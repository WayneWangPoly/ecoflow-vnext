#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('='); out[key] = value ?? true;
  }
  return out;
}
function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
function time(value) { const parsed = value ? new Date(value).getTime() : 0; return Number.isFinite(parsed) ? parsed : 0; }
async function loadPaged(factory, pageSize = 500, maxRows = 100000) {
  const rows = [];
  for (let start = 0; start < maxRows; start += pageSize) {
    const result = await factory(start, start + pageSize - 1); if (result.error) throw result.error;
    const page = result.data ?? []; rows.push(...page); if (page.length < pageSize) break;
  }
  return rows;
}
async function upsertChunks(db, rows, chunkSize = 500) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const result = await db.from('ecoflow_ordermentum_source_presence').upsert(rows.slice(index, index + chunkSize), { onConflict: 'domain,external_id' });
    if (result.error) throw result.error;
  }
}

const DOMAIN_BY_RESOURCE = new Map([
  ['purchasers', 'STORE'], ['purchaser_detail', 'STORE'], ['products', 'PRODUCT'], ['product_detail', 'PRODUCT'],
  ['variants', 'VARIANT'], ['variant_detail', 'VARIANT'], ['invoices', 'INVOICE'], ['invoice_detail', 'INVOICE'],
  ['price_groups', 'PRICE_GROUP'], ['price_group_detail', 'PRICE_GROUP'], ['stock_locations', 'STOCK_LOCATION'], ['stock_location_detail', 'STOCK_LOCATION'],
]);
const args = parseArgs(process.argv);
const scope = String(args.scope || 'recent');
if (!['recent', 'full_history'].includes(scope)) throw new Error(`Unsupported scope: ${scope}`);
const mirrorStart = new Date(String(args['mirror-start'] || new Date().toISOString()));
if (Number.isNaN(mirrorStart.getTime())) throw new Error('A valid --mirror-start ISO timestamp is required.');
const mirrorStartIso = mirrorStart.toISOString();
const historyRunId = args['history-run-id'] ? String(args['history-run-id']) : null;
const fullHistory = scope === 'full_history';
const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

let rawOrders = []; let catalogOrders = [];
if (fullHistory) {
  if (!historyRunId) throw new Error('--history-run-id is required for full_history source-presence finalisation.');
  const history = await db.from('ecoflow_ordermentum_history_runs').select('id,stage,status,catalog_complete').eq('id', historyRunId).single();
  if (history.error) throw history.error;
  if (!history.data.catalog_complete || !['READY_TO_FINALISE', 'COMPLETE'].includes(history.data.stage)) throw new Error(`History catalog ${historyRunId} is not ready to finalise: ${history.data.status}/${history.data.stage}`);
  catalogOrders = await loadPaged((from, to) => db.from('ecoflow_ordermentum_order_catalog')
    .select('order_key,external_order_id,external_order_number,source_status,last_seen_at,source_updated_at,last_full_seen_run_id')
    .order('order_key', { ascending: true }).range(from, to));
} else {
  rawOrders = await loadPaged((from, to) => db.from('ordermentum_raw_orders')
    .select('external_order_id,external_order_number,last_synced_at,external_updated_at').order('id', { ascending: true }).range(from, to));
}
const rawMaster = await loadPaged((from, to) => db.from('ordermentum_raw_master_resources')
  .select('resource_type,external_id,last_synced_at,remote_updated_at,is_deleted_or_missing')
  .order('resource_type', { ascending: true }).order('external_id', { ascending: true }).range(from, to));

const byKey = new Map();
function collect(row) {
  if (!row.external_id) return;
  const key = `${row.domain}::${row.external_id}`; const existing = byKey.get(key);
  if (!existing || time(row.last_seen_at) >= time(existing.last_seen_at)) byKey.set(key, row);
}

