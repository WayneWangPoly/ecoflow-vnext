import { getOrderBucketCounts } from '@/domain/orderBuckets';
import { businessDateFromIso, makeSyncBatch } from '@/domain/syncModel';
import type {
  Activity,
  DataQualityItem,
  EcoFlowDataSet,
  ImportedOrder,
  MappingException,
  OrderChangeImpact,
  OrderLine,
  OrderStatus,
  OrderSyncStatus,
  PaymentStatus,
  PriceTier,
  ReleaseGateStatus,
  StoreProfile
} from '@/domain/types';

export type SupabaseInboxRow = {
  raw_order_id: string | null;
  external_order_id: string | null;
  external_order_number: string | null;
  external_invoice_number: string | null;
  om_order_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  order_status: string | null;
  payment_status: string | null;
  order_created_at: string | null;
  order_updated_at: string | null;
  received_business_day: string | null;
  updated_business_day: string | null;
  invoice_id: string | null;
  invoice_detail_number: string | null;
  invoice_status: string | null;
  invoice_payment_status: string | null;
  invoice_total: number | string | null;
  total_due: number | string | null;
  is_outstanding: boolean | null;
  invoice_due_at: string | null;
  invoice_date: string | null;
  line_count: number | string | null;
  total_units: number | string | null;
  order_items_total: number | string | null;
  invoice_detail_missing: boolean | null;
  line_items_missing: boolean | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_synced_at: string | null;
  payload_hash: string | null;
  import_source: string | null;
  raw_created_at: string | null;
  raw_updated_at: string | null;
};

export type SupabaseExceptionRow = {
  raw_order_id: string | null;
  external_order_id: string | null;
  external_order_number: string | null;
  external_invoice_number: string | null;
  order_number: string | null;
  invoice_number: string | null;
  exception_type: string | null;
  message: string | null;
  status: string | null;
  detected_at: string | null;
};

export type SupabaseSyncHealthRow = {
  raw_orders: number | string | null;
  invoice_detail_missing: number | string | null;
  line_items_missing: number | string | null;
  first_order_created_at: string | null;
  last_order_created_at: string | null;
  first_order_updated_at: string | null;
  last_order_updated_at: string | null;
  last_synced_at: string | null;
};


export type SupabaseOrderLineRow = {
  source_order_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  source_line_id: string | null;
  external_sku_code: string | null;
  external_product_name: string | null;
  quantity: number | string | null;
  unit: string | null;
  uom: string | null;
  packing_unit: number | string | null;
  price: number | string | null;
  rate_price: number | string | null;
  subtotal: number | string | null;
  gst: number | string | null;
  tax: number | string | null;
  total: number | string | null;
  source: string | null;
};

/** v_ecoflow_ordermentum_internal_order_drafts_v3 — the live release/internalisation gate. */
export type SupabaseDraftRow = {
  raw_order_id: string | null;
  external_order_id: string | null;
  external_order_number: string | null;
  order_number: string | null;
  invoice_number: string | null;
  payment_status: string | null;
  invoice_payment_status: string | null;
  invoice_total: number | string | null;
  total_due: number | string | null;
  line_count: number | string | null;
  total_units: number | string | null;
  internalisation_status: string | null;
  account_release_status: string | null;
  warehouse_gate_status: string | null;
  unmapped_line_count: number | string | null;
  barcode_blocked_line_count: number | string | null;
  barcode_confirmed_line_count: number | string | null;
  service_line_count: number | string | null;
  updated_business_day: string | null;
  last_synced_at: string | null;
  internal_order_id: string | null;
};

export type SupabaseOmOrderRow = {
  id: string | null;
  order_number: string | null;
  retailer_name: string | null;
  delivery_date: string | null;
  due_at: string | null;
  total_quantity: number | string | null;
};

export type SupabaseReleaseSummaryRow = {
  total_orders: number | string | null;
  ready_to_internalise: number | string | null;
  review_payment: number | string | null;
  blocked_data: number | string | null;
  blocked_mapping: number | string | null;
  blocked_stock: number | string | null;
  invoice_total: number | string | null;
  total_due: number | string | null;
  latest_order_update: string | null;
  last_synced_at: string | null;
};

