import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type PickTaskClaim = {
  business_day: string;
  task_key: string;
  task_type: string;
  claimed_by: string;
  claimed_by_label: string;
  claimed_at: string;
  expires_at: string;
  updated_at: string;
  claim_status?: string;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

export async function loadActivePickTaskClaims(businessDay: string, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_active_pick_task_claims')
    .select('*')
    .eq('business_day', businessDay)
    .order('task_key', { ascending: true });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as PickTaskClaim[];
}

export async function claimPickTask(input: { businessDay: string; taskKey: string; actorLabel: string; ttlMinutes?: number }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_claim_pick_task', {
    p_business_day: input.businessDay,
    p_task_key: input.taskKey,
    p_actor_label: input.actorLabel,
    p_ttl_minutes: input.ttlMinutes ?? 30,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as PickTaskClaim[];
}

export async function releasePickTask(input: { businessDay: string; taskKey: string; reason?: string | null }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_release_pick_task', {
    p_business_day: input.businessDay,
    p_task_key: input.taskKey,
    p_reason: input.reason ?? null,
  });
  if (error) throw new Error(errorMessage(error));
  return data ?? [];
}
