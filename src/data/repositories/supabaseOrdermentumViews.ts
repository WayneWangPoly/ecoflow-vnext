import { getOrderBucketCounts } from '@/domain/orderBuckets';
import { businessDateFromIso, makeBusinessDay, makeSyncBatch } from '@/domain/syncModel';
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
  retailer_id: string | null;
  retailer_name: string | null;
  delivery_date: string | null;
  due_at: string | null;
  total_quantity: number | string | null;
};

export type SupabaseSkuMasterRow = {
  external_sku_code: string | null;
  classification: string | null;
  is_service_item: boolean | null;
  pick_level: string | null;
  warehouse_location: string | null;
  status: string | null;
  internal_sku_id: string | null;
  carton_barcode: string | null;
  carton_barcode_status: string | null;
  each_barcode: string | null;
  each_barcode_status: string | null;
};

export type SupabaseStoreSiteRow = {
  retailer_id: string | null;
  purchaser_id: string | null;
  store_name: string | null;
  street1: string | null;
  street2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_phone: string | null;
  delivery_instructions: string | null;
  price_group_id: string | null;
  source: string | null;
  verified: boolean | null;
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
  skuMaster: SupabaseSkuMasterRow[];
  storeSites: SupabaseStoreSiteRow[];
  releaseSummary: SupabaseReleaseSummaryRow | null;
  skuMappingCandidates: SupabaseSkuMappingCandidateRow[];
};

const UNMAPPED_TIER: PriceTier = 'Unmapped';

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
  if (normalized.includes('paid')) return 'PAID';
  if (normalized.includes('overdue')) return 'OVERDUE';
  return 'UNPAID';
}

function isCompletedOrder(row: SupabaseInboxRow, draft?: SupabaseDraftRow): boolean {
  const values = [row.order_status, row.invoice_status, draft?.internalisation_status, draft?.warehouse_gate_status]
    .map((value) => String(value || '').toLowerCase());
  return values.some((value) =>
    value === 'completed' ||
    value === 'complete' ||
    value === 'closed' ||
    value === 'delivered' ||
    value === 'fulfilled' ||
    value === 'finalised' ||
    value === 'finalized' ||
    value.includes('completed') ||
    value.includes('delivered') ||
    value.includes('closed') ||
    value.includes('fulfilled')
  );
}

function isLegacyDraft(draft?: SupabaseDraftRow) {
  if (!draft?.internal_order_id) return false;
  const internalisation = String(draft.internalisation_status || '').toUpperCase();
  const gate = String(draft.warehouse_gate_status || '').toUpperCase();
  return ['READY_TO_INTERNALISE', 'READY', 'RELEASE_READY'].includes(internalisation) && ['BLOCKED_BARCODE', 'BARCODE_BLOCKED'].includes(gate);
}