export type SupabaseSkuMappingCandidateRow = {
  external_sku_code: string | null;
  external_product_name: string | null;
  order_count: number | string | null;
  line_count: number | string | null;
  total_required_quantity: number | string | null;
  total_value: number | string | null;
  mapping_id: string | null;
  internal_sku_id: string | null;
  internal_sku_code: string | null;
  internal_sku_name: string | null;
  default_unit_level: string | null;
  confidence: string | null;
  mapping_status: string | null;
};

export type SupabaseOrdermentumViews = {
  inbox: SupabaseInboxRow[];
  exceptions: SupabaseExceptionRow[];
  health: SupabaseSyncHealthRow | null;
  lines: SupabaseOrderLineRow[];
  drafts: SupabaseDraftRow[];
  omOrders: SupabaseOmOrderRow[];
  releaseSummary: SupabaseReleaseSummaryRow | null;
  skuMappingCandidates: SupabaseSkuMappingCandidateRow[];
};

const tierSequence: PriceTier[] = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'];
const locationSequence = ['A1-01-01A', 'A2-02-01B', 'B1-03-02A', 'B2-01-02B', 'C1-04-01A', 'C2-02-03B', 'D1-01-01A', 'E1-03-01B'];

function envValue(key: string) {
  return (import.meta.env[key] as string | undefined)?.trim() || '';
}

