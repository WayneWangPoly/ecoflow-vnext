import {
  applySupabaseOrdermentumViews as applyBaseSupabaseOrdermentumViews,
  type SupabaseDraftRow,
  type SupabaseExceptionRow,
  type SupabaseInboxRow,
  type SupabaseOmOrderRow,
  type SupabaseOrderLineRow,
  type SupabaseOrdermentumViews,
  type SupabaseReleaseSummaryRow,
  type SupabaseSkuMappingCandidateRow,
  type SupabaseSkuMasterRow,
  type SupabaseStoreSiteRow,
  type SupabaseSyncHealthRow,
} from './supabaseOrdermentumViews';
import { getOrderBucketCounts } from '@/domain/orderBuckets';
import type { EcoFlowDataSet, ImportedOrder, OrderStatus } from '@/domain/types';
import { supabase } from '@/lib/supabaseClient';

export type { SupabaseOrdermentumViews };

type InventoryLocationRow = {
  sku: string | null;
  fixed_shelf: string | null;
  primary_barcode: string | null;
  control_status: string | null;
};

type BarcodeShelfRow = {
  sku: string | null;
  fixed_shelf: string | null;
};

type LiveLocationBalanceRow = {
  sku: string | null;
  location: string | null;
  on_hand_location: number | string | null;
};

type AccountReleaseHoldRow = {
  store_id: string;
  active: boolean | null;
  hold_reason: string | null;
};

export type OperationalSourceDiagnostic = {
  source: string;
  required: boolean;
  status: 'OK' | 'DEGRADED';
  rowCount: number;
  error?: string;
};

export type ResilientOrdermentumViews = SupabaseOrdermentumViews & {
  diagnostics: OperationalSourceDiagnostic[];
  accountHolds: AccountReleaseHoldRow[];
};

export class OperationalSnapshotError extends Error {
  source: string;
  status?: number;

  constructor(source: string, message: string, status?: number) {
    super(`${source}: ${message}`);
    this.name = 'OperationalSnapshotError';
    this.source = source;
    this.status = status;
  }
}

const EXPLICIT_CURRENT_SOURCE_STATUSES = new Set([
  'new',
  'pending',
  'placed',
  'processing',
  'confirmed',
  'accepted',
  'approved',
  'open',
  'ready',
  'paid',
  'unpaid',
  'in_progress',
  'partially_fulfilled',
]);

function envValue(key: string) {
  return (import.meta.env[key] as string | undefined)?.trim() || '';
}

function hasSupabaseConfig() {
  return Boolean(envValue('VITE_SUPABASE_URL') && envValue('VITE_SUPABASE_ANON_KEY'));
}

