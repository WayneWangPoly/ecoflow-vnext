import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOrdermentumSyncSnapshot,
  triggerOrdermentumSync,
  type MasterSyncHealthRow,
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

const syncButtons: Array<{ mode: OrdermentumSyncMode; label: string; detail: string }> = [
  { mode: 'orders_only', label: 'Sync orders now', detail: 'Fast incremental order refresh.' },
  { mode: 'master_only', label: 'Sync master data', detail: 'Customers, stores, SKU, price groups, invoices and leads.' },
  { mode: 'standard', label: 'Full standard sync', detail: 'Orders plus full master-data refresh.' },
];

export function OrdermentumIntegrationSettingsPanel({ supabase }: { supabase: SupabaseClient }) {
  const [loading, setLoading] = useState(true);
  const [triggeringMode, setTriggeringMode] = useState<OrdermentumSyncMode | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [masterHealth, setMasterHealth] = useState<MasterSyncHealthRow[]>([]);
  const [orderRuns, setOrderRuns] = useState<OrderSyncRunRow[]>([]);
  const [snapshotWarning, setSnapshotWarning] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setSnapshotWarning('');
    try {
      const snapshot = await loadOrdermentumSyncSnapshot(supabase);
      setMasterHealth(snapshot.masterHealth);
      setOrderRuns(snapshot.orderRuns);
      const warnings = [snapshot.masterError, snapshot.orderError].filter(Boolean).join(' · ');
      setSnapshotWarning(warnings);
    } catch (snapshotError) {
      setSnapshotWarning(snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latestMaster = useMemo(() => latestMasterTime(masterHealth), [masterHealth]);
  const latestOrder = useMemo(() => latestOrderRun(orderRuns), [orderRuns]);

  async function trigger(mode: OrdermentumSyncMode) {
    setTriggeringMode(mode);
    setMessage('');
    setError('');
    try {
      const result = await triggerOrdermentumSync(supabase, {
        mode,
        reason: `Triggered from EcoFlow Settings at ${new Date().toISOString()}`,
      });
      setMessage(`${result.mode} started in GitHub Actions. Refresh this panel in a few minutes to see the latest status.`);
      window.setTimeout(() => void refresh(), 5000);
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
          <span>Cloud sync control for orders, customer master, SKU master and price tiers.</span>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh status'}</button>
      </div>

      <div className="readiness-grid">
        <div><strong>{formatTime(latestOrder?.finished_at ?? latestOrder?.started_at)}</strong><span>latest order sync</span></div>
        <div><strong>{latestOrder?.status ?? '—'}</strong><span>order sync status</span></div>
        <div><strong>{formatTime(latestMaster)}</strong><span>latest master-data sync</span></div>
        <div><strong>{masterHealth.length || '—'}</strong><span>master resources tracked</span></div>
      </div>

      <div className="settings-panel">
        {syncButtons.map((button) => (
          <label key={button.mode}>
            <span>{button.label}</span>
            <div>
              <small>{button.detail}</small>
              <button
                className="primary-button"
                type="button"
                onClick={() => void trigger(button.mode)}
                disabled={Boolean(triggeringMode)}
              >
                {triggeringMode === button.mode ? 'Starting…' : 'Run'}
              </button>
            </div>
          </label>
        ))}
      </div>

      {message ? <div className="sync-error-banner">{message}</div> : null}
      {error ? <div className="sync-error-banner desktop-error-banner">Failed to trigger sync: {error}</div> : null}
      {snapshotWarning ? <p className="panel-note">Status warning: {snapshotWarning}</p> : null}

      <div className="table-like">
        <div className="table-head"><span>Resource</span><span>Rows</span><span>Latest sync</span><span>Status</span></div>
        {masterHealth.slice(0, 12).map((row, index) => (
          <div className="table-row" key={`${row.resource_type ?? 'resource'}-${index}`}>
            <span><strong>{String(row.resource_type ?? 'unknown')}</strong></span>
            <span>{String(row.resource_count ?? row.count ?? '—')}</span>
            <span>{formatTime(row.latest_synced_at ?? row.latest_payload_seen_at)}</span>
            <span>{statusText(row)}</span>
          </div>
        ))}
        {!masterHealth.length ? (
          <div className="table-row"><span>No master-data sync status yet.</span><span>—</span><span>—</span><span>Run master sync first.</span></div>
        ) : null}
      </div>
    </section>
  );
}