function hasSupabaseConfig() {
  return Boolean(envValue('VITE_SUPABASE_URL') && envValue('VITE_SUPABASE_ANON_KEY'));
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function maxIso(values: Array<string | null | undefined>) {
  const latest = values
    .map((value) => value ? new Date(value) : null)
    .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return latest?.toISOString() || new Date().toISOString();
}

function formatTime(iso: string | null | undefined, fallbackIndex: number) {
  if (!iso) return `${String(9 + Math.floor(fallbackIndex / 4)).padStart(2, '0')}:${String((fallbackIndex % 4) * 15).padStart(2, '0')}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `${String(9 + Math.floor(fallbackIndex / 4)).padStart(2, '0')}:${String((fallbackIndex % 4) * 15).padStart(2, '0')}`;
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Adelaide' });
}

function paymentStatus(value: string | null | undefined): PaymentStatus {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'paid') return 'PAID';
  if (normalized.includes('overdue')) return 'OVERDUE';
  return 'UNPAID';
}

function orderStatus(row: SupabaseInboxRow): OrderStatus {
  if (row.invoice_detail_missing || row.line_items_missing) return 'MAPPING_EXCEPTION';
  const normalized = String(row.order_status || '').toLowerCase();
  if (normalized === 'paid') return 'RELEASE_READY';
  if (normalized === 'processing') return 'IMPORTED';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'CANCELLED';
  return 'RELEASE_READY';
}

function syncStatus(row: SupabaseInboxRow, businessDay: string): OrderSyncStatus {
  if (row.received_business_day === businessDay) return 'NEW';
  if (row.updated_business_day === businessDay) return 'UPDATED';
  return 'UNCHANGED';
}

function changeImpact(row: SupabaseInboxRow): OrderChangeImpact {
  if (row.invoice_detail_missing || row.line_items_missing) return 'REVIEW_REQUIRED';
  if (String(row.order_status || '').toLowerCase() === 'paid') return 'SAFE_UPDATE';
  if (String(row.payment_status || '').toLowerCase() === 'processing') return 'REVIEW_REQUIRED';
  return 'NO_CHANGE';
}

function gateStatusFromDraft(draft: SupabaseDraftRow): ReleaseGateStatus {
  const internalisation = String(draft.internalisation_status || '');
  if (internalisation === 'BLOCKED_MAPPING') return 'BLOCKED_MAPPING';
  if (internalisation === 'BLOCKED_DATA') return 'BLOCKED_DATA';
  if (internalisation === 'BLOCKED_STOCK') return 'BLOCKED_STOCK';
  if (String(draft.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') return 'REVIEW_PAYMENT';
  return 'READY_TO_RELEASE';
}

function statusFromDraft(draft: SupabaseDraftRow): OrderStatus {
  const gateStatus = gateStatusFromDraft(draft);
  if (gateStatus === 'READY_TO_RELEASE') return 'RELEASE_READY';
  if (gateStatus === 'REVIEW_PAYMENT') return 'IMPORTED';
  return 'MAPPING_EXCEPTION';
}

function blockersFromDraft(draft: SupabaseDraftRow): string {
  const parts: string[] = [];
  const unmapped = numberValue(draft.unmapped_line_count, 0);
  const barcodeBlocked = numberValue(draft.barcode_blocked_line_count, 0);
  if (String(draft.internalisation_status || '') === 'BLOCKED_DATA') parts.push('Order line detail missing — refresh invoice detail before release');
  if (unmapped) parts.push(`${unmapped} line${unmapped === 1 ? '' : 's'} need SKU mapping`);
  if (String(draft.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') parts.push('Payment review hold');
  if (barcodeBlocked) parts.push(`${barcodeBlocked} line${barcodeBlocked === 1 ? '' : 's'} await barcode confirmation (blocks pick wave, not release)`);
  return parts.join(' · ');
}

function unitForLine(unit: string | null | undefined, uom: string | null | undefined): 'sleeve' | 'carton' {
  const normalized = String(unit || uom || '').toLowerCase();
  if (normalized.includes('sleeve')) return 'sleeve';
  return 'carton';
}

function makeBarcode(seed: string | null | undefined, index: number) {
  const digits = String(seed || index + 1000000000).replace(/\D/g, '').slice(0, 10).padEnd(10, String(index % 10));
  return `93${digits}`;
}

function buildLineMap(lines: SupabaseOrderLineRow[]) {
  const byOrder = new Map<string, OrderLine[]>();
  lines.forEach((line, index) => {
    const keys = [line.source_order_id, line.order_number].filter((value): value is string => Boolean(value));
    const qty = Math.max(1, numberValue(line.quantity, 1));
    const orderLine: OrderLine = {
      sku: textValue(line.external_sku_code, `OM-LINE-${String(line.source_line_id || index + 1).slice(0, 8)}`),
      name: textValue(line.external_product_name, 'Ordermentum line item'),
      qty,
      unit: unitForLine(line.unit, line.uom),
      stock: qty + 8,
      location: locationSequence[index % locationSequence.length],
      barcode: makeBarcode(line.external_sku_code || line.source_line_id, index),
      source: 'order-detail'
    };
    keys.forEach((key) => byOrder.set(key, [...(byOrder.get(key) || []), orderLine]));
  });
  return byOrder;
}

function lineFor(row: SupabaseInboxRow, index: number): OrderLine {
  const qty = Math.max(1, numberValue(row.total_units, numberValue(row.line_count, 1)));
  const invoiceMissing = Boolean(row.invoice_detail_missing || row.line_items_missing);
  return {
    sku: invoiceMissing ? 'PENDING-INVOICE-DETAIL' : `OM-${String(row.order_number || row.external_order_number || index).replace(/\D/g, '').slice(-5).padStart(5, '0')}`,
    name: invoiceMissing ? 'Invoice detail required before warehouse release' : `${numberValue(row.line_count, 1)} Ordermentum lines`,
    qty,
    unit: 'carton',
    stock: invoiceMissing ? 0 : qty + 8,
    location: locationSequence[index % locationSequence.length],
    barcode: `93${String(index + 1000000000).slice(0, 10)}`,
    source: 'catalog-sample'
  };
}

function buildOrders(rows: SupabaseInboxRow[], businessDay: string, lineMap = new Map<string, OrderLine[]>(), draftMap = new Map<string, SupabaseDraftRow>(), omMap = new Map<string, SupabaseOmOrderRow>()): ImportedOrder[] {
  return rows.map((row, index) => {
    const orderNo = textValue(row.order_number, textValue(row.external_order_number, `OM-RAW-${index + 1}`));
    const invoiceNo = textValue(row.invoice_number, textValue(row.external_invoice_number, 'invoice pending'));
    const amount = numberValue(row.invoice_total, numberValue(row.order_items_total, 0));
    const draft = draftMap.get(textValue(row.external_order_id, '')) || draftMap.get(orderNo);
    const om = omMap.get(textValue(row.external_order_id, '')) || omMap.get(textValue(row.om_order_id, '')) || omMap.get(orderNo);
    const status = draft ? statusFromDraft(draft) : orderStatus(row);
    const gateStatus = draft ? gateStatusFromDraft(draft) : (status === 'MAPPING_EXCEPTION' ? 'BLOCKED_DATA' : 'READY_TO_RELEASE');
    const fallbackLine = lineFor(row, index);
    const actualLines = lineMap.get(textValue(row.external_order_id, '')) || lineMap.get(orderNo) || [];
    const itemLines = actualLines.length ? actualLines : [fallbackLine];
    const store = textValue(om?.retailer_name, 'Ordermentum retailer');
    const businessReceived = row.received_business_day || businessDateFromIso(row.first_seen_at || row.order_created_at || row.raw_created_at || new Date().toISOString());
    const businessUpdated = row.updated_business_day || businessDateFromIso(row.order_updated_at || row.raw_updated_at || row.last_seen_at || new Date().toISOString());
    const firstSeenAt = row.first_seen_at || row.order_created_at || row.raw_created_at || new Date().toISOString();
    const lastSeenAt = row.last_seen_at || row.order_updated_at || row.raw_updated_at || firstSeenAt;

    return {
      id: row.raw_order_id || row.external_order_id || orderNo,
      orderNo,
      invoiceNo,
      store,
      account: store,
      priceTier: tierSequence[index % tierSequence.length],
      address: 'Address pending from customer/site master',
      suburb: 'Adelaide',
      eta: formatTime(row.invoice_due_at || row.order_updated_at, index),
      status,
      paymentStatus: paymentStatus(row.payment_status || row.invoice_payment_status),
      selected: status === 'RELEASE_READY',
      sequence: index + 1,
      amount,
      packageCount: Math.max(1, actualLines.length || numberValue(row.line_count, 1)),
      podStatus: 'missing',
      mappingNotes: [
        row.invoice_detail_missing ? 'Invoice detail missing from om_invoices.' : '',
        row.line_items_missing ? 'Order item lines missing from om_order_items.' : ''
      ].filter(Boolean),
      dueAt: om?.due_at || row.invoice_due_at || row.invoice_date || row.order_updated_at || undefined,
      deliveryDate: om?.delivery_date || row.invoice_date || row.invoice_due_at || row.order_created_at || undefined,
      ordermentumUpdatedAt: row.order_updated_at || undefined,
      externalOrderId: textValue(row.external_order_id, textValue(row.om_order_id, orderNo)),
      externalCreatedAt: row.order_created_at || undefined,
      externalUpdatedAt: row.order_updated_at || undefined,
      firstSeenAt,
      lastSeenAt,
      lastSyncedAt: row.last_synced_at || lastSeenAt,
      businessDay: businessUpdated,
      requestedDeliveryBusinessDay: businessDateFromIso(row.invoice_due_at || row.invoice_date || row.order_created_at || lastSeenAt),
      firstSeenBusinessDay: businessReceived,
      lastUpdatedBusinessDay: businessUpdated,
      syncStatus: syncStatus(row, businessDay),
      changeImpact: changeImpact(row),
      changeSummary: (draft ? blockersFromDraft(draft) : '') || (row.invoice_detail_missing ? 'Invoice detail missing' : row.line_items_missing ? 'Line items missing' : textValue(row.order_status, 'Ordermentum update')),
      openExceptionCount: gateStatus === 'READY_TO_RELEASE' ? 0 : 1,
      releaseGateStatus: gateStatus,
      releaseBlockers: draft ? blockersFromDraft(draft) : '',
      mappedLineCount: draft ? Math.max(0, numberValue(draft.line_count, actualLines.length) - numberValue(draft.unmapped_line_count, 0)) : actualLines.length,
      unmappedLineCount: numberValue(draft?.unmapped_line_count, Number(row.invoice_detail_missing || row.line_items_missing)),
      stockShortageCount: 0,
      requiredQuantity: numberValue(row.total_units, numberValue(om?.total_quantity, 0)),
      mappedAvailableQuantity: 0,
      canCreateInternalOrder: draft ? String(draft.internalisation_status || '') === 'READY_TO_INTERNALISE' : status === 'RELEASE_READY',
      lines: itemLines
    };
  });
}

function buildStores(orders: ImportedOrder[]): StoreProfile[] {
  const byStore = new Map<string, ImportedOrder[]>();
  orders.forEach((order) => byStore.set(order.store, [...(byStore.get(order.store) || []), order]));
  return Array.from(byStore.entries()).map(([store, rows], index) => ({
    id: `supabase-store-${index + 1}`,
    name: store,
    account: store,
    suburb: rows[0]?.suburb || 'Adelaide',
    priceTier: rows[0]?.priceTier || tierSequence[index % tierSequence.length],
    paymentTerms: 'Ordermentum payment status',
    ordermentumId: `retained-orders:${rows.length}`,
    statementGroup: store,
    status: 'NEEDS_ADDRESS',
    orderCount: rows.length,
    totalValue: rows.reduce((sum, order) => sum + order.amount, 0)
  }));
}

function buildExceptions(rows: SupabaseExceptionRow[], orders: ImportedOrder[]): MappingException[] {
  const byOrder = new Map(orders.map((order) => [order.orderNo, order]));
  const importExceptions = rows.map((row, index): MappingException => {
    const orderNo = textValue(row.order_number, textValue(row.external_order_number, `OM-EX-${index + 1}`));
    const order = byOrder.get(orderNo);
    return {
      id: `${row.raw_order_id || orderNo}-${row.exception_type || index}`,
      orderId: order?.id || row.raw_order_id || orderNo,
      orderNo,
      store: order?.store || 'Ordermentum retailer',
      category: row.exception_type === 'INVOICE_DETAIL_MISSING' ? 'PAYMENT' : 'SKU_MAPPING',
      severity: 'danger',
      summary: String(row.exception_type || 'IMPORT_EXCEPTION').replace(/_/g, ' '),
      detail: row.message || 'Ordermentum record requires review.',
      action: row.exception_type === 'INVOICE_DETAIL_MISSING' ? 'Fetch invoice detail' : 'Open import record'
    };
  });
  const releaseGateExceptions = orders
    .filter((order) => order.releaseGateStatus && order.releaseGateStatus !== 'READY_TO_RELEASE' && !rows.some((row) => row.order_number === order.orderNo || row.external_order_number === order.orderNo))
    .map((order): MappingException => ({
      id: `${order.id}-${order.releaseGateStatus}`,
      orderId: order.id,
      orderNo: order.orderNo,
      store: order.store,
      category: order.releaseGateStatus === 'REVIEW_PAYMENT' ? 'PAYMENT' : order.releaseGateStatus === 'BLOCKED_STOCK' ? 'STOCK_SHORTAGE' : 'SKU_MAPPING',
      severity: order.releaseGateStatus === 'REVIEW_PAYMENT' ? 'warn' : 'danger',
      summary: String(order.releaseGateStatus).replace(/_/g, ' '),
      detail: order.releaseBlockers || 'Release gate requires review before internal order creation.',
      action: order.releaseGateStatus === 'BLOCKED_MAPPING' ? 'Map SKUs' : order.releaseGateStatus === 'BLOCKED_STOCK' ? 'Review stock' : 'Review order'
    }));
  return [...importExceptions, ...releaseGateExceptions];
}

function buildDataQuality(health: SupabaseSyncHealthRow | null, rowCount: number, releaseSummary: SupabaseReleaseSummaryRow | null, skuCandidates: SupabaseSkuMappingCandidateRow[]): DataQualityItem[] {
  const invoiceMissing = numberValue(health?.invoice_detail_missing, 0);
  const linesMissing = numberValue(health?.line_items_missing, 0);
  const blockedMapping = numberValue(releaseSummary?.blocked_mapping, 0);
  const blockedStock = numberValue(releaseSummary?.blocked_stock, 0);
  const readyToRelease = numberValue(releaseSummary?.ready_to_internalise, 0);
  const unmappedSkuCount = skuCandidates.filter((item) => item.mapping_status !== 'MAPPED').length;
  return [
    {
      severity: rowCount ? 'good' : 'danger',
      area: 'Supabase order inbox',
      message: `${rowCount} Ordermentum orders retained in raw inbox.`,
      detail: 'The UI is reading v_ecoflow_ordermentum_inbox through Supabase REST.'
    },
    {
      severity: invoiceMissing ? 'warn' : 'good',
      area: 'Invoice detail coverage',
      message: `${invoiceMissing} orders need invoice detail refresh.`,
      detail: 'Missing invoice detail should be fetched individually, not by rerunning a full backfill.'
    },
    {
      severity: linesMissing ? 'warn' : 'good',
      area: 'Line item coverage',
      message: `${linesMissing} orders need item lines.`,
      detail: 'Orders without lines stay out of warehouse release until detail is available.'
    },
    {
      severity: readyToRelease ? 'good' : blockedMapping || blockedStock ? 'warn' : 'info',
      area: 'Release gate',
      message: `${readyToRelease} orders can create internal orders.`,
      detail: `${blockedMapping} blocked by SKU mapping, ${blockedStock} blocked by stock, ${unmappedSkuCount} SKU candidates need review.`
    }
  ];
}

function buildLogs(health: SupabaseSyncHealthRow | null, views: SupabaseOrdermentumViews): Activity[] {
  return [
    { at: 'sync', actor: 'Supabase', action: 'Raw inbox loaded', detail: `${views.inbox.length} Ordermentum orders available from v_ecoflow_ordermentum_inbox.` },
    { at: 'sync', actor: 'EcoFlow OS', action: 'Exception view loaded', detail: `${views.exceptions.length} open import exceptions are visible from v_ecoflow_ordermentum_exceptions.` },
    { at: 'sync', actor: 'Ordermentum', action: 'Latest update', detail: health?.last_order_updated_at || 'No Ordermentum update timestamp available.' }
  ];
}

async function supabaseFetch<T>(path: string): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function optionalSupabaseFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await supabaseFetch<T>(path);
  } catch {
    return fallback;
  }
}

/** PostgREST caps responses at 1000 rows; page through until short page. */
async function supabaseFetchAll<T>(path: string, pageSize = 1000, maxPages = 6): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await optionalSupabaseFetch<T[]>(`${path}&limit=${pageSize}&offset=${page * pageSize}`, []);
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export async function loadSupabaseOrdermentumViews(): Promise<SupabaseOrdermentumViews | null> {
  if (!hasSupabaseConfig()) return null;
  const [inbox, exceptions, healthRows, lines, drafts, omOrders, releaseSummaryRows, skuMappingCandidates] = await Promise.all([
    supabaseFetchAll<SupabaseInboxRow>('v_ecoflow_ordermentum_inbox?select=*&order=order_updated_at.desc'),
    supabaseFetch<SupabaseExceptionRow[]>('v_ecoflow_ordermentum_exceptions?select=*&order=detected_at.desc'),
    supabaseFetch<SupabaseSyncHealthRow[]>('v_ecoflow_ordermentum_sync_health?select=*'),
    supabaseFetchAll<SupabaseOrderLineRow>('v_ecoflow_ordermentum_order_lines?select=*&order=order_number.asc'),
    supabaseFetchAll<SupabaseDraftRow>('v_ecoflow_ordermentum_internal_order_drafts_v3?select=*&order=last_synced_at.desc'),
    supabaseFetchAll<SupabaseOmOrderRow>('om_orders?select=id,order_number,retailer_name,delivery_date,due_at,total_quantity&order=updated_at.desc'),
    optionalSupabaseFetch<SupabaseReleaseSummaryRow[]>('v_ecoflow_ordermentum_release_summary_v2?select=*', []),
    optionalSupabaseFetch<SupabaseSkuMappingCandidateRow[]>('v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc', [])
  ]);
  return { inbox, exceptions, health: healthRows[0] || null, lines, drafts, omOrders, releaseSummary: releaseSummaryRows[0] || null, skuMappingCandidates };
}

export function applySupabaseOrdermentumViews(base: EcoFlowDataSet, views: SupabaseOrdermentumViews): EcoFlowDataSet {
  const anchorIso = maxIso([views.health?.last_order_updated_at, ...views.inbox.map((row) => row.order_updated_at)]);
  const businessDay = businessDateFromIso(anchorIso);
  const lineMap = buildLineMap(views.lines || []);
  const draftMap = new Map<string, SupabaseDraftRow>();
  (views.drafts || []).forEach((draft) => {
    if (draft.external_order_id) draftMap.set(draft.external_order_id, draft);
    if (draft.order_number) draftMap.set(draft.order_number, draft);
  });
  const omMap = new Map<string, SupabaseOmOrderRow>();
  (views.omOrders || []).forEach((om) => {
    if (om.id) omMap.set(om.id, om);
    if (om.order_number) omMap.set(om.order_number, om);
  });
  const orders = buildOrders(views.inbox, businessDay, lineMap, draftMap, omMap);
  const stores = buildStores(orders);
  const mappingExceptions = buildExceptions(views.exceptions, orders);
  const enrichedOrders = orders.map((order) => ({
    ...order,
    openExceptionCount: mappingExceptions.filter((item) => item.orderId === order.id || item.orderNo === order.orderNo).length || order.openExceptionCount
  }));
  const syncBatch = makeSyncBatch({
    completedAt: views.health?.last_synced_at || anchorIso,
    fetched: numberValue(views.health?.raw_orders, views.inbox.length),
    created: enrichedOrders.filter((order) => order.syncStatus === 'NEW').length,
    updated: enrichedOrders.filter((order) => order.syncStatus === 'UPDATED').length,
    unchanged: enrichedOrders.filter((order) => order.syncStatus === 'UNCHANGED').length,
    failed: views.exceptions.length
  });
  const dataQuality = buildDataQuality(views.health, views.inbox.length, views.releaseSummary, views.skuMappingCandidates || []);
  const logs = buildLogs(views.health, views);
  const invoiceTotal = enrichedOrders.reduce((sum, order) => sum + order.amount, 0);

  return {
    ...base,
    orders: enrichedOrders,
    stores,
    logs,
    dataQuality,
    mappingExceptions,
    syncBatch,
    businessDay: syncBatch.businessDay,
    bucketCounts: getOrderBucketCounts(enrichedOrders, syncBatch.businessDay.date),
    repositoryStatus: {
      ...base.repositoryStatus,
      mode: 'supabase',
      label: 'Supabase Ordermentum raw inbox',
      connected: true,
      loadedAt: views.health?.last_synced_at || anchorIso,
      sourceFiles: ['v_ecoflow_ordermentum_inbox', 'v_ecoflow_ordermentum_internal_order_drafts_v3', 'v_ecoflow_ordermentum_order_lines', 'om_orders', 'v_ecoflow_ordermentum_sku_mapping_candidates', 'v_ecoflow_ordermentum_sync_health'],
      counts: {
        ...base.repositoryStatus.counts,
        recentOrders: enrichedOrders.length
      }
    },
    summary: {
      ...base.summary,
      recentOrdersCount: enrichedOrders.length,
      detailOrderNo: enrichedOrders[0]?.orderNo || base.summary.detailOrderNo,
      detailInvoiceNo: enrichedOrders[0]?.invoiceNo || base.summary.detailInvoiceNo,
      detailRetailerName: enrichedOrders[0]?.store || base.summary.detailRetailerName,
      detailLineCount: enrichedOrders[0]?.packageCount || base.summary.detailLineCount,
      invoiceTotal,
      invoiceStatus: views.releaseSummary ? `${numberValue(views.releaseSummary.ready_to_internalise, 0)} ready / ${numberValue(views.releaseSummary.blocked_data, 0)} awaiting line detail` : `${views.exceptions.length} open import exceptions`,
      supplierName: 'EcoFlow Packaging',
      sourceFiles: ['Supabase views']
    }
  };
}
