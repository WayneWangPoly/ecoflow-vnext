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
import {
  mapPurchaseOrderFamiliarStatus,
  type PurchaseOrderFamiliarStatus,
} from './purchaseOperationsContract';
export {
  PURCHASE_OPERATIONS_COLUMN_ORDER,
  PURCHASE_OPERATIONS_FILTER_ORDER,
  PURCHASE_ORDER_FAMILIAR_STATUS_ORDER,
  mapPurchaseOrderFamiliarStatus,
} from './purchaseOperationsContract';

export const PURCHASE_OPERATIONS_READ_LIMIT = 300;

export type PurchaseOperationsRow = PurchaseOrderSummary & { familiarStatus: PurchaseOrderFamiliarStatus | null };
export type PurchaseOperationsListResult = NativeReadResult<PurchaseOperationsRow> & {
  totalCount: number;
  page: number;
  pageSize: number;
  countExact: boolean;
  sourceLimit: number;
};

export type PurchaseOperationsDetailResult = {
  state: Exclude<NativeReadSurfaceState, 'LOADING'>;
  order: PurchaseOperationsRow | null;
  lines: PurchaseOrderLine[];
  receipts: PurchaseOrderReceipt[];
  metadata: NativeReadMetadata;
  issues: string[];
};

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function latestUpdatedAt(rows: readonly PurchaseOrderSummary[]): string | null {
  const candidates = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time);
  return candidates[0]?.value ?? null;
}

function metadata(rows: readonly PurchaseOrderSummary[]): NativeReadMetadata {
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

function applyRequest(sourceRows: readonly PurchaseOrderSummary[], request: NativeReadListRequest) {
  const rows = sourceRows.map((row): PurchaseOperationsRow => ({
    ...row,
    familiarStatus: mapPurchaseOrderFamiliarStatus(row.po_status),
  }));
  const search = clean(request.search).toLowerCase();
  const statuses = filterValues(request.filters, 'status').map((value) => value.toLowerCase());
  const poNumbers = filterValues(request.filters, 'purchase-order').map((value) => value.toLowerCase());
  const suppliers = filterValues(request.filters, 'supplier').map((value) => value.toLowerCase());

  let next = rows.filter((row) => {
    if (search && ![row.po_number, row.supplier_name, row.po_status].some((value) => clean(value).toLowerCase().includes(search))) return false;
    if (statuses.length && !statuses.includes(clean(row.familiarStatus).toLowerCase())) return false;
    if (poNumbers.length && !poNumbers.some((value) => clean(row.po_number).toLowerCase().includes(value))) return false;
    if (suppliers.length && !suppliers.some((value) => clean(row.supplier_name).toLowerCase().includes(value))) return false;
    return true;
  });

  if (request.sort === 'po-desc') next = [...next].sort((a, b) => b.po_number.localeCompare(a.po_number, 'en-AU', { numeric: true }));
  else if (request.sort === 'supplier') next = [...next].sort((a, b) => a.supplier_name.localeCompare(b.supplier_name) || a.po_number.localeCompare(b.po_number));
  else if (request.sort === 'order-date-desc') next = [...next].sort((a, b) => b.order_date.localeCompare(a.order_date));
  else next = [...next].sort((a, b) => a.po_number.localeCompare(b.po_number, 'en-AU', { numeric: true }));

  const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 50));
  const totalCount = next.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(totalPages, Math.max(1, request.page ?? 1));
  const offset = (page - 1) * pageSize;
  return { rows: next.slice(offset, offset + pageSize), totalCount, page, pageSize };
}

/**
 * Read-only #340A adapter over the existing governed purchase-order RPC. No
 * receiving, costing, review, or inventory mutation is exposed from this file.
 * The inherited RPC caps its result at 300 rows. If that cap is reached, this
 * reader must not describe the client-side filtered count as exact.
 */
export async function readPurchaseOperationsList(
  request: NativeReadListRequest = {},
  client?: SupabaseClient | null,
): Promise<PurchaseOperationsListResult> {
  const sourceRows = await loadPurchaseOrders(client, PURCHASE_OPERATIONS_READ_LIMIT);
  const countExact = sourceRows.length < PURCHASE_OPERATIONS_READ_LIMIT;
  const page = applyRequest(sourceRows, request);
  return {
    state: countExact
      ? (sourceRows.length ? (page.rows.length ? 'READY' : 'EMPTY') : 'EMPTY')
      : 'DEGRADED',
    rows: page.rows,
    totalCount: page.totalCount,
    page: page.page,
    pageSize: page.pageSize,
    countExact,
    sourceLimit: PURCHASE_OPERATIONS_READ_LIMIT,
    metadata: metadata(sourceRows),
    issues: countExact ? [] : [
      'The governed purchase-order summary RPC reached its 300-row ceiling. Filtered counts and paging are bounded to that visible read window, so EcoFlow will not report them as exact.',
    ],
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

  const orders = await loadPurchaseOrders(client, PURCHASE_OPERATIONS_READ_LIMIT);
  const sourceOrder = orders.find((row) => row.id === id) ?? null;
  const order = sourceOrder ? { ...sourceOrder, familiarStatus: mapPurchaseOrderFamiliarStatus(sourceOrder.po_status) } : null;
  if (!order) {
    const bounded = orders.length >= PURCHASE_OPERATIONS_READ_LIMIT;
    return {
      state: 'UNAVAILABLE',
      order: null,
      lines: [],
      receipts: [],
      metadata: metadata(orders),
      issues: [bounded
        ? 'The requested purchase order is not visible inside the governed 300-row summary window. #340A will not bypass the existing RPC authority to guess or direct-read the record.'
        : 'The requested purchase order is not present in the governed purchase-order read model.'],
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
