import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import { loadOrderOperationsSummary, type OrderOperationsSummary } from '@/data/repositories/orderOperations';
import { loadBarcodeSprintKpis, loadInventoryKpis, type BarcodeSprintKpis, type InventoryKpis } from '@/data/repositories/inventoryControl';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import { loadOrdermentumMirrorHealth, type OrdermentumMirrorHealthRow } from '@/features/team/ordermentumSync';
import { supabase } from '@/lib/supabaseClient';
import './fieldReadinessDashboard.css';

type Props = {
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
type Tone = 'good' | 'warn' | 'danger' | 'neutral';
type Stage = 'blocked' | 'review' | 'ready' | 'warehouse' | 'route';
type Action = { id: string; title: string; detail: string; count: number; tone: Tone; next: string };

const CLOSED = new Set(['DELIVERED', 'CLOSED', 'CANCELLED']);
const WAREHOUSE = new Set(['RELEASED', 'PICKING', 'PACKED', 'STAGED']);
const LIMIT = 10;

function n(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function money(value: number) { return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }); }
function dateTime(value?: string | null) {
  if (!value) return 'Not verified yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function openSection(label: string) {
  Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button, .desktop-mobile-nav button'))
    .find((button) => button.textContent?.trim() === label)?.click();
}
function openWorkItem(detail: { id: string; title: string; subtitle: string; kind: string; fields: Array<{ label: string; value: string }> }) {
  window.dispatchEvent(new CustomEvent('ecoflow:open-work-item', { detail }));
}
function isOpen(order: ImportedOrder) { return !CLOSED.has(order.status); }
function stageOf(order: ImportedOrder): Stage {
  if (order.status === 'OUT_FOR_DELIVERY') return 'route';
  if (WAREHOUSE.has(order.status)) return 'warehouse';
  if (order.releaseGateStatus === 'READY_TO_RELEASE') return 'ready';
  if (order.releaseGateStatus === 'REVIEW_PAYMENT') return 'review';
  return 'blocked';
}
function stageLabel(stage: Stage) {
  return stage === 'review' ? 'FINANCE REVIEW' : stage === 'ready' ? 'READY' : stage === 'warehouse' ? 'IN WAREHOUSE' : stage === 'route' ? 'ON ROUTE' : 'NEEDS ACTION';
}
function stageTone(stage: Stage): Tone { return stage === 'blocked' ? 'danger' : stage === 'review' ? 'warn' : stage === 'ready' ? 'good' : 'neutral'; }
function gateLabel(order: ImportedOrder) { return (order.releaseGateStatus || order.status).replace(/_/g, ' '); }

