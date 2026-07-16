#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');

const requireHistory = process.argv.some((arg) => arg === '--require-history=true');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const pageSize = 1000;
const maxRows = 100000;

function text(value) {
  return value == null ? '' : String(value).trim();
}

async function loadPaged(table, columns, configure = (query) => query) {
  const rows = [];
  for (let start = 0; start < maxRows; start += pageSize) {
    let query = db.from(table).select(columns).range(start, start + pageSize - 1);
    query = configure(query);
    const result = await query;
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  if (rows.length >= maxRows) throw new Error(`${table}: verification row ceiling ${maxRows} reached`);
  return rows;
}

function addKey(set, value) {
  const normalized = text(value);
  if (normalized) set.add(normalized);
}

function distinctExternalIds(rows, resourceTypes) {
  const allowed = new Set(resourceTypes);
  const ids = new Set();
  for (const row of rows) {
    if (allowed.has(text(row.resource_type).toLowerCase())) addKey(ids, row.external_id);
  }
  return ids;
}

const [
  rawOrders,
  projectedOrders,
  rawMaster,
  projectedInvoices,
  sourcePresence,
  historyResult,
  catalog,
] = await Promise.all([
  loadPaged('ordermentum_raw_orders', 'external_order_id,external_order_number'),
  loadPaged('om_orders', 'id,order_number'),
  loadPaged('ordermentum_raw_master_resources', 'resource_type,external_id,is_deleted_or_missing'),
  loadPaged('om_invoices', 'id,number'),
  loadPaged('ecoflow_ordermentum_source_presence', 'domain,external_id,source_status,last_full_mirror_at'),
  db.from('ecoflow_ordermentum_history_runs')
    .select('id,status,stage,catalog_complete,started_at,heartbeat_at,completed_at,last_error')
    .eq('pipeline_key', 'ORDER_HISTORY_V2')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
  loadPaged('ecoflow_ordermentum_order_catalog', 'order_key,source_status,detail_status,last_full_seen_run_id'),
]);

if (historyResult.error) throw new Error(`ecoflow_ordermentum_history_runs: ${historyResult.error.message}`);
const history = historyResult.data || null;

const projectedOrderKeys = new Set();
for (const row of projectedOrders) {
  addKey(projectedOrderKeys, row.id);
  addKey(projectedOrderKeys, row.order_number);
}
const rawOrderKeys = new Set();
let orderProjectionMissing = 0;
for (const row of rawOrders) {
  const candidates = [text(row.external_order_id), text(row.external_order_number)].filter(Boolean);
  if (!candidates.length) continue;
  candidates.forEach((candidate) => rawOrderKeys.add(candidate));
  if (!candidates.some((candidate) => projectedOrderKeys.has(candidate))) orderProjectionMissing += 1;
}

const projectedInvoiceKeys = new Set();
for (const row of projectedInvoices) {
  addKey(projectedInvoiceKeys, row.id);
  addKey(projectedInvoiceKeys, row.number);
}
const rawInvoiceIds = distinctExternalIds(rawMaster, ['invoices', 'invoice_detail']);
let invoiceProjectionMissing = 0;
for (const id of rawInvoiceIds) {
  if (!projectedInvoiceKeys.has(id)) invoiceProjectionMissing += 1;
}

const purchaserIds = distinctExternalIds(rawMaster, ['purchasers', 'purchaser_detail']);
const productIds = distinctExternalIds(rawMaster, ['products', 'product_detail']);
const variantIds = distinctExternalIds(rawMaster, ['variants', 'variant_detail']);
const priceGroupIds = distinctExternalIds(rawMaster, ['price_groups', 'price_group_detail']);
const stockLocationIds = distinctExternalIds(rawMaster, ['stock_locations', 'stock_location_detail']);

const catalogPresent = catalog.filter((row) => row.source_status === 'PRESENT');
const detailPending = catalogPresent.filter((row) => ['PENDING', 'IN_PROGRESS'].includes(row.detail_status)).length;
const detailFailed = catalogPresent.filter((row) => row.detail_status === 'FAILED').length;
const detailComplete = catalogPresent.filter((row) => row.detail_status === 'COMPLETE').length;

const sourceMissingRecords = sourcePresence.filter((row) => row.source_status === 'SOURCE_MISSING').length;
const sourceMissingOrders = sourcePresence.filter((row) => row.domain === 'ORDER' && row.source_status === 'SOURCE_MISSING').length;

const data = {
  overall_status: 'COMPLETE',
  verification_mode: 'LIGHTWEIGHT_DIRECT_V1',
  raw_order_count: rawOrderKeys.size,
  projected_order_count: projectedOrders.length,
  order_projection_missing: orderProjectionMissing,
  raw_invoice_count: rawInvoiceIds.size,
  projected_invoice_count: projectedInvoices.length,
  invoice_projection_missing: invoiceProjectionMissing,
  purchaser_count: purchaserIds.size,
  product_count: productIds.size,
  variant_count: variantIds.size,
  price_group_count: priceGroupIds.size,
  stock_location_count: stockLocationIds.size,
  source_missing_records: sourceMissingRecords,
  source_missing_orders: sourceMissingOrders,
  history_run_id: history?.id || null,
  history_pipeline_status: history?.status || null,
  history_stage: history?.stage || null,
  history_catalog_complete: history?.catalog_complete === true,
  history_started_at: history?.started_at || null,
  history_heartbeat_at: history?.heartbeat_at || null,
  history_completed_at: history?.completed_at || null,
  history_last_error: history?.last_error || null,
  catalog_total: catalog.length,
  catalog_present: catalogPresent.length,
  detail_complete: detailComplete,
  detail_pending: detailPending,
  detail_failed: detailFailed,
};

const blockers = [
  ['raw order source empty', rawOrderKeys.size === 0 ? 1 : 0],
  ['order projection gaps', orderProjectionMissing],
  ['raw invoice source empty', rawInvoiceIds.size === 0 ? 1 : 0],
  ['invoice projection gaps', invoiceProjectionMissing],
  ['purchaser source empty', purchaserIds.size === 0 ? 1 : 0],
  ['product and variant source empty', productIds.size + variantIds.size === 0 ? 1 : 0],
  ['price group source empty', priceGroupIds.size === 0 ? 1 : 0],
];

if (requireHistory) {
  blockers.push(['history health unavailable', history ? 0 : 1]);
  blockers.push(['history pipeline incomplete', history?.status === 'COMPLETE' && history?.stage === 'COMPLETE' ? 0 : 1]);
  blockers.push(['history catalog incomplete', history?.catalog_complete === true ? 0 : 1]);
  blockers.push(['history details pending', detailPending]);
  blockers.push(['history details failed', detailFailed]);
}

const active = blockers.filter((entry) => Number(entry[1]) > 0);
if (active.length) data.overall_status = 'DEGRADED';

const warnings = [];
if (sourceMissingOrders > 0) {
  warnings.push({
    code: 'SOURCE_MISSING_HISTORY_RETAINED',
    count: sourceMissingOrders,
    blocking: false,
    message: 'Orders removed from Ordermentum are retained as historical SOURCE_MISSING records.',
  });
}
warnings.push({
  code: 'OPERATIONAL_REVIEW_SEPARATE',
  blocking: false,
  message: 'Unknown statuses, finance reconciliation reviews and active workflow exceptions are operational review signals, not source-mirror completeness blockers.',
});

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  health_source: 'lightweight_direct_v1',
  require_history: requireHistory,
  ordermentum_complete_mirror: data,
  blockers: active.map(([label, count]) => ({ label, count: Number(count) })),
  warnings,
}, null, 2));

if (active.length) {
  throw new Error(`Ordermentum mirror is DEGRADED: ${active.map(([label, count]) => `${label}: ${count}`).join('; ')}`);
}
