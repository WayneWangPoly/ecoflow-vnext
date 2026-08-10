import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type DispatchDriver = {
  userId: string;
  label: string;
};

function requireClient(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message || error);
  return String(error);
}

export async function loadActiveDispatchDrivers(client?: SupabaseClient | null): Promise<DispatchDriver[]> {
  const active = requireClient(client);
  const { data, error } = await active.rpc('ecoflow_list_active_dispatch_drivers');
  if (error) throw new Error(message(error));
  return (Array.isArray(data) ? data : [])
    .map((row) => ({
      userId: String((row as Record<string, unknown>).user_id || ''),
      label: String((row as Record<string, unknown>).driver_label || ''),
    }))
    .filter((row) => row.userId && row.label);
}
