import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOrdermentumMirrorHealth,
  loadOrdermentumOperationalSyncSnapshot,
  triggerOrdermentumSync,
  type MasterSyncHealthRow,
  type OperationalSyncJobRow,
  type OrdermentumMirrorHealthRow,
  type OrdermentumSyncMode,
  type OrderSyncRunRow,
} from '../team/ordermentumSync';

function formatTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestOrderRun(runs: OrderSyncRunRow[]) {
  return runs.find((run) => run.run_type?.toLowerCase().includes('incremental')) ?? runs[0] ?? null;
}

function isActiveJob(job: OperationalSyncJobRow) {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

function tone(status?: string | null) {
  if (status === 'COMPLETE' || status === 'SUCCEEDED') return 'good';
  if (['LOADING', 'QUEUED', 'RUNNING', 'PAUSED', 'PARTIAL', 'READY_TO_FINALISE', 'DEGRADED'].includes(String(status))) return 'warn';
  return 'danger';
}

const syncButtons: Array<{ mode: OrdermentumSyncMode; label: string; primary?: boolean }> = [
  { mode: 'orders_invoices', label: 'Sync orders + invoices now', primary: true },
  { mode: 'catchup', label: 'Recover last 7 days' },
  { mode: 'stores_only', label: 'Sync stores' },
  { mode: 'sku_only', label: 'Sync SKU' },
];

export function OrdermentumIntegrationSettingsPanel({ supabase }: { supabase: SupabaseClient }) {
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [triggeringMode, setTriggeringMode] = useState<OrdermentumSyncMode | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mirrorError, setMirrorError] = useState('');
  const [operationalError, setOperationalError] = useState('');
  const [masterHealth, setMasterHealth] = useState<MasterSyncHealthRow[]>([]);
  const [orderRuns, setOrderRuns] = useState<OrderSyncRunRow[]>([]);
  const [jobs, setJobs] = useState<OperationalSyncJobRow[]>([]);
  const [mirrorHealth, setMirrorHealth] = useState<OrdermentumMirrorHealthRow | null>(null);

  useEffect(() => {
    const handleSection = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string }>).detail;
      setActive(detail?.section === 'integration');
    };
    window.addEventListener('ecoflow:system-section', handleSection);
    if (document.querySelector('.system-direct-shell.system-show-integration')) setActive(true);
    return () => window.removeEventListener('ecoflow:system-section', handleSection);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMirrorError('');
    setOperationalError('');

    const [mirrorResult, operationalResult] = await Promise.allSettled([
      loadOrdermentumMirrorHealth(supabase),
      loadOrdermentumOperationalSyncSnapshot(supabase),
    ]);

    if (mirrorResult.status === 'fulfilled') {
      setMirrorHealth(mirrorResult.value.mirrorHealth);
      setMirrorError(mirrorResult.value.mirrorError ?? '');
    } else {
      setMirrorHealth(null);
      setMirrorError(mirrorResult.reason instanceof Error ? mirrorResult.reason.message : String(mirrorResult.reason));
    }

    if (operationalResult.status === 'fulfilled') {
      setMasterHealth(operationalResult.value.masterHealth);
      setOrderRuns(operationalResult.value.orderRuns);
      setJobs(operationalResult.value.operationalJobs);
      setOperationalError([operationalResult.value.orderError, operationalResult.value.masterError, operationalResult.value.jobError].filter(Boolean).join(' · '));
    } else {
      setOperationalError(operationalResult.reason instanceof Error ? operationalResult.reason.message : String(operationalResult.reason));
    }

    setLoaded(true);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (active && !loaded && !loading) void refresh();
  }, [active, loaded, loading, refresh]);

  const hasActiveJob = jobs.some(isActiveJob);
  useEffect(() => {
    if (!active || !hasActiveJob) return;
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [active, hasActiveJob, refresh]);

  const latestOrder = useMemo(() => latestOrderRun(orderRuns), [orderRuns]);
  const latestOrderAt = latestOrder?.finished_at ?? latestOrder?.started_at ?? null;
  const activeByMode = useMemo(() => new Map(jobs.filter(isActiveJob).map((job) => [job.mode, job])), [jobs]);
  const mirrorStatus = loading && !loaded ? 'LOADING' : mirrorHealth?.overall_status ?? 'UNAVAILABLE';
  const historyStatus = loading && !loaded ? 'LOADING' : mirrorHealth?.history_pipeline_status ?? 'UNAVAILABLE';
  const detailPending = loaded ? numberValue(mirrorHealth?.detail_pending) : '—';
  const blockerSummary = (mirrorHealth?.blockers ?? [])
    .filter((blocker) => numberValue(blocker.count) > 0)
    .map((blocker) => `${blocker.label || 'control'}: ${numberValue(blocker.count)}`)
    .join(' · ');

  async function trigger(mode: OrdermentumSyncMode) {
    setTriggeringMode(mode);
    setMessage('');
    setError('');
    try {
      const result = await triggerOrdermentumSync(supabase, {
        mode,
        reason: `Triggered from EcoFlow System at ${new Date().toISOString()}`,
      });
      setMessage(result.existing ? `${mode} is already running.` : `${mode} queued.`);
      await refresh();
    } catch (triggerError) {
      setError(triggerError instanceof Error ? triggerError.message : String(triggerError));
    } finally {
      setTriggeringMode(null);
    }
  }

  return (
    <section className="panel ordermentum-system-panel">
      <div className="panel-head">
        <div><h2>Integration</h2><span>Ordermentum sync controls</span></div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {mirrorError ? <div className="sync-error-banner desktop-error-banner">Mirror status unavailable · {mirrorError}</div> : null}
      {operationalError ? <div className="sync-error-banner desktop-error-banner">Operational status incomplete · {operationalError}</div> : null}
      {blockerSummary ? <div className="sync-error-banner desktop-error-banner">Action required · {blockerSummary}</div> : null}
      {message ? <div className="success-message">{message}</div> : null}
      {error ? <div className="error-message">{error}</div> : null}

      <div className="system-status-grid">
        <div><span>Mirror</span><strong><b className={`pill pill-${tone(mirrorStatus)}`}>{mirrorStatus}</b></strong></div>
        <div><span>Order feed</span><strong>{formatTime(latestOrderAt)}</strong></div>
        <div><span>Detail pending</span><strong>{detailPending}</strong></div>
        <div><span>Active jobs</span><strong>{jobs.filter(isActiveJob).length}</strong></div>
      </div>

      <div className="system-sync-actions">
        {syncButtons.map((button) => {
          const currentJob = activeByMode.get(button.mode);
          return (
            <button
              key={button.mode}
              type="button"
              className={button.primary ? 'primary' : ''}
              onClick={() => void trigger(button.mode)}
              disabled={Boolean(triggeringMode) || Boolean(currentJob)}
            >
              {triggeringMode === button.mode ? 'Queuing…' : currentJob ? currentJob.status : button.label}
            </button>
          );
        })}
      </div>

      <details className="system-diagnostics">
        <summary>Diagnostics</summary>
        <div className="system-status-grid">
          <div><span>History</span><strong><b className={`pill pill-${tone(historyStatus)}`}>{historyStatus}</b></strong></div>
          <div><span>Pages saved</span><strong>{loaded ? numberValue(mirrorHealth?.history_pages_completed) : '—'}</strong></div>
          <div><span>Orders projected / raw</span><strong>{loaded ? `${numberValue(mirrorHealth?.projected_order_count)} / ${numberValue(mirrorHealth?.raw_order_count)}` : '—'}</strong></div>
          <div><span>retained source-missing</span><strong>{loaded ? numberValue(mirrorHealth?.source_missing_records) : '—'}</strong></div>
          <div><span>active source missing</span><strong>{loaded ? numberValue(mirrorHealth?.active_source_missing_orders) : '—'}</strong></div>
        </div>

        <div className="table-like">
          <div className="table-head"><span>Job</span><span>Progress</span><span>Requested</span><span>Status</span></div>
          {jobs.slice(0, 8).map((job) => (
            <div className="table-row" key={job.id}>
              <span><strong>{job.mode}</strong><small>{job.id.slice(0, 8)}</small></span>
              <span>{job.stage_number}/{job.stage_total} · {job.stage}</span>
              <span>{formatTime(job.requested_at)}</span>
              <span><b className={`pill pill-${tone(job.status)}`}>{job.status}</b>{job.error_message ? <small>{job.error_message}</small> : null}</span>
            </div>
          ))}
          {!jobs.length ? <div className="table-row"><span>No jobs.</span><span>—</span><span>—</span><span>—</span></div> : null}
        </div>

        <div className="table-like">
          <div className="table-head"><span>Resource</span><span>Rows</span><span>Latest sync</span><span>Status</span></div>
          {masterHealth.slice(0, 10).map((row, index) => (
            <div className="table-row" key={`${String(row.resource_type ?? 'resource')}-${index}`}>
              <span><strong>{String(row.resource_type ?? 'unknown')}</strong></span>
              <span>{String(row.resource_count ?? row.count ?? '—')}</span>
              <span>{formatTime(row.latest_synced_at ?? row.latest_payload_seen_at)}</span>
              <span>{String(row.latest_run_status ?? row.status ?? row.sync_status ?? 'UNKNOWN')}</span>
            </div>
          ))}
          {!masterHealth.length ? <div className="table-row"><span>No resource status.</span><span>—</span><span>—</span><span>—</span></div> : null}
        </div>
      </details>
    </section>
  );
}
