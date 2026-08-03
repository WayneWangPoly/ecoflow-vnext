import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  productIdentityFriendlyError,
  validateProductIdentityScan,
} from './productIdentityCommissioning';

export type WarehouseLocationItemRow = {
  location_id: string;
  location_code: string;
  rack_id: string;
  rack_title: string;
  side: 'left' | 'right' | 'front';
  bin_code: string | null;
  level_code: string | null;
  half_code: string | null;
  display_level: string;
  location_category: string | null;
  location_type: 'BIN' | 'SHELF' | 'AREA';
  location_status: 'ACTIVE' | 'INACTIVE' | 'HOLD';
  sort_order: number;
  item_id: string | null;
  sku: string | null;
  product_name: string | null;
  source_barcode: string | null;
  unit_level: 'carton' | 'sleeve' | 'each' | 'unknown' | null;
  quantity: number | string | null;
  item_status: 'ACTIVE' | 'HOLD' | 'ZEROED' | null;
  last_movement_at: string | null;
  last_note: string | null;
  item_updated_at: string | null;
  sku_total_quantity: number | string | null;
};

export type InventoryLocationSummaryRow = {
  sku: string;
  product_name: string | null;
  total_quantity: number | string | null;
  location_count: number | string | null;
  primary_location: string | null;
  fixed_shelf: string | null;
  current_locations: string | null;
  barcodes: string | null;
  last_movement_at: string | null;
  updated_at: string | null;
};

export type ReceivingBarcodeLookupRow = {
  barcode: string;
  sku: string;
  physical_sku?: string | null;
  commercial_sku?: string | null;
  product_name: string | null;
  unit_level: 'carton' | 'sleeve' | 'inner' | 'each' | 'unknown' | string | null;
  units_per_barcode?: number | string | null;
  fixed_location: string | null;
  pick_level: string | null;
  classification: string | null;
  family_code?: string | null;
  substitution_policy?: string | null;
  is_preferred?: boolean | null;
  barcode_status: string | null;
  sku_status: string | null;
};

export type ReceiveWarehouseStockInput = {
  locationCode: string;
  barcode: string;
  quantity: number;
  note?: string;
  sku?: string;
  productName?: string;
  unitLevel?: 'carton' | 'sleeve' | 'inner' | 'each' | 'unknown';
};

export type PickWarehouseStockInput = {
  sku: string;
  quantity: number;
  unitLevel: 'carton' | 'sleeve' | 'inner' | 'each' | 'unknown';
  barcode?: string;
  note?: string;
};

export type PickWarehouseStockResult = {
  location_code: string;
  sku: string;
  picked_quantity: number | string;
  remaining_quantity: number | string;
};

export type CustomerStockDrawdownInput = {
  customerName: string;
  sku: string;
  quantity: number;
  unitLevel: 'carton' | 'sleeve' | 'each' | 'unknown';
  barcode?: string;
  note?: string;
  locationCode?: string;
  customerReference?: string;
  productName?: string;
  fulfilmentMode?: 'OWNER_ONSITE' | 'OPS_DELIVERY';
  deliveryAddress?: string;
  driverNote?: string;
};

export type CustomerStockDrawdownResult = {
  issue_id: string;
  issue_no: string;
  location_code: string;
  sku: string;
  issued_quantity: number | string;
  remaining_quantity: number | string;
};

export type CustomerOpsStatus = 'RELEASED_TO_WAREHOUSE' | 'PICKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

