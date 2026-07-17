#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');

const requireHistory = process.argv.some((arg) => arg === '--require-history=true');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const pageSize = 1000;
const maxRows = 100000;
const recentCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
const terminalOrderStatuses = new Set([
  'cancelled', 'canceled', 'void', 'voided',
  'completed', 'complete', 'closed', 'delivered', 'fulfilled',
  'finalised', 'finalized',
]);
const explicitCurrentStatuses = new Set([
  'new', 'pending', 'placed', 'processing', 'confirmed', 'accepted',
  'approved', 'open', 'ready', 'paid', 'unpaid', 'in_progress',
  'partially_fulfilled',
]);

function text(value) {
  return value == null ? '' : String(value).trim();
}

function timestamp(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalStatus(row) {
  return text(row.order_status || row.status).toLowerCase();
}

function isOperationallyCurrent(row) {
  if (row.cancelled === true || text(row.cancelled).toLowerCase() === 'true' || row.cancelled_at) return false;
  const status = canonicalStatus(row);
  if (terminalOrderStatuses.has(status)) return false;
  const activity = Math.max(
    timestamp(row.delivery_date),
    timestamp(row.due_at),
    timestamp(row.updated_at),
    timestamp(row.created_at),
  );
  return activity >= recentCutoff;
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

function groupRawOrderAliases(rows) {
  const groups = new Map();
  for (const row of rows) {
    const candidates = [text(row.external_order_id), text(row.external_order_number)].filter(Boolean);
    if (!candidates.length) continue;
    const identity = candidates[0];
    const aliases = groups.get(identity) || new Set();
    candidates.forEach((candidate) => aliases.add(candidate));
    groups.set(identity, aliases);
  }
  return groups;
}

const [
  rawOrders,
  projectedOrders,
  rawMaster,
  projectedInvoices,
  sourcePresence,
  historyResult,
  catalog,
  activeSourceMissingResult,
] = await Promise.all([
  loadPaged('ordermentum_raw_orders', 'external_order_id,external_order_number'),
  loadPaged('om_orders', 'id,order_number,status,order_status,cancelled,cancelled_at,delivery_date,due_at,created_at,updated_at'),
  loadPaged('ordermentum_raw_master_resources', 'resource_type,external_id,is_deleted_or_missing'),
  loadPaged('om_invoices', 'id,number'),
  loadPaged('ecoflow_ordermentum_source_presence', 'domain,external_id,source_status,last_full_mirror_at'),
  db.from('ecoflow_ordermentum_history_runs')
    .select('id,status,stage,next_page,pages_completed,summaries_seen,catalog_complete,started_at,heartbeat_at,completed_at,last_error')
    .eq('pipeline_key', 'ORDER_HISTORY_V2')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
  loadPaged('ecoflow_ordermentum_order_catalog', 'order_key,source_status,detail_status,last_full_seen_run_id'),
  db.rpc('ecoflow_count_active_source_missing_orders'),
]);

if (historyResult.error) throw new Error(`ecoflow_ordermentum_history_runs: ${historyResult.error.message}`);
if (activeSourceMissingResult.error) throw new Error(`ecoflow_count_active_source_missing_orders: ${activeSourceMissingResult.error.message}`);
const history = historyResult.data || null;
const activeSourceMissingOrders = Number(activeSourceMissingResult.data ?? 0);
if (!Number.isFinite(activeSourceMissingOrders) || activeSourceMissingOrders < 0) {
  throw new Error(`ecoflow_count_active_source_missing_orders returned an invalid count: ${activeSourceMissingResult.data}`);
}

const projectedOrderKeys = new Set();
for (const row of projectedOrders) {
  addKey(projectedOrderKeys, row.id);
  addKey(projectedOrderKeys, row.order_number);
}
const rawOrderGroups = groupRawOrderAliases(rawOrders);
let orderProjectionMissing = 0;
let sourceBackedProjectedOrders = 0;
for (const aliases of rawOrderGroups.values()) {
  if ([...aliases].some((candidate) => projectedOrderKeys.has(candidate))) sourceBackedProjectedOrders += 1;
  else orderProjectionMissing += 1;
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
const sourceBackedProjectedInvoices = projectedInvoices.filter((row) => (
  rawInvoiceIds.has(text(row.id)) || rawInvoiceIds.has(text(row.number))
)).length;

const purchaserIds = distinctExternalIds(rawMaster, ['purchasers', 'purchaser_detail']);
const productIds = distinctExternalIds(rawMaster, ['products', 'product_detail']);
const variantIds = distinctExternalIds(rawMaster, ['variants', 'variant_detail']);
const priceGroupIds = distinctExternalIds(rawMaster, ['price_groups', 'price_group_detail']);
const stockLocationIds = distinctExternalIds(rawMaster, ['stock_locations', 'stock_location_detail']);

const catalogPresent = catalog.filter((row) => row.source_status === 'PRESENT');
const catalogSourceMissing = catalog.filter((row) => row.source_status === 'SOURCE_MISSING').length;
const detailPending = catalogPresent.filter((row) => ['PENDING', 'IN_PROGRESS'].includes(row.detail_status)).length;
const detailFailed = catalogPresent.filter((row) => row.detail_status === 'FAILED').length;
const detailComplete = catalogPresent.filter((row) => row.detail_status === 'COMPLETE').length;

const sourceMissingRecords = sourcePresence.filter((row) => row.source_status === 'SOURCE_MISSING').length;
const sourceMissingOrders = sourcePresence.filter((row) => row.domain === 'ORDER' && row.source_status === 'SOURCE_MISSING');
const sourceMissingOrderKeys = new Set(sourceMissingOrders.map((row) => text(row.external_id)).filter(Boolean));
const currentCanonicalOrders = projectedOrders.filter((row) => (
  isOperationallyCurrent(row)
  && !sourceMissingOrderKeys.has(text(row.id))
  && !sourceMissingOrderKeys.has(text(row.order_number))
));
const unknownRecentStatuses = currentCanonicalOrders.filter((row) => !explicitCurrentStatuses.has(canonicalStatus(row))).length;
const checkedAt = new Date().toISOString();

const data = {
  overall_status: 'COMPLETE',
  verification_mode: 'LIGHTWEIGHT_DIRECT_V3',
  checked_at: checkedAt,
  raw_order_count: rawOrderGroups.size,
  projected_order_count: sourceBackedProjectedOrders,
  order_projection_missing: orderProjectionMissing,
  raw_invoice_count: rawInvoiceIds.size,
  projected_invoice_count: sourceBackedProjectedInvoices,
  invoice_projection_missing: invoiceProjectionMissing,
  purchaser_count: purchaserIds.size,
  product_count: productIds.size,
  variant_count: variantIds.size,
  price_group_count: priceGroupIds.size,
  stock_location_count: stockLocationIds.size,
  source_missing_records: sourceMissingRecords,
  source_missing_orders: sourceMissingOrders.length,
  active_source_missing_orders: activeSourceMissingOrders,
  recent_orders_missing_lines: 0,
  recent_orders_missing_invoice_detail: 0,
  unknown_recent_statuses: unknownRecentStatuses,
  recent_finance_reviews: 0,
  history_run_id: history?.id || null,
  history_pipeline_status: history?.status || null,
  history_stage: history?.stage || null,
  history_next_page: history?.next_page ?? null,
  history_pages_completed: history?.pages_completed ?? null,
  history_summaries_seen: history?.summaries_seen ?? null,
  history_catalog_complete: history?.catalog_complete === true,
  history_heartbeat_at: history?.heartbeat_at || null,
  history_last_error: history?.last_error || null,
  catalog_total: catalog.length,
  catalog_present: catalogPresent.length,
  catalog_source_missing: catalogSourceMissing,
  detail_complete: detailComplete,
  detail_pending: detailPending,
  detail_failed: detailFailed,
};

const blockers = [
  ['raw order source empty', rawOrderGroups.size === 0 ? 1 : 0],
  ['order projection gaps', orderProjectionMissing],
  ['raw invoice source empty', rawInvoiceIds.size === 0 ? 1 : 0],
  ['invoice projection gaps', invoiceProjectionMissing],
  ['purchaser source empty', purchaserIds.size === 0 ? 1 : 0],
  ['product and variant source empty', productIds.size + variantIds.size === 0 ? 1 : 0],
  ['price group source empty', priceGroupIds.size === 0 ? 1 : 0],
  ['active source-missing orders', activeSourceMissingOrders],
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
if (sourceMissingOrders.length > 0) {
  warnings.push({
    code: 'SOURCE_MISSING_HISTORY_RETAINED',
    count: sourceMissingOrders.length,
    blocking: false,
    message: 'Orders removed from Ordermentum are retained as historical SOURCE_MISSING records.',
  });
}
if (unknownRecentStatuses > 0) {
  warnings.push({
    code: 'UNKNOWN_CURRENT_SOURCE_STATUS',
    count: unknownRecentStatuses,
    blocking: false,
    message: 'Recent non-terminal source statuses are retained for operational review and remain fail-closed for release.',
  });
}
warnings.push({
  code: 'OPERATIONAL_REVIEW_SEPARATE',
  blocking: false,
  message: 'Unknown statuses, finance reconciliation reviews and active workflow exceptions are operational review signals, not source-mirror completeness blockers.',
});

const snapshot = {
  snapshot_key: 'ORDERMENTUM_COMPLETE_MIRROR',
  ...data,
  blockers: active.map(([label, count]) => ({ label, count: Number(count) })),
  warnings,
  metadata: {
    require_history: requireHistory,
    generated_at: checkedAt,
    canonical_order_table_rows: projectedOrders.length,
    canonical_invoice_table_rows: projectedInvoices.length,
    operationally_current_order_rows: currentCanonicalOrders.length,
    active_source_missing_semantics: 'SOURCE_MISSING orders with a non-terminal EcoFlow internal workflow',
    count_semantics: 'source-backed distinct records',
  },
};
const snapshotResult = await db.from('ecoflow_ordermentum_mirror_status_snapshot').upsert(snapshot, { onConflict: 'snapshot_key' });
if (snapshotResult.error) throw new Error(`ecoflow_ordermentum_mirror_status_snapshot: ${snapshotResult.error.message}`);

console.log(JSON.stringify({
  generated_at: checkedAt,
  health_source: 'lightweight_direct_v3',
  require_history: requireHistory,
  ordermentum_complete_mirror: data,
  blockers: snapshot.blockers,
  warnings,
  snapshot_persisted: true,
}, null, 2));

if (active.length) {
  throw new Error(`Ordermentum mirror is DEGRADED: ${active.map(([label, count]) => `${label}: ${count}`).join('; ')}`);
}
