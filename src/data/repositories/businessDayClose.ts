import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BusinessDayCloseCheck = {
  check_key: string;
  check_status: string;
  detail: string;
  blocking: boolean;
  read_at: string;
};

export type BusinessDayCloseState = {
  businessDay: string;
  closeStatus: 'OPEN' | 'CLOSED';
  revision: number;
  nextBusinessDay: string | null;
  carryOverCount: number;
  closedAt: string | null;
  readAt: string;
};

export type BusinessDayCloseResult = {
  command_id: string;
  business_day: string;
  close_status: 'APPLIED' | 'REPLAYED' | 'CONFLICT';
  revision: number;
  next_business_day: string;
  carry_over_count: number;
  closed_at: string | null;
};

function activeClient(input?: SupabaseClient | null) {
  const value = input ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

async function rpc<T>(name: string, args?: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data as T;
}

export function createBusinessDayCloseCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure Business Day Close command ID.');
}

export async function readBusinessDayCloseReadiness(
  businessDay: string,
  client?: SupabaseClient | null,
): Promise<BusinessDayCloseCheck[]> {
  return await rpc<BusinessDayCloseCheck[]>(
    'ecoflow_business_day_close_readiness',
    { p_business_day: businessDay },
    client,
  ) ?? [];
}

export async function readBusinessDayCloseState(
  businessDay: string,
  client?: SupabaseClient | null,
): Promise<BusinessDayCloseState> {
  const rows = await rpc<Array<{
    business_day: unknown;
    close_status: unknown;
    revision: unknown;
    next_business_day: unknown;
    carry_over_count: unknown;
    closed_at: unknown;
    read_at: unknown;
  }>>(
    'ecoflow_read_business_day_close_state',
    { p_business_day: businessDay },
    client,
  ) ?? [];

  const row = rows[0];
  if (!row || (row.close_status !== 'OPEN' && row.close_status !== 'CLOSED')) {
    throw new Error('Business Day Close authority is unavailable.');
  }

  const revision = Number(row.revision);
  const carryOverCount = Number(row.carry_over_count);
  if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(carryOverCount) || carryOverCount < 0) {
    throw new Error('Business Day Close authority returned an invalid revision.');
  }

  return {
    businessDay: typeof row.business_day === 'string' ? row.business_day : businessDay,
    closeStatus: row.close_status,
    revision,
    nextBusinessDay: typeof row.next_business_day === 'string' ? row.next_business_day : null,
    carryOverCount,
    closedAt: typeof row.closed_at === 'string' ? row.closed_at : null,
    readAt: typeof row.read_at === 'string' ? row.read_at : new Date(0).toISOString(),
  };
}

export async function completeBusinessDayClose(input: {
  businessDay: string;
  nextBusinessDay: string;
  expectedRevision: number;
  reason: string;
  acknowledgementNote: string;
  commandId: string;
  actorLabel?: string | null;
}, client?: SupabaseClient | null): Promise<BusinessDayCloseResult> {
  const data = await rpc<BusinessDayCloseResult[]>('ecoflow_complete_business_day_close', {
    p_business_day: input.businessDay,
    p_next_business_day: input.nextBusinessDay,
    p_expected_revision: input.expectedRevision,
    p_reason: input.reason,
    p_command_id: input.commandId,
    p_checklist: { accountsVarianceAcknowledged: true, commandId: input.commandId },
    p_acknowledgement_note: input.acknowledgementNote,
    p_actor_label: input.actorLabel || null,
  }, client) ?? [];

  const row = data[0];
  if (!row || !['APPLIED', 'REPLAYED', 'CONFLICT'].includes(row.close_status)) {
    throw new Error('Business Day Close returned no authoritative result.');
  }
  return row;
}
