#!/usr/bin/env node
import {
  RESOURCE_DEFINITIONS, extractArray, extractExternalId, extractTimestamp, fetchOrdermentumJson,
  getLegacyBearerToken, hashPayload, optionalSupabase, parseArgs, requireEnv,
} from './ordermentum-master-data-common.mjs';
import {
  buildArchivedVersion,
  shouldArchivePreviousVersion,
} from './ordermentum-master-version-policy.mjs';

const args = parseArgs(process.argv);
const supabase = optionalSupabase();
if (!supabase && !args['dry-run']) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.');
const supplierId = process.env.ORDERMENTUM_SUPPLIER_ID || args.supplierId || requireEnv('ORDERMENTUM_SUPPLIER_ID');
const token = await getLegacyBearerToken();
const dryRun = Boolean(args['dry-run'] || args.dryRun);
const resources = String(args.resources || Object.keys(RESOURCE_DEFINITIONS).filter((r) => r !== 'leads').join(',')).split(',').map((x) => x.trim()).filter(Boolean);
const pageSize = Number(args['page-size'] || args.pageSize || 50);
const maxPages = Number(args['max-pages'] || args.maxPages || 50);
const detail = Boolean(args.detail);
const detailChangedOnly = detail && args['detail-changed-only'] !== 'false';
const delayMs = Number(args['delay-ms'] || args.delayMs || 300);
let runId = null;
const counters = {
  endpointsAttempted: 0, pagesSeen: 0, recordsSeen: 0, recordsUpserted: 0, recordsChanged: 0,
  versionsArchived: 0, versionsArchiveDeduped: 0,
  detailAttempted: 0, detailSucceeded: 0, detailFailed: 0, detailSkippedUnchanged: 0, storesProjected: 0,
};
const resourcesSucceeded = []; const resourcesFailed = []; const resourcesUnavailable = [];
const errors = []; const warnings = []; const detailFailuresByResource = {}; const detailSkippedByResource = {};

function isOptionalCapabilityUnavailable(resource, error) {
  const message = error instanceof Error ? error.message : String(error);
  return RESOURCE_DEFINITIONS[resource]?.optionalCapability === true && /failed\s+(404|405)\b/i.test(message);
}

if (supabase) {
  const result = await supabase.from('ordermentum_master_sync_runs').insert({
    run_type: 'MASTER_DATA_SYNC', status: dryRun ? 'DRY_RUN' : 'RUNNING', supplier_id: supplierId,
    resources_requested: resources, dry_run: dryRun,
    auth_mode: process.env.ORDERMENTUM_BEARER_TOKEN ? 'legacy-bearer-env' : 'legacy-username-password',
  }).select('id').single();
  if (result.error) throw result.error; runId = result.data.id;
}

async function loadExistingDetailIds(resourceType) {
  const ids = new Set();
  if (!supabase || dryRun || !resourceType) return ids;
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from('ordermentum_raw_master_resources').select('external_id')
      .eq('resource_type', resourceType).order('external_id', { ascending: true }).range(from, from + 999);
    if (result.error) throw result.error;
    for (const row of result.data ?? []) if (row.external_id) ids.add(String(row.external_id));
    if ((result.data ?? []).length < 1000) break;
  }
  return ids;
}

