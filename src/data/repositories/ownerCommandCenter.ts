import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OwnerCommandKpis = {
  order_revenue_30d: number | string | null;
  orders_30d: number | string | null;
  units_30d: number | string | null;
  active_internal_orders: number | string | null;
  lifecycle_active_orders: number | string | null;
  legacy_review_orders: number | string | null;
  top_sku_30d: string | null;
  top_product_30d: string | null;
  top_sku_units_30d: number | string | null;
  active_stores_30d: number | string | null;
  total_stores: number | string | null;
  address_attention_stores: number | string | null;
  price_tier_attention_stores: number | string | null;
  top_store_30d: string | null;
  top_store_revenue_30d: number | string | null;
  open_ar_value: number | string | null;
  overdue_ar_value: number | string | null;
  urgent_customers: number | string | null;
  held_customers: number | string | null;
  worst_overdue_days: number | string | null;
  reorder_pressure_rows: number | string | null;
  barcode_attention_lines: number | string | null;
  latest_activity_at: string | null;
};

export type OwnerCommandAttentionRow = {
  priority: number | string | null;
  area: string | null;
  signal: string | null;
  title: string | null;
  detail: string | null;
  value_numeric: number | string | null;
  reference_id: string | null;
  action_hint: string | null;
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

export async function loadOwnerCommandKpis(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_command_kpis')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as OwnerCommandKpis | null;
}

export async function loadOwnerCommandAttention(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_command_attention')
    .select('*')
    .order('priority', { ascending: true })
    .order('value_numeric', { ascending: false })
    .limit(18);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OwnerCommandAttentionRow[];
}
