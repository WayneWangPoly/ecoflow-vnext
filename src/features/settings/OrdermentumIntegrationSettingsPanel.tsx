import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOrdermentumSyncSnapshot,
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
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageMinutes(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
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

function mirrorTone(status?: string | null) {
  if (status === 'COMPLETE') return 'good';
  if (status === 'DEGRADED') return 'warn';
  return 'danger';
}

const syncButtons: Array<{ mode: OrdermentumSyncMode; label: string; detail: string }> = [
  { mode: 'orders_invoices', label: 'Sync orders + invoices now', detail: 'Fast delta from the saved high-watermark. Fetches changed orders and embedded invoice facts.' },
  { mode: 'catchup', label: 'Recover recent order feed', detail: 'Recovery scan that ignores the saved high-watermark and rechecks the last seven days.' },
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
  const [mirrorHealth, setMirrorHealth] = useState<OrdermentumMirrorHealthRow | null>(null);
  const [snapshotWarning, setSnapshotWarning] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setSnapshotWarning('');
    try {
      const snapshot = await loadOrdermentumSyncSnapshot(supabase);
      setMasterHealth(snapshot.masterHealth);
      setOrderRuns(snapshot.orderRuns);
      setJobs(snapshot.operationalJobs);
      setMirrorHealth(snapshot.mirrorHealth);
      const warnings = [snapshot.masterError, snapshot.orderError, snapshot.jobError, snapshot.mirrorError].filter(Boolean).join(' · ');
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
  const latestOrderAt = latestOrder?.finished_at ?? latestOrder?.started_at ?? null;
  const orderAge = ageMinutes(latestOrderAt);
  const orderFeedStale = orderAge === null || orderAge > 90;
  const mirrorStatus = mirrorHealth?.overall_status ?? 'NOT AVAILABLE';
  const orderCoverage = `${numberValue(mirrorHealth?.projected_order_count)} / ${numberValue(mirrorHealth?.raw_order_count)}`;
  const invoiceCoverage = `${numberValue(mirrorHealth?.projected_invoice_count)} / ${numberValue(mirrorHealth?.raw_invoice_count)}`;

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
          <span>Fast deltas keep recent work moving. A separate complete mirror rechecks all supported Ordermentum domains and refuses to report success while data is incomplete.</span>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh status'}</button>
      </div>

      {orderFeedStale ? (
        <div className="sync-error-banner desktop-error-banner">
          ORDER FEED STALE · Last recorded order + invoice delta: {formatTime(latestOrderAt)}. New customer orders may be missing from EcoFlow. Run “Recover recent order feed”.
        </div>
      ) : null}

      {mirrorHealth && mirrorStatus !== 'COMPLETE' ? (
        <div className="sync-error-banner desktop-error-banner">
          COMPLETE MIRROR {mirrorStatus} · Projection gaps, missing detail, unknown source states, or finance reconciliation still require attention. EcoFlow is retaining the source payloads and will not silently classify them as ready.
        </div>
      ) : null}

      <div className="readiness-grid">
        <div><strong><span className={`pill pill-${mirrorTone(mirrorStatus)}`}>{mirrorStatus}</span></strong><span>complete mirror contract</span></div>
        <div><strong>{orderCoverage}</strong><span>projected / raw orders</span></div>
        <div><strong>{invoiceCoverage}</strong><span>projected / raw invoices</span></div>
        <div><strong>{formatTime(mirrorHealth?.checked_at)}</strong><span>mirror verification</span></div>
        <div><strong>{latestJob?.status ?? 'NO DURABLE JOB'}</strong><span>latest fast-sync job</span></div>
        <div><strong>{formatTime(latestOrderAt)}</strong><span>{orderFeedStale ? 'stale order delta' : 'latest order delta'}</span></div>
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

      <p className="panel-note">Complete mirror schedule: recent commercial data is reconciled daily; all Ordermentum history is rechecked weekly. Orders, invoices, purchaser detail, products, variants, price groups and stock locations are retained independently.</p>

      {message ? <div className="sync-error-banner">{message}</div> : null}
      {error ? <div className="sync-error-banner desktop-error-banner">Failed to trigger sync: {error}</div> : null}
      {snapshotWarning ? <p className="panel-note">Status source degraded: {snapshotWarning}</p> : null}
      {!latestJob && latestOrder ? <p className="panel-note">A legacy sync run is visible, but no durable job record was returned. The legacy status is not presented as an operational job.</p> : null}

      <div className="table-like">
        <div className="table-head"><span>Mirror control</span><span>Count</span><span>Expectation</span><span>Status</span></div>
        <div className="table-row"><span><strong>Order projection gaps</strong></span><span>{numberValue(mirrorHealth?.order_projection_missing)}</span><span>0</span><span>{numberValue(mirrorHealth?.order_projection_missing) ? 'ACTION REQUIRED' : 'COMPLETE'}</span></div>
        <div className="table-row"><span><strong>Invoice projection gaps</strong></span><span>{numberValue(mirrorHealth?.invoice_projection_missing)}</span><span>0</span><span>{numberValue(mirrorHealth?.invoice_projection_missing) ? 'ACTION REQUIRED' : 'COMPLETE'}</span></div>
        <div className="table-row"><span><strong>Recent orders missing lines</strong></span><span>{numberValue(mirrorHealth?.recent_orders_missing_lines)}</span><span>0</span><span>{numberValue(mirrorHealth?.recent_orders_missing_lines) ? 'BLOCKED' : 'COMPLETE'}</span></div>
        <div className="table-row"><span><strong>Recent invoice detail gaps</strong></span><span>{numberValue(mirrorHealth?.recent_orders_missing_invoice_detail)}</span><span>0</span><span>{numberValue(mirrorHealth?.recent_orders_missing_invoice_detail) ? 'BLOCKED' : 'COMPLETE'}</span></div>
        <div className="table-row"><span><strong>Unknown recent source states</strong></span><span>{numberValue(mirrorHealth?.unknown_recent_statuses)}</span><span>0</span><span>{numberValue(mirrorHealth?.unknown_recent_statuses) ? 'REVIEW' : 'CLASSIFIED'}</span></div>
        <div className="table-row"><span><strong>Finance reconciliation review</strong></span><span>{numberValue(mirrorHealth?.recent_finance_reviews)}</span><span>0</span><span>{numberValue(mirrorHealth?.recent_finance_reviews) ? 'REVIEW' : 'RECONCILED'}</span></div>
      </div>

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
        {!masterHealth.length ? <div className="table-row"><span>No master-data status.</span><span>—</span><span>—</span><span>The complete mirror will populate every supported resource.</span></div> : null}
      </div>
    </section>
  );
}