async function archivePreviousVersion(existing, resourceType, externalId, sourceEndpoint) {
  const latest = await supabase.from('ordermentum_raw_master_resource_versions').select('payload_hash')
    .eq('resource_type', resourceType).eq('external_id', externalId)
    .order('changed_at', { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw latest.error;

  // If a previous archive succeeded but the current-row upsert failed, a retry
  // must not append the same prior snapshot again.
  if (latest.data?.payload_hash === existing.payload_hash) {
    counters.versionsArchiveDeduped += 1;
    return;
  }

  const version = await supabase.from('ordermentum_raw_master_resource_versions').insert(
    buildArchivedVersion(existing, { supplierId, sourceEndpoint, syncRunId: runId }),
  );
  if (version.error) throw version.error;
  counters.versionsArchived += 1;
}

async function upsertRaw(resourceType, sourceEndpoint, requestQuery, item) {
  const externalId = extractExternalId(item, resourceType);
  const payloadHash = hashPayload(item);
  const remoteCreatedAt = extractTimestamp(item, ['createdAt', 'created_at', 'created', 'product.createdAt', 'retailer.createdAt']);
  const remoteUpdatedAt = extractTimestamp(item, ['updatedAt', 'updated_at', 'modifiedAt', 'lastModifiedAt', 'product.updatedAt', 'retailer.updatedAt']);
  counters.recordsSeen += 1;
  if (dryRun || !supabase) return { externalId, changed: false };
  const existing = await supabase.from('ordermentum_raw_master_resources')
    .select('resource_type,external_id,supplier_id,source_endpoint,payload,payload_hash,sync_run_id')
    .eq('resource_type', resourceType).eq('external_id', externalId).maybeSingle();
  if (existing.error) throw existing.error;

  const changed = !existing.data || existing.data.payload_hash !== payloadHash;
  const archivePrevious = shouldArchivePreviousVersion(existing.data, payloadHash);

  if (archivePrevious) await archivePreviousVersion(existing.data, resourceType, externalId, sourceEndpoint);

  const row = {
    resource_type: resourceType, external_id: externalId, supplier_id: supplierId, source_endpoint: sourceEndpoint,
    source_method: 'GET', request_query: requestQuery, payload: item, payload_hash: payloadHash,
    previous_payload_hash: existing.data?.payload_hash || null, remote_created_at: remoteCreatedAt,
    remote_updated_at: remoteUpdatedAt, last_seen_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
    is_deleted_or_missing: false, sync_run_id: runId,
  };
  const saved = await supabase.from('ordermentum_raw_master_resources').upsert(row, { onConflict: 'resource_type,external_id' });
  if (saved.error) throw saved.error; counters.recordsUpserted += 1;
  if (changed) counters.recordsChanged += 1;
  return { externalId, changed };
}

async function syncResource(resource) {
  const def = RESOURCE_DEFINITIONS[resource];
  if (!def) throw new Error(`Unknown resource: ${resource}`);
  let pageNo = 1; let totalItems = 0; const detailIds = [];
  const existingDetailIds = detail && def.detailPath && detailChangedOnly ? await loadExistingDetailIds(def.detailType) : new Set();
  while (pageNo <= maxPages) {
    const query = { pageNo, pageSize }; if (def.needsSupplierId !== false) query.supplierId = supplierId;
    counters.endpointsAttempted += 1;
    const result = await fetchOrdermentumJson(token, def.path, query); counters.pagesSeen += 1;
    if (!result.ok) throw new Error(`${resource} ${def.path} failed ${result.status}: ${JSON.stringify(result.data).slice(0, 1000)}`);
    const items = extractArray(result.data, resource);
    for (const item of items) {
      const saved = await upsertRaw(resource, def.path, query, item);
      if (detail && def.detailPath && saved.externalId) {
        if (!detailChangedOnly || saved.changed || !existingDetailIds.has(saved.externalId)) detailIds.push(saved.externalId);
        else { counters.detailSkippedUnchanged += 1; detailSkippedByResource[resource] = (detailSkippedByResource[resource] || 0) + 1; }
      }
    }
    totalItems += items.length;
    console.log(JSON.stringify({ action: 'master_resource_page', resource, page: pageNo, items: items.length, detail_queued: detailIds.length, detail_skipped_unchanged: detailSkippedByResource[resource] || 0 }));
    if (items.length < pageSize || items.length === 0) break;
    pageNo += 1; if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (detail && def.detailPath && detailIds.length) {
    const uniqueIds = [...new Set(detailIds)];
    for (let index = 0; index < uniqueIds.length; index += 1) {
      const externalId = uniqueIds[index]; counters.detailAttempted += 1;
      const path = def.detailPath(externalId); const result = await fetchOrdermentumJson(token, path, {});
      if (result.ok && result.data) { await upsertRaw(def.detailType, path, {}, result.data); existingDetailIds.add(externalId); counters.detailSucceeded += 1; }
      else { counters.detailFailed += 1; detailFailuresByResource[resource] = (detailFailuresByResource[resource] || 0) + 1; console.warn(`[${resource}] detail ${externalId} failed ${result.status}`); }
      if ((index + 1) % 25 === 0 || index === uniqueIds.length - 1) console.log(JSON.stringify({ action: 'master_detail_progress', resource, completed: index + 1, total: uniqueIds.length, failed: detailFailuresByResource[resource] || 0 }));
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return totalItems;
}

async function projectStores() {
  if (dryRun || !supabase || !resources.includes('purchasers') || !resourcesSucceeded.includes('purchasers')) return;
  const result = await supabase.rpc('ecoflow_project_ordermentum_stores');
  if (result.error) throw result.error; counters.storesProjected = Number((result.data ?? [])[0]?.projected_count || 0);
}

try {
  for (const resource of resources) {
    try { const count = await syncResource(resource); resourcesSucceeded.push(resource); console.log(`[${resource}] completed: ${count}`); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isOptionalCapabilityUnavailable(resource, error)) { resourcesUnavailable.push(resource); warnings.push({ resource, message }); console.warn(`[${resource}] optional capability unavailable: ${message}`); }
      else { resourcesFailed.push(resource); errors.push({ resource, message }); console.error(`[${resource}] failed: ${message}`); }
    }
  }
  try { await projectStores(); } catch (error) { const message = error instanceof Error ? error.message : String(error); resourcesFailed.push('store_projection'); errors.push({ resource: 'store_projection', message }); }
  const status = dryRun ? 'DRY_RUN' : resourcesFailed.length ? 'PARTIAL' : 'SUCCEEDED';
  if (supabase && runId) await supabase.from('ordermentum_master_sync_runs').update({
    status, resources_succeeded: resourcesSucceeded, resources_failed: resourcesFailed,
    endpoints_attempted: counters.endpointsAttempted, pages_seen: counters.pagesSeen, records_seen: counters.recordsSeen,
    records_upserted: counters.recordsUpserted, records_changed: counters.recordsChanged,
    detail_attempted: counters.detailAttempted, detail_succeeded: counters.detailSucceeded, detail_failed: counters.detailFailed,
    finished_at: new Date().toISOString(), last_error: errors.length ? JSON.stringify(errors).slice(0, 2000) : null,
    notes: { errors, warnings, resourcesUnavailable, detailFailuresByResource, detailSkippedByResource, detailSkippedUnchanged: counters.detailSkippedUnchanged, storesProjected: counters.storesProjected, versionsArchived: counters.versionsArchived, versionsArchiveDeduped: counters.versionsArchiveDeduped },
  }).eq('id', runId);
  console.log(JSON.stringify({ runId, dryRun, supplierId, resources, resourcesSucceeded, resourcesUnavailable, resourcesFailed, ...counters, detailChangedOnly, detailFailuresByResource, detailSkippedByResource, warnings, errors }, null, 2));
  if (resourcesFailed.length) process.exitCode = 2;
} catch (error) {
  if (supabase && runId) await supabase.from('ordermentum_master_sync_runs').update({ status: 'FAILED', finished_at: new Date().toISOString(), last_error: error.message }).eq('id', runId);
  throw error;
}
