import type { SupabaseClient } from '@supabase/supabase-js';

export type OrdermentumSyncMode = 'orders_invoices' | 'stores_only' | 'sku_only' | 'standard' | 'catchup';

export type TriggerOrdermentumSyncResult = {
  ok: boolean;
  existing?: boolean;
  mode: OrdermentumSyncMode;
  jobId?: string;
  status?: string;
  stage?: string;
  workflowDispatchStatus?: number;
  workflow?: string;
  repository?: string;
  ref?: string;
  requestedBy?: string;
  requestedAt?: string;
  error?: string;
  details?: string;
};

export type OperationalSyncJobRow = {
  id: string;
  job_type: string;
  mode: OrdermentumSyncMode;
  reason: string | null;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  stage: string;
  stage_number: number;
  stage_total: number;
  requested_by_email: string | null;
  requested_at: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  completed_at: string | null;
  records_seen: number;
  records_upserted: number;
  records_changed: number;
  records_failed: number;
  error_code: string | null;
  error_message: string | null;
  workflow_repository: string | null;
  workflow_name: string | null;
  workflow_ref: string | null;
  workflow_run_id: string | null;
  updated_at: string;
};

export type MasterSyncHealthRow = {
  resource_type?: string;
  resource_count?: number;
  latest_synced_at?: string | null;
  latest_payload_seen_at?: string | null;
  latest_run_status?: string | null;
  latest_error?: string | null;
  [key: string]: unknown;
};

export type OrderSyncRunRow = {
  run_type?: string | null;
  status?: string | null;
  orders_seen?: number | null;
  orders_upserted?: number | null;
  orders_changed?: number | null;
  last_error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  [key: string]: unknown;
};

export async function triggerOrdermentumSync(
  supabase: SupabaseClient,
  input: { mode: OrdermentumSyncMode; reason?: string }
): Promise<TriggerOrdermentumSyncResult> {
  const { data, error } = await supabase.functions.invoke('trigger-ordermentum-sync', {
    body: {
      mode: input.mode,
      reason: input.reason ?? null,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(`${data.error}${data.details ? `: ${data.details}` : ''}`);
  return data as TriggerOrdermentumSyncResult;
}

export async function loadOrdermentumSyncSnapshot(supabase: SupabaseClient) {
  const [masterHealth, recentRuns, operationalJobs] = await Promise.allSettled([
    supabase
      .from('v_ecoflow_ordermentum_master_data_sync_health')
      .select('*')
      .order('resource_type', { ascending: true }),
    supabase
      .from('ordermentum_sync_runs_v2')
      .select('run_type,status,orders_seen,orders_upserted,orders_changed,last_error,started_at,finished_at')
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('v_ecoflow_operational_sync_jobs')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(20),
  ]);

  const masterData = masterHealth.status === 'fulfilled' && !masterHealth.value.error
    ? ((masterHealth.value.data ?? []) as MasterSyncHealthRow[])
    : [];
  const masterError = masterHealth.status === 'fulfilled'
    ? masterHealth.value.error?.message ?? null
    : masterHealth.reason instanceof Error ? masterHealth.reason.message : String(masterHealth.reason);

  const orderRuns = recentRuns.status === 'fulfilled' && !recentRuns.value.error
    ? ((recentRuns.value.data ?? []) as OrderSyncRunRow[])
    : [];
  const orderError = recentRuns.status === 'fulfilled'
    ? recentRuns.value.error?.message ?? null
    : recentRuns.reason instanceof Error ? recentRuns.reason.message : String(recentRuns.reason);

  const jobs = operationalJobs.status === 'fulfilled' && !operationalJobs.value.error
    ? ((operationalJobs.value.data ?? []) as OperationalSyncJobRow[])
    : [];
  const jobError = operationalJobs.status === 'fulfilled'
    ? operationalJobs.value.error?.message ?? null
    : operationalJobs.reason instanceof Error ? operationalJobs.reason.message : String(operationalJobs.reason);

  return {
    masterHealth: masterData,
    orderRuns,
    operationalJobs: jobs,
    masterError,
    orderError,
    jobError,
  };
}
