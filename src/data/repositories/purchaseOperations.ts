import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadPurchaseOrderLines,
  loadPurchaseOrderReceipts,
  loadPurchaseOrders,
  type PurchaseOrderLine,
  type PurchaseOrderReceipt,
  type PurchaseOrderSummary,
} from './purchaseOrders';
import type { NativeReadListRequest, NativeReadMetadata, NativeReadResult, NativeReadSurfaceState } from './nativeReadModel';

export const PURCHASE_ORDER_FAMILIAR_STATUS_ORDER = [
  'Open',
  'Unapproved',
  'Parked',
  'Placed',
  'Costed',
  'Receipted',
  'Deleted',
  'Complete',
] as const;

export const PURCHASE_OPERATIONS_FILTER_ORDER = [
  'status',
  'purchase-order',
  'supplier',
  'warehouse',
  'order-date',
  'expected-date',
  'product',
] as const;

export const PURCHASE_OPERATIONS_COLUMN_ORDER = [
  'purchase-order',
  'supplier',
  'order-date',
  'expected-date',
  'currency',
  'status',
  'ordered',
  'received',
  'variance',
  'action',
] as const;

export type PurchaseOperationsRow = PurchaseOrderSummary;
export type PurchaseOperationsListResult = NativeReadResult<PurchaseOperationsRow>;

export type PurchaseOperationsDetailResult = {
  state: Exclude<NativeReadSurfaceState, 'LOADING'>;
  order: PurchaseOrderSummary | null;
  lines: PurchaseOrderLine[];
  receipts: PurchaseOrderReceipt[];
  metadata: NativeReadMetadata;
  issues: string[];
};

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function latestUpdatedAt(rows: PurchaseOperationsRow[]): string | null {
  const candidates = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time);
  return candidates[0]?.value ?? null;
}

function metadata(rows: PurchaseOperationsRow[]): NativeReadMetadata {
  return {
    source: 'ecoflow_read_purchase_orders',
    authority: 'WAYNX_PURCHASE_ORDER',
    isAuthoritative: true,
    freshness: rows.length ? 'CURRENT' : 'UNKNOWN',
    readAt: new Date().toISOString(),
    sourceObservedAt: latestUpdatedAt(rows),
  };
}

function filterValues(filters: readonly string[] | undefined, key: string) {
  return (filters ?? []).flatMap((raw) => {
    const separator = raw.indexOf(':');
    if (separator <= 0 || raw.slice(0, separator).trim() !== key) return [];
    const value = raw.slice(separator + 1).trim();
    return value ? [value] : [];
  });
}

function applyRequest(rows: PurchaseOperationsRow[], request: NativeReadListRequest) {
  const search = clean(request.search).toLowerCase();
  const statuses = filterValues(request.filters, 'status').map((value) => value.toLowerCase());
  const poNumbers = filterValues(request.filters, 'purchase-order').map((value) => value.toLowerCase());
  const suppliers = filterValues(request.filters, 'supplier').map((value) => value.toLowerCase());
  const orderDates = filterValues(request.filters, 'order-date');
  const expectedDates = filterValues(request.filters, 'expected-date');

  let next = rows.filter((row) => {
    if (search && ![row.po_number, row.supplier_name, row.po_status].some((value) => clean(value).toLowerCase().includes(search))) return false;
    if (statuses.length && !statuses.includes(clean(row.po_status).toLowerCase())) return false;
    if (poNumbers.length && !poNumbers.some((value) => clean(row.po_number).toLowerCase().includes(value))) return false;
    if (suppliers.length && !suppliers.some((value) => clean(row.supplier_name).toLowerCase().includes(value))) return false;
    if (orderDates.length && !orderDates.includes(row.order_date)) return false;
    if (expectedDates.length && !expectedDates.includes(row.expected_date || '')) return false;
    return true;
  });

  if (request.sort === 'po-desc') next = [...next].sort((a, b) => b.po_number.localeCompare(a.po_number, 'en-AU', { numeric: true }));
  else if (request.sort === 'supplier') next = [...next].sort((a, b) => a.supplier_name.localeCompare(b.supplier_name) || a.po_number.localeCompare(b.po_number));
  else if (request.sort === 'order-date-desc') next = [...next].sort((a, b) => b.order_date.localeCompare(a.order_date));
  else next = [...next].sort((a, b) => a.po_number.localeCompare(b.po_number, 'en-AU', { numeric: true }));

  return next.slice(0, Math.min(100, Math.max(1, request.pageSize ?? 50)));
}

/**
 * Read-only #340A adapter over the existing governed purchase-order RPC. No
 * receiving, costing, review, or inventory mutation is exposed from this file.
 */
export async function readPurchaseOperationsList(
  request: NativeReadListRequest = {},
  client?: SupabaseClient | null,
): Promise<PurchaseOperationsListResult> {
  const sourceRows = await loadPurchaseOrders(client);
  const rows = applyRequest(sourceRows, request);
  return {
    state: sourceRows.length ? (rows.length ? 'READY' : 'EMPTY') : 'EMPTY',
    rows,
    metadata: metadata(sourceRows),
    issues: [],
  };
}

/** Read-only detail projection. Historical receipt rows are evidence only. */
export async function readPurchaseOperationsDetail(
  purchaseOrderId: string,
  client?: SupabaseClient | null,
): Promise<PurchaseOperationsDetailResult> {
  const id = clean(purchaseOrderId);
  if (!id) {
    return {
      state: 'UNAVAILABLE',
      order: null,
      lines: [],
      receipts: [],
      metadata: metadata([]),
      issues: ['Purchase order id is required.'],
    };
  }

  const orders = await loadPurchaseOrders(client);
  const order = orders.find((row) => row.id === id) ?? null;
  if (!order) {
    return {
      state: 'UNAVAILABLE',
      order: null,
      lines: [],
      receipts: [],
      metadata: metadata(orders),
      issues: ['The requested purchase order is not present in the governed purchase-order read model.'],
    };
  }

  const [lines, receipts] = await Promise.all([
    loadPurchaseOrderLines(id, client),
    loadPurchaseOrderReceipts(id, client),
  ]);
  return {
    state: 'READY',
    order,
    lines,
    receipts,
    metadata: metadata([order]),
    issues: [],
  };
}
