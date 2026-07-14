#!/usr/bin/env node
import {
  RESOURCE_DEFINITIONS,
  extractArray,
  extractExternalId,
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
if (!supabase && !args['dry-run']) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.');
}
const supplierId = process.env.ORDERMENTUM_SUPPLIER_ID || args.supplierId || requireEnv('ORDERMENTUM_SUPPLIER_ID');
const token = await getLegacyBearerToken();
const dryRun = Boolean(args['dry-run'] || args.dryRun);
const resources = String(args.resources || Object.keys(RESOURCE_DEFINITIONS).filter((r) => r !== 'leads').join(','))
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const pageSize = Number(args['page-size'] || args.pageSize || 50);
const maxPages = Number(args['max-pages'] || args.maxPages || 50);
const detail = Boolean(args.detail);
const delayMs = Number(args['delay-ms'] || args.delayMs || 300);

let runId = null;
const counters = {
  endpointsAttempted: 0,
  pagesSeen: 0,
  recordsSeen: 0,
  recordsUpserted: 0,
  recordsChanged: 0,
  detailAttempted: 0,
  detailSucceeded: 0,
  detailFailed: 0,
  storesProjected: 0,
};
const resourcesSucceeded = [];
const resourcesFailed = [];
const resourcesUnavailable = [];
const errors = [];
const warnings = [];
const detailFailuresByResource = {};

function isOptionalCapabilityUnavailable(resource, error) {
  const definition = RESOURCE_DEFINITIONS[resource];
  const message = error instanceof Error ? error.message : String(error);
  return definition?.optionalCapability === true && /failed\s+(404|405)\b/i.test(message);
}

if (supabase) {
  const { data, error } = await supabase
    .from('ordermentum_master_sync_runs')
    .insert({
      run_type: 'MASTER_DATA_SYNC',
      status: dryRun ? 'DRY_RUN' : 'RUNNING',
      supplier_id: supplierId,
      resources_requested: resources,
      dry_run: dryRun,
      auth_mode: process.env.ORDERMENTUM_BEARER_TOKEN ? 'legacy-bearer-env' : 'legacy-username-password',
    })
    .select('id')
    .single();
  if (error) throw error;
  runId = data.id;
}

async function upsertRaw(resourceType, sourceEndpoint, requestQuery, item) {
  const externalId = extractExternalId(item, resourceType);
  const payloadHash = hashPayload(item);
  const remoteCreatedAt = extractTimestamp(item, ['createdAt', 'created_at', 'created', 'product.createdAt', 'retailer.createdAt']);
  const remoteUpdatedAt = extractTimestamp(item, ['updatedAt', 'updated_at', 'modifiedAt', 'lastModifiedAt', 'product.updatedAt', 'retailer.updatedAt']);
  counters.recordsSeen += 1;
  if (dryRun || !supabase) return { externalId, changed: false };

  const { data: existing, error: existingError } = await supabase
    .from('ordermentum_raw_master_resources')
    .select('payload_hash')
    .eq('resource_type', resourceType)
    .eq('external_id', externalId)
    .maybeSingle();
  if (existingError) throw existingError;
  const changed = !existing || existing.payload_hash !== payloadHash;

  const row = {
    resource_type: resourceType,
    external_id: externalId,
    supplier_id: supplierId,
    source_endpoint: sourceEndpoint,
    source_method: 'GET',
    request_query: requestQuery,
    payload: item,
    payload_hash: payloadHash,
    previous_payload_hash: existing?.payload_hash || null,
    remote_created_at: remoteCreatedAt,
    remote_updated_at: remoteUpdatedAt,
    last_seen_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    is_deleted_or_missing: false,
    sync_run_id: runId,
  };
  const { error } = await supabase
    .from('ordermentum_raw_master_resources')
    .upsert(row, { onConflict: 'resource_type,external_id' });
  if (error) throw error;
  counters.recordsUpserted += 1;
  if (changed) {
    counters.recordsChanged += 1;
    await supabase.from('ordermentum_raw_master_resource_versions').insert({
      resource_type: resourceType,
      external_id: externalId,
      supplier_id: supplierId,
      source_endpoint: sourceEndpoint,
      payload: item,
      payload_hash: payloadHash,
      sync_run_id: runId,
    });
  }
  return { externalId, changed };
}

