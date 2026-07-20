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
  store_id: string | null; store_name: string | null; address: string | null; suburb: string | null; state: string | null;
  postcode: string | null; contact_phone: string | null; delivery_instructions: string | null; price_group_id: string | null;
  verified: boolean | null; lifetime_orders: number | string | null; orders_7d: number | string | null; orders_30d: number | string | null;
  revenue_7d: number | string | null; revenue_30d: number | string | null; units_30d: number | string | null; sku_count_30d: number | string | null;
  last_order_at: string | null; first_order_at: string | null; legacy_or_cancelled_orders: number | string | null;
  top_sku_30d: string | null; top_product_30d: string | null; top_sku_units_30d: number | string | null;
  top_sku_revenue_30d: number | string | null; store_signal: string | null; revenue_rank_30d: number | string | null;
};

export type OwnerStoreSkuMixRow = {
  store_id: string | null; store_name: string | null; sku: string | null; product_name: string | null;
  order_count_30d: number | string | null; units_30d: number | string | null; revenue_30d: number | string | null; last_sold_at: string | null;
};

export type OwnerStoreStatementSummaryRow = {
  store_id: string | null; store_name: string | null; invoice_count: number | string | null; open_invoice_count: number | string | null;
  overdue_invoice_count: number | string | null; total_statement_value: number | string | null; open_statement_value: number | string | null;
  overdue_statement_value: number | string | null; statement_value_30d: number | string | null; latest_invoice_at: string | null;
  worst_overdue_days: number | string | null; statement_signal: string | null;
};

export type OwnerStoreReorderWatchRow = {
  store_id: string | null; store_name: string | null; sku: string | null; product_name: string | null;
  order_count_30d: number | string | null; units_30d: number | string | null; revenue_30d: number | string | null;
  last_sold_at: string | null; price_group_id: string | null; delivery_instructions: string | null; store_signal: string | null;
  store_revenue_30d: number | string | null; store_sku_rank: number | string | null; global_velocity_rank: number | string | null;
  reorder_signal: string | null; action_hint: string | null;
};

export type OwnerStoreExperienceGapRow = {
  store_id: string | null; store_name: string | null; address: string | null; suburb: string | null; price_group_id: string | null;
  delivery_instructions: string | null; orders_30d: number | string | null; revenue_30d: number | string | null;
  store_signal: string | null; statement_signal: string | null; open_statement_value: number | string | null;
  overdue_statement_value: number | string | null; owner_action: string | null;
};

export type StoreOwnerAction = 'SET_PRICE_TIER' | 'SET_DELIVERY_INSTRUCTIONS' | 'SET_ADDRESS' | 'SET_CONTACT_PHONE' | 'MARK_VERIFIED' | 'ACK_STATEMENT_REVIEW';
export type StoreOwnerActionResult = { action_id: string; store_id: string; action: StoreOwnerAction; execution_status: string; affected_rows: number | string | null; executed_at: string; error_message: string | null };

const CACHE_TTL_MS = 45_000;
type CacheEntry<T> = { at: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function requireSupabase(client?: SupabaseClient | null) { const active = client ?? supabase; if (!active) throw new Error('Supabase is not configured.'); return active; }
function errorMessage(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === 'object') { const record = error as Record<string, unknown>; return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(record); } return String(error); }

async function cachedQuery<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (!force && existing && Date.now() - existing.at < CACHE_TTL_MS) return existing.value;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (!force && pending) return pending;
  const stale = existing?.value;
  const request = loader()
    .then((value) => { cache.set(key, { at: Date.now(), value }); return value; })
    .catch((reason) => { if (stale !== undefined) return stale; throw reason; })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export async function loadOwnerStoreKpis(client?: SupabaseClient | null, force = false) {
  return cachedQuery('kpis', async () => {
    const { data, error } = await requireSupabase(client).from('v_ecoflow_owner_store_kpis').select('*').maybeSingle();
    if (error) throw new Error(errorMessage(error)); return (data ?? null) as OwnerStoreKpis | null;
  }, force);
}

export async function loadOwnerStorePerformance(client?: SupabaseClient | null, force = false) {
  return cachedQuery('performance', async () => {
    const { data, error } = await requireSupabase(client).from('v_ecoflow_owner_store_performance').select('*').order('revenue_rank_30d', { ascending: true }).limit(300);
    if (error) throw new Error(errorMessage(error)); return (data ?? []) as OwnerStorePerformanceRow[];
  }, force);
}

export async function loadOwnerStoreSkuMix(client?: SupabaseClient | null, force = false) {
  return cachedQuery('sku-mix', async () => {
    const { data, error } = await requireSupabase(client).from('v_ecoflow_owner_store_sku_mix').select('*').limit(1000);
    if (error) throw new Error(errorMessage(error)); return (data ?? []) as OwnerStoreSkuMixRow[];
  }, force);
}

export async function loadOwnerStoreStatementSummary(client?: SupabaseClient | null, force = false) {
  return cachedQuery('statement-summary', async () => {
    const { data, error } = await requireSupabase(client).from('v_ecoflow_owner_store_statement_summary').select('*').order('open_statement_value', { ascending: false }).limit(300);
    if (error) throw new Error(errorMessage(error)); return (data ?? []) as OwnerStoreStatementSummaryRow[];
  }, force);
}

export async function loadOwnerStoreReorderWatch(client?: SupabaseClient | null, force = false) {
  return cachedQuery('reorder-watch', async () => {
    const { data, error } = await requireSupabase(client).from('v_ecoflow_owner_store_reorder_watch').select('*').limit(500);
    if (error) throw new Error(errorMessage(error)); return (data ?? []) as OwnerStoreReorderWatchRow[];
  }, force);
}

export async function loadOwnerStoreExperienceGaps(client?: SupabaseClient | null, force = false) {
  return cachedQuery('experience-gaps', async () => {
    const { data, error } = await requireSupabase(client).from('v_ecoflow_owner_store_experience_gaps').select('*').limit(300);
    if (error) throw new Error(errorMessage(error)); return (data ?? []) as OwnerStoreExperienceGapRow[];
  }, force);
}

const SOURCE_OWNED_STORE_ACTIONS = new Set<StoreOwnerAction>([
  'SET_PRICE_TIER', 'SET_DELIVERY_INSTRUCTIONS', 'SET_ADDRESS', 'SET_CONTACT_PHONE',
]);

export async function applyStoreOwnerAction(input: { storeId: string; action: StoreOwnerAction; value?: string | null; note?: string | null }, client?: SupabaseClient | null) {
  if (SOURCE_OWNED_STORE_ACTIONS.has(input.action)) {
    throw new Error('ORDERMENTUM_SOURCE_OWNED · Correct customer master fields in Ordermentum and re-sync the Stores Mirror.');
  }
  const { data, error } = await requireSupabase(client).rpc('ecoflow_apply_store_owner_action', {
    p_store_id: input.storeId,
    p_action: input.action,
    p_value: input.value ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(errorMessage(error));
  cache.clear();
  return (data ?? []) as StoreOwnerActionResult[];
}
