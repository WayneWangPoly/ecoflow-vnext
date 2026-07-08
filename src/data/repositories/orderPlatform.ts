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

export type LegacyReviewDecision = 'ARCHIVE_APPROVED' | 'CANCEL_DRAFT_REQUESTED' | 'REBUILD_REQUESTED' | 'KEEP_REVIEW';

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

export type LegacyReviewDecisionRow = {
  id: string;
  lifecycle_id: string;
  order_number: string | null;
  invoice_number: string | null;
  internal_order_id: string | null;
  decision: LegacyReviewDecision;
  decision_note: string | null;
  decided_at: string;
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
    .from('v_ecoflow_order_lifecycle_active')
    .select('*')
    .order('lifecycle_updated_at', { ascending: false })
    .limit(120);
  if (error) throw new Error(errorMessage(error));
  return ((data ?? []) as OrderPlatformLatestOrderRow[]).map((row) => ({ ...row, platform_bucket: 'ACTIVE' }));
}

export async function loadLegacyInternalReviewOrders(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_lifecycle_legacy_internal_review')
    .select('*')
    .order('lifecycle_updated_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(errorMessage(error));
  return ((data ?? []) as OrderPlatformLatestOrderRow[]).map((row) => ({ ...row, platform_bucket: 'LEGACY_REVIEW' }));
}

export async function loadCompletedArchivePreview(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_lifecycle_board')
    .select('*')
    .eq('lifecycle_status', 'COMPLETED')
    .order('lifecycle_updated_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(errorMessage(error));
  return ((data ?? []) as OrderPlatformLatestOrderRow[]).map((row) => ({ ...row, platform_bucket: 'ARCHIVE' }));
}

export async function recordLegacyReviewDecision(input: { lifecycleId: string; decision: LegacyReviewDecision; note?: string }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_record_legacy_internal_review_decision', {
    p_lifecycle_id: input.lifecycleId,
    p_decision: input.decision,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(errorMessage(error));

  const { error: executeError } = await active.rpc('ecoflow_execute_legacy_internal_review_decision', {
    p_lifecycle_id: input.lifecycleId,
  });
  if (executeError) throw new Error(errorMessage(executeError));

  return (data ?? []) as LegacyReviewDecisionRow[];
}