function orderStatus(row: SupabaseInboxRow, draft?: SupabaseDraftRow): OrderStatus {
  if (isCompletedOrder(row, draft)) return 'CLOSED';
  if (isLegacyDraft(draft)) return 'MAPPING_EXCEPTION';
  const normalized = String(row.order_status || '').toLowerCase();
  if (normalized === 'cancelled' || normalized === 'canceled') return 'CANCELLED';
  if (draft?.internal_order_id) return 'IMPORTED';
  if (row.invoice_detail_missing || row.line_items_missing) return 'MAPPING_EXCEPTION';
  const internalisation = String(draft?.internalisation_status || '').toUpperCase();
  const gate = String(draft?.warehouse_gate_status || '').toUpperCase();
  if (['BLOCKED_MAPPING', 'NOT_ELIGIBLE_MAPPING', 'BLOCKED_BARCODE', 'BARCODE_BLOCKED'].includes(internalisation) || ['BLOCKED_MAPPING', 'NOT_ELIGIBLE_MAPPING', 'BLOCKED_BARCODE', 'BARCODE_BLOCKED'].includes(gate)) return 'MAPPING_EXCEPTION';
  if (['BLOCKED_DATA', 'NOT_ELIGIBLE_DATA'].includes(internalisation) || ['BLOCKED_DATA', 'NOT_ELIGIBLE_DATA'].includes(gate)) return 'MAPPING_EXCEPTION';
  if (String(draft?.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') return 'IMPORTED';
  if (normalized === 'processing') return 'IMPORTED';
  return 'RELEASE_READY';
}

function syncStatus(row: SupabaseInboxRow, businessDay: string): OrderSyncStatus {
  if (row.received_business_day === businessDay) return 'NEW';
  if (row.updated_business_day === businessDay) return 'UPDATED';
  return 'UNCHANGED';
}

function changeImpact(row: SupabaseInboxRow): OrderChangeImpact {
  if (isCompletedOrder(row)) return 'SAFE_UPDATE';
  if (row.invoice_detail_missing || row.line_items_missing) return 'REVIEW_REQUIRED';
  if (String(row.payment_status || '').toLowerCase() === 'processing') return 'REVIEW_REQUIRED';
  return 'NO_CHANGE';
}

function gateStatusFromOrder(status: OrderStatus, draft?: SupabaseDraftRow): ReleaseGateStatus {
  if (status === 'CLOSED' || status === 'DELIVERED' || status === 'CANCELLED') return 'READY_TO_RELEASE';
  const internalisation = String(draft?.internalisation_status || '').toUpperCase();
  const gate = String(draft?.warehouse_gate_status || '').toUpperCase();
  if (['BLOCKED_MAPPING', 'NOT_ELIGIBLE_MAPPING', 'BLOCKED_BARCODE', 'BARCODE_BLOCKED'].includes(internalisation) || ['BLOCKED_MAPPING', 'NOT_ELIGIBLE_MAPPING', 'BLOCKED_BARCODE', 'BARCODE_BLOCKED'].includes(gate)) return 'BLOCKED_MAPPING';
  if (['BLOCKED_DATA', 'NOT_ELIGIBLE_DATA'].includes(internalisation) || ['BLOCKED_DATA', 'NOT_ELIGIBLE_DATA'].includes(gate)) return 'BLOCKED_DATA';
  if (internalisation === 'BLOCKED_STOCK' || gate === 'BLOCKED_STOCK') return 'BLOCKED_STOCK';
  if (String(draft?.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') return 'REVIEW_PAYMENT';
  if (status === 'MAPPING_EXCEPTION') return 'BLOCKED_DATA';
  return 'READY_TO_RELEASE';
}

function blockersFromDraft(draft?: SupabaseDraftRow): string {
  if (!draft) return '';
  const parts: string[] = [];
  const unmapped = numberValue(draft.unmapped_line_count, 0);
  const barcodeBlocked = numberValue(draft.barcode_blocked_line_count, 0);
  const internalisation = String(draft.internalisation_status || '').toUpperCase();
  const gate = String(draft.warehouse_gate_status || '').toUpperCase();
  if (['BLOCKED_DATA', 'NOT_ELIGIBLE_DATA'].includes(internalisation) || ['BLOCKED_DATA', 'NOT_ELIGIBLE_DATA'].includes(gate)) parts.push('Order line detail missing — refresh invoice detail before release');
  if (unmapped) parts.push(`${unmapped} line${unmapped === 1 ? '' : 's'} need SKU mapping`);
  if (String(draft.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') parts.push('Payment review hold');
  if (barcodeBlocked || ['BLOCKED_BARCODE', 'BARCODE_BLOCKED'].includes(gate)) parts.push(`${barcodeBlocked || 'Some'} line${barcodeBlocked === 1 ? '' : 's'} await barcode confirmation`);
  return parts.join(' · ');
}

function unitForLine(unit: string | null | undefined, uom: string | null | undefined): 'sleeve' | 'carton' {
  const normalized = String(unit || uom || '').toLowerCase().trim();
  if (normalized.includes('sleeve') || normalized === 'unit' || normalized === 'each' || normalized === 'ea') return 'sleeve';
  return 'carton';
}

function buildLineMap(lines: SupabaseOrderLineRow[], skuMaster = new Map<string, SupabaseSkuMasterRow>()) {
  const byOrder = new Map<string, OrderLine[]>();
  lines.forEach((line, index) => {
    const keys = [line.source_order_id, line.order_number, line.invoice_number].filter((value): value is string => Boolean(value));
    const qty = Math.max(1, numberValue(line.quantity, 1));
    const sku = textValue(line.external_sku_code, `OM-LINE-${String(line.source_line_id || index + 1).slice(0, 8)}`);
    const master = skuMaster.get(sku.toUpperCase());
    const pickLevel = String(master?.pick_level || '').toUpperCase();
    const unit: 'sleeve' | 'carton' = master ? (pickLevel === 'EACH' || pickLevel === 'SLEEVE' ? 'sleeve' : 'carton') : unitForLine(line.unit, line.uom);
    const orderLine: OrderLine = {
      sku,
      name: textValue(line.external_product_name, 'Ordermentum line item'),
      qty,
      unit,
      stock: qty,
      location: textValue(master?.warehouse_location, ''),
      barcode: unit === 'sleeve'
        ? textValue(master?.each_barcode, textValue(master?.carton_barcode, '')) || undefined
        : textValue(master?.carton_barcode, '') || undefined,
      isService: master ? Boolean(master.is_service_item) : undefined,
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
    stock: 0,
    location: '',
    barcode: undefined,
    source: 'fallback'
  };
}

function buildOrders(
  rows: SupabaseInboxRow[],
  businessDay: string,
  lineMap = new Map<string, OrderLine[]>(),
  draftMap = new Map<string, SupabaseDraftRow>(),
  omMap = new Map<string, SupabaseOmOrderRow>(),
  siteMap = new Map<string, SupabaseStoreSiteRow>(),
  priceGroupNames = new Map<string, string>()
): ImportedOrder[] {
  return rows.map((row, index) => {
    const orderNo = textValue(row.order_number, textValue(row.external_order_number, `OM-RAW-${index + 1}`));
    const invoiceNo = textValue(row.invoice_number, textValue(row.external_invoice_number, 'invoice pending'));
    const amount = numberValue(row.invoice_total, numberValue(row.order_items_total, 0));
    const draft = draftMap.get(textValue(row.external_order_id, '')) || draftMap.get(orderNo) || draftMap.get(invoiceNo);
    const om = omMap.get(textValue(row.external_order_id, '')) || omMap.get(textValue(row.om_order_id, '')) || omMap.get(orderNo);
    const site = om?.retailer_id ? siteMap.get(om.retailer_id) : undefined;
    const status = orderStatus(row, draft);
    const gateStatus = gateStatusFromOrder(status, draft);
    const actualLines = lineMap.get(textValue(row.external_order_id, '')) || lineMap.get(orderNo) || lineMap.get(invoiceNo) || [];
    const itemLines = actualLines.length ? actualLines : [lineFor(row, index)];
    const store = textValue(site?.store_name, textValue(om?.retailer_name, 'Ordermentum retailer'));
    const siteAddress = textValue(site?.formatted_address, site?.street1 ? [site.street1, site.street2, site.suburb, site.state, site.postcode].filter(Boolean).join(', ') : '');
    const priceTier = site?.price_group_id ? (priceGroupNames.get(site.price_group_id) || UNMAPPED_TIER) : UNMAPPED_TIER;
    const businessReceived = row.received_business_day || businessDateFromIso(row.first_seen_at || row.order_created_at || row.raw_created_at || new Date().toISOString());
    const businessUpdated = row.updated_business_day || businessDateFromIso(row.order_updated_at || row.raw_updated_at || row.last_seen_at || new Date().toISOString());
    const firstSeenAt = row.first_seen_at || row.order_created_at || row.raw_created_at || new Date().toISOString();
    const lastSeenAt = row.last_seen_at || row.order_updated_at || row.raw_updated_at || firstSeenAt;
    const completed = status === 'CLOSED' || status === 'DELIVERED';
    const hasInternalOrder = Boolean(draft?.internal_order_id);

    return {
      id: row.raw_order_id || row.external_order_id || orderNo,
      orderNo,
      invoiceNo,
      store,
      account: store,
      priceTier,
      address: siteAddress || 'Address pending from customer/site master',
      suburb: textValue(site?.suburb, 'Adelaide'),
      phone: textValue(site?.contact_phone, '') || undefined,
      lat: typeof site?.latitude === 'number' ? site.latitude : undefined,
      lng: typeof site?.longitude === 'number' ? site.longitude : undefined,
      deliveryNote: textValue(site?.delivery_instructions, '') || undefined,
      eta: completed ? 'done' : formatTime(row.invoice_due_at || row.order_updated_at, index),
      status,
      paymentStatus: paymentStatus(row.payment_status || row.invoice_payment_status),
      selected: status === 'RELEASE_READY' && !hasInternalOrder,
      sequence: index + 1,
      amount,
      packageCount: Math.max(1, actualLines.length || numberValue(row.line_count, 1)),
      podStatus: completed ? 'captured' : 'missing',
      mappingNotes: completed ? ['Completed in Ordermentum'] : [
        row.invoice_detail_missing ? 'Invoice detail missing from om_invoices.' : '',
        row.line_items_missing ? 'Order item lines missing from om_order_items.' : '',
        isLegacyDraft(draft) ? 'Legacy internal draft held for review.' : ''
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
      changeSummary: completed ? 'Completed in Ordermentum' : (blockersFromDraft(draft) || (row.invoice_detail_missing ? 'Invoice detail missing' : row.line_items_missing ? 'Line items missing' : textValue(row.order_status, 'Ordermentum update'))),
      openExceptionCount: completed || gateStatus === 'READY_TO_RELEASE' ? 0 : 1,
      releaseGateStatus: gateStatus,
      releaseBlockers: completed ? '' : blockersFromDraft(draft),
      mappedLineCount: draft ? Math.max(0, numberValue(draft.line_count, actualLines.length) - numberValue(draft.unmapped_line_count, 0)) : actualLines.length,
      unmappedLineCount: completed ? 0 : numberValue(draft?.unmapped_line_count, Number(row.invoice_detail_missing || row.line_items_missing)),
      stockShortageCount: 0,
      requiredQuantity: numberValue(row.total_units, numberValue(om?.total_quantity, 0)),
      mappedAvailableQuantity: 0,
      canCreateInternalOrder: !completed && !hasInternalOrder && status === 'RELEASE_READY' && (draft ? String(draft.internalisation_status || '') === 'READY_TO_INTERNALISE' : true),
      lines: itemLines
    };
  });
}

function buildStores(orders: ImportedOrder[], sitesByName = new Map<string, SupabaseStoreSiteRow>()): StoreProfile[] {
  const byStore = new Map<string, ImportedOrder[]>();
  orders.forEach((order) => byStore.set(order.store, [...(byStore.get(order.store) || []), order]));
  return Array.from(byStore.entries()).map(([store, rows], index) => {
    const site = sitesByName.get(store);
    const hasAddress = Boolean(rows[0]?.address && !rows[0].address.startsWith('Address pending'));
    return {
      id: site?.retailer_id || `supabase-store-${index + 1}`,
      name: store,
      account: store,
      suburb: rows[0]?.suburb || 'Adelaide',
      priceTier: rows[0]?.priceTier || UNMAPPED_TIER,
      paymentTerms: site?.verified ? 'Site master verified (Ordermentum)' : 'Ordermentum payment status',
      ordermentumId: site?.retailer_id || `active-orders:${rows.length}`,
      statementGroup: store,
      status: hasAddress ? 'OK' : 'NEEDS_ADDRESS',
      address: hasAddress ? rows[0].address : undefined,
      phone: rows[0]?.phone,
      orderCount: rows.length,
      totalValue: rows.reduce((sum, order) => sum + order.amount, 0)
    };
  });
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
    .filter((order) => !['CLOSED', 'DELIVERED', 'CANCELLED'].includes(order.status) && order.releaseGateStatus && order.releaseGateStatus !== 'READY_TO_RELEASE' && !rows.some((row) => row.order_number === order.orderNo || row.external_order_number === order.orderNo))
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

function buildDataQuality(health: SupabaseSyncHealthRow | null, activeRowCount: number, releaseSummary: SupabaseReleaseSummaryRow | null, skuCandidates: SupabaseSkuMappingCandidateRow[]): DataQualityItem[] {
  const rawOrders = numberValue(health?.raw_orders, activeRowCount);
  const invoiceMissing = numberValue(health?.invoice_detail_missing, 0);
  const linesMissing = numberValue(health?.line_items_missing, 0);
  const blockedMapping = numberValue(releaseSummary?.blocked_mapping, 0);
  const blockedStock = numberValue(releaseSummary?.blocked_stock, 0);
  const readyToRelease = numberValue(releaseSummary?.ready_to_internalise, 0);
  const unmappedSkuCount = skuCandidates.filter((item) => item.mapping_status !== 'MAPPED').length;
  return [
    { severity: activeRowCount ? 'good' : 'info', area: 'Active Orders UI', message: `${activeRowCount} active Ordermentum orders loaded into the browser.`, detail: 'The UI reads the active lifecycle slice, not the full raw history table.' },
    { severity: rawOrders ? 'good' : 'danger', area: 'Raw Ordermentum inbox', message: `${rawOrders} retained raw orders in Supabase.`, detail: 'Raw history stays in Supabase for audit/search and must not drive warehouse/driver workflows directly.' },
    { severity: invoiceMissing ? 'warn' : 'good', area: 'Invoice detail coverage', message: `${invoiceMissing} orders need invoice detail refresh.`, detail: 'Missing invoice detail stays blocked until detail is fetched.' },
    { severity: linesMissing || blockedMapping || blockedStock ? 'warn' : 'good', area: 'Release gate', message: `${readyToRelease} ready, ${blockedMapping} mapping blocked, ${blockedStock} stock blocked.`, detail: `${unmappedSkuCount} SKU candidates need review.` }
  ];
}

function buildLogs(health: SupabaseSyncHealthRow | null, views: SupabaseOrdermentumViews): Activity[] {
  return [
    { at: 'sync', actor: 'Supabase', action: 'Active inbox loaded', detail: `${views.inbox.length} active workflow orders loaded into the browser.` },
    { at: 'sync', actor: 'EcoFlow OS', action: 'Raw history retained', detail: `${numberValue(views.health?.raw_orders, views.inbox.length)} raw Ordermentum orders remain in Supabase.` },
    { at: 'sync', actor: 'Ordermentum', action: 'Latest update', detail: health?.last_order_updated_at || 'No Ordermentum update timestamp available.' }
  ];
}

async function supabaseFetch<T>(path: string): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: 'application/json' }
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

async function firstAvailable<T>(paths: string[], fallback: T): Promise<T> {
  for (const path of paths) {
    try {
      return await supabaseFetch<T>(path);
    } catch {
      // Try the next view. This keeps the app usable during migration rollout.
    }
  }
  return fallback;
}

export async function loadSupabaseOrdermentumViews(): Promise<SupabaseOrdermentumViews | null> {
  if (!hasSupabaseConfig()) return null;

  const [inbox, exceptions, healthRows, lines, drafts, omOrders, skuMaster, storeSites, releaseSummaryRows, skuMappingCandidates] = await Promise.all([
    firstAvailable<SupabaseInboxRow[]>([
      'v_ecoflow_ordermentum_ui_active_inbox?select=*&order=order_updated_at.desc&limit=160',
      'v_ecoflow_ordermentum_inbox?select=*&order=order_updated_at.desc&limit=160'
    ], []),
    firstAvailable<SupabaseExceptionRow[]>([
      'v_ecoflow_ordermentum_ui_active_exceptions?select=*&order=detected_at.desc&limit=160',
      'v_ecoflow_ordermentum_exceptions?select=*&order=detected_at.desc&limit=160'
    ], []),
    supabaseFetch<SupabaseSyncHealthRow[]>('v_ecoflow_ordermentum_sync_health?select=*'),
    firstAvailable<SupabaseOrderLineRow[]>([
      'v_ecoflow_ordermentum_ui_active_order_lines?select=*&order=order_number.asc&limit=1200',
      'v_ecoflow_ordermentum_order_lines?select=*&order=order_number.asc&limit=1200'
    ], []),
    firstAvailable<SupabaseDraftRow[]>([
      'v_ecoflow_ordermentum_ui_active_drafts?select=*&order=last_synced_at.desc&limit=300',
      'v_ecoflow_ordermentum_internal_order_drafts_v3?select=*&order=last_synced_at.desc&limit=300'
    ], []),
    firstAvailable<SupabaseOmOrderRow[]>([
      'v_ecoflow_ordermentum_ui_active_om_orders?select=id,order_number,retailer_id,retailer_name,delivery_date,due_at,total_quantity&order=updated_at.desc&limit=300',
      'om_orders?select=id,order_number,retailer_id,retailer_name,delivery_date,due_at,total_quantity&order=updated_at.desc&limit=300'
    ], []),
    optionalSupabaseFetch<SupabaseSkuMasterRow[]>('v_ecoflow_app_sku_master?select=*&limit=2000', []),
    optionalSupabaseFetch<SupabaseStoreSiteRow[]>('ecoflow_store_sites?select=*&limit=1000', []),
    optionalSupabaseFetch<SupabaseReleaseSummaryRow[]>('v_ecoflow_ordermentum_release_summary_v2?select=*', []),
    optionalSupabaseFetch<SupabaseSkuMappingCandidateRow[]>('v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc&limit=200', [])
  ]);

  return { inbox, exceptions, health: healthRows[0] || null, lines, drafts, omOrders, skuMaster, storeSites, releaseSummary: releaseSummaryRows[0] || null, skuMappingCandidates };
}

export function applySupabaseOrdermentumViews(base: EcoFlowDataSet, views: SupabaseOrdermentumViews): EcoFlowDataSet {
  const anchorIso = maxIso([views.health?.last_order_updated_at, ...views.inbox.map((row) => row.order_updated_at)]);
  const businessDay = businessDateFromIso(new Date().toISOString());
  const skuMasterMap = new Map<string, SupabaseSkuMasterRow>();
  (views.skuMaster || []).forEach((row) => { if (row.external_sku_code) skuMasterMap.set(row.external_sku_code.toUpperCase(), row); });
  const siteMap = new Map<string, SupabaseStoreSiteRow>();
  const sitesByName = new Map<string, SupabaseStoreSiteRow>();
  (views.storeSites || []).forEach((site) => { if (site.retailer_id) siteMap.set(site.retailer_id, site); if (site.store_name) sitesByName.set(site.store_name, site); });
  const priceGroupNames = new Map<string, string>();
  base.priceGroups.forEach((group) => priceGroupNames.set(group.id, String(group.name)));
  const lineMap = buildLineMap(views.lines || [], skuMasterMap);
  const draftMap = new Map<string, SupabaseDraftRow>();
  (views.drafts || []).forEach((draft) => { if (draft.external_order_id) draftMap.set(draft.external_order_id, draft); if (draft.order_number) draftMap.set(draft.order_number, draft); if (draft.invoice_number) draftMap.set(draft.invoice_number, draft); });
  const omMap = new Map<string, SupabaseOmOrderRow>();
  (views.omOrders || []).forEach((om) => { if (om.id) omMap.set(om.id, om); if (om.order_number) omMap.set(om.order_number, om); });
  const orders = buildOrders(views.inbox, businessDay, lineMap, draftMap, omMap, siteMap, priceGroupNames);
  const stores = buildStores(orders, sitesByName);
  const mappingExceptions = buildExceptions(views.exceptions, orders);
  const enrichedOrders = orders.map((order) => ({
    ...order,
    openExceptionCount: ['CLOSED', 'DELIVERED', 'CANCELLED'].includes(order.status) ? 0 : (mappingExceptions.filter((item) => item.orderId === order.id || item.orderNo === order.orderNo).length || order.openExceptionCount)
  }));
  const rawOrderCount = numberValue(views.health?.raw_orders, enrichedOrders.length);
  const syncBatch = makeSyncBatch({
    completedAt: views.health?.last_synced_at || anchorIso,
    fetched: rawOrderCount,
    created: enrichedOrders.filter((order) => order.syncStatus === 'NEW').length,
    updated: enrichedOrders.filter((order) => order.syncStatus === 'UPDATED').length,
    unchanged: enrichedOrders.filter((order) => order.syncStatus === 'UNCHANGED').length,
    failed: views.exceptions.length
  });
  const dataQuality = buildDataQuality(views.health, views.inbox.length, views.releaseSummary, views.skuMappingCandidates || []);
  const logs = buildLogs(views.health, views);
  const invoiceTotal = enrichedOrders.reduce((sum, order) => sum + order.amount, 0);
  const operationalDay = makeBusinessDay(new Date().toISOString());

  return {
    ...base,
    orders: enrichedOrders,
    stores,
    stock: [],
    logs,
    dataQuality,
    mappingExceptions,
    syncBatch,
    businessDay: operationalDay,
    bucketCounts: getOrderBucketCounts(enrichedOrders, operationalDay.date),
    repositoryStatus: {
      ...base.repositoryStatus,
      mode: 'supabase',
      label: 'Supabase Ordermentum active workflow',
      connected: true,
      loadedAt: views.health?.last_synced_at || anchorIso,
      sourceFiles: ['v_ecoflow_ordermentum_ui_active_inbox', 'v_ecoflow_order_lifecycle_active', 'v_ecoflow_order_platform_guardrails'],
      counts: { ...base.repositoryStatus.counts, recentOrders: enrichedOrders.length }
    },
    summary: {
      ...base.summary,
      recentOrdersCount: enrichedOrders.length,
      detailOrderNo: enrichedOrders[0]?.orderNo || base.summary.detailOrderNo,
      detailInvoiceNo: enrichedOrders[0]?.invoiceNo || base.summary.detailInvoiceNo,
      detailRetailerName: enrichedOrders[0]?.store || base.summary.detailRetailerName,
      detailLineCount: enrichedOrders[0]?.packageCount || base.summary.detailLineCount,
      invoiceTotal,
      invoiceStatus: views.releaseSummary ? `${numberValue(views.releaseSummary.ready_to_internalise, 0)} ready / ${numberValue(views.releaseSummary.blocked_mapping, 0)} mapping blocked` : `${views.exceptions.length} open import exceptions`,
      supplierName: 'EcoFlow Packaging',
      sourceFiles: ['Supabase active workflow views']
    }
  };
}
