import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type DashboardReadiness = {
  server_current_orders: number | string | null;
  live_on_hand_units: number | string | null;
  registered_barcodes: number | string | null;
  active_exception_count: number | string | null;
  exception_snapshot_refreshed_at: string | null;
  calculated_at: string | null;
};

type DashboardReadinessRow = DashboardReadiness;

function activeClient(client?: SupabaseClient | null): SupabaseClient {
  const value = client ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

export async function loadDashboardReadiness(
  client?: SupabaseClient | null,
): Promise<DashboardReadiness | null> {
  const result = await activeClient(client).rpc('ecoflow_get_dashboard_readiness_v1');
  if (result.error) throw result.error;

  const row = Array.isArray(result.data)
    ? result.data[0] as DashboardReadinessRow | undefined
    : result.data as DashboardReadinessRow | null;

  return row ?? null;
}