export function DashboardPage({ role, data, orders, snapshotReady, loading, loadError, healthNotice, onReload, onOpenOrders }: Props) {
  const [operations, setOperations] = useState<OrderOperationsSummary | null>(null);
  const [mirror, setMirror] = useState<OrdermentumMirrorHealthRow | null>(null);
  const [inventory, setInventory] = useState<InventoryKpis | null>(null);
  const [barcode, setBarcode] = useState<BarcodeSprintKpis | null>(null);
  const [locations, setLocations] = useState<WarehouseLocationItemRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusNotice, setStatusNotice] = useState('');

  const reloadReadiness = useCallback(async () => {
    setStatusLoading(true); setStatusNotice('');
    const checks = await Promise.allSettled([
      loadOrderOperationsSummary(),
      supabase ? loadOrdermentumMirrorHealth(supabase) : Promise.resolve({ mirrorHealth: null, mirrorError: 'Supabase is unavailable.' }),
      loadInventoryKpis(), loadBarcodeSprintKpis(), loadWarehouseLocationItems(),
    ]);
    const [operationResult, mirrorResult, inventoryResult, barcodeResult, locationResult] = checks;
    if (operationResult.status === 'fulfilled') setOperations(operationResult.value);
    if (mirrorResult.status === 'fulfilled') { setMirror(mirrorResult.value.mirrorHealth); if (mirrorResult.value.mirrorError) setStatusNotice(mirrorResult.value.mirrorError); }
    if (inventoryResult.status === 'fulfilled') setInventory(inventoryResult.value);
    if (barcodeResult.status === 'fulfilled') setBarcode(barcodeResult.value);
    if (locationResult.status === 'fulfilled') setLocations(locationResult.value);
    const unavailable = [
      operationResult.status === 'rejected' ? 'server order summary' : '',
      mirrorResult.status === 'rejected' ? 'source verification' : '',
      inventoryResult.status === 'rejected' ? 'inventory summary' : '',
      barcodeResult.status === 'rejected' ? 'barcode coverage count' : '',
      locationResult.status === 'rejected' ? 'warehouse location summary' : '',
    ].filter(Boolean);
    if (unavailable.length) setStatusNotice(`Summary unavailable: ${unavailable.join(', ')}. Operational records remain unchanged.`);
    setStatusLoading(false);
  }, []);

  useEffect(() => { if (snapshotReady) void reloadReadiness(); }, [reloadReadiness, snapshotReady, data.syncBatch.completedAt]);

  const locationCount = useMemo(() => new Set(locations.map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const liveLocationCount = useMemo(() => new Set(locations.filter((row) => row.item_id && n(row.quantity) > 0).map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const firstStocktakeNeeded = n(inventory?.live_on_hand_units) <= 0 && liveLocationCount === 0;
  const openOrders = useMemo(() => orders.filter(isOpen), [orders]);
  const serverCurrentOrders = operations ? n(operations.current_orders) + n(operations.source_review_orders) : orders.length;
  const groups = useMemo(() => {
    const value: Record<Stage, ImportedOrder[]> = { blocked: [], review: [], ready: [], warehouse: [], route: [] };
    openOrders.forEach((order) => value[stageOf(order)].push(order));
    return value;
  }, [openOrders]);
  const delivered = orders.filter((order) => order.status === 'DELIVERED' || order.status === 'CLOSED');
  const podMissing = delivered.filter((order) => order.podStatus === 'missing');
  const decisionCount = groups.blocked.length + groups.review.length;
  const executionCount = groups.warehouse.length + groups.route.length;
  const mirrorStatus = mirror?.overall_status || (snapshotReady ? 'CHECKING' : 'UNAVAILABLE');
  const priority: Record<Stage, number> = { blocked: 5, review: 4, ready: 3, warehouse: 2, route: 1 };
  const activeOrders = useMemo(() => [...openOrders].sort((left, right) => {
    const score = (order: ImportedOrder) => priority[stageOf(order)] * 100 + order.openExceptionCount * 10;
    return score(right) - score(left) || new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
  }).slice(0, LIMIT), [openOrders]);

  const actions: Action[] = role === 'account' ? [
    { id: 'finance', title: 'Finance review', detail: 'Payment status, credit hold or overdue decision.', count: groups.review.length, tone: groups.review.length ? 'warn' : 'good', next: 'Open Reconciliation' },
    { id: 'blocked', title: 'Commercial or data blockers', detail: 'Mapping, source or stock control requires action.', count: groups.blocked.length, tone: groups.blocked.length ? 'danger' : 'good', next: 'Open Orders' },
    { id: 'pod', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
    { id: 'ready', title: 'Ready for execution', detail: 'Orders that passed current release controls.', count: groups.ready.length, tone: groups.ready.length ? 'good' : 'neutral', next: 'Open Orders' },
  ] : [
    { id: 'blocked', title: 'Orders needing action', detail: 'Mapping, data, source or stock controls are blocking progress.', count: groups.blocked.length, tone: groups.blocked.length ? 'danger' : 'good', next: 'Open Orders' },
    { id: 'finance', title: 'Finance review', detail: 'Office decision required before release.', count: groups.review.length, tone: groups.review.length ? 'warn' : 'good', next: 'Open Reconciliation' },
    { id: 'pod', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
    { id: 'ready', title: 'Ready to release', detail: 'Current controls passed; waiting for execution.', count: groups.ready.length, tone: groups.ready.length ? 'good' : 'neutral', next: 'Open Orders' },
  ];

  const roleName = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : role === 'account' ? 'Accounts' : 'Viewer';
  const deskTitle = role === 'account' ? 'Finance and fulfilment desk' : role === 'viewer' ? 'Live operating picture' : 'Operations control desk';
  const stages: Array<{ key: Stage; label: string; count: number; section: string }> = [
    { key: 'blocked', label: 'Needs action', count: groups.blocked.length, section: 'Orders' },
    { key: 'review', label: 'Finance review', count: groups.review.length, section: role === 'account' ? 'Reconciliation' : 'Orders' },
    { key: 'ready', label: 'Ready', count: groups.ready.length, section: 'Orders' },
    { key: 'warehouse', label: 'In warehouse', count: groups.warehouse.length, section: 'Delivery' },
    { key: 'route', label: 'On route', count: groups.route.length, section: 'Delivery' },
  ];

  if (loading && !snapshotReady) return <section className="field-readiness-loading">Loading live operations…</section>;
  if (!snapshotReady) return <section className="field-readiness-unavailable" role="alert"><div><strong>Live operating data is unavailable</strong><span>{loadError || 'EcoFlow will not show sample figures.'}</span></div><button type="button" onClick={() => void onReload()} disabled={loading}>{loading ? 'Retrying…' : 'Retry live data'}</button></section>;

  return (
    <section className="ops-home" data-server-current={serverCurrentOrders}>
      <header className="ops-home-header"><div className="ops-home-heading"><span>{roleName.toUpperCase()} · {data.businessDay.label.toUpperCase()} · SOURCE {mirrorStatus}</span><h1>{deskTitle}</h1></div><div className="ops-home-actions"><button type="button" className="primary" onClick={onOpenOrders}>Review orders</button>{(role === 'owner' || role === 'admin') && firstStocktakeNeeded ? <a href="/?workspace=warehouse&mode=stocktake">Start first stocktake</a> : null}{role === 'owner' || role === 'admin' ? <a href="/warehouse-map">Warehouse map</a> : null}{role === 'account' ? <button type="button" onClick={() => openSection('Reconciliation')}>Reconciliation</button> : null}<button type="button" onClick={() => void Promise.all([onReload(), reloadReadiness()])} disabled={loading || statusLoading}>{loading || statusLoading ? 'Refreshing…' : 'Refresh'}</button></div></header>
      {loadError ? <div className="field-readiness-warning">Last loaded records retained · {loadError}</div> : null}
      {healthNotice || statusNotice ? <div className="field-readiness-note">{healthNotice || statusNotice}</div> : null}

      <section className="ops-metrics" aria-label="Current operating summary">
        <article className="ops-metric"><span>Open orders</span><strong>{openOrders.length}</strong><small>five exclusive stages</small></article>
        <article className="ops-metric"><span>Needs decision</span><strong>{decisionCount}</strong><small>{groups.blocked.length} operational · {groups.review.length} finance</small></article>
        <article className="ops-metric"><span>Ready</span><strong>{groups.ready.length}</strong><small>release controls passed</small></article>
        <article className="ops-metric"><span>In execution</span><strong>{executionCount}</strong><small>{groups.warehouse.length} warehouse · {groups.route.length} route</small></article>
        <article className="ops-metric"><span>Live stock locations</span><strong>{liveLocationCount}</strong><small>{locationCount} mapped locations</small></article>
        <article className="ops-metric"><span>Delivered retained</span><strong>{delivered.length}</strong><small>{podMissing.length} missing POD</small></article>
      </section>

      <section className="ops-home-grid">
        <section className="ops-home-panel"><header><h2>Needs attention</h2><b className="ops-panel-total">{decisionCount + podMissing.length}</b></header><div className="ops-action-list">{actions.map((item) => <button key={item.id} type="button" className={`ops-action-row ${item.tone}`} onClick={() => openWorkItem({ id: `queue-${item.id}`, title: item.title, subtitle: item.detail, kind: 'Action queue', fields: [{ label: 'Open items', value: String(item.count) }, { label: 'Role view', value: roleName }, { label: 'Next action', value: item.next }] })}><i /><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>{item.count}</b></button>)}</div></section>
        <section className="ops-home-panel ops-stage-panel"><header><h2>Open order stages</h2><b className="ops-panel-total">{openOrders.length}</b></header><div className="ops-flow ops-flow-exclusive">{stages.map((stage) => <button key={stage.key} type="button" onClick={() => openSection(stage.section)}><strong>{stage.count}</strong><span>{stage.label}</span></button>)}</div></section>
      </section>

      <section className="ops-home-panel"><header><h2>Priority work</h2><div className="ops-panel-actions"><span>Top {activeOrders.length} of {openOrders.length} open orders</span><button type="button" onClick={onOpenOrders}>View all</button></div></header><div className="ops-order-table"><div className="ops-order-row head"><span>Order</span><span>Store</span><span>Stage</span><span>Value</span><span>POD</span></div>{activeOrders.map((order) => { const stage = stageOf(order); return <div className="ops-order-row" key={order.id} onClick={() => openWorkItem({ id: `order-${order.id}`, title: order.orderNo, subtitle: `${order.store} · ${order.suburb}`, kind: 'Order', fields: [{ label: 'Order', value: order.orderNo }, { label: 'Invoice', value: order.invoiceNo || '—' }, { label: 'Store', value: order.store }, { label: 'Account', value: order.account }, { label: 'Payment', value: order.paymentStatus }, { label: 'Value', value: money(order.amount) }, { label: 'Pipeline stage', value: stageLabel(stage) }, { label: 'Release gate', value: gateLabel(order) }, { label: 'Blockers', value: order.releaseBlockers || order.changeSummary || 'None reported' }, { label: 'POD', value: order.podStatus }] })}><span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span><span><strong>{order.store}</strong><small>{order.suburb} · {order.priceTier}</small></span><span><b className={`ops-chip ${stageTone(stage)}`}>{stageLabel(stage)}</b><small>{order.releaseBlockers || order.changeSummary}</small></span><span>{money(order.amount)}</span><span><b className={`ops-chip ${order.podStatus === 'captured' ? 'good' : 'warn'}`}>{order.podStatus}</b></span></div>; })}{!activeOrders.length ? <div className="empty-state">No open orders.</div> : null}</div></section>
      <div className="ops-home-status-line">{openOrders.length === serverCurrentOrders ? `${serverCurrentOrders} server-current orders classified` : `${openOrders.length} loaded open · ${serverCurrentOrders} server current`} · {n(barcode?.registered_barcodes)} package codes · {n(inventory?.live_on_hand_units)} live units · source checked {dateTime(mirror?.checked_at)}</div>
    </section>
  );
}
