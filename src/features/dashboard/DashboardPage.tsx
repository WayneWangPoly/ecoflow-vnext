import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import { loadOrderOperationsSummary } from '@/data/repositories/orderOperations';
import {
  loadBarcodeSprintKpis,
  loadInventoryKpis,
  type BarcodeSprintKpis,
  type InventoryKpis,
} from '@/data/repositories/inventoryControl';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import {
  loadOrdermentumMirrorHealth,
  type OrdermentumMirrorHealthRow,
} from '@/features/team/ordermentumSync';
import { supabase } from '@/lib/supabaseClient';
import './fieldReadinessDashboard.css';

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

type ActionTone = 'good' | 'warn' | 'danger' | 'neutral';
type PipelineStage = 'blocked' | 'review' | 'ready' | 'warehouse' | 'route';
type ActionItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  tone: ActionTone;
  next: string;
};

const WAREHOUSE_STATUSES = new Set(['RELEASED', 'PICKING', 'PACKED', 'STAGED']);
const CLOSED_STATUSES = new Set(['DELIVERED', 'CLOSED', 'CANCELLED']);
const ACTIVE_WORK_LIMIT = 10;

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

function dateTime(value?: string | null) {
  if (!value) return 'Not verified yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function openSection(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button, .desktop-mobile-nav button'))
    .find((candidate) => candidate.textContent?.trim() === label);
  button?.click();
}

function openWorkItem(item: { id: string; title: string; subtitle: string; kind: string; fields: Array<{ label: string; value: string }> }) {
  window.dispatchEvent(new CustomEvent('ecoflow:open-work-item', { detail: item }));
}

function isOpenOrder(order: ImportedOrder) {
  return !CLOSED_STATUSES.has(order.status);
}

function pipelineStage(order: ImportedOrder): PipelineStage {
  if (order.status === 'OUT_FOR_DELIVERY') return 'route';
  if (WAREHOUSE_STATUSES.has(order.status)) return 'warehouse';
  if (order.releaseGateStatus === 'READY_TO_RELEASE') return 'ready';
  if (order.releaseGateStatus === 'REVIEW_PAYMENT') return 'review';
  return 'blocked';
}

function stageLabel(stage: PipelineStage) {
  if (stage === 'review') return 'FINANCE REVIEW';
  if (stage === 'ready') return 'READY';
  if (stage === 'warehouse') return 'IN WAREHOUSE';
  if (stage === 'route') return 'ON ROUTE';
  return 'NEEDS ACTION';
}

function stageTone(stage: PipelineStage): ActionTone {
  if (stage === 'blocked') return 'danger';
  if (stage === 'review') return 'warn';
  if (stage === 'ready') return 'good';
  return 'neutral';
}

