import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OrdersDeskView = 'current' | 'today' | 'decision' | 'ready' | 'warehouse' | 'delivered';
export type OrdersDeskSort = 'operations' | 'latest' | 'oldest' | 'due' | 'store' | 'value';
export type OrdersDeskReleaseState =
  | 'COMPLETED'
  | 'REVIEW_PAYMENT'
  | 'BLOCKED_DATA'
  | 'BLOCKED_MAPPING'
  | 'BLOCKED_BARCODE'
  | 'BLOCKED_STOCK'
  | 'INTERNALISE_REQUIRED'
  | 'READY_TO_RELEASE'
  | 'UNKNOWN';
export type OrdersDeskExecutionState = 'DELIVERED' | 'ROUTE' | 'STAGED' | 'PICKING' | 'NOT_STARTED' | 'UNKNOWN';

export type OrdersDeskRow = {
  orderKey: string;
  rawOrderId: string | null;
  externalOrderId: string | null;
  orderNumber: string;
  invoiceNumber: string;
  storeName: string;
  suburb: string | null;
  deliveryDate: string | null;
  dueAt: string | null;
  sourceStatus: string | null;
  paymentStatus: string | null;
  orderValue: number;
  lineCount: number;
  totalUnits: number;
  releaseState: OrdersDeskReleaseState;
  executionState: OrdersDeskExecutionState;
  internalOrderId: string | null;
  unmappedLineCount: number;
  barcodeBlockedLineCount: number;
  activeExceptionCount: number | null;
  exceptionSnapshotFresh: boolean;
  exceptionRefreshedAt: string | null;
  updatedAt: string | null;
  operatingDay: string | null;
};

export type OrdersDeskLine = {
  source_line_id?: string | null;
  source_order_id?: string | null;
  order_number?: string | null;
  invoice_number?: string | null;
  external_sku_code?: string | null;
  external_product_name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  uom?: string | null;
  price?: number | string | null;
  rate_price?: number | string | null;
  subtotal?: number | string | null;
  total?: number | string | null;
};

export type OrdersDeskException = {
  exceptionId: string;
  exceptionType: string | null;
  message: string | null;
  status: string | null;
  detectedAt: string | null;
  lifecycleStatus: string;
  ownerTeam: string;
  snoozedUntil: string | null;
  resolutionNote: string | null;
  version: number;
};

export type OrdersDeskDetailOrder = {
  orderKey: string;
  rawOrderId: string | null;
  externalOrderId: string | null;
  orderNumber: string;
  invoiceNumber: string;
  storeName: string;
  suburb: string | null;
  address: string | null;
  priceGroupId: string | null;
  deliveryDate: string | null;
  dueAt: string | null;
  sourceStatus: string | null;
  paymentStatus: string | null;
  invoiceStatus: string | null;
  orderValue: number;
  lineCount: number;
  totalUnits: number;
  releaseState: OrdersDeskReleaseState;
  executionState: OrdersDeskExecutionState;
  internalisationStatus: string | null;
  accountReleaseStatus: string | null;
  warehouseGateStatus: string | null;
  internalOrderId: string | null;
  unmappedLineCount: number;
  barcodeBlockedLineCount: number;
  barcodeConfirmedLineCount: number;
  invoiceDetailMissing: boolean;
  lineItemsMissing: boolean;
  updatedAt: string | null;
  lastSyncedAt: string | null;
};

export type OrdersDeskDetail = {
  order: OrdersDeskDetailOrder;
  lines: OrdersDeskLine[];
  exceptions: OrdersDeskException[] | null;
  exceptionSnapshotFresh: boolean;
  exceptionRefreshedAt: string | null;
  readAt: string | null;
};

export type OrdersDeskPage = {
  rows: OrdersDeskRow[];
  totalCount: number;
  readAt: string | null;
};

const RELEASE_STATES = new Set<OrdersDeskReleaseState>([
  'COMPLETED','REVIEW_PAYMENT','BLOCKED_DATA','BLOCKED_MAPPING','BLOCKED_BARCODE','BLOCKED_STOCK','INTERNALISE_REQUIRED','READY_TO_RELEASE','UNKNOWN',
]);
const EXECUTION_STATES = new Set<OrdersDeskExecutionState>(['DELIVERED','ROUTE','STAGED','PICKING','NOT_STARTED','UNKNOWN']);

function activeClient(input?: SupabaseClient | null) {
  const value = input ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message,row.details,row.hint,row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : value === null || value === undefined ? fallback : String(value).trim() || fallback;
}

function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function releaseState(value: unknown): OrdersDeskReleaseState {
  const next = text(value, 'UNKNOWN').toUpperCase() as OrdersDeskReleaseState;
  return RELEASE_STATES.has(next) ? next : 'UNKNOWN';
}

function executionState(value: unknown): OrdersDeskExecutionState {
  const next = text(value, 'UNKNOWN').toUpperCase() as OrdersDeskExecutionState;
  return EXECUTION_STATES.has(next) ? next : 'UNKNOWN';
}