async function supabaseFetch<T>(source: string, path: string): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const bearer = sessionResult?.data.session?.access_token || anonKey;
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new OperationalSnapshotError(source, body || `Supabase returned ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

function rowCount(value: unknown) {
  return Array.isArray(value) ? value.length : value == null ? 0 : 1;
}

async function requiredFetch<T>(source: string, path: string): Promise<{ data: T; diagnostic: OperationalSourceDiagnostic }> {
  const data = await supabaseFetch<T>(source, path);
  return {
    data,
    diagnostic: { source, required: true, status: 'OK', rowCount: rowCount(data) },
  };
}

async function optionalFetch<T>(source: string, path: string, fallback: T): Promise<{ data: T; diagnostic: OperationalSourceDiagnostic }> {
  try {
    const data = await supabaseFetch<T>(source, path);
    return {
      data,
      diagnostic: { source, required: false, status: 'OK', rowCount: rowCount(data) },
    };
  } catch (error) {
    return {
      data: fallback,
      diagnostic: {
        source,
        required: false,
        status: 'DEGRADED',
        rowCount: rowCount(fallback),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineValue(line: SupabaseOrderLineRow) {
  const explicit = numberValue(line.total) || numberValue(line.subtotal);
  if (explicit) return explicit;
  const unitPrice = numberValue(line.price) || numberValue(line.rate_price);
  return unitPrice * Math.max(0, numberValue(line.quantity));
}

function orderLineTotals(lines: SupabaseOrderLineRow[]) {
  const totals = new Map<string, number>();
  lines.forEach((line) => {
    const value = lineValue(line);
    if (!value) return;
    [line.source_order_id, line.order_number, line.invoice_number]
      .filter((key): key is string => Boolean(key))
      .forEach((key) => totals.set(key, (totals.get(key) || 0) + value));
  });
  return totals;
}

function enrichInboxAmounts(rows: SupabaseInboxRow[], lines: SupabaseOrderLineRow[]) {
  const totals = orderLineTotals(lines);
  return rows.map((row) => {
    const existing = numberValue(row.invoice_total) || numberValue(row.order_items_total);
    if (existing) return row;
    const derived = [
      row.external_order_id,
      row.om_order_id,
      row.order_number,
      row.external_order_number,
      row.invoice_number,
      row.external_invoice_number,
    ]
      .filter((key): key is string => Boolean(key))
      .map((key) => totals.get(key) || 0)
      .find((value) => value > 0) || numberValue(row.total_due);
    return derived > 0 ? { ...row, order_items_total: derived } : row;
  });
}

function liveLocationsBySku(rows: LiveLocationBalanceRow[]) {
  const grouped = new Map<string, Array<{ location: string; quantity: number }>>();
  rows.forEach((row) => {
    if (!row.sku || !row.location || numberValue(row.on_hand_location) <= 0) return;
    const key = row.sku.toUpperCase();
    const current = grouped.get(key) || [];
    current.push({ location: row.location, quantity: numberValue(row.on_hand_location) });
    grouped.set(key, current);
  });
  return new Map([...grouped.entries()].map(([sku, locations]) => [
    sku,
    locations
      .sort((left, right) => right.quantity - left.quantity || left.location.localeCompare(right.location, undefined, { numeric: true }))
      .map((row) => row.location)
      .filter((location, index, all) => all.indexOf(location) === index)
      .slice(0, 4)
      .join(' / '),
  ]));
}

function mergeSkuLocations(
  masterRows: SupabaseSkuMasterRow[],
  inventoryRows: InventoryLocationRow[],
  barcodeRows: BarcodeShelfRow[],
  liveBalanceRows: LiveLocationBalanceRow[],
) {
  const bySku = new Map<string, SupabaseSkuMasterRow>();
  masterRows.forEach((row) => {
    if (row.external_sku_code) bySku.set(row.external_sku_code.toUpperCase(), row);
  });

  const shelfBySku = new Map<string, string>();
  barcodeRows.forEach((row) => {
    if (row.sku && row.fixed_shelf) shelfBySku.set(row.sku.toUpperCase(), row.fixed_shelf);
  });
  const liveBySku = liveLocationsBySku(liveBalanceRows);

  inventoryRows.forEach((row) => {
    if (!row.sku || row.control_status === 'DISCONTINUED') return;
    const key = row.sku.toUpperCase();
    const existing = bySku.get(key);
    const warehouseLocation = liveBySku.get(key) || row.fixed_shelf || shelfBySku.get(key) || existing?.warehouse_location || null;
    const primaryBarcode = row.primary_barcode || existing?.carton_barcode || null;
    bySku.set(key, {
      external_sku_code: row.sku,
      classification: existing?.classification || 'PRODUCT',
      is_service_item: existing?.is_service_item || false,
      pick_level: existing?.pick_level || 'CARTON',
      warehouse_location: warehouseLocation,
      status: existing?.status || row.control_status || 'ACTIVE',
      internal_sku_id: existing?.internal_sku_id || null,
      carton_barcode: primaryBarcode,
      carton_barcode_status: primaryBarcode ? (existing?.carton_barcode_status || 'CONFIRMED') : existing?.carton_barcode_status || null,
      each_barcode: existing?.each_barcode || null,
      each_barcode_status: existing?.each_barcode_status || null,
    });
  });

  barcodeRows.forEach((row) => {
    if (!row.sku || !row.fixed_shelf) return;
    const key = row.sku.toUpperCase();
    const existing = bySku.get(key);
    if (existing) bySku.set(key, { ...existing, warehouse_location: liveBySku.get(key) || existing.warehouse_location || row.fixed_shelf });
  });

  liveBySku.forEach((location, key) => {
    const existing = bySku.get(key);
    if (existing) bySku.set(key, { ...existing, warehouse_location: location });
  });

  return [...bySku.values()];
}

function addKeys<T>(map: Map<string, T>, row: T, values: Array<string | null | undefined>) {
  values.filter((value): value is string => Boolean(value)).forEach((value) => map.set(value, row));
}

function activeOrderKeys(rows: SupabaseInboxRow[]) {
  const keys = new Set<string>();
  rows.forEach((row) => {
    [row.raw_order_id, row.external_order_id, row.external_order_number, row.order_number, row.invoice_number, row.external_invoice_number]
      .filter((value): value is string => Boolean(value))
      .forEach((value) => keys.add(value));
  });
  return keys;
}

function scopeAndDedupeExceptions(rows: SupabaseExceptionRow[], inbox: SupabaseInboxRow[]) {
  const keys = activeOrderKeys(inbox);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const rowKeys = [row.raw_order_id, row.external_order_id, row.external_order_number, row.order_number, row.invoice_number]
      .filter((value): value is string => Boolean(value));
    if (!rowKeys.some((value) => keys.has(value))) return false;
    const identity = `${row.order_number || row.external_order_number || row.external_order_id || row.raw_order_id}::${row.exception_type || row.message || 'exception'}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function warehouseStatus(draft?: SupabaseDraftRow): OrderStatus | null {
  if (!draft?.internal_order_id) return null;
  const gate = String(draft.warehouse_gate_status || '').toLowerCase();
  if (['out_for_delivery', 'driver_assigned', 'on_route', 'en_route'].includes(gate)) return 'OUT_FOR_DELIVERY';
  if (['staged', 'packed', 'ready_for_delivery'].includes(gate)) return 'STAGED';
  if (['picking', 'pick_started'].includes(gate)) return 'PICKING';
  return null;
}

/**
 * The base projection still supplies the existing domain object used by the
 * warehouse and driver surfaces. This final pass enforces the new boundary:
 * source status may describe an order, but only an explicit current state may
 * make it releasable. Existing internal orders are never recreated.
 */
export function applySupabaseOrdermentumViews(base: EcoFlowDataSet, views: ResilientOrdermentumViews): EcoFlowDataSet {
  const projected = applyBaseSupabaseOrdermentumViews(base, views);
  const inboxByKey = new Map<string, SupabaseInboxRow>();
  views.inbox.forEach((row) => addKeys(inboxByKey, row, [
    row.raw_order_id,
    row.external_order_id,
    row.external_order_number,
    row.order_number,
    row.invoice_number,
    row.external_invoice_number,
  ]));

  const draftByKey = new Map<string, SupabaseDraftRow>();
  views.drafts.forEach((draft) => addKeys(draftByKey, draft, [
    draft.raw_order_id,
    draft.external_order_id,
    draft.external_order_number,
    draft.order_number,
    draft.invoice_number,
  ]));

  const omOrderByKey = new Map<string, SupabaseOmOrderRow>();
  views.omOrders.forEach((row) => addKeys(omOrderByKey, row, [row.id, row.order_number]));
  const holdByStoreId = new Map(
    views.accountHolds
      .filter((hold) => hold.active !== false && hold.store_id)
      .map((hold) => [hold.store_id, hold] as const),
  );

  const orders = projected.orders.map((order): ImportedOrder => {
    const row = inboxByKey.get(order.id)
      || inboxByKey.get(order.externalOrderId)
      || inboxByKey.get(order.orderNo)
      || inboxByKey.get(order.invoiceNo);
    const draft = draftByKey.get(order.id)
      || draftByKey.get(order.externalOrderId)
      || draftByKey.get(order.orderNo)
      || draftByKey.get(order.invoiceNo);
    const omOrder = omOrderByKey.get(order.externalOrderId)
      || omOrderByKey.get(order.id)
      || omOrderByKey.get(order.orderNo);
    const accountHold = omOrder?.retailer_id ? holdByStoreId.get(omOrder.retailer_id) : undefined;
    const sourceStatus = String(row?.order_status || '').trim().toLowerCase();
    const sourceRecognised = EXPLICIT_CURRENT_SOURCE_STATUSES.has(sourceStatus);
    const liveWarehouseStatus = warehouseStatus(draft);

    if (!sourceRecognised) {
      const blocker = sourceStatus
        ? `Ordermentum status “${row?.order_status}” requires review before release.`
        : 'Ordermentum source status is missing; review before release.';
      return {
        ...order,
        status: liveWarehouseStatus || 'IMPORTED',
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: Boolean(draft?.internal_order_id),
        releaseGateStatus: 'BLOCKED_DATA',
        releaseBlockers: blocker,
        changeSummary: blocker,
        openExceptionCount: Math.max(1, order.openExceptionCount),
      };
    }

    if (accountHold) {
      const blocker = `EcoFlow account release hold · ${accountHold.hold_reason || 'Accounts review required'}`;
      return {
        ...order,
        status: liveWarehouseStatus || 'IMPORTED',
        paymentStatus: 'CREDIT_HOLD',
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: Boolean(draft?.internal_order_id),
        releaseGateStatus: 'REVIEW_PAYMENT',
        releaseBlockers: blocker,
        changeSummary: blocker,
        openExceptionCount: Math.max(1, order.openExceptionCount),
      };
    }

    if (liveWarehouseStatus) {
      return {
        ...order,
        status: liveWarehouseStatus,
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: true,
      };
    }

    if (draft?.internal_order_id) {
      const releaseReady = order.status === 'RELEASE_READY'
        && order.releaseGateStatus === 'READY_TO_RELEASE'
        && !order.releaseBlockers;
      return {
        ...order,
        selected: releaseReady,
        canCreateInternalOrder: false,
        hasInternalOrder: true,
      };
    }

    // The source order may be eligible for database internalisation, but it is
    // not yet eligible for a driver run. The strict run-release predicate also
    // requires hasInternalOrder=true after the RPC completes and data reloads.
    return {
      ...order,
      selected: false,
      hasInternalOrder: false,
    };
  });

  return {
    ...projected,
    orders,
    bucketCounts: getOrderBucketCounts(orders, projected.businessDay.date),
    repositoryStatus: {
      ...projected.repositoryStatus,
      label: 'Supabase Ordermentum current operations',
      sourceFiles: ['v_ecoflow_order_operations_v2', 'v_ecoflow_ordermentum_ui_active_inbox'],
      counts: { ...projected.repositoryStatus.counts, recentOrders: orders.length },
    },
    summary: {
      ...projected.summary,
      recentOrdersCount: orders.length,
      sourceFiles: ['Supabase current operations model'],
    },
  };
}

export async function loadSupabaseOrdermentumViews(): Promise<ResilientOrdermentumViews | null> {
  if (!hasSupabaseConfig()) return null;

  // These sources define the current operational slice. They fail closed so a
  // broken read can never turn a real queue into a misleading zero.
  const [inboxResult, exceptionResult, lineResult, draftResult, orderResult] = await Promise.all([
    requiredFetch<SupabaseInboxRow[]>('current order inbox', 'v_ecoflow_ordermentum_ui_active_inbox?select=*&order=order_updated_at.desc&limit=1000'),
    requiredFetch<SupabaseExceptionRow[]>('current exceptions', 'v_ecoflow_ordermentum_ui_active_exceptions?select=*&order=detected_at.desc&limit=1000'),
    requiredFetch<SupabaseOrderLineRow[]>('current order lines', 'v_ecoflow_ordermentum_ui_active_order_lines?select=*&order=order_number.asc&limit=6000'),
    requiredFetch<SupabaseDraftRow[]>('current internal drafts', 'v_ecoflow_ordermentum_ui_active_drafts?select=*&order=last_synced_at.desc&limit=2000'),
    requiredFetch<SupabaseOmOrderRow[]>('current Ordermentum orders', 'v_ecoflow_ordermentum_ui_active_om_orders?select=id,order_number,retailer_id,retailer_name,delivery_date,due_at,total_quantity&order=updated_at.desc&limit=2000'),
  ]);

  const [healthResult, skuResult, inventoryResult, barcodeResult, liveBalanceResult, storeResult, releaseResult, mappingResult, holdResult] = await Promise.all([
    optionalFetch<SupabaseSyncHealthRow[]>('sync health', 'v_ecoflow_ordermentum_sync_health?select=*', []),
    optionalFetch<SupabaseSkuMasterRow[]>('SKU master', 'v_ecoflow_app_sku_master?select=*&limit=3000', []),
    optionalFetch<InventoryLocationRow[]>('inventory SKU control', 'v_ecoflow_inventory_sku_control?select=sku,fixed_shelf,primary_barcode,control_status&limit=3000', []),
    optionalFetch<BarcodeShelfRow[]>('barcode registry', 'v_ecoflow_barcode_registry_review?select=sku,fixed_shelf&limit=3000', []),
    optionalFetch<LiveLocationBalanceRow[]>('live location balances', 'v_ecoflow_inventory_sku_location_balance?select=sku,location,on_hand_location&limit=5000', []),
    optionalFetch<SupabaseStoreSiteRow[]>('store site master', 'ecoflow_store_sites?select=*&limit=1000', []),
    optionalFetch<SupabaseReleaseSummaryRow[]>('release summary', 'v_ecoflow_ordermentum_release_summary_v2?select=*', []),
    optionalFetch<SupabaseSkuMappingCandidateRow[]>('SKU mapping candidates', 'v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc&limit=1000', []),
    optionalFetch<AccountReleaseHoldRow[]>('account release holds', 'v_ecoflow_account_release_holds_v1?select=store_id,active,hold_reason&limit=1000', []),
  ]);

  const inbox = enrichInboxAmounts(inboxResult.data, lineResult.data);
  const exceptions = scopeAndDedupeExceptions(exceptionResult.data, inbox);

  return {
    inbox,
    exceptions,
    health: healthResult.data[0] || null,
    lines: lineResult.data,
    drafts: draftResult.data,
    omOrders: orderResult.data,
    skuMaster: mergeSkuLocations(skuResult.data, inventoryResult.data, barcodeResult.data, liveBalanceResult.data),
    storeSites: storeResult.data,
    releaseSummary: releaseResult.data[0] || null,
    skuMappingCandidates: mappingResult.data,
    accountHolds: holdResult.data,
    diagnostics: [
      inboxResult.diagnostic,
      exceptionResult.diagnostic,
      lineResult.diagnostic,
      draftResult.diagnostic,
      orderResult.diagnostic,
      healthResult.diagnostic,
      skuResult.diagnostic,
      inventoryResult.diagnostic,
      barcodeResult.diagnostic,
      liveBalanceResult.diagnostic,
      storeResult.diagnostic,
      releaseResult.diagnostic,
      mappingResult.diagnostic,
      holdResult.diagnostic,
    ],
  };
}
