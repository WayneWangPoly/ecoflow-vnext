import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BusinessDayCloseState = {
  business_day: string;
  close_status: 'OPEN' | 'CLOSED' | string;
  revision: number | string;
  next_business_day: string | null;
  carry_over_count: number | string;
  command_id: string | null;
  closed_at: string | null;
  closed_by_label: string | null;
};

function requireClient(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

export async function readBusinessDayCloseState(businessDay: string, client?: SupabaseClient | null) {
  const { data, error } = await requireClient(client).rpc('ecoflow_read_business_day_close_state', {
    p_business_day: businessDay,
  });
  if (error) throw error;
  const row = ((data ?? []) as BusinessDayCloseState[])[0];
  if (!row) throw new Error('Business Day Close state returned no result.');
  return row;
}
