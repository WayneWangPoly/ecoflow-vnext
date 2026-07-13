import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { buildEcoFlowData } from '@/domain/ecoflowData';
import { buildProductionEmptyData } from '@/domain/productionData';
import { getOrderBucketCounts } from '@/domain/orderBuckets';
import { formatBusinessDate, formatDateTime, sortOrdersForOperations } from '@/domain/syncModel';
import {
  applySupabaseOrdermentumViews,
  loadSupabaseOrdermentumViews,
  type OperationalSourceDiagnostic,
} from '@/data/repositories/resilientOrdermentumViews';
import type { EcoFlowDataSet, ImportedOrder, OrderBucketKey } from '@/domain/types';
import {
  loadOwnerCommandAttention,
  loadOwnerCommandKpis,
  type OwnerCommandAttentionRow,
  type OwnerCommandKpis,
} from '@/data/repositories/ownerCommandCenter';

// Demo fixtures remain available to local development only. Production starts
// from a structurally empty dataset and never inherits sample orders or KPIs.
const dashboardBase = import.meta.env.DEV ? buildEcoFlowData() : buildProductionEmptyData();

type Tone = 'good' | 'warn' | 'danger' | 'blue' | 'neutral';
type QueueBadge = { label: string; tone: Tone };

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return num(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function operationalError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.toLowerCase();
  if (normalized.includes('current transaction is aborted') || normalized.includes('transaction block') || normalized.includes('25p02')) {
    return 'The live operational snapshot was interrupted by a database transaction error. EcoFlow is not showing substitute figures. Retry shortly; if it continues, review the first Supabase database error.';
  }
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('permission')) {
    return 'Your session is active, but one required operational source could not be authorised. Refresh the session or ask an administrator to review the source permission.';
  }
  return raw || 'Live operations are temporarily unavailable. No sample figures are being shown.';
}

function signalTone(signal?: string | null): Tone {
  const normalized = String(signal || '').toUpperCase();
  if (normalized.includes('URGENT') || normalized.includes('OVERDUE') || normalized.includes('HOLD') || normalized.includes('BLOCKED')) return 'danger';
  if (normalized.includes('NEEDS') || normalized.includes('WATCH') || normalized.includes('HIGH') || normalized.includes('LEGACY') || normalized.includes('BARCODE')) return 'warn';
  if (normalized.includes('OPEN') || normalized.includes('REORDER') || normalized.includes('UPDATED')) return 'blue';
  if (normalized.includes('READY') || normalized.includes('ACTIVE') || normalized.includes('CLEAR') || normalized.includes('SUCCESS')) return 'good';
  return 'neutral';
}

function orderStatusTone(status: ImportedOrder['status']): Tone {
  if (status === 'DELIVERED' || status === 'CLOSED') return 'good';
  if (status === 'MAPPING_EXCEPTION' || status === 'FAILED') return 'danger';
  if (status === 'OUT_FOR_DELIVERY' || status === 'PACKED' || status === 'STAGED') return 'blue';
  if (status === 'RELEASE_READY') return 'warn';
  return 'neutral';
}

function releaseTone(status: ImportedOrder['releaseGateStatus']): Tone {
  if (status === 'READY_TO_RELEASE') return 'good';
  if (status === 'REVIEW_PAYMENT') return 'warn';
  if (status === 'BLOCKED_DATA' || status === 'BLOCKED_MAPPING' || status === 'BLOCKED_STOCK') return 'danger';
  return 'neutral';
}

function syncTone(status: ImportedOrder['syncStatus']): Tone {
  if (status === 'NEW') return 'good';
  if (status === 'UPDATED') return 'blue';
  return 'neutral';
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`owner-command-pill owner-command-pill-${tone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: Tone }) {
  return <article className={`owner-command-metric owner-command-metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

function roleFromShell() {
  const roleText = document.querySelector<HTMLElement>('.sidebar-brand > div:not(.brand-logo-lockup) span')?.textContent?.toUpperCase() || '';
  if (roleText.includes('ACCOUNT')) return 'ACCOUNT';
  if (roleText.includes('ADMIN')) return 'ADMIN';
  if (roleText.includes('OWNER')) return 'OWNER';
  return 'OWNER';
}

function repairKnownInterfaceText(root: ParentNode = document.body) {
  if (!root || typeof document === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.matches('script, style, textarea')) {
      const current = node.nodeValue || '';
      if (current.includes('脳')) node.nodeValue = current.replace(/脳/g, '×');
    }
    node = walker.nextNode();
  }
}

