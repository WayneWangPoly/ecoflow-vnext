import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '@/domain/syncModel';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import {
  loadOwnerCommandAttention,
  loadOwnerCommandKpis,
  type OwnerCommandAttentionRow,
  type OwnerCommandKpis,
} from '@/data/repositories/ownerCommandCenter';
import {
  DashboardAttentionRow,
  DashboardLoading,
  DashboardMetric,
  DashboardOrderRow,
  DashboardPill,
} from './DashboardPrimitives';
import { buildDashboardView, money, numberValue } from './dashboardModel';

type DashboardPageProps = {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  snapshotReady: boolean;
  loading: boolean;
  loadError?: string;
  healthNotice?: string;
  onReload: () => Promise<void>;
  onOpenOrders: () => void;
};

export function DashboardPage({
  role,
  data,
  orders,
  snapshotReady,
  loading,
  loadError,
  healthNotice,
  onReload,
  onOpenOrders,
}: DashboardPageProps) {
  const [kpis, setKpis] = useState<OwnerCommandKpis | null>(null);
  const [attention, setAttention] = useState<OwnerCommandAttentionRow[]>([]);

  useEffect(() => {
    if (!snapshotReady) return;
    let active = true;
    void Promise.allSettled([loadOwnerCommandKpis(), loadOwnerCommandAttention()]).then(([kpiResult, attentionResult]) => {
      if (!active) return;
      setKpis(kpiResult.status === 'fulfilled' ? kpiResult.value : null);
      setAttention(attentionResult.status === 'fulfilled' ? attentionResult.value : []);
    });
    return () => { active = false; };
  }, [snapshotReady, data.syncBatch.completedAt]);

  const view = useMemo(
    () => snapshotReady ? buildDashboardView(data, orders, kpis) : null,
    [data, kpis, orders, snapshotReady],
  );

  if (loading && !snapshotReady) return <DashboardLoading />;
  if (!snapshotReady || !view) {
    return (
      <section className="owner-command-unavailable" role="alert">
        <div>
          <strong>Live dashboard unavailable</strong>
          <span>{loadError || 'EcoFlow could not load a consistent current-lifecycle snapshot. No sample figures are shown.'}</span>
        </div>
        <button type="button" disabled={loading} onClick={() => void onReload()}>
          {loading ? 'Retrying…' : 'Retry live data'}
        </button>
      </section>
    );
  }

  const roleName = role === 'account' ? 'ACCOUNTS' : role.toUpperCase();
  const subtitle = role === 'account'
    ? 'Accounts control across today’s Ordermentum changes, release blockers and receivables.'
    : 'One clear operating view across today’s orders, mapping pressure and customer risk.';

  return (
    <section className="owner-command-shell">
      <section className="owner-command-hero">
        <div className="owner-command-hero-copy">
          <span>{roleName} CONTROL</span>
          <h1>Build the supply chain behind a cleaner food future.</h1>
          <p>{subtitle}</p>
          <small>{data.businessDay.label} · cutoff {data.businessDay.cutoffTime} · authenticated live workflow</small>
        </div>
        <div className="owner-command-hero-metrics">
          <DashboardMetric label="New today" value={view.count('newToday')} helper="First seen today" tone="good" />
          <DashboardMetric label="Updated today" value={view.count('updatedToday')} helper="Changed today" tone="blue" />
          <DashboardMetric label="Active orders" value={view.activeOrders} helper={`${orders.length} current lifecycle records`} tone="warn" />
          <DashboardMetric label="Open AR" value={money(view.openAr)} helper="Outstanding balance" />
        </div>
      </section>

      <section className="owner-command-syncbar">
        <div className="owner-command-sync-summary">
          <span className={`owner-command-sync-dot ${data.syncBatch.status === 'SUCCESS' ? 'is-good' : 'is-warn'}`} />
          <div>
            <strong>Sync control</strong>
            <span>Last successful snapshot {formatDateTime(data.syncBatch.completedAt)}</span>
          </div>
          <DashboardPill tone={data.syncBatch.status === 'SUCCESS' ? 'good' : 'warn'}>{data.syncBatch.status}</DashboardPill>
        </div>
        <div className="owner-command-sync-metrics">
          <div><strong>{data.syncBatch.fetched}</strong><span>Fetched</span></div>
          <div><strong>{data.syncBatch.created}</strong><span>New</span></div>
          <div><strong>{data.syncBatch.updated}</strong><span>Updated</span></div>
          <div><strong>{data.syncBatch.unchanged}</strong><span>Unchanged</span></div>
          <div className={view.dataCheckCount ? 'is-warning' : ''}>
            <strong>{view.dataCheckCount}</strong><span>Active data checks</span>
          </div>
        </div>
        <div className="owner-command-sync-actions">
          <small>
            Latest order change {view.latestOrderChange ? formatDateTime(view.latestOrderChange) : '—'}
            <br />Current snapshot {formatDateTime(data.repositoryStatus?.loadedAt || data.syncBatch.completedAt)}
          </small>
          <button type="button" disabled={loading} onClick={() => void onReload()}>
            {loading ? 'Refreshing…' : 'Refresh live data'}
          </button>
        </div>
      </section>

      {healthNotice ? (
        <div className="owner-command-error">
          System health notice: {healthNotice}. Core order totals remain live; review Settings for source details.
        </div>
      ) : null}
      {loadError ? (
        <div className="owner-command-error">
          Refresh failed. The last trusted snapshot remains on screen. {loadError}
        </div>
      ) : null}

      <section className="owner-command-workspace">
        <section className="owner-command-panel owner-command-queue-panel">
          <header className="owner-command-panel-header">
            <div>
              <h2>Daily control queue</h2>
              <p>Actionable changes and blockers only. Unchanged records remain in Ordermentum Inbox history.</p>
            </div>
            <div className="owner-command-header-actions">
              <DashboardPill tone={view.actionableCount ? 'warn' : 'good'}>
                {view.queue.length} of {view.actionableCount} shown
              </DashboardPill>
              <button type="button" onClick={onOpenOrders}>View all orders</button>
            </div>
          </header>
          <div className="owner-command-order-list">
            {view.queue.map((order) => <DashboardOrderRow key={order.id} order={order} />)}
            {!view.queue.length ? <div className="owner-command-empty">No orders need control-room attention.</div> : null}
          </div>
        </section>

        <aside className="owner-command-rail">
          <section className="owner-command-panel owner-command-rail-card">
            <header className="owner-command-panel-header">
              <div><h3>Operational buckets</h3><p>{data.businessDay.label}</p></div>
            </header>
            <div className="owner-command-buckets">
              {view.bucketCounts
                .filter((bucket) => ['exceptions', 'newToday', 'updatedToday', 'dueToday', 'carryOver'].includes(bucket.key))
                .map((bucket) => (
                  <article key={bucket.key}><strong>{bucket.count}</strong><span>{bucket.label}</span></article>
                ))}
            </div>
          </section>

          <section className="owner-command-panel owner-command-rail-card">
            <header className="owner-command-panel-header">
              <div><h3>Business pulse</h3><p>Best available live owner signals.</p></div>
            </header>
            <div className="owner-command-pulse-list">
              <article><strong>{kpis?.top_sku_30d || '—'}</strong><span>Top SKU · {kpis?.top_product_30d || 'No product detail'}</span></article>
              <article><strong>{kpis?.top_store_30d || '—'}</strong><span>Top store · {money(kpis?.top_store_revenue_30d)}</span></article>
              <article><strong>{numberValue(kpis?.barcode_attention_lines)}</strong><span>Barcode attention lines</span></article>
              <article><strong>{numberValue(kpis?.reorder_pressure_rows)}</strong><span>Reorder pressure rows</span></article>
            </div>
          </section>

          <section className="owner-command-panel owner-command-rail-card">
            <header className="owner-command-panel-header">
              <div><h3>Priority attention</h3><p>Highest-value actions across the platform.</p></div>
            </header>
            <div className="owner-command-attention-list">
              {attention.slice(0, 5).map((row, index) => (
                <DashboardAttentionRow key={`${row.area}-${row.reference_id}-${index}`} row={row} />
              ))}
              {!attention.length ? <div className="owner-command-empty">No additional command-centre alerts.</div> : null}
            </div>
          </section>
        </aside>
      </section>
    </section>
  );
}
