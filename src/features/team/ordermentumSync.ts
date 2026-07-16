import type { SupabaseClient } from '@supabase/supabase-js';

export type OrdermentumSyncMode = 'orders_invoices' | 'stores_only' | 'sku_only' | 'standard' | 'catchup';
export type TriggerOrdermentumSyncResult = { ok: boolean; existing?: boolean; mode: OrdermentumSyncMode; jobId?: string; status?: string; stage?: string; workflowDispatchStatus?: number; workflow?: string; repository?: string; ref?: string; requestedBy?: string; requestedAt?: string; error?: string; details?: string; };
export type OperationalSyncJobRow = { id: string; job_type: string; mode: OrdermentumSyncMode; reason: string | null; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'; stage: string; stage_number: number; stage_total: number; requested_by_email: string | null; requested_at: string; started_at: string | null; last_heartbeat_at: string | null; completed_at: string | null; records_seen: number; records_upserted: number; records_changed: number; records_failed: number; error_code: string | null; error_message: string | null; workflow_repository: string | null; workflow_name: string | null; workflow_ref: string | null; workflow_run_id: string | null; updated_at: string; };
export type MasterSyncHealthRow = { resource_type?: string; resource_count?: number; latest_synced_at?: string | null; latest_payload_seen_at?: string | null; latest_run_status?: string | null; latest_error?: string | null; [key: string]: unknown; };
export type OrderSyncRunRow = { run_type?: string | null; status?: string | null; orders_seen?: number | null; orders_upserted?: number | null; orders_changed?: number | null; last_error?: string | null; started_at?: string | null; finished_at?: string | null; [key: string]: unknown; };

export type OrdermentumMirrorHealthRow = {
  snapshot_key?: string | null; verification_mode?: string | null;
  overall_status: 'COMPLETE' | 'DEGRADED' | 'FAILED' | string;
  raw_order_count: number | string | null; projected_order_count: number | string | null; order_projection_missing: number | string | null;
  raw_invoice_count: number | string | null; projected_invoice_count: number | string | null; invoice_projection_missing: number | string | null;
  recent_orders_missing_lines: number | string | null; recent_orders_missing_invoice_detail: number | string | null;
  unknown_recent_statuses: number | string | null; recent_finance_reviews: number | string | null;
  purchaser_count: number | string | null; product_count: number | string | null; variant_count: number | string | null;
  price_group_count: number | string | null; stock_location_count: number | string | null;
  source_missing_records?: number | string | null; source_missing_orders?: number | string | null; active_source_missing_orders?: number | string | null;
  latest_raw_order_sync?: string | null; latest_master_sync?: string | null; checked_at: string | null;
  history_run_id?: string | null; history_pipeline_status?: string | null; history_stage?: string | null;
  history_next_page?: number | string | null; history_pages_completed?: number | string | null; history_summaries_seen?: number | string | null;
  history_catalog_complete?: boolean | null; history_heartbeat_at?: string | null; history_last_error?: string | null;
  catalog_total?: number | string | null; catalog_present?: number | string | null; catalog_source_missing?: number | string | null;
  detail_complete?: number | string | null; detail_pending?: number | string | null; detail_failed?: number | string | null;
};

function isMissingRelation(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const text = [record.message, record.details, record.hint, record.code].filter(Boolean).join(' ').toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache') || text.includes('pgrst205') || text.includes('42p01');
}

async function loadMirrorHealth(supabase: SupabaseClient) {
  const snapshot = await supabase.from('ecoflow_ordermentum_mirror_status_snapshot').select('*').eq('snapshot_key', 'ORDERMENTUM_COMPLETE_MIRROR').maybeSingle();
  if (!snapshot.error) return snapshot;
  if (!isMissingRelation(snapshot.error)) return snapshot;
  for (const view of ['v_ecoflow_ordermentum_mirror_health_v3', 'v_ecoflow_ordermentum_mirror_health_v2', 'v_ecoflow_ordermentum_mirror_health_v1']) {
    const result = await supabase.from(view).select('*').maybeSingle();
    if (!result.error || !isMissingRelation(result.error)) return result;
  }
  return { data: null, error: null };
}

export async function triggerOrdermentumSync(supabase: SupabaseClient, input: { mode: OrdermentumSyncMode; reason?: string }): Promise<TriggerOrdermentumSyncResult> {
  const { data, error } = await supabase.functions.invoke('trigger-ordermentum-sync', { body: { mode: input.mode, reason: input.reason ?? null } });
  if (error) throw error;
  if (data?.error) throw new Error(`${data.error}${data.details ? `: ${data.details}` : ''}`);
  return data as TriggerOrdermentumSyncResult;
}

export async function loadOrdermentumSyncSnapshot(supabase: SupabaseClient) {
  const [masterHealth, recentRuns, operationalJobs, mirrorHealth] = await Promise.allSettled([
    supabase.from('v_ecoflow_ordermentum_master_data_sync_health').select('*').order('resource_type', { ascending: true }),
    supabase.from('ordermentum_sync_runs_v2').select('run_type,status,orders_seen,orders_upserted,orders_changed,last_error,started_at,finished_at').order('started_at', { ascending: false }).limit(5),
    supabase.from('v_ecoflow_operational_sync_jobs').select('*').order('requested_at', { ascending: false }).limit(20),
    loadMirrorHealth(supabase),
  ]);
  const masterData = masterHealth.status === 'fulfilled' && !masterHealth.value.error ? ((masterHealth.value.data ?? []) as MasterSyncHealthRow[]) : [];
  const masterError = masterHealth.status === 'fulfilled' ? masterHealth.value.error?.message ?? null : masterHealth.reason instanceof Error ? masterHealth.reason.message : String(masterHealth.reason);
  const orderRuns = recentRuns.status === 'fulfilled' && !recentRuns.value.error ? ((recentRuns.value.data ?? []) as OrderSyncRunRow[]) : [];
  const orderError = recentRuns.status === 'fulfilled' ? recentRuns.value.error?.message ?? null : recentRuns.reason instanceof Error ? recentRuns.reason.message : String(recentRuns.reason);
  const jobs = operationalJobs.status === 'fulfilled' && !operationalJobs.value.error ? ((operationalJobs.value.data ?? []) as OperationalSyncJobRow[]) : [];
  const jobError = operationalJobs.status === 'fulfilled' ? operationalJobs.value.error?.message ?? null : operationalJobs.reason instanceof Error ? operationalJobs.reason.message : String(operationalJobs.reason);
  const mirror = mirrorHealth.status === 'fulfilled' && !mirrorHealth.value.error ? ((mirrorHealth.value.data ?? null) as OrdermentumMirrorHealthRow | null) : null;
  const mirrorError = mirrorHealth.status === 'fulfilled' ? mirrorHealth.value.error?.message ?? null : mirrorHealth.reason instanceof Error ? mirrorHealth.reason.message : String(mirrorHealth.reason);
  return { masterHealth: masterData, orderRuns, operationalJobs: jobs, mirrorHealth: mirror, masterError, orderError, jobError, mirrorError };
}