function hideNativeDashboard(hero: HTMLElement) {
  hero.classList.add('owner-command-native-hide');
  let sibling = hero.nextElementSibling as HTMLElement | null;
  while (sibling && (sibling.classList.contains('quick-stats') || sibling.classList.contains('dashboard-grid'))) {
    sibling.classList.add('owner-command-native-hide');
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
}

function useDashboardHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [role, setRole] = useState('OWNER');
  useEffect(() => {
    function locate() {
      repairKnownInterfaceText();
      const hero = document.querySelector<HTMLElement>('.desktop-content > .hero-card');
      const existingMount = document.querySelector<HTMLElement>('.owner-command-center-mount');
      if (!hero) {
        if (existingMount) existingMount.remove();
        setHost(null);
        return;
      }
      setRole(roleFromShell());
      hideNativeDashboard(hero);
      let mount = existingMount;
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'owner-command-center-mount';
        hero.insertAdjacentElement('beforebegin', mount);
      }
      setHost(mount);
    }
    const stopObserving = observeBody(locate);
    return () => {
      stopObserving();
      document.querySelectorAll<HTMLElement>('.owner-command-native-hide').forEach((node) => node.classList.remove('owner-command-native-hide'));
      document.querySelector<HTMLElement>('.owner-command-center-mount')?.remove();
    };
  }, []);
  return { host, role };
}

