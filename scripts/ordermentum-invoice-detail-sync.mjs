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

const args = parseArgs(process.argv);
const supabase = optionalSupabase();
if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const supplierId = process.env.ORDERMENTUM_SUPPLIER_ID || requireEnv('ORDERMENTUM_SUPPLIER_ID');
const token = await getLegacyBearerToken();
const force = Boolean(args.force);
const delayMs = Number(args['delay-ms'] || 300);
const pageSize = Math.max(50, Math.min(1000, Number(args['page-size'] || 500)));
const limit = Math.max(1, Number(args.limit || 10000));

async function loadAll(resourceType) {
  const rows = [];
  for (let from = 0; rows.length < limit; from += pageSize) {
    const { data, error } = await supabase
      .from('ordermentum_raw_master_resources')
      .select('external_id,payload,payload_hash,remote_created_at,remote_updated_at,last_synced_at')
      .eq('resource_type', resourceType)
      .order('external_id', { ascending: true })
      .range(from, Math.min(from + pageSize - 1, limit - 1));
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.slice(0, limit);
}

async function fetchInvoiceDetail(externalId) {
  const candidates = [
    `/v1/invoices/${encodeURIComponent(externalId)}`,
    `/v2/invoices/${encodeURIComponent(externalId)}`,
  ];
  let lastResult = null;
  for (const path of candidates) {
    const result = await fetchOrdermentumJson(token, path, {});
    lastResult = result;
    if (result.ok && result.data) return { ...result, path };
    if (result.status !== 404 && result.status !== 405) break;
  }
  return lastResult;
}

const summaries = await loadAll('invoices');
const existingDetails = await loadAll('invoice_detail');
const detailById = new Map(existingDetails.map((row) => [String(row.external_id), row]));
const counters = { summaries: summaries.length, attempted: 0, succeeded: 0, unchanged: 0, failed: 0 };
const failures = [];

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
      sync_run_id: null,
    };

    const { error } = await supabase
      .from('ordermentum_raw_master_resources')
      .upsert(row, { onConflict: 'resource_type,external_id' });
    if (error) throw error;

    if (changed) {
      const { error: versionError } = await supabase
        .from('ordermentum_raw_master_resource_versions')
        .insert({
          resource_type: 'invoice_detail',
          external_id: externalId,
          supplier_id: supplierId,
          source_endpoint: result.path,
          payload: result.data,
          payload_hash: payloadHash,
          sync_run_id: null,
        });
      if (versionError) throw versionError;
    }

    counters.succeeded += 1;
  } catch (error) {
    counters.failed += 1;
    failures.push({ externalId, message: error instanceof Error ? error.message : String(error) });
  }

  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

console.log(JSON.stringify({ action: 'invoice_detail_sync', ...counters, failures: failures.slice(0, 25) }, null, 2));
if (counters.failed > 0) process.exitCode = 2;
