#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    out[key] = value ?? true;
  }
  return out;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function time(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadPaged(queryFactory, pageSize = 500, maxRows = 50000) {
  const rows = [];
  for (let start = 0; start < maxRows; start += pageSize) {
    const { data, error } = await queryFactory(start, start + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function upsertChunks(db, rows, chunkSize = 500) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await db
      .from('ecoflow_ordermentum_source_presence')
      .upsert(chunk, { onConflict: 'domain,external_id' });
    if (error) throw error;
  }
}

const DOMAIN_BY_RESOURCE = new Map([
  ['purchasers', 'STORE'],
  ['purchaser_detail', 'STORE'],
  ['products', 'PRODUCT'],
  ['product_detail', 'PRODUCT'],
  ['variants', 'VARIANT'],
  ['variant_detail', 'VARIANT'],
  ['invoices', 'INVOICE'],
  ['invoice_detail', 'INVOICE'],
  ['price_groups', 'PRICE_GROUP'],
  ['price_group_detail', 'PRICE_GROUP'],
  ['stock_locations', 'STOCK_LOCATION'],
  ['stock_location_detail', 'STOCK_LOCATION'],
]);

const args = parseArgs(process.argv);
const scope = String(args.scope || 'recent');
if (!['recent', 'full_history'].includes(scope)) throw new Error(`Unsupported scope: ${scope}`);
const mirrorStart = new Date(String(args['mirror-start'] || new Date().toISOString()));
if (Number.isNaN(mirrorStart.getTime())) throw new Error('A valid --mirror-start ISO timestamp is required.');
const mirrorStartIso = mirrorStart.toISOString();
const fullHistory = scope === 'full_history';

const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [rawOrders, rawMaster] = await Promise.all([
  loadPaged((from, to) => db
    .from('ordermentum_raw_orders')
    .select('external_order_id,external_order_number,last_synced_at,external_updated_at')
    .order('id', { ascending: true })
    .range(from, to)),
  loadPaged((from, to) => db
    .from('ordermentum_raw_master_resources')
    .select('resource_type,external_id,last_synced_at,remote_updated_at,is_deleted_or_missing')
    .order('resource_type', { ascending: true })
    .order('external_id', { ascending: true })
    .range(from, to)),
]);

const byKey = new Map();
function collect(row) {
  if (!row.external_id) return;
  const key = `${row.domain}::${row.external_id}`;
  const existing = byKey.get(key);
  if (!existing || time(row.last_seen_at) >= time(existing.last_seen_at)) byKey.set(key, row);
}

for (const order of rawOrders) {
  const externalId = String(order.external_order_id || order.external_order_number || '').trim();
  if (!externalId) continue;
  const lastSeen = order.last_synced_at || order.external_updated_at || mirrorStartIso;
  const seenThisRun = time(lastSeen) >= mirrorStart.getTime();
  if (!fullHistory && !seenThisRun) continue;
  collect({
    domain: 'ORDER',
    external_id: externalId,
    source_reference: order.external_order_number || externalId,
    source_status: fullHistory && !seenThisRun ? 'SOURCE_MISSING' : 'PRESENT',
    first_seen_at: lastSeen,
    last_seen_at: lastSeen,
    missing_since: fullHistory && !seenThisRun ? mirrorStartIso : null,
    last_full_mirror_at: fullHistory ? mirrorStartIso : null,
    metadata: { source: 'ordermentum_raw_orders' },
  });
}

for (const resource of rawMaster) {
  const domain = DOMAIN_BY_RESOURCE.get(String(resource.resource_type || '').toLowerCase());
  const externalId = String(resource.external_id || '').trim();
  if (!domain || !externalId) continue;
  const lastSeen = resource.last_synced_at || resource.remote_updated_at || mirrorStartIso;
  const seenThisRun = time(lastSeen) >= mirrorStart.getTime() && resource.is_deleted_or_missing !== true;
  if (!fullHistory && !seenThisRun) continue;
  collect({
    domain,
    external_id: externalId,
    source_reference: externalId,
    source_status: fullHistory && !seenThisRun ? 'SOURCE_MISSING' : 'PRESENT',
    first_seen_at: lastSeen,
    last_seen_at: lastSeen,
    missing_since: fullHistory && !seenThisRun ? mirrorStartIso : null,
    last_full_mirror_at: fullHistory ? mirrorStartIso : null,
    metadata: { resource_type: resource.resource_type },
  });
}

const rows = [...byKey.values()];
await upsertChunks(db, rows);

if (fullHistory) {
  // Records that disappeared before the current full traversal may already exist
  // only in the presence table. Preserve them and mark them missing rather than
  // deleting their historical commercial or operational references.
  const { error: markError } = await db
    .from('ecoflow_ordermentum_source_presence')
    .update({ source_status: 'SOURCE_MISSING', missing_since: mirrorStartIso, last_full_mirror_at: mirrorStartIso })
    .lt('last_seen_at', mirrorStartIso)
    .neq('source_status', 'SOURCE_MISSING');
  if (markError) throw markError;

  // Re-assert records seen in this run after the broad missing pass.
  const presentRows = rows.filter((row) => row.source_status === 'PRESENT').map((row) => ({
    ...row,
    missing_since: null,
    last_full_mirror_at: mirrorStartIso,
  }));
  await upsertChunks(db, presentRows);
}

const { data: refreshed, error: refreshError } = await db.rpc('ecoflow_refresh_ui_active_order_keys');
if (refreshError) throw refreshError;

const { data: summary, error: summaryError } = await db
  .from('ecoflow_ordermentum_source_presence')
  .select('domain,source_status');
if (summaryError) throw summaryError;

const counts = {};
for (const row of summary ?? []) {
  const key = `${row.domain}_${row.source_status}`;
  counts[key] = (counts[key] || 0) + 1;
}

console.log(JSON.stringify({
  action: 'finalise_ordermentum_source_presence',
  scope,
  mirrorStart: mirrorStartIso,
  rawOrders: rawOrders.length,
  rawMaster: rawMaster.length,
  presenceRowsUpserted: rows.length,
  activeKeysRefreshed: refreshed,
  counts,
}, null, 2));
