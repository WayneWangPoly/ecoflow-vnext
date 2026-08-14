#!/usr/bin/env node
import {
  extractTimestamp,
  fetchOrdermentumJson,
  getLegacyBearerToken,
  hashPayload,
  optionalSupabase,
  parseArgs,
  requireEnv,
} from './ordermentum-master-data-common.mjs';
import {
  buildArchivedVersion,
  shouldArchivePreviousVersion,
} from './ordermentum-master-version-policy.mjs';

const args = parseArgs(process.argv);
const supabase = optionalSupabase();
if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const supplierId = process.env.ORDERMENTUM_SUPPLIER_ID || requireEnv('ORDERMENTUM_SUPPLIER_ID');
const token = await getLegacyBearerToken();
const force = Boolean(args.force);
const delayMs = Number(args['delay-ms'] || 300);
const pageSize = Math.max(50, Math.min(1000, Number(args['page-size'] || 500)));
const minPageSize = Math.max(50, Math.min(pageSize, Number(args['min-page-size'] || 50)));
const limit = Math.max(1, Number(args.limit || 10000));

function errorDetails(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, code: error.cause?.code || null };
  if (error && typeof error === 'object') {
    return {
      name: error.name || 'StructuredError',
      message: error.message || error.error_description || error.error || 'Unknown structured error',
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null,
      status: error.status || error.statusCode || null,
    };
  }
  return { name: typeof error, message: String(error), code: null };
}

function errorMessage(error) {
  const detail = errorDetails(error);
  return [
    detail.message,
    detail.code ? `code=${detail.code}` : null,
    detail.details ? `details=${detail.details}` : null,
    detail.hint ? `hint=${detail.hint}` : null,
    detail.status ? `status=${detail.status}` : null,
  ].filter(Boolean).join(' | ');
}

function isStatementTimeout(error) {
  const detail = errorDetails(error);
  return detail.code === '57014' || /statement timeout/i.test(detail.message || '');
}

const { data: runRow, error: runError } = await supabase
  .from('ordermentum_master_sync_runs')
  .insert({
    run_type: 'MASTER_DATA_SYNC',
    status: 'RUNNING',
    supplier_id: supplierId,
    resources_requested: ['invoice_detail'],
    dry_run: false,
    auth_mode: process.env.ORDERMENTUM_API_KEY ? 'api-key' : 'legacy-username-password',
  })
  .select('id')
  .single();
if (runError || !runRow) throw runError || new Error('Could not create invoice detail sync run.');
const runId = runRow.id;