function normaliseRow(value: unknown): OrdersDeskRow | null {
  const row = record(value);
  const orderKey = text(row.order_key);
  const orderNumber = text(row.order_number);
  if (!orderKey || !orderNumber) return null;
  return {
    orderKey,
    rawOrderId: nullableText(row.raw_order_id),
    externalOrderId: nullableText(row.external_order_id),
    orderNumber,
    invoiceNumber: text(row.invoice_number, 'invoice pending'),
    storeName: text(row.store_name, 'Ordermentum retailer'),
    suburb: nullableText(row.suburb),
    deliveryDate: nullableText(row.delivery_date),
    dueAt: nullableText(row.due_at),
    sourceStatus: nullableText(row.source_status),
    paymentStatus: nullableText(row.payment_status),
    orderValue: numberValue(row.order_value),
    lineCount: numberValue(row.line_count),
    totalUnits: numberValue(row.total_units),
    releaseState: releaseState(row.release_state),
    executionState: executionState(row.execution_state),
    internalOrderId: nullableText(row.internal_order_id),
    unmappedLineCount: numberValue(row.unmapped_line_count),
    barcodeBlockedLineCount: numberValue(row.barcode_blocked_line_count),
    activeExceptionCount: row.active_exception_count === null || row.active_exception_count === undefined ? null : numberValue(row.active_exception_count),
    exceptionSnapshotFresh: booleanValue(row.exception_snapshot_fresh),
    exceptionRefreshedAt: nullableText(row.exception_refreshed_at),
    updatedAt: nullableText(row.updated_at),
    operatingDay: nullableText(row.operating_day),
  };
}

function normaliseDetailOrder(value: unknown): OrdersDeskDetailOrder | null {
  const row = record(value);
  const orderKey = text(row.order_key);
  const orderNumber = text(row.order_number);
  if (!orderKey || !orderNumber) return null;
  return {
    orderKey,
    rawOrderId: nullableText(row.raw_order_id),
    externalOrderId: nullableText(row.external_order_id),
    orderNumber,
    invoiceNumber: text(row.invoice_number, 'invoice pending'),
    storeName: text(row.store_name, 'Ordermentum retailer'),
    suburb: nullableText(row.suburb),
    address: nullableText(row.address),
    priceGroupId: nullableText(row.price_group_id),
    deliveryDate: nullableText(row.delivery_date),
    dueAt: nullableText(row.due_at),
    sourceStatus: nullableText(row.source_status),
    paymentStatus: nullableText(row.payment_status),
    invoiceStatus: nullableText(row.invoice_status),
    orderValue: numberValue(row.order_value),
    lineCount: numberValue(row.line_count),
    totalUnits: numberValue(row.total_units),
    releaseState: releaseState(row.release_state),
    executionState: executionState(row.execution_state),
    internalisationStatus: nullableText(row.internalisation_status),
    accountReleaseStatus: nullableText(row.account_release_status),
    warehouseGateStatus: nullableText(row.warehouse_gate_status),
    internalOrderId: nullableText(row.internal_order_id),
    unmappedLineCount: numberValue(row.unmapped_line_count),
    barcodeBlockedLineCount: numberValue(row.barcode_blocked_line_count),
    barcodeConfirmedLineCount: numberValue(row.barcode_confirmed_line_count),
    invoiceDetailMissing: booleanValue(row.invoice_detail_missing),
    lineItemsMissing: booleanValue(row.line_items_missing),
    updatedAt: nullableText(row.updated_at),
    lastSyncedAt: nullableText(row.last_synced_at),
  };
}

function normaliseException(value: unknown): OrdersDeskException | null {
  const row = record(value);
  const exceptionId = text(row.exception_id);
  if (!exceptionId) return null;
  return {
    exceptionId,
    exceptionType: nullableText(row.exception_type),
    message: nullableText(row.message),
    status: nullableText(row.status),
    detectedAt: nullableText(row.detected_at),
    lifecycleStatus: text(row.lifecycle_status, 'OPEN'),
    ownerTeam: text(row.owner_team, 'Operations queue'),
    snoozedUntil: nullableText(row.snoozed_until),
    resolutionNote: nullableText(row.resolution_note),
    version: Math.max(0, numberValue(row.version)),
  };
}

export async function readOrdersOperationsPage(input: {
  page: number;
  pageSize: 10 | 20 | 25 | 50 | 100;
  search?: string | null;
  view?: OrdersDeskView | null;
  sort?: OrdersDeskSort | null;
}, client?: SupabaseClient | null): Promise<OrdersDeskPage> {
  const result = await activeClient(client).rpc('ecoflow_read_orders_operations_v1', {
    p_page: input.page,
    p_page_size: input.pageSize,
    p_search: input.search?.trim() || null,
    p_view: input.view || 'current',
    p_sort: input.sort || 'operations',
  });
  if (result.error) throw new Error(message(result.error));
  const rows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
  return {
    rows: rows.flatMap((item) => {
      const next = normaliseRow(item.row_data);
      return next ? [next] : [];
    }),
    totalCount: rows.length ? numberValue(rows[0].total_count) : 0,
    readAt: rows.length ? nullableText(rows[0].read_at) : null,
  };
}

export async function readOrderOperationsDetail(orderKey: string, client?: SupabaseClient | null): Promise<OrdersDeskDetail> {
  const result = await activeClient(client).rpc('ecoflow_read_order_operations_detail_v1', { p_order_key: orderKey });
  if (result.error) throw new Error(message(result.error));
  const root = record(result.data);
  const order = normaliseDetailOrder(root.order);
  if (!order) throw new Error('Order detail returned an invalid order identity.');
  const lines = Array.isArray(root.lines) ? root.lines.flatMap((line) => Object.keys(record(line)).length ? [record(line) as OrdersDeskLine] : []) : [];
  const rawExceptions = root.exceptions;
  const exceptions = rawExceptions === null || rawExceptions === undefined
    ? null
    : Array.isArray(rawExceptions)
      ? rawExceptions.flatMap((item) => {
          const next = normaliseException(item);
          return next ? [next] : [];
        })
      : [];
  return {
    order,
    lines,
    exceptions,
    exceptionSnapshotFresh: booleanValue(root.exception_snapshot_fresh),
    exceptionRefreshedAt: nullableText(root.exception_refreshed_at),
    readAt: nullableText(root.read_at),
  };
}