async function syncResource(resource) {
  const def = RESOURCE_DEFINITIONS[resource];
  if (!def) throw new Error(`Unknown resource: ${resource}`);
  let pageNo = 1;
  let totalItems = 0;
  const detailIds = [];

  while (pageNo <= maxPages) {
    const query = { pageNo, pageSize };
    if (def.needsSupplierId !== false) query.supplierId = supplierId;
    counters.endpointsAttempted += 1;
    const result = await fetchOrdermentumJson(token, def.path, query);
    counters.pagesSeen += 1;
    if (!result.ok) throw new Error(`${resource} ${def.path} failed ${result.status}: ${JSON.stringify(result.data).slice(0, 1000)}`);
    const items = extractArray(result.data, resource);
    for (const item of items) {
      const { externalId } = await upsertRaw(resource, def.path, query, item);
      if (detail && def.detailPath && externalId) detailIds.push(externalId);
    }
    totalItems += items.length;
    console.log(`[${resource}] page ${pageNo}: ${items.length}`);
    if (items.length < pageSize || items.length === 0) break;
    pageNo += 1;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (detail && def.detailPath && detailIds.length) {
    const uniqueIds = [...new Set(detailIds)];
    for (const externalId of uniqueIds) {
      counters.detailAttempted += 1;
      const path = def.detailPath(externalId);
      const result = await fetchOrdermentumJson(token, path, {});
      if (result.ok && result.data) {
        await upsertRaw(def.detailType, path, {}, result.data);
        counters.detailSucceeded += 1;
      } else {
        counters.detailFailed += 1;
        detailFailuresByResource[resource] = (detailFailuresByResource[resource] || 0) + 1;
        console.warn(`[${resource}] detail ${externalId} failed ${result.status}: ${JSON.stringify(result.data).slice(0, 400)}`);
      }
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return totalItems;
}

async function projectOperationalStores() {
  if (dryRun || !supabase || !resources.includes('purchasers') || !resourcesSucceeded.includes('purchasers')) return;
  const { data, error } = await supabase.rpc('ecoflow_project_ordermentum_stores');
  if (error) throw error;
  const result = (data ?? [])[0] ?? {};
  counters.storesProjected = Number(result.projected_count || 0);
  console.log(`[purchasers] operational store master projected: ${counters.storesProjected}`);
}

try {
  for (const resource of resources) {
    try {
      const count = await syncResource(resource);
      resourcesSucceeded.push(resource);
      console.log(`[${resource}] completed: ${count}`);
    } catch (error) {
      if (isOptionalCapabilityUnavailable(resource, error)) {
        const message = error instanceof Error ? error.message : String(error);
        resourcesUnavailable.push(resource);
        warnings.push({ resource, message });
        console.warn(`[${resource}] unavailable optional Ordermentum capability: ${message}`);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      resourcesFailed.push(resource);
      errors.push({ resource, message });
      console.error(`[${resource}] failed:`, message);
    }
  }

  try {
    await projectOperationalStores();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resourcesFailed.push('store_projection');
    errors.push({ resource: 'store_projection', message });
    console.error('[store_projection] failed:', message);
  }

  const status = dryRun ? 'DRY_RUN' : (resourcesFailed.length ? 'PARTIAL' : 'SUCCEEDED');
  if (supabase && runId) {
    await supabase
      .from('ordermentum_master_sync_runs')
      .update({
        status,
        resources_succeeded: resourcesSucceeded,
        resources_failed: resourcesFailed,
        endpoints_attempted: counters.endpointsAttempted,
        pages_seen: counters.pagesSeen,
        records_seen: counters.recordsSeen,
        records_upserted: counters.recordsUpserted,
        records_changed: counters.recordsChanged,
        detail_attempted: counters.detailAttempted,
        detail_succeeded: counters.detailSucceeded,
        detail_failed: counters.detailFailed,
        finished_at: new Date().toISOString(),
        last_error: errors.length ? JSON.stringify(errors).slice(0, 2000) : null,
        notes: {
          errors,
          warnings,
          resourcesUnavailable,
          detailFailuresByResource,
          storesProjected: counters.storesProjected,
        },
      })
      .eq('id', runId);
  }
  console.log(JSON.stringify({
    runId,
    dryRun,
    supplierId,
    resources,
    resourcesSucceeded,
    resourcesUnavailable,
    resourcesFailed,
    ...counters,
    detailFailuresByResource,
    warnings,
    errors,
  }, null, 2));
  if (resourcesFailed.length) process.exitCode = 2;
} catch (error) {
  if (supabase && runId) {
    await supabase
      .from('ordermentum_master_sync_runs')
      .update({ status: 'FAILED', finished_at: new Date().toISOString(), last_error: error.message })
      .eq('id', runId);
  }
  throw error;
}
