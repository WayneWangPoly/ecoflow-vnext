import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type PickHandoffProgressRow = {
  business_day: string | null;
  handoff_status: string | null;
  locked_at: string | null;
  locked_by: string | null;
  route_lock_synced_at: string | null;
  task_count: number | string | null;
  picked_task_count: number | string | null;
  open_task_count: number | string | null;
  short_units: number | string | null;
  allocation_count: number | string | null;
  done_allocation_count: number | string | null;
  staged_stop_count: number | string | null;
  warehouse_phase: string | null;
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

export async function loadLatestPickHandoffProgress(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_pick_handoff_progress')
    .select('*')
    .order('business_day', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as PickHandoffProgressRow | null;
}