export type CustomerOpsQueueRow = {
  id: string;
  issue_no: string;
  customer_name: string;
  customer_reference: string | null;
  sku: string;
  product_name: string | null;
  barcode: string | null;
  unit_level: 'carton' | 'sleeve' | 'each' | 'unknown';
  quantity: number | string;
  location_code: string | null;
  note: string | null;
  delivery_address: string | null;
  driver_note: string | null;
  ops_status: CustomerOpsStatus;
  bill_status: 'TO_BILL' | 'BILLED' | 'NO_CHARGE' | 'CANCELLED';
  released_at: string | null;
  created_at: string;
  updated_at?: string | null;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function lowerUnit(level: string) {
  const value = level.toLowerCase();
  if (value === 'carton' || value === 'sleeve' || value === 'inner' || value === 'each') return value;
  return 'unknown';
}

export async function loadWarehouseLocationItems(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_warehouse_location_items')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('sku', { ascending: true, nullsFirst: false });

  if (error) throw error;
  return (data ?? []) as WarehouseLocationItemRow[];
}

export async function loadInventoryLocationSummaries(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_inventory_locations')
    .select('*')
    .order('sku', { ascending: true });

  if (error) throw error;
  return (data ?? []) as InventoryLocationSummaryRow[];
}

export async function loadReceivingBarcodeLookup(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_product_identity_barcode_lookup')
    .select('*')
    .order('sku', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ReceivingBarcodeLookupRow[];
}

export async function loadCustomerOpsQueue(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_customer_stock_issues_ops_queue')
    .select('*')
    .order('ops_status', { ascending: true })
    .order('released_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CustomerOpsQueueRow[];
}

export async function receiveWarehouseStock(input: ReceiveWarehouseStockInput, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  try {
    const identity = await validateProductIdentityScan({
      barcode: input.barcode,
      operation: 'RECEIVING',
    }, active);
    if (input.sku && ![identity.physical_sku, identity.commercial_sku].includes(input.sku.trim().toUpperCase())) {
      throw new Error('The entered SKU does not match the published barcode identity.');
    }
    const { data, error } = await active.rpc('ecoflow_record_receive_movement', {
      p_location_code: input.locationCode,
      p_barcode: identity.barcode,
      p_quantity: input.quantity,
      p_note: input.note ?? null,
      p_sku: identity.physical_sku,
      p_product_name: identity.product_name,
      p_unit_level: lowerUnit(identity.package_level),
    });
    if (error) throw error;
    return data;
  } catch (error) {
    throw new Error(productIdentityFriendlyError(error));
  }
}

export async function pickWarehouseStock(input: PickWarehouseStockInput, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  if (!input.barcode?.trim()) {
    throw new Error('A published package barcode is required before stock can be picked.');
  }
  try {
    const identity = await validateProductIdentityScan({
      barcode: input.barcode,
      commercialSku: input.sku,
      operation: 'PICKING',
    }, active);
    const { data, error } = await active.rpc('ecoflow_record_pick_movement', {
      p_sku: identity.physical_sku,
      p_quantity: input.quantity,
      p_unit_level: lowerUnit(identity.package_level),
      p_barcode: identity.barcode,
      p_note: [input.note, `Commercial SKU ${input.sku.toUpperCase()}`, `Family ${identity.family_code}`].filter(Boolean).join(' · '),
    });
    if (error) throw error;
    return (data ?? []) as PickWarehouseStockResult[];
  } catch (error) {
    throw new Error(productIdentityFriendlyError(error));
  }
}

export async function recordCustomerStockDrawdown(input: CustomerStockDrawdownInput, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  let sku = input.sku;
  let productName = input.productName ?? null;
  let unitLevel = input.unitLevel;
  let barcode = input.barcode ?? null;

  if (barcode) {
    const identity = await validateProductIdentityScan({
      barcode,
      commercialSku: input.sku,
      operation: 'PICKING',
    }, active);
    sku = identity.physical_sku;
    productName = identity.product_name;
    unitLevel = lowerUnit(identity.package_level) as CustomerStockDrawdownInput['unitLevel'];
    barcode = identity.barcode;
  }

  const { data, error } = await active.rpc('ecoflow_record_customer_stock_issue', {
    p_customer_name: input.customerName,
    p_sku: sku,
    p_quantity: input.quantity,
    p_unit_level: unitLevel,
    p_barcode: barcode,
    p_note: input.note ?? null,
    p_location_code: input.locationCode ?? null,
    p_customer_reference: input.customerReference ?? null,
    p_product_name: productName,
    p_fulfilment_mode: input.fulfilmentMode ?? 'OWNER_ONSITE',
    p_delivery_address: input.deliveryAddress ?? null,
    p_driver_note: input.driverNote ?? null,
  });

  if (error) throw error;
  return (data ?? []) as CustomerStockDrawdownResult[];
}

export async function updateCustomerOpsStatus(input: { issueId: string; opsStatus: CustomerOpsStatus; note?: string }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_update_customer_stock_issue_ops_status', {
    p_issue_id: input.issueId,
    p_ops_status: input.opsStatus,
    p_note: input.note ?? null,
  });

  if (error) throw error;
  return data;
}
