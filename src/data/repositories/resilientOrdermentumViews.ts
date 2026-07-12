import {
  applySupabaseOrdermentumViews,
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
import { supabase } from '@/lib/supabaseClient';

export { applySupabaseOrdermentumViews };

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

function envValue(key: string) {
  return (import.meta.env[key] as string | undefined)?.trim() || '';
}

function hasSupabaseConfig() {
  return Boolean(envValue('VITE_SUPABASE_URL') && envValue('VITE_SUPABASE_ANON_KEY'));
}

async function supabaseFetch<T>(path: string): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const bearer = sessionResult?.data.session?.access_token || anonKey;
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${bearer}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function optionalFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await supabaseFetch<T>(path);
  } catch {
    return fallback;
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
    const derived = [row.external_order_id, row.om_order_id, row.order_number, row.external_order_number, row.invoice_number, row.external_invoice_number]
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

function mergeSkuLocations(masterRows: SupabaseSkuMasterRow[], inventoryRows: InventoryLocationRow[], barcodeRows: BarcodeShelfRow[], liveBalanceRows: LiveLocationBalanceRow[]) {
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

export async function loadSupabaseOrdermentumViews(): Promise<SupabaseOrdermentumViews | null> {
  if (!hasSupabaseConfig()) return null;

  // Operational surfaces deliberately read only the active lifecycle views.
  // Historical raw inbox/exception views remain in Supabase for audit and search,
  // but must never be used as a fallback for today's warehouse/office workload.
  const [inbox, rawExceptions, healthRows, lines, drafts, omOrders, skuMaster, inventoryLocations, barcodeShelves, liveLocationBalances, storeSites, releaseSummaryRows, skuMappingCandidates] = await Promise.all([
    optionalFetch<SupabaseInboxRow[]>('v_ecoflow_ordermentum_ui_active_inbox?select=*&order=order_updated_at.desc&limit=1000', []),
    optionalFetch<SupabaseExceptionRow[]>('v_ecoflow_ordermentum_ui_active_exceptions?select=*&order=detected_at.desc&limit=1000', []),
    optionalFetch<SupabaseSyncHealthRow[]>('v_ecoflow_ordermentum_sync_health?select=*', []),
    optionalFetch<SupabaseOrderLineRow[]>('v_ecoflow_ordermentum_ui_active_order_lines?select=*&order=order_number.asc&limit=6000', []),
    optionalFetch<SupabaseDraftRow[]>('v_ecoflow_ordermentum_ui_active_drafts?select=*&order=last_synced_at.desc&limit=2000', []),
    optionalFetch<SupabaseOmOrderRow[]>('v_ecoflow_ordermentum_ui_active_om_orders?select=*&order=updated_at.desc&limit=2000', []),
    optionalFetch<SupabaseSkuMasterRow[]>('v_ecoflow_app_sku_master?select=*&limit=3000', []),
    optionalFetch<InventoryLocationRow[]>('v_ecoflow_inventory_sku_control?select=sku,fixed_shelf,primary_barcode,control_status&limit=3000', []),
    optionalFetch<BarcodeShelfRow[]>('v_ecoflow_barcode_registry_review?select=sku,fixed_shelf&limit=3000', []),
    optionalFetch<LiveLocationBalanceRow[]>('v_ecoflow_inventory_sku_location_balance?select=sku,location,on_hand_location&limit=5000', []),
    optionalFetch<SupabaseStoreSiteRow[]>('ecoflow_store_sites?select=*&limit=1000', []),
    optionalFetch<SupabaseReleaseSummaryRow[]>('v_ecoflow_ordermentum_release_summary_v2?select=*', []),
    optionalFetch<SupabaseSkuMappingCandidateRow[]>('v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc&limit=1000', [])
  ]);

  const exceptions = scopeAndDedupeExceptions(rawExceptions, inbox);
  return {
    inbox: enrichInboxAmounts(inbox, lines),
    exceptions,
    health: healthRows[0] || null,
    lines,
    drafts,
    omOrders,
    skuMaster: mergeSkuLocations(skuMaster, inventoryLocations, barcodeShelves, liveLocationBalances),
    storeSites,
    releaseSummary: releaseSummaryRows[0] || null,
    skuMappingCandidates
  };
}