function lineSummary(order: ImportedOrder) {
  const parts = order.lines.slice(0, 3).map((line) => {
    const baseUnit = line.unit === 'sleeve' ? 'sleeve' : 'carton';
    return `${line.sku} × ${line.qty} ${line.qty === 1 ? baseUnit : `${baseUnit}s`}`;
  });
  const remaining = Math.max(0, order.lines.length - 3);
  if (remaining) parts.push(`+${remaining} more line${remaining === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function queueBadges(order: ImportedOrder): QueueBadge[] {
  const raw: QueueBadge[] = [{ label: title(order.status), tone: orderStatusTone(order.status) }];
  if (order.syncStatus !== 'UNCHANGED') raw.push({ label: title(order.syncStatus), tone: syncTone(order.syncStatus) });
  if (order.releaseGateStatus && order.releaseGateStatus !== 'READY_TO_RELEASE') raw.push({ label: title(order.releaseGateStatus), tone: releaseTone(order.releaseGateStatus) });
  const seen = new Set<string>();
  return raw.filter((badge) => {
    const key = badge.label.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function OrderQueueRow({ order }: { order: ImportedOrder }) {
  const blocked = order.openExceptionCount > 0 || order.status === 'MAPPING_EXCEPTION';
  return <article className="owner-command-order-row">
    <div className={`owner-command-order-signal ${blocked ? 'is-blocked' : ''}`} aria-hidden="true">{blocked ? '!' : '✓'}</div>
    <div className="owner-command-order-main">
      <div className="owner-command-order-title"><strong>{order.orderNo}</strong><div className="owner-command-order-pills">{queueBadges(order).map((badge) => <Pill key={badge.label} tone={badge.tone}>{badge.label}</Pill>)}</div></div>
      <span>{order.store} · {order.suburb} · {order.priceTier}</span>
      <small className="owner-command-order-lines">{lineSummary(order) || 'Order lines are awaiting detail.'}</small>
      {order.releaseBlockers ? <small className="owner-command-order-blocker">{order.releaseBlockers}</small> : null}
    </div>
    <div className="owner-command-order-side"><strong>{money(order.amount)}</strong><span>{order.packageCount} label{order.packageCount === 1 ? '' : 's'}</span><small>Due {formatBusinessDate(order.deliveryDate || order.dueAt)}</small></div>
  </article>;
}

function openOrdersWorkspace() {
  Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button, .desktop-mobile-nav button')).find((button) => button.textContent?.trim() === 'Orders')?.click();
}

function AttentionRow({ row }: { row: OwnerCommandAttentionRow }) {
  return <article className="owner-command-attention-row"><div><strong>{row.title || 'Untitled attention item'}</strong><span>{row.detail || row.action_hint || 'Review required.'}</span></div><Pill tone={signalTone(row.signal)}>{row.area || 'Operations'} · {title(row.signal)}</Pill></article>;
}

function LoadingDashboard() {
  return <section className="owner-command-loading" aria-live="polite"><div className="owner-command-loading-mark" /><div><strong>Loading live operations</strong><span>EcoFlow is waiting for all required lifecycle sources before showing totals.</span></div></section>;
}

function degradedText(rows: OperationalSourceDiagnostic[]) {
  const degraded = rows.filter((row) => row.status === 'DEGRADED');
  return degraded.length ? `${degraded.length} supporting source${degraded.length === 1 ? '' : 's'} degraded: ${degraded.map((row) => row.source).join(', ')}` : '';
}

function CommandContent({ role }: { role: string }) {
  const [data, setData] = useState<EcoFlowDataSet | null>(null);
  const [kpis, setKpis] = useState<OwnerCommandKpis | null>(null);
  const [attention, setAttention] = useState<OwnerCommandAttentionRow[]>([]);
  const [error, setError] = useState('');
  const [healthNotice, setHealthNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    setHealthNotice('');
    try {
      const views = await loadSupabaseOrdermentumViews();
      if (!views) throw new Error('Supabase live views are not configured.');
      setData(applySupabaseOrdermentumViews(dashboardBase, views));
      setHealthNotice(degradedText(views.diagnostics));
      setLoadedAt(new Date().toISOString());
      const [kpiResult, attentionResult] = await Promise.allSettled([loadOwnerCommandKpis(), loadOwnerCommandAttention()]);
      setKpis(kpiResult.status === 'fulfilled' ? kpiResult.value : null);
      setAttention(attentionResult.status === 'fulfilled' ? attentionResult.value : []);
    } catch (reason) {
      setData(null);
      setError(operationalError(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const bucketCounts = getOrderBucketCounts(data.orders, data.businessDay.date);
    const count = (key: OrderBucketKey) => bucketCounts.find((item) => item.key === key)?.count ?? 0;
    const activeOrders = data.orders.filter((order) => !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(order.status)).length;
    const openArFallback = data.orders.filter((order) => order.paymentStatus !== 'PAID').reduce((sum, order) => sum + order.amount, 0);
    const sorted = sortOrdersForOperations(data.orders);
    const attentionOrders = sorted.filter((order) => order.syncStatus !== 'UNCHANGED' || order.openExceptionCount > 0);
    const queue = (attentionOrders.length ? attentionOrders : sorted.filter((order) => !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(order.status))).slice(0, 10);
    const latestOrderChange = data.orders.map((order) => order.lastSeenAt).filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
    const dataCheckCount = data.dataQuality.filter((item) => item.severity === 'warn' || item.severity === 'danger').length;
    return { bucketCounts, count, activeOrders, openAr: kpis?.open_ar_value ?? openArFallback, queue, latestOrderChange, dataCheckCount };
  }, [data, kpis]);

  if (loading && !data) return <LoadingDashboard />;
  if (!data || !view) return <section className="owner-command-unavailable" role="alert"><div><strong>Live dashboard unavailable</strong><span>{error || 'EcoFlow could not load a consistent live snapshot.'}</span></div><button type="button" onClick={() => void reload()}>Retry live data</button></section>;

  const subtitle = role === 'ACCOUNT'
    ? 'Accounts control across today’s Ordermentum changes, release blockers and receivables.'
    : 'One clear operating view across today’s orders, mapping pressure and customer risk.';

  return <section className="owner-command-shell">
    <section className="owner-command-hero">
      <div className="owner-command-hero-copy"><span>{role === 'ACCOUNT' ? 'ACCOUNTS CONTROL' : `${role} CONTROL`}</span><h1>Build the supply chain behind a cleaner food future.</h1><p>{subtitle}</p><small>{data.businessDay.label} · cutoff {data.businessDay.cutoffTime} · authenticated live workflow</small></div>
      <div className="owner-command-hero-metrics"><Metric label="New today" value={view.count('newToday')} helper="First seen today" tone="good" /><Metric label="Updated today" value={view.count('updatedToday')} helper="Changed today" tone="blue" /><Metric label="Active orders" value={view.activeOrders} helper={`${data.orders.length} current lifecycle records`} tone="warn" /><Metric label="Open AR" value={money(view.openAr)} helper="Outstanding balance" /></div>
    </section>

    <section className="owner-command-syncbar">
      <div className="owner-command-sync-summary"><span className={`owner-command-sync-dot ${data.syncBatch.status === 'SUCCESS' ? 'is-good' : 'is-warn'}`} /><div><strong>Sync control</strong><span>Last successful snapshot {formatDateTime(data.syncBatch.completedAt)}</span></div><Pill tone={data.syncBatch.status === 'SUCCESS' ? 'good' : 'warn'}>{data.syncBatch.status}</Pill></div>
      <div className="owner-command-sync-metrics"><div><strong>{data.syncBatch.fetched}</strong><span>Fetched</span></div><div><strong>{data.syncBatch.created}</strong><span>New</span></div><div><strong>{data.syncBatch.updated}</strong><span>Updated</span></div><div><strong>{data.syncBatch.unchanged}</strong><span>Unchanged</span></div><div className={view.dataCheckCount ? 'is-warning' : ''}><strong>{view.dataCheckCount}</strong><span>Active data checks</span></div></div>
      <div className="owner-command-sync-actions"><small>Latest order change {view.latestOrderChange ? formatDateTime(view.latestOrderChange) : '—'}<br />View refreshed {formatDateTime(loadedAt)}</small><button type="button" disabled={loading} onClick={() => void reload()}>{loading ? 'Refreshing…' : 'Refresh live data'}</button></div>
    </section>

    {healthNotice ? <div className="owner-command-error">System health notice: {healthNotice}. Core order totals remain live; review Settings for source details.</div> : null}
    {error ? <div className="owner-command-error">{error}</div> : null}

    <section className="owner-command-workspace">
      <section className="owner-command-panel owner-command-queue-panel"><header className="owner-command-panel-header"><div><h2>Daily control queue</h2><p>Actionable changes and blockers only. Unchanged records stay in Ordermentum Inbox history.</p></div><div className="owner-command-header-actions"><Pill tone={view.queue.length ? 'warn' : 'good'}>{view.queue.length} shown</Pill><button type="button" onClick={openOrdersWorkspace}>View all orders</button></div></header><div className="owner-command-order-list">{view.queue.map((order) => <OrderQueueRow key={order.id} order={order} />)}{!view.queue.length ? <div className="owner-command-empty">No orders need control-room attention.</div> : null}</div></section>
      <aside className="owner-command-rail">
        <section className="owner-command-panel owner-command-rail-card"><header className="owner-command-panel-header"><div><h3>Operational buckets</h3><p>{data.businessDay.label}</p></div></header><div className="owner-command-buckets">{view.bucketCounts.filter((bucket) => ['exceptions', 'newToday', 'updatedToday', 'dueToday', 'carryOver'].includes(bucket.key)).map((bucket) => <article key={bucket.key}><strong>{bucket.count}</strong><span>{bucket.label}</span></article>)}</div></section>
        <section className="owner-command-panel owner-command-rail-card"><header className="owner-command-panel-header"><div><h3>Business pulse</h3><p>Best available live owner signals.</p></div></header><div className="owner-command-pulse-list"><article><strong>{kpis?.top_sku_30d || '—'}</strong><span>Top SKU · {kpis?.top_product_30d || 'No product detail'}</span></article><article><strong>{kpis?.top_store_30d || '—'}</strong><span>Top store · {money(kpis?.top_store_revenue_30d)}</span></article><article><strong>{num(kpis?.barcode_attention_lines)}</strong><span>Barcode attention lines</span></article><article><strong>{num(kpis?.reorder_pressure_rows)}</strong><span>Reorder pressure rows</span></article></div></section>
        <section className="owner-command-panel owner-command-rail-card"><header className="owner-command-panel-header"><div><h3>Priority attention</h3><p>Highest-value actions across the platform.</p></div></header><div className="owner-command-attention-list">{attention.slice(0, 5).map((row, index) => <AttentionRow key={`${row.area}-${row.reference_id}-${index}`} row={row} />)}{!attention.length ? <div className="owner-command-empty">No additional command-centre alerts.</div> : null}</div></section>
      </aside>
    </section>
  </section>;
}

export function OwnerCommandCenter() {
  const { host, role } = useDashboardHost();
  return host ? createPortal(<CommandContent role={role} />, host) : null;
}
