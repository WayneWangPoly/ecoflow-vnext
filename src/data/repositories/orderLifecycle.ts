import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OrderLifecycleStatus =
  | 'READY_TO_INTERNALISE'
  | 'BLOCKED_DATA'
  | 'BLOCKED_MAPPING'
  | 'INTERNAL_ORDER_CREATED'
  | 'PICKING'
  | 'STAGED'
  | 'COMPLETED';

export type OrderLifecycleRow = {
  lifecycle_id: string | null;
  external_order_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  ordermentum_order_status: string | null;
  ordermentum_invoice_status: string | null;
  internalisation_status: string | null;
  account_release_status: string | null;
  warehouse_gate_status: string | null;
  internal_order_id: string | null;
  payment_status: string | null;
  invoice_payment_status: string | null;
  invoice_total: number | string | null;
  line_count: number | string | null;
  unmapped_line_count: number | string | null;
  barcode_blocked_line_count: number | string | null;
  lifecycle_status: OrderLifecycleStatus;
  can_internalise: boolean;
  lifecycle_updated_at: string | null;
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

export async function loadOrderLifecycleBoard(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_lifecycle_board')
    .select('*')
    .neq('lifecycle_status', 'COMPLETED')
    .order('lifecycle_updated_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OrderLifecycleRow[];
}

export async function loadOrderLifecycleArchive(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_lifecycle_board')
    .select('*')
    .order('lifecycle_updated_at', { ascending: false })
    .limit(1000);

  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OrderLifecycleRow[];
}
