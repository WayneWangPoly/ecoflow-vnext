import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type InternalOrderSchemaProbeRow = {
  table_schema: string | null;
  table_name: string | null;
  table_type: string | null;
  column_count: number | string | null;
  columns: string | null;
};

export type InternalOrderDependencyRow = {
  object_schema: string | null;
  object_name: string | null;
  object_type: string | null;
  has_internal_order_id: boolean | null;
  has_internalisation_status: boolean | null;
  has_warehouse_gate_status: boolean | null;
  identity_column?: string | null;
  status_column?: string | null;
  execution_role?: string | null;
};

export type InternalOrderExecutionQueueRow = {
  id: string | null;
  lifecycle_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  internal_order_id: string | null;
  decision: string | null;
  decision_note: string | null;
  decided_at: string | null;
  execution_status: string | null;
  affected_rows?: number | string | null;
  executed_at?: string | null;
  error_message?: string | null;
  lifecycle_status: string | null;
  internalisation_status: string | null;
  warehouse_gate_status: string | null;
  invoice_total: number | string | null;
  lifecycle_updated_at: string | null;
};

export type InternalOrderExecutionResultRow = {
  execution_id: string;
  lifecycle_id: string;
  decision: string;
  execution_status: string;
  affected_rows: number | string | null;
  executed_at: string;
  error_message: string | null;
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

export async function loadInternalOrderSchemaProbe(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_internal_order_schema_probe')
    .select('*')
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as InternalOrderSchemaProbeRow[];
}

export async function loadInternalOrderDraftDependencies(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_internal_order_draft_dependencies')
    .select('*')
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as InternalOrderDependencyRow[];
}

export async function loadInternalOrderExecutionQueue(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_internal_order_execution_queue')
    .select('*')
    .order('decided_at', { ascending: false })
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as InternalOrderExecutionQueueRow[];
}

export async function executeLegacyInternalReviewDecision(lifecycleId: string, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_execute_legacy_internal_review_decision', {
    p_lifecycle_id: lifecycleId,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as InternalOrderExecutionResultRow[];
}
