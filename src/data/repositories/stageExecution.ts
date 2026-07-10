import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type StagePreparation = {
  sealedAt?: string | null;
  labelAppliedAt?: string | null;
};

function activeClient(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(record);
  }
  return String(error);
}

export async function loadStagePreparations(businessDay: string, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client)
    .from('ecoflow_day_state')
    .select('scope,payload')
    .eq('business_day', businessDay)
    .like('scope', 'prep:%');
  if (error) throw new Error(message(error));
  const result: Record<string, StagePreparation> = {};
  (data ?? []).forEach((row: { scope?: string; payload?: StagePreparation }) => {
    const orderId = String(row.scope || '').replace(/^prep:/, '');
    if (orderId) result[orderId] = row.payload || {};
  });
  return result;
}

export async function saveStagePreparation(input: { businessDay: string; orderId: string; preparation: StagePreparation; updatedBy?: string }, client?: SupabaseClient | null) {
  const { error } = await activeClient(client)
    .from('ecoflow_day_state')
    .upsert({
      business_day: input.businessDay,
      scope: `prep:${input.orderId}`,
      payload: input.preparation,
      updated_by: input.updatedBy || 'Warehouse stage'
    }, { onConflict: 'business_day,scope' });
  if (error) throw new Error(message(error));
}