async function loadMetadata(resourceType) {
  const rows = [];
  let from = 0;
  let currentPageSize = pageSize;

  while (rows.length < limit) {
    const to = Math.min(from + currentPageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('ordermentum_raw_master_resources')
      .select('external_id,payload_hash,remote_updated_at')
      .eq('resource_type', resourceType)
      .order('external_id', { ascending: true })
      .range(from, to);

    if (error) {
      if (isStatementTimeout(error) && currentPageSize > minPageSize) {
        const nextPageSize = Math.max(minPageSize, Math.floor(currentPageSize / 2));
        console.warn(JSON.stringify({
          action: 'invoice_detail_metadata_page_retry',
          resourceType,
          from,
          attemptedPageSize: currentPageSize,
          nextPageSize,
          error: errorDetails(error),
        }));
        currentPageSize = nextPageSize;
        continue;
      }
      const prefix = isStatementTimeout(error) && currentPageSize <= minPageSize
        ? `Invoice detail metadata read exhausted minimum page size ${minPageSize}`
        : 'Invoice detail metadata read failed';
      const wrapped = new Error(`${prefix} for ${resourceType} at offset ${from}: ${errorMessage(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }

    const page = data ?? [];
    rows.push(...page);
    console.log(JSON.stringify({
      action: 'invoice_detail_metadata_page',
      resourceType,
      from,
      pageSize: currentPageSize,
      rows: page.length,
      totalLoaded: rows.length,
    }));
    from += page.length;
    if (page.length < currentPageSize || page.length === 0) break;
  }

  return rows.slice(0, limit);
}

async function loadCurrentDetailWithPayload(externalId) {
  const result = await supabase
    .from('ordermentum_raw_master_resources')
    .select('resource_type,external_id,supplier_id,source_endpoint,payload,payload_hash,sync_run_id')
    .eq('resource_type', 'invoice_detail')
    .eq('external_id', externalId)
    .single();
  if (result.error || !result.data) throw result.error || new Error(`Existing invoice detail ${externalId} disappeared during sync.`);
  return result.data;
}

async function archivePreviousVersion(previous, sourceEndpoint) {
  const latest = await supabase
    .from('ordermentum_raw_master_resource_versions')
    .select('payload_hash')
    .eq('resource_type', 'invoice_detail')
    .eq('external_id', previous.external_id)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;

  if (latest.data?.payload_hash === previous.payload_hash) return { archived: false, deduped: true };

  const result = await supabase
    .from('ordermentum_raw_master_resource_versions')
    .insert(buildArchivedVersion(previous, { supplierId, sourceEndpoint, syncRunId: runId }));
  if (result.error) throw result.error;
  return { archived: true, deduped: false };
}

async function touchUnchangedDetail(externalId, { sourceEndpoint, remoteCreatedAt, remoteUpdatedAt, now }) {
  const patch = {
    source_endpoint: sourceEndpoint,
    last_seen_at: now,
    last_synced_at: now,
    is_deleted_or_missing: false,
    sync_run_id: runId,
  };
  if (remoteCreatedAt) patch.remote_created_at = remoteCreatedAt;
  if (remoteUpdatedAt) patch.remote_updated_at = remoteUpdatedAt;
  const result = await supabase
    .from('ordermentum_raw_master_resources')
    .update(patch)
    .eq('resource_type', 'invoice_detail')
    .eq('external_id', externalId);
  if (result.error) throw result.error;
}

function fillTemplate(template, externalId) {
  return String(template || '')
    .replace(/\{\{\s*(id|invoiceId)\s*\}\}/g, encodeURIComponent(externalId))
    .replace(/\{\{\s*baseUrl\s*\}\}/g, process.env.ORDERMENTUM_API_BASE_URL || 'https://api.ordermentum.com');
}

async function fetchInvoiceDetail(externalId) {
  const configured = process.env.ORDERMENTUM_INVOICE_DETAIL_URL_TEMPLATE
    ? fillTemplate(process.env.ORDERMENTUM_INVOICE_DETAIL_URL_TEMPLATE, externalId)
    : null;
  const candidates = [
    configured,
    `/v1/invoices/${encodeURIComponent(externalId)}`,
    `/v2/invoices/${encodeURIComponent(externalId)}`,
  ].filter(Boolean);
  let lastResult = null;
  for (const path of candidates) {
    const result = await fetchOrdermentumJson(token, path, {});
    lastResult = result;
    if (result.ok && result.data) return { ...result, path };
    if (result.status !== 404 && result.status !== 405) break;
  }
  return lastResult;
}

const counters = {
  summaries: 0,
  attempted: 0,
  succeeded: 0,
  unchanged: 0,
  fetchedUnchanged: 0,
  changed: 0,
  metadataTouched: 0,
  versionsArchived: 0,
  versionsArchiveDeduped: 0,
  failed: 0,
};
const failures = [];

try {
  const summaries = await loadMetadata('invoices');
  const existingDetails = await loadMetadata('invoice_detail');
  counters.summaries = summaries.length;
  const detailById = new Map(existingDetails.map((row) => [String(row.external_id), row]));

  for (const summary of summaries) {
    const externalId = String(summary.external_id || '');
    if (!externalId) continue;
    const current = detailById.get(externalId);
    const summaryUpdated = summary.remote_updated_at ? new Date(summary.remote_updated_at).getTime() : 0;
    const detailUpdated = current?.remote_updated_at ? new Date(current.remote_updated_at).getTime() : 0;
    if (!force && current && current.payload_hash && detailUpdated >= summaryUpdated) {
      counters.unchanged += 1;
      continue;
    }

    counters.attempted += 1;
    try {
      const result = await fetchInvoiceDetail(externalId);
      if (!result?.ok || !result.data) {
        counters.failed += 1;
        failures.push({ externalId, status: result?.status ?? null, payload: result?.data ?? null });
        continue;
      }

      const payloadHash = hashPayload(result.data);
      const changed = !current || current.payload_hash !== payloadHash;
      const now = new Date().toISOString();
      const remoteCreatedAt = extractTimestamp(result.data, ['createdAt', 'created_at', 'date', 'invoiceDate']);
      const remoteUpdatedAt = extractTimestamp(result.data, ['updatedAt', 'updated_at', 'modifiedAt', 'lastModifiedAt']) || summary.remote_updated_at;

      if (!changed) {
        await touchUnchangedDetail(externalId, {
          sourceEndpoint: result.path,
          remoteCreatedAt,
          remoteUpdatedAt,
          now,
        });
        counters.fetchedUnchanged += 1;
        counters.metadataTouched += 1;
        counters.succeeded += 1;
        continue;
      }

      if (shouldArchivePreviousVersion(current, payloadHash)) {
        const previous = await loadCurrentDetailWithPayload(externalId);
        const archived = await archivePreviousVersion(previous, result.path);
        if (archived.archived) counters.versionsArchived += 1;
        if (archived.deduped) counters.versionsArchiveDeduped += 1;
      }

      const row = {
        resource_type: 'invoice_detail',
        external_id: externalId,
        supplier_id: supplierId,
        source_endpoint: result.path,
        source_method: 'GET',
        request_query: {},
        payload: result.data,
        payload_hash: payloadHash,
        previous_payload_hash: current?.payload_hash || null,
        remote_created_at: remoteCreatedAt,
        remote_updated_at: remoteUpdatedAt,
        last_seen_at: now,
        last_synced_at: now,
        is_deleted_or_missing: false,
        sync_run_id: runId,
      };

      const saved = await supabase
        .from('ordermentum_raw_master_resources')
        .upsert(row, { onConflict: 'resource_type,external_id' });
      if (saved.error) throw saved.error;

      counters.changed += 1;
      counters.succeeded += 1;
    } catch (error) {
      counters.failed += 1;
      failures.push({ externalId, message: errorMessage(error), error: errorDetails(error) });
    }

    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const finalStatus = counters.failed > 0 ? 'PARTIAL' : 'SUCCEEDED';
  const { error: finalError } = await supabase
    .from('ordermentum_master_sync_runs')
    .update({
      status: finalStatus,
      resources_succeeded: counters.succeeded || counters.unchanged ? ['invoice_detail'] : [],
      resources_failed: counters.failed ? ['invoice_detail'] : [],
      endpoints_attempted: counters.attempted,
      records_seen: counters.summaries,
      records_upserted: counters.changed + counters.metadataTouched,
      records_changed: counters.changed,
      detail_attempted: counters.attempted,
      detail_succeeded: counters.succeeded,
      detail_failed: counters.failed,
      finished_at: new Date().toISOString(),
      last_error: counters.failed ? JSON.stringify(failures.slice(0, 10)).slice(0, 2000) : null,
      notes: {
        unchanged: counters.unchanged,
        fetchedUnchanged: counters.fetchedUnchanged,
        metadataTouched: counters.metadataTouched,
        versionsArchived: counters.versionsArchived,
        versionsArchiveDeduped: counters.versionsArchiveDeduped,
        metadataPageSize: pageSize,
        metadataMinPageSize: minPageSize,
        failures: failures.slice(0, 25),
      },
    })
    .eq('id', runId);
  if (finalError) throw finalError;

  console.log(JSON.stringify({ action: 'invoice_detail_sync', runId, status: finalStatus, pageSize, minPageSize, ...counters, failures: failures.slice(0, 25) }, null, 2));
  if (counters.failed > 0) process.exitCode = 2;
} catch (error) {
  const message = errorMessage(error);
  const failed = await supabase
    .from('ordermentum_master_sync_runs')
    .update({
      status: 'FAILED',
      finished_at: new Date().toISOString(),
      last_error: message.slice(0, 2000),
      notes: { phase: 'invoice_detail_sync', error: errorDetails(error), pageSize, minPageSize },
    })
    .eq('id', runId);
  if (failed.error) console.error(JSON.stringify({ action: 'invoice_detail_run_failure_record_error', error: errorDetails(failed.error) }));
  throw error;
}
