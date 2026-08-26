#!/usr/bin/env node
import process from 'node:process';
import {
  extractTimestamp,
  fetchOrdermentumJson,
  getLegacyBearerToken,
  optionalSupabase,
  parseArgs,
  requireEnv,
} from './ordermentum-master-data-common.mjs';
import {
  buildArchivedVersion,
  shouldArchivePreviousVersion,
} from './ordermentum-master-version-policy.mjs';
import {
  PURCHASER_DETAIL_RESOURCE_TYPE,
  hashTargetPayload,
  mergeStoreProjection,
  projectPurchaserToStoreRow,
  purchaserDetailPath,
  resolvePurchaserIdentity,
  unchangedTarget,
} from './ordermentum-targeted-store-sync-core.mjs';

const args = parseArgs(process.argv);
const externalId = String(args['external-id'] || args.externalId || '').trim();
const resource = String(args.resource || 'purchaser').trim().toLowerCase();
if (resource !== 'purchaser') throw new Error(`Unsupported targeted resource: ${resource}`);
const path = purchaserDetailPath(externalId);

const supabase = optionalSupabase();
if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const supplierId = process.env.ORDERMENTUM_SUPPLIER_ID || requireEnv('ORDERMENTUM_SUPPLIER_ID');
const token = await getLegacyBearerToken();

async function latestArchivedHash() {
  const result = await supabase
    .from('ordermentum_raw_master_resource_versions')
    .select('payload_hash')
    .eq('resource_type', PURCHASER_DETAIL_RESOURCE_TYPE)
    .eq('external_id', externalId)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.payload_hash || null;
}

async function archivePrevious(existing) {
  if (!shouldArchivePreviousVersion(existing, nextHash)) return false;
  if ((await latestArchivedHash()) === existing.payload_hash) return false;
  const version = buildArchivedVersion(existing, {
    supplierId,
    sourceEndpoint: path,
    syncRunId: null,
  });
  const result = await supabase.from('ordermentum_raw_master_resource_versions').insert(version);
  if (result.error) throw result.error;
  return true;
}

const response = await fetchOrdermentumJson(token, path, {});
if (!response.ok || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
  throw new Error(`Targeted purchaser ${externalId} failed ${response.status}: ${JSON.stringify(response.data).slice(0, 1000)}`);
}
const payload = response.data;
resolvePurchaserIdentity(payload, externalId);
const nextHash = hashTargetPayload(payload);

// The no-op path intentionally performs only SELECTs after the single source GET.
// Do not touch timestamps or operational-job history: unchanged means zero DB writes.
const existingHashResult = await supabase
  .from('ordermentum_raw_master_resources')
  .select('payload_hash')
  .eq('resource_type', PURCHASER_DETAIL_RESOURCE_TYPE)
  .eq('external_id', externalId)
  .maybeSingle();
if (existingHashResult.error) throw existingHashResult.error;

if (unchangedTarget(existingHashResult.data?.payload_hash, nextHash)) {
  console.log(JSON.stringify({
    action: 'targeted_ordermentum_store_sync',
    resource,
    externalId,
    endpoint: path,
    changed: false,
    databaseWrites: 0,
    storeProjection: 'not_needed',
  }, null, 2));
  process.exit(0);
}

let previous = null;
if (existingHashResult.data) {
  const fullExisting = await supabase
    .from('ordermentum_raw_master_resources')
    .select('resource_type,external_id,supplier_id,source_endpoint,payload,payload_hash,sync_run_id')
    .eq('resource_type', PURCHASER_DETAIL_RESOURCE_TYPE)
    .eq('external_id', externalId)
    .single();
  if (fullExisting.error) throw fullExisting.error;
  previous = fullExisting.data;
}

const versionArchived = previous ? await archivePrevious(previous) : false;
const now = new Date().toISOString();
const rawRow = {
  resource_type: PURCHASER_DETAIL_RESOURCE_TYPE,
  external_id: externalId,
  supplier_id: supplierId,
  source_endpoint: path,
  source_method: 'GET',
  request_query: {},
  payload,
  payload_hash: nextHash,
  previous_payload_hash: previous?.payload_hash || null,
  remote_created_at: extractTimestamp(payload, ['createdAt', 'created_at', 'created', 'retailer.createdAt']),
  remote_updated_at: extractTimestamp(payload, ['updatedAt', 'updated_at', 'modifiedAt', 'lastModifiedAt', 'retailer.updatedAt']),
  last_seen_at: now,
  last_synced_at: now,
  is_deleted_or_missing: false,
};
const rawSaved = await supabase
  .from('ordermentum_raw_master_resources')
  .upsert(rawRow, { onConflict: 'resource_type,external_id' });
if (rawSaved.error) throw rawSaved.error;

const projected = projectPurchaserToStoreRow(payload, externalId);
const existingStore = await supabase
  .from('ecoflow_store_sites')
  .select('retailer_id,purchaser_id,store_name,street1,street2,suburb,state,postcode,formatted_address,latitude,longitude,contact_phone,delivery_instructions,price_group_id,source,verified,notes')
  .eq('retailer_id', projected.retailer_id)
  .maybeSingle();
if (existingStore.error) throw existingStore.error;

const storeMerge = mergeStoreProjection(existingStore.data, projected, now);
let storeWrites = 0;
if (storeMerge.row) {
  const storeSaved = await supabase
    .from('ecoflow_store_sites')
    .upsert(storeMerge.row, { onConflict: 'retailer_id' });
  if (storeSaved.error) throw storeSaved.error;
  storeWrites = 1;
}

console.log(JSON.stringify({
  action: 'targeted_ordermentum_store_sync',
  resource,
  externalId,
  endpoint: path,
  changed: true,
  versionArchived,
  rawWrites: 1,
  storeWrites,
  databaseWrites: 1 + Number(versionArchived) + storeWrites,
  storeProjection: storeMerge.action,
  retailerId: projected.retailer_id,
}, null, 2));