if (fullHistory) {
  for (const order of catalogOrders) {
    const externalId = String(order.external_order_id || order.external_order_number || order.order_key || '').trim();
    if (!externalId) continue;
    const present = order.source_status !== 'SOURCE_MISSING' && String(order.last_full_seen_run_id || '') === historyRunId;
    collect({ domain: 'ORDER', external_id: externalId, source_reference: order.external_order_number || externalId,
      source_status: present ? 'PRESENT' : 'SOURCE_MISSING', first_seen_at: order.last_seen_at || mirrorStartIso,
      last_seen_at: present ? mirrorStartIso : (order.last_seen_at || mirrorStartIso), missing_since: present ? null : mirrorStartIso,
      last_full_mirror_at: mirrorStartIso, metadata: { source: 'ecoflow_ordermentum_order_catalog', history_run_id: historyRunId, source_updated_at: order.source_updated_at || null } });
  }
} else {
  for (const order of rawOrders) {
    const externalId = String(order.external_order_id || order.external_order_number || '').trim();
    if (!externalId) continue;
    const lastSeen = order.last_synced_at || order.external_updated_at || mirrorStartIso;
    if (time(lastSeen) < mirrorStart.getTime()) continue;
    collect({ domain: 'ORDER', external_id: externalId, source_reference: order.external_order_number || externalId, source_status: 'PRESENT',
      first_seen_at: lastSeen, last_seen_at: lastSeen, missing_since: null, last_full_mirror_at: null, metadata: { source: 'ordermentum_raw_orders' } });
  }
}

for (const resource of rawMaster) {
  const domain = DOMAIN_BY_RESOURCE.get(String(resource.resource_type || '').toLowerCase());
  const externalId = String(resource.external_id || '').trim(); if (!domain || !externalId) continue;
  const lastSeen = resource.last_synced_at || resource.remote_updated_at || mirrorStartIso;
  const seenThisRun = time(lastSeen) >= mirrorStart.getTime() && resource.is_deleted_or_missing !== true;
  if (!fullHistory && !seenThisRun) continue;
  collect({ domain, external_id: externalId, source_reference: externalId, source_status: fullHistory && !seenThisRun ? 'SOURCE_MISSING' : 'PRESENT',
    first_seen_at: lastSeen, last_seen_at: seenThisRun ? mirrorStartIso : lastSeen,
    missing_since: fullHistory && !seenThisRun ? mirrorStartIso : null, last_full_mirror_at: fullHistory ? mirrorStartIso : null,
    metadata: { resource_type: resource.resource_type } });
}

const rows = [...byKey.values()]; await upsertChunks(db, rows);
if (fullHistory) {
  const mark = await db.from('ecoflow_ordermentum_source_presence')
    .update({ source_status: 'SOURCE_MISSING', missing_since: mirrorStartIso, last_full_mirror_at: mirrorStartIso })
    .lt('last_seen_at', mirrorStartIso).neq('source_status', 'SOURCE_MISSING');
  if (mark.error) throw mark.error;
  await upsertChunks(db, rows.filter((row) => row.source_status === 'PRESENT').map((row) => ({ ...row, missing_since: null, last_full_mirror_at: mirrorStartIso, last_seen_at: mirrorStartIso })));
}

let refreshed = null; let cacheWarning = null;
try { const result = await db.rpc('ecoflow_refresh_ui_active_order_keys'); if (result.error) throw result.error; refreshed = result.data; }
catch (error) { cacheWarning = error instanceof Error ? error.message : String(error); console.warn(JSON.stringify({ action: 'refresh_ui_active_order_keys_deferred', blocking: false, message: cacheWarning })); }
const summary = await db.from('ecoflow_ordermentum_source_presence').select('domain,source_status'); if (summary.error) throw summary.error;
const counts = {}; for (const row of summary.data ?? []) { const key = `${row.domain}_${row.source_status}`; counts[key] = (counts[key] || 0) + 1; }
console.log(JSON.stringify({ action: 'finalise_ordermentum_source_presence', scope, mirrorStart: mirrorStartIso, historyRunId,
  rawOrders: rawOrders.length, catalogOrders: catalogOrders.length, rawMaster: rawMaster.length, presenceRowsUpserted: rows.length,
  activeKeysRefreshed: refreshed, activeKeyCacheWarning: cacheWarning, counts }, null, 2));