function gateLabel(order: ImportedOrder) {
  return (order.releaseGateStatus || order.status).replace(/_/g, ' ');
}

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
  const [mirror, setMirror] = useState<OrdermentumMirrorHealthRow | null>(null);
  const [inventory, setInventory] = useState<InventoryKpis | null>(null);
  const [barcode, setBarcode] = useState<BarcodeSprintKpis | null>(null);
  const [locations, setLocations] = useState<WarehouseLocationItemRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusNotice, setStatusNotice] = useState('');

  const reloadReadiness = useCallback(async () => {
    setStatusLoading(true);
    setStatusNotice('');
    const checks = await Promise.allSettled([
      loadOrderOperationsSummary(),
      supabase ? loadOrdermentumMirrorHealth(supabase) : Promise.resolve({ mirrorHealth: null, mirrorError: 'Supabase is unavailable.' }),
      loadInventoryKpis(),
      loadBarcodeSprintKpis(),
      loadWarehouseLocationItems(),
    ]);

    const [operationsResult, mirrorResult, inventoryResult, barcodeResult, locationsResult] = checks;
    if (mirrorResult.status === 'fulfilled') {
      setMirror(mirrorResult.value.mirrorHealth);
      if (mirrorResult.value.mirrorError) setStatusNotice(mirrorResult.value.mirrorError);
    }
    if (inventoryResult.status === 'fulfilled') setInventory(inventoryResult.value);
    if (barcodeResult.status === 'fulfilled') setBarcode(barcodeResult.value);
    if (locationsResult.status === 'fulfilled') setLocations(locationsResult.value);

    const unavailable = [
      operationsResult.status === 'rejected' ? 'server order summary' : '',
      mirrorResult.status === 'rejected' ? 'source verification' : '',
      inventoryResult.status === 'rejected' ? 'inventory summary' : '',
      barcodeResult.status === 'rejected' ? 'barcode coverage count' : '',
      locationsResult.status === 'rejected' ? 'warehouse location summary' : '',
    ].filter(Boolean);
    if (unavailable.length) {
      setStatusNotice(`Summary unavailable: ${unavailable.join(', ')}. Operational records remain unchanged.`);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    if (!snapshotReady) return;
    void reloadReadiness();
  }, [reloadReadiness, snapshotReady, data.syncBatch.completedAt]);

  const locationCount = useMemo(() => new Set(locations.map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const liveLocationCount = useMemo(() => new Set(locations
    .filter((row) => row.item_id && n(row.quantity) > 0)
    .map((row) => row.location_code)
    .filter(Boolean)).size, [locations]);
  const firstStocktakeNeeded = n(inventory?.live_on_hand_units) <= 0 && liveLocationCount === 0;

  const openOrders = useMemo(() => orders.filter(isOpenOrder), [orders]);
  const stageGroups = useMemo(() => {
    const groups: Record<PipelineStage, ImportedOrder[]> = {
      blocked: [],
      review: [],
      ready: [],
      warehouse: [],
      route: [],
    };
    openOrders.forEach((order) => groups[pipelineStage(order)].push(order));
    return groups;
  }, [openOrders]);

  const deliveredRetained = orders.filter((order) => order.status === 'DELIVERED' || order.status === 'CLOSED');
  const podMissing = deliveredRetained.filter((order) => order.podStatus === 'missing');
  const decisionCount = stageGroups.blocked.length + stageGroups.review.length;
  const executionCount = stageGroups.warehouse.length + stageGroups.route.length;
  const mirrorStatus = mirror?.overall_status || (snapshotReady ? 'CHECKING' : 'UNAVAILABLE');

  const activeOrders = useMemo(() => [...openOrders]
    .sort((left, right) => {
      const leftStage = pipelineStage(left);
      const rightStage = pipelineStage(right);
      const priority: Record<PipelineStage, number> = { blocked: 5, review: 4, ready: 3, warehouse: 2, route: 1 };
      const leftScore = priority[leftStage] * 100 + left.openExceptionCount * 10;
      const rightScore = priority[rightStage] * 100 + right.openExceptionCount * 10;
      return rightScore - leftScore || new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
    })
    .slice(0, ACTIVE_WORK_LIMIT), [openOrders]);

  const actionItems: ActionItem[] = role === 'account'
    ? [
        { id: 'payment-review', title: 'Finance review', detail: 'Payment status, credit hold or overdue decision.', count: stageGroups.review.length, tone: stageGroups.review.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'blocked-orders', title: 'Commercial or data blockers', detail: 'Mapping, source or stock control requires action.', count: stageGroups.blocked.length, tone: stageGroups.blocked.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'pod-missing', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready-release', title: 'Ready for execution', detail: 'Orders that passed current release controls.', count: stageGroups.ready.length, tone: stageGroups.ready.length ? 'good' : 'neutral', next: 'Open Orders' },
      ]
    : [
        { id: 'blocked-orders', title: 'Orders needing action', detail: 'Mapping, data, source or stock controls are blocking progress.', count: stageGroups.blocked.length, tone: stageGroups.blocked.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'payment-review', title: 'Finance review', detail: 'Office decision required before release.', count: stageGroups.review.length, tone: stageGroups.review.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'pod-missing', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready-release', title: 'Ready to release', detail: 'Current controls passed; waiting for the next execution step.', count: stageGroups.ready.length, tone: stageGroups.ready.length ? 'good' : 'neutral', next: 'Open Orders' },
      ];

  const roleName = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : role === 'account' ? 'Accounts' : 'Viewer';
  const deskTitle = role === 'account' ? 'Finance and fulfilment desk' : role === 'viewer' ? 'Live operating picture' : 'Operations control desk';

  if (loading && !snapshotReady) return <section className="field-readiness-loading">Loading live operations…</section>;

  if (!snapshotReady) {
    return <section className="field-readiness-unavailable" role="alert"><div><strong>Live operating data is unavailable</strong><span>{loadError || 'EcoFlow will not show sample figures.'}</span></div><button type="button" onClick={() => void onReload()} disabled={loading}>{loading ? 'Retrying…' : 'Retry live data'}</button></section>;
  }

  const stages: Array<{ key: PipelineStage; label: string; count: number; section: string }> = [
    { key: 'blocked', label: 'Needs action', count: stageGroups.blocked.length, section: 'Orders' },
    { key: 'review', label: 'Finance review', count: stageGroups.review.length, section: role === 'account' ? 'Reconciliation' : 'Orders' },
    { key: 'ready', label: 'Ready', count: stageGroups.ready.length, section: 'Orders' },
    { key: 'warehouse', label: 'In warehouse', count: stageGroups.warehouse.length, section: 'Delivery' },
    { key: 'route', label: 'On route', count: stageGroups.route.length, section: 'Delivery' },
  ];

  return (
    <section className="ops-home">
      <header className="ops-home-header">
        <div className="ops-home-heading">
          <span>{roleName.toUpperCase()} · {data.businessDay.label.toUpperCase()} · SOURCE {mirrorStatus}</span>
          <h1>{deskTitle}</h1>
        </div>
        <div className="ops-home-actions">
          <button type="button" className="primary" onClick={onOpenOrders}>Review orders</button>
          {(role === 'owner' || role === 'admin') && firstStocktakeNeeded ? <a href="/?workspace=warehouse&mode=stocktake">Start first stocktake</a> : null}
          {role === 'owner' || role === 'admin' ? <a href="/warehouse-map">Warehouse map</a> : null}
          {role === 'account' ? <button type="button" onClick={() => openSection('Reconciliation')}>Reconciliation</button> : null}
          <button type="button" onClick={() => void Promise.all([onReload(), reloadReadiness()])} disabled={loading || statusLoading}>{loading || statusLoading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {loadError ? <div className="field-readiness-warning">Last loaded records retained · {loadError}</div> : null}
      {healthNotice || statusNotice ? <div className="field-readiness-note">{healthNotice || statusNotice}</div> : null}

      <section className="ops-metrics" aria-label="Current operating summary">
        <article className="ops-metric"><span>Open orders</span><strong>{openOrders.length}</strong><small>sum of the five stages below</small></article>
        <article className="ops-metric"><span>Needs decision</span><strong>{decisionCount}</strong><small>{stageGroups.blocked.length} operational · {stageGroups.review.length} finance</small></article>
        <article className="ops-metric"><span>Ready</span><strong>{stageGroups.ready.length}</strong><small>release controls passed</small></article>
        <article className="ops-metric"><span>In execution</span><strong>{executionCount}</strong><small>{stageGroups.warehouse.length} warehouse · {stageGroups.route.length} route</small></article>
        <article className="ops-metric"><span>Live stock locations</span><strong>{liveLocationCount}</strong><small>{locationCount} mapped locations</small></article>
        <article className="ops-metric"><span>Delivered retained</span><strong>{deliveredRetained.length}</strong><small>{podMissing.length} missing POD</small></article>
      </section>

      <section className="ops-home-grid">
        <section className="ops-home-panel">
          <header><h2>Needs attention</h2><b className="ops-panel-total">{decisionCount + podMissing.length}</b></header>
          <div className="ops-action-list">
            {actionItems.map((item) => (
              <button key={item.id} type="button" className={`ops-action-row ${item.tone}`} onClick={() => openWorkItem({
                id: `queue-${item.id}`,
                title: item.title,
                subtitle: item.detail,
                kind: 'Action queue',
                fields: [
                  { label: 'Open items', value: String(item.count) },
                  { label: 'Role view', value: roleName },
                  { label: 'Next action', value: item.next },
                ],
              })}>
                <i /><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>{item.count}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="ops-home-panel ops-stage-panel">
          <header><h2>Open order stages</h2><b className="ops-panel-total">{openOrders.length}</b></header>
          <div className="ops-flow ops-flow-exclusive">
            {stages.map((stage) => (
              <button key={stage.key} type="button" onClick={() => openSection(stage.section)}>
                <strong>{stage.count}</strong><span>{stage.label}</span>
              </button>
            ))}
          </div>
        </section>
      </section>

      <section className="ops-home-panel">
        <header>
          <h2>Priority work</h2>
          <div className="ops-panel-actions"><span>Top {activeOrders.length} of {openOrders.length} open orders</span><button type="button" onClick={onOpenOrders}>View all</button></div>
        </header>
        <div className="ops-order-table">
          <div className="ops-order-row head"><span>Order</span><span>Store</span><span>Stage</span><span>Value</span><span>POD</span></div>
          {activeOrders.map((order) => {
            const stage = pipelineStage(order);
            return (
              <div className="ops-order-row" key={order.id} onClick={() => openWorkItem({
                id: `order-${order.id}`,
                title: order.orderNo,
                subtitle: `${order.store} · ${order.suburb}`,
                kind: 'Order',
                fields: [
                  { label: 'Order', value: order.orderNo },
                  { label: 'Invoice', value: order.invoiceNo || '—' },
                  { label: 'Store', value: order.store },
                  { label: 'Account', value: order.account },
                  { label: 'Payment', value: order.paymentStatus },
                  { label: 'Value', value: money(order.amount) },
                  { label: 'Pipeline stage', value: stageLabel(stage) },
                  { label: 'Release gate', value: gateLabel(order) },
                  { label: 'Blockers', value: order.releaseBlockers || order.changeSummary || 'None reported' },
                  { label: 'POD', value: order.podStatus },
                ],
              })}>
                <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
                <span><strong>{order.store}</strong><small>{order.suburb} · {order.priceTier}</small></span>
                <span><b className={`ops-chip ${stageTone(stage)}`}>{stageLabel(stage)}</b><small>{order.releaseBlockers || order.changeSummary}</small></span>
                <span>{money(order.amount)}</span>
                <span><b className={`ops-chip ${order.podStatus === 'captured' ? 'good' : 'warn'}`}>{order.podStatus}</b></span>
              </div>
            );
          })}
          {!activeOrders.length ? <div className="empty-state">No open orders.</div> : null}
        </div>
      </section>

      <div className="ops-home-status-line">{n(barcode?.registered_barcodes)} package codes · {n(inventory?.live_on_hand_units)} live units · source checked {dateTime(mirror?.checked_at)}</div>
    </section>
  );
}
