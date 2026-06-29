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
  external_order_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  line_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  sku: string | null;
  name: string | null;
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
};

export type SupabaseOrdermentumViews = {
  inbox: SupabaseInboxRow[];
  exceptions: SupabaseExceptionRow[];
  health: SupabaseSyncHealthRow | null;
  lines: SupabaseOrderLineRow[];
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
    const keys = [line.external_order_id, line.order_number].filter((value): value is string => Boolean(value));
    const qty = Math.max(1, numberValue(line.quantity, 1));
    const orderLine: OrderLine = {
      sku: textValue(line.sku, `OM-LINE-${String(line.line_id || index + 1).slice(0, 8)}`),
      name: textValue(line.name, 'Ordermentum line item'),
      qty,
      unit: unitForLine(line.unit, line.uom),
      stock: qty + 8,
      location: locationSequence[index % locationSequence.length],
      barcode: makeBarcode(line.sku || line.line_id, index),
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

function buildOrders(rows: SupabaseInboxRow[], businessDay: string, lineMap = new Map<string, OrderLine[]>()): ImportedOrder[] {
  return rows.map((row, index) => {
    const orderNo = textValue(row.order_number, textValue(row.external_order_number, `OM-RAW-${index + 1}`));
    const invoiceNo = textValue(row.invoice_number, textValue(row.external_invoice_number, 'invoice pending'));
    const amount = numberValue(row.invoice_total, numberValue(row.order_items_total, 0));
    const status = orderStatus(row);
    const fallbackLine = lineFor(row, index);
    const actualLines = lineMap.get(textValue(row.external_order_id, '')) || lineMap.get(orderNo) || [];
    const itemLines = actualLines.length ? actualLines : [fallbackLine];
    const store = 'Ordermentum retailer';
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
      dueAt: row.invoice_due_at || row.invoice_date || row.order_updated_at || undefined,
      deliveryDate: row.invoice_date || row.invoice_due_at || row.order_created_at || undefined,
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
      changeSummary: row.invoice_detail_missing ? 'Invoice detail missing' : row.line_items_missing ? 'Line items missing' : textValue(row.order_status, 'Ordermentum update'),
      openExceptionCount: Number(row.invoice_detail_missing || row.line_items_missing),
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
  return rows.map((row, index) => {
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
}

function buildDataQuality(health: SupabaseSyncHealthRow | null, rowCount: number): DataQualityItem[] {
  const invoiceMissing = numberValue(health?.invoice_detail_missing, 0);
  const linesMissing = numberValue(health?.line_items_missing, 0);
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

export async function loadSupabaseOrdermentumViews(): Promise<SupabaseOrdermentumViews | null> {
  if (!hasSupabaseConfig()) return null;
  const [inbox, exceptions, healthRows, lines] = await Promise.all([
    supabaseFetch<SupabaseInboxRow[]>('v_ecoflow_ordermentum_inbox?select=*&order=order_updated_at.desc'),
    supabaseFetch<SupabaseExceptionRow[]>('v_ecoflow_ordermentum_exceptions?select=*&order=detected_at.desc'),
    supabaseFetch<SupabaseSyncHealthRow[]>('v_ecoflow_ordermentum_sync_health?select=*'),
    optionalSupabaseFetch<SupabaseOrderLineRow[]>('v_ecoflow_ordermentum_order_lines?select=*&order=order_number.asc', [])
  ]);
  return { inbox, exceptions, health: healthRows[0] || null, lines };
}

export function applySupabaseOrdermentumViews(base: EcoFlowDataSet, views: SupabaseOrdermentumViews): EcoFlowDataSet {
  const anchorIso = maxIso([views.health?.last_order_updated_at, ...views.inbox.map((row) => row.order_updated_at)]);
  const businessDay = businessDateFromIso(anchorIso);
  const lineMap = buildLineMap(views.lines || []);
  const orders = buildOrders(views.inbox, businessDay, lineMap);
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
  const dataQuality = buildDataQuality(views.health, views.inbox.length);
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
      sourceFiles: ['v_ecoflow_ordermentum_inbox', 'v_ecoflow_ordermentum_order_lines', 'v_ecoflow_ordermentum_exceptions', 'v_ecoflow_ordermentum_sync_health'],
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
      invoiceStatus: `${views.exceptions.length} open import exceptions`,
      supplierName: 'EcoFlow Packaging',
      sourceFiles: ['Supabase views']
    }
  };
}
