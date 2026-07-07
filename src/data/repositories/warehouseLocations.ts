import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

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

export type ReceiveWarehouseStockInput = {
  locationCode: string;
  barcode: string;
  quantity: number;
  note?: string;
  sku?: string;
  productName?: string;
  unitLevel?: 'carton' | 'sleeve' | 'each' | 'unknown';
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
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

export async function receiveWarehouseStock(input: ReceiveWarehouseStockInput, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_record_receive_movement', {
    p_location_code: input.locationCode,
    p_barcode: input.barcode,
    p_quantity: input.quantity,
    p_note: input.note ?? null,
    p_sku: input.sku ?? null,
    p_product_name: input.productName ?? null,
    p_unit_level: input.unitLevel ?? 'carton',
  });

  if (error) throw error;
  return data;
}
