import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOrdermentumSyncSnapshot,
  triggerOrdermentumSync,
  type MasterSyncHealthRow,
  type OperationalSyncJobRow,
  type OrdermentumSyncMode,
  type OrderSyncRunRow,
} from '../team/ordermentumSync';

function formatTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusText(row: MasterSyncHealthRow) {
  const status = row.latest_run_status ?? row.status ?? row.sync_status ?? 'UNKNOWN';
  const error = row.latest_error ?? row.last_error;
  return error ? `${status} · ${error}` : String(status);
}

function latestMasterTime(rows: MasterSyncHealthRow[]) {
  const times = rows
    .map((row) => row.latest_synced_at ?? row.latest_payload_seen_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function latestOrderRun(runs: OrderSyncRunRow[]) {
  return runs.find((run) => run.run_type?.toLowerCase().includes('incremental')) ?? runs[0] ?? null;
}

function isActiveJob(job: OperationalSyncJobRow) {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

function jobTone(status: OperationalSyncJobRow['status']) {
  if (status === 'SUCCEEDED') return 'good';
  if (status === 'QUEUED' || status === 'RUNNING' || status === 'PARTIAL') return 'warn';
  return 'danger';
}

const syncButtons: Array<{ mode: OrdermentumSyncMode; label: string; detail: string }> = [
  { mode: 'orders_invoices', label: 'Sync orders + invoices now', detail: 'Fast high-watermark delta. Fetches changed orders and their invoice detail only.' },
  { mode: 'stores_only', label: 'Sync stores', detail: 'Purchaser/store and price-group master refresh.' },
  { mode: 'sku_only', label: 'Sync SKU', detail: 'Product and variant master refresh.' },
];

export function OrdermentumIntegrationSettingsPanel({ supabase }: { supabase: SupabaseClient }) {
  const [loading, setLoading] = useState(true);
  const [triggeringMode, setTriggeringMode] = useState<OrdermentumSyncMode | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [masterHealth, setMasterHealth] = useState<MasterSyncHealthRow[]>([]);
  const [orderRuns, setOrderRuns] = useState<OrderSyncRunRow[]>([]);
  const [jobs, setJobs] = useState<OperationalSyncJobRow[]>([]);
  const [snapshotWarning, setSnapshotWarning] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setSnapshotWarning('');
    try {
      const snapshot = await loadOrdermentumSyncSnapshot(supabase);
      setMasterHealth(snapshot.masterHealth);
      setOrderRuns(snapshot.orderRuns);
      setJobs(snapshot.operationalJobs);
      const warnings = [snapshot.masterError, snapshot.orderError, snapshot.jobError].filter(Boolean).join(' · ');
      setSnapshotWarning(warnings);
    } catch (snapshotError) {
      setSnapshotWarning(snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void refresh(); }, [refresh]);
  const hasActiveJob = jobs.some(isActiveJob);
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, refresh]);

  const latestMaster = useMemo(() => latestMasterTime(masterHealth), [masterHealth]);
  const latestOrder = useMemo(() => latestOrderRun(orderRuns), [orderRuns]);
  const activeByMode = useMemo(() => new Map(jobs.filter(isActiveJob).map((job) => [job.mode, job])), [jobs]);
  const latestJob = jobs[0] ?? null;

  async function trigger(mode: OrdermentumSyncMode) {
    setTriggeringMode(mode);
    setMessage('');
    setError('');
    try {
      const result = await triggerOrdermentumSync(supabase, {
        mode,
        reason: `Triggered from EcoFlow Settings at ${new Date().toISOString()}`,
      });
      setMessage(result.existing
        ? `${mode} is already ${String(result.status || 'running').toLowerCase()}. EcoFlow will track the existing job ${result.jobId || ''}.`
        : `${mode} queued as job ${result.jobId || 'pending'}. This panel will update automatically.`);
      await refresh();
    } catch (triggerError) {
      setError(triggerError instanceof Error ? triggerError.message : String(triggerError));
    } finally {
      setTriggeringMode(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Ordermentum integration</h2>
          <span>Every manual sync has one job ID, one status and one audit trail. Duplicate runs are blocked while a matching job is active.</span>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh status'}</button>
      </div>

      <div className="readiness-grid">
        <div><strong>{latestJob?.status ?? latestOrder?.status ?? '—'}</strong><span>latest operational job</span></div>
        <div><strong>{latestJob ? `${latestJob.stage_number}/${latestJob.stage_total}` : '—'}</strong><span>{latestJob?.stage ?? 'job progress'}</span></div>
        <div><strong>{formatTime(latestOrder?.finished_at ?? latestOrder?.started_at)}</strong><span>latest order + invoice delta</span></div>
        <div><strong>{formatTime(latestMaster)}</strong><span>latest master sync</span></div>
      </div>

      <div className="settings-panel">
        {syncButtons.map((button) => {
          const active = activeByMode.get(button.mode);
          return (
            <label key={button.mode}>
              <span>{button.label}</span>
              <div>
                <small>{active ? `${active.status} · ${active.stage} · requested ${formatTime(active.requested_at)}` : button.detail}</small>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void trigger(button.mode)}
                  disabled={Boolean(triggeringMode) || Boolean(active)}
                >
                  {triggeringMode === button.mode ? 'Queuing…' : active ? active.status : 'Run'}
                </button>
              </div>
            </label>
          );
        })}
      </div>

      {message ? <div className="sync-error-banner">{message}</div> : null}
      {error ? <div className="sync-error-banner desktop-error-banner">Failed to trigger sync: {error}</div> : null}
      {snapshotWarning ? <p className="panel-note">Status source degraded: {snapshotWarning}</p> : null}

      <div className="table-like">
        <div className="table-head"><span>Job / mode</span><span>Progress</span><span>Requested</span><span>Status</span></div>
        {jobs.slice(0, 10).map((job) => (
          <div className="table-row" key={job.id}>
            <span><strong>{job.mode}</strong><small>{job.id.slice(0, 8)} · {job.requested_by_email || 'automation'}</small></span>
            <span>{job.stage_number}/{job.stage_total} · {job.stage}</span>
            <span>{formatTime(job.requested_at)}</span>
            <span><span className={`pill pill-${jobTone(job.status)}`}>{job.status}</span>{job.error_message ? <small>{job.error_message}</small> : null}</span>
          </div>
        ))}
        {!jobs.length ? <div className="table-row"><span>No durable jobs yet.</span><span>—</span><span>—</span><span>The next sync will appear here.</span></div> : null}
      </div>

      <div className="table-like">
        <div className="table-head"><span>Master resource</span><span>Rows</span><span>Latest sync</span><span>Status</span></div>
        {masterHealth.slice(0, 12).map((row, index) => (
          <div className="table-row" key={`${row.resource_type ?? 'resource'}-${index}`}>
            <span><strong>{String(row.resource_type ?? 'unknown')}</strong></span>
            <span>{String(row.resource_count ?? row.count ?? '—')}</span>
            <span>{formatTime(row.latest_synced_at ?? row.latest_payload_seen_at)}</span>
            <span>{statusText(row)}</span>
          </div>
        ))}
        {!masterHealth.length ? <div className="table-row"><span>No master-data status.</span><span>—</span><span>—</span><span>Run Store or SKU sync when required.</span></div> : null}
      </div>
    </section>
  );
}
