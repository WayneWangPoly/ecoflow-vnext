import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OwnerStoreKpis = {
  total_stores: number | string | null;
  active_stores_30d: number | string | null;
  address_attention_stores: number | string | null;
  price_tier_attention_stores: number | string | null;
  revenue_30d: number | string | null;
  units_30d: number | string | null;
  avg_active_store_revenue_30d: number | string | null;
  top_store_30d: string | null;
  top_store_revenue_30d: number | string | null;
  latest_store_order_at: string | null;
};

export type OwnerStorePerformanceRow = {
  store_id: string | null;
  store_name: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  contact_phone: string | null;
  delivery_instructions: string | null;
  price_group_id: string | null;
  verified: boolean | null;
  lifetime_orders: number | string | null;
  orders_7d: number | string | null;
  orders_30d: number | string | null;
  revenue_7d: number | string | null;
  revenue_30d: number | string | null;
  units_30d: number | string | null;
  sku_count_30d: number | string | null;
  last_order_at: string | null;
  first_order_at: string | null;
  legacy_or_cancelled_orders: number | string | null;
  top_sku_30d: string | null;
  top_product_30d: string | null;
  top_sku_units_30d: number | string | null;
  top_sku_revenue_30d: number | string | null;
  store_signal: string | null;
  revenue_rank_30d: number | string | null;
};

export type OwnerStoreSkuMixRow = {
  store_id: string | null;
  store_name: string | null;
  sku: string | null;
  product_name: string | null;
  order_count_30d: number | string | null;
  units_30d: number | string | null;
  revenue_30d: number | string | null;
  last_sold_at: string | null;
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

export async function loadOwnerStoreKpis(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.from('v_ecoflow_owner_store_kpis').select('*').maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as OwnerStoreKpis | null;
}

export async function loadOwnerStorePerformance(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_store_performance')
    .select('*')
    .order('revenue_rank_30d', { ascending: true })
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OwnerStorePerformanceRow[];
}

export async function loadOwnerStoreSkuMix(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_owner_store_sku_mix')
    .select('*')
    .limit(160);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OwnerStoreSkuMixRow[];
}
