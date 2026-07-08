import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OrderPlatformGuardrailRow = {
  check_name: 'ordermentum_raw_inbox' | 'orders_active_workflow' | 'legacy_internal_review' | 'completed_archive' | string;
  row_count: number | string | null;
  oldest_at: string | null;
  newest_at: string | null;
  total_value: number | string | null;
  note: string | null;
};

export type OrderPlatformBucket = 'ACTIVE' | 'LEGACY_REVIEW' | 'ARCHIVE';

export type OrderPlatformLatestOrderRow = {
  lifecycle_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  ordermentum_order_status: string | null;
  ordermentum_invoice_status: string | null;
  internalisation_status: string | null;
  warehouse_gate_status: string | null;
  internal_order_id: string | null;
  lifecycle_status: string | null;
  can_internalise: boolean | null;
  invoice_total: number | string | null;
  lifecycle_updated_at: string | null;
  platform_bucket: OrderPlatformBucket | string | null;
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

export async function loadOrderPlatformGuardrails(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_platform_guardrails')
    .select('*');
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OrderPlatformGuardrailRow[];
}

export async function loadOrderPlatformLatestOrders(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_platform_latest_orders')
    .select('*')
    .order('lifecycle_updated_at', { ascending: false })
    .limit(120);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OrderPlatformLatestOrderRow[];
}
