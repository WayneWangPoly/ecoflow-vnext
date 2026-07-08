import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OwnerOrderKpis = {
  active_internal_orders: number | string | null;
  orders_7d: number | string | null;
  orders_30d: number | string | null;
  revenue_7d: number | string | null;
  revenue_30d: number | string | null;
  avg_order_value_30d: number | string | null;
  legacy_review_orders: number | string | null;
  lifecycle_active_orders: number | string | null;
  units_30d: number | string | null;
  top_sku_30d: string | null;
  top_product_30d: string | null;
  top_sku_units_30d: number | string | null;
  latest_order_at: string | null;
};

export type OwnerSkuVelocityRow = {
  sku: string | null;
  product_name: string | null;
  order_count: number | string | null;
  total_units: number | string | null;
  total_revenue: number | string | null;
  units_7d: number | string | null;
  revenue_7d: number | string | null;
  units_30d: number | string | null;
  revenue_30d: number | string | null;
  avg_unit_price: number | string | null;
  last_sold_at: string | null;
  barcode_attention_lines: number | string | null;
  latest_barcode_status: string | null;
  warehouse_barcode: string | null;
  velocity_rank: number | string | null;
};

export type OwnerDailyOrderReportRow = {
  order_day: string | null;
  order_count: number | string | null;
  active_order_count: number | string | null;
  cancelled_or_legacy_count: number | string | null;
  revenue: number | string | null;
  units: number | string | null;
  sku_count: number | string | null;
};

export type OwnerOrderStatusReportRow = {
  status: string | null;
  account_release_status: string | null;
  warehouse_gate_status: string | null;
  order_count: number | string | null;
  total_value: number | string | null;
  oldest_at: string | null;
  newest_at: string | null;
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

export async function loadOwnerOrderKpis(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_order_kpis')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as OwnerOrderKpis | null;
}

export async function loadOwnerSkuVelocity(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_sku_velocity')
    .select('*')
    .order('velocity_rank', { ascending: true })
    .limit(40);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OwnerSkuVelocityRow[];
}

export async function loadOwnerDailyOrderReport(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_daily_order_report')
    .select('*')
    .order('order_day', { ascending: false })
    .limit(30);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OwnerDailyOrderReportRow[];
}

export async function loadOwnerOrderStatusReport(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_order_status_report')
    .select('*')
    .limit(30);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OwnerOrderStatusReportRow[];
}
