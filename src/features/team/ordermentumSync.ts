import type { SupabaseClient } from '@supabase/supabase-js';

export type OrdermentumSyncMode = 'orders_invoices' | 'stores_only' | 'sku_only' | 'standard' | 'catchup';
export type TriggerOrdermentumSyncResult = { ok: boolean; existing?: boolean; mode: OrdermentumSyncMode; jobId?: string; status?: string; stage?: string; workflowDispatchStatus?: number; workflow?: string; repository?: string; ref?: string; requestedBy?: string; requestedAt?: string; error?: string; details?: string; };
export type OperationalSyncJobRow = { id: string; job_type: string; mode: OrdermentumSyncMode; reason: string | null; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'; stage: string; stage_number: number; stage_total: number; requested_by_email: string | null; requested_at: string; started_at: string | null; last_heartbeat_at: string | null; completed_at: string | null; records_seen: number; records_upserted: number; records_changed: number; records_failed: number; error_code: string | null; error_message: string | null; workflow_repository: string | null; workflow_name: string | null; workflow_ref: string | null; workflow_run_id: string | null; updated_at: string; };
export type MasterSyncHealthRow = { resource_type?: string; resource_count?: number; latest_synced_at?: string | null; latest_payload_seen_at?: string | null; latest_run_status?: string | null; latest_error?: string | null; [key: string]: unknown; };
export type OrderSyncRunRow = { run_type?: string | null; status?: string | null; orders_seen?: number | null; orders_upserted?: number | null; orders_changed?: number | null; last_error?: string | null; started_at?: string | null; finished_at?: string | null; [key: string]: unknown; };
export type OrdermentumMirrorBlocker = { label?: string | null; count?: number | string | null };
export type OrdermentumMirrorWarning = { code?: string | null; count?: number | string | null; blocking?: boolean | null; message?: string | null };

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
  blockers?: OrdermentumMirrorBlocker[] | null;
  warnings?: OrdermentumMirrorWarning[] | null;
  metadata?: Record<string, unknown> | null;
};

function isMissingRelation(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const value = [record.message, record.details, record.hint, record.code].filter(Boolean).join(' ').toLowerCase();
  return value.includes('does not exist') || value.includes('schema cache') || value.includes('pgrst205') || value.includes('42p01');
}

function errorMessage(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const value = [record.message, record.details, record.hint, record.code].filter(Boolean).join(' · ');
    if (value) return value;
  }
  return String(error);
}

function withTimeout<T>(task: PromiseLike<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
    Promise.resolve(task).then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

export async function loadOrdermentumMirrorHealth(supabase: SupabaseClient) {
  const snapshot = await withTimeout(
    supabase.from('ecoflow_ordermentum_mirror_status_snapshot').select('*').eq('snapshot_key', 'ORDERMENTUM_COMPLETE_MIRROR').maybeSingle(),
    'Verified mirror status',
    8000,
  );
  if (!snapshot.error) {
    const mirrorHealth = (snapshot.data ?? null) as OrdermentumMirrorHealthRow | null;
    return {
      mirrorHealth,
      mirrorError: mirrorHealth ? null : 'No verified mirror status snapshot has been published yet.',
    };
  }
  if (!isMissingRelation(snapshot.error)) return { mirrorHealth: null, mirrorError: errorMessage(snapshot.error) };

  for (const view of ['v_ecoflow_ordermentum_mirror_health_v3', 'v_ecoflow_ordermentum_mirror_health_v2', 'v_ecoflow_ordermentum_mirror_health_v1']) {
    const result = await withTimeout(supabase.from(view).select('*').maybeSingle(), `${view} fallback`, 8000);
    if (!result.error) return { mirrorHealth: (result.data ?? null) as OrdermentumMirrorHealthRow | null, mirrorError: null };
    if (!isMissingRelation(result.error)) return { mirrorHealth: null, mirrorError: errorMessage(result.error) };
  }
  return { mirrorHealth: null, mirrorError: 'Ordermentum mirror status sources are unavailable.' };
}

export async function triggerOrdermentumSync(supabase: SupabaseClient, input: { mode: OrdermentumSyncMode; reason?: string }): Promise<TriggerOrdermentumSyncResult> {
  const { data, error } = await supabase.functions.invoke('trigger-ordermentum-sync', { body: { mode: input.mode, reason: input.reason ?? null } });
  if (error) throw error;
  if (data?.error) throw new Error(`${data.error}${data.details ? `: ${data.details}` : ''}`);
  return data as TriggerOrdermentumSyncResult;
}

export async function loadOrdermentumOperationalSyncSnapshot(supabase: SupabaseClient) {
  const [masterHealth, recentRuns, operationalJobs] = await Promise.allSettled([
    withTimeout(supabase.from('v_ecoflow_ordermentum_master_data_sync_health').select('*').order('resource_type', { ascending: true }), 'Master-data status', 12000),
    withTimeout(supabase.from('ordermentum_sync_runs_v2').select('run_type,status,orders_seen,orders_upserted,orders_changed,last_error,started_at,finished_at').order('started_at', { ascending: false }).limit(5), 'Order-feed status', 12000),
    withTimeout(supabase.from('v_ecoflow_operational_sync_jobs').select('*').order('requested_at', { ascending: false }).limit(20), 'Operational job status', 12000),
  ]);
  const masterData = masterHealth.status === 'fulfilled' && !masterHealth.value.error ? ((masterHealth.value.data ?? []) as MasterSyncHealthRow[]) : [];
  const masterError = masterHealth.status === 'fulfilled' ? errorMessage(masterHealth.value.error) : errorMessage(masterHealth.reason);
  const orderRuns = recentRuns.status === 'fulfilled' && !recentRuns.value.error ? ((recentRuns.value.data ?? []) as OrderSyncRunRow[]) : [];
  const orderError = recentRuns.status === 'fulfilled' ? errorMessage(recentRuns.value.error) : errorMessage(recentRuns.reason);
  const jobs = operationalJobs.status === 'fulfilled' && !operationalJobs.value.error ? ((operationalJobs.value.data ?? []) as OperationalSyncJobRow[]) : [];
  const jobError = operationalJobs.status === 'fulfilled' ? errorMessage(operationalJobs.value.error) : errorMessage(operationalJobs.reason);
  return { masterHealth: masterData, orderRuns, operationalJobs: jobs, masterError, orderError, jobError };
}

export async function loadOrdermentumSyncSnapshot(supabase: SupabaseClient) {
  const [operational, mirror] = await Promise.all([
    loadOrdermentumOperationalSyncSnapshot(supabase),
    loadOrdermentumMirrorHealth(supabase),
  ]);
  return { ...operational, ...mirror };
}
