import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type InventoryKpis = {
  sku_count: number | string | null;
  no_stock_ledger_skus: number | string | null;
  below_target_skus: number | string | null;
  reorder_pressure_skus: number | string | null;
  barcode_cleanup_skus: number | string | null;
  needs_shelf_skus: number | string | null;
  units_30d: number | string | null;
  revenue_30d: number | string | null;
  top_sku_30d: string | null;
  top_product_30d: string | null;
  latest_sku_sale_at: string | null;
};

export type InventorySkuControlRow = {
  sku: string | null;
  product_name: string | null;
  category: string | null;
  fixed_shelf: string | null;
  primary_barcode: string | null;
  reorder_target: number | string | null;
  on_hand_estimate: number | string | null;
  control_status: string | null;
  owner_note: string | null;
  revenue_7d: number | string | null;
  revenue_30d: number | string | null;
  units_7d: number | string | null;
  units_30d: number | string | null;
  order_count_30d: number | string | null;
  avg_unit_price: number | string | null;
  last_sold_at: string | null;
  barcode_attention_lines: number | string | null;
  latest_barcode_status: string | null;
  high_reorder_stores: number | string | null;
  watch_reorder_stores: number | string | null;
  latest_store_reorder_at: string | null;
  latest_action: string | null;
  latest_execution_status: string | null;
  latest_action_at: string | null;
  inventory_signal: string | null;
  action_hint: string | null;
  inventory_rank: number | string | null;
};

export type InventorySkuAction = 'SET_FIXED_SHELF' | 'SET_BARCODE' | 'SET_REORDER_TARGET' | 'SET_ON_HAND_ESTIMATE' | 'SET_STATUS' | 'SET_NOTE' | 'MARK_REVIEWED';

export type InventorySkuActionResult = {
  action_id: string;
  sku: string;
  action: InventorySkuAction;
  execution_status: string;
  executed_at: string;
  error_message: string | null;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code].filter(Boolean).map(String);
    return parts.length ? parts.join(' · ') : JSON.stringify(record);
  }
  return String(error);
}

export async function loadInventoryKpis(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.from('v_ecoflow_inventory_kpis').select('*').maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as InventoryKpis | null;
}

export async function loadInventorySkuControl(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_inventory_sku_control')
    .select('*')
    .order('inventory_rank', { ascending: true })
    .limit(160);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as InventorySkuControlRow[];
}

export async function applyInventorySkuAction(input: { sku: string; action: InventorySkuAction; value?: string | null; note?: string | null }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_apply_inventory_sku_action', {
    p_sku: input.sku,
    p_action: input.action,
    p_value: input.value ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as InventorySkuActionResult[];
}
