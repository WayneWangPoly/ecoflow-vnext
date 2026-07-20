import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import {
  loadOrderOperationsSummary,
  type OrderOperationsSummary,
} from '@/data/repositories/orderOperations';
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
type ActionItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  tone: ActionTone;
  next: string;
};

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

function gateTone(order: ImportedOrder): ActionTone {
  if (order.openExceptionCount || order.releaseGateStatus?.startsWith('BLOCKED')) return 'danger';
  if (order.releaseGateStatus === 'REVIEW_PAYMENT') return 'warn';
  if (order.releaseGateStatus === 'READY_TO_RELEASE') return 'good';
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
  const [operations, setOperations] = useState<OrderOperationsSummary | null>(null);
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
    if (operationsResult.status === 'fulfilled') setOperations(operationsResult.value);
    if (mirrorResult.status === 'fulfilled') {
      setMirror(mirrorResult.value.mirrorHealth);
      if (mirrorResult.value.mirrorError) setStatusNotice(mirrorResult.value.mirrorError);
    }
    if (inventoryResult.status === 'fulfilled') setInventory(inventoryResult.value);
    if (barcodeResult.status === 'fulfilled') setBarcode(barcodeResult.value);
    if (locationsResult.status === 'fulfilled') setLocations(locationsResult.value);

    const unavailable = [
      operationsResult.status === 'rejected' ? 'orders' : '',
      mirrorResult.status === 'rejected' ? 'source verification' : '',
      inventoryResult.status === 'rejected' ? 'inventory' : '',
      barcodeResult.status === 'rejected' ? 'barcode coverage' : '',
      locationsResult.status === 'rejected' ? 'warehouse locations' : '',
    ].filter(Boolean);
    if (unavailable.length) setStatusNotice(`Some checks are unavailable: ${unavailable.join(', ')}.`);
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    if (!snapshotReady) return;
    void reloadReadiness();
  }, [reloadReadiness, snapshotReady, data.syncBatch.completedAt]);

  const locationCount = useMemo(() => new Set(locations.map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const liveLocationCount = useMemo(() => new Set(locations.filter((row) => row.item_id && n(row.quantity) > 0).map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const firstStocktakeNeeded = n(inventory?.live_on_hand_units) <= 0 && liveLocationCount === 0;
  const currentOrders = operations ? n(operations.current_orders) + n(operations.source_review_orders) : orders.length;
  const ready = orders.filter((order) => order.releaseGateStatus === 'READY_TO_RELEASE');
  const paymentReview = orders.filter((order) => order.releaseGateStatus === 'REVIEW_PAYMENT' || order.paymentStatus === 'CREDIT_HOLD' || order.paymentStatus === 'OVERDUE');
  const mappingBlocked = orders.filter((order) => order.releaseGateStatus === 'BLOCKED_MAPPING' || n(order.unmappedLineCount) > 0);
  const stockBlocked = orders.filter((order) => order.releaseGateStatus === 'BLOCKED_STOCK' || n(order.stockShortageCount) > 0);
  const podMissing = orders.filter((order) => ['DELIVERED', 'CLOSED'].includes(order.status) && order.podStatus === 'missing');
  const inFulfilment = orders.filter((order) => ['RELEASED', 'PICKING', 'PACKED', 'STAGED', 'OUT_FOR_DELIVERY'].includes(order.status));
  const onRoute = orders.filter((order) => order.status === 'OUT_FOR_DELIVERY');
  const delivered = orders.filter((order) => ['DELIVERED', 'CLOSED'].includes(order.status));
  const openAr = orders.filter((order) => order.paymentStatus !== 'PAID').reduce((sum, order) => sum + order.amount, 0);
  const mirrorStatus = mirror?.overall_status || (snapshotReady ? 'CHECKING' : 'UNAVAILABLE');
  const activeOrders = useMemo(() => [...orders]
    .filter((order) => !['CANCELLED', 'CLOSED'].includes(order.status))
    .sort((left, right) => {
      const leftPriority = left.openExceptionCount * 10 + (left.releaseGateStatus?.startsWith('BLOCKED') ? 5 : 0) + (left.releaseGateStatus === 'REVIEW_PAYMENT' ? 3 : 0);
      const rightPriority = right.openExceptionCount * 10 + (right.releaseGateStatus?.startsWith('BLOCKED') ? 5 : 0) + (right.releaseGateStatus === 'REVIEW_PAYMENT' ? 3 : 0);
      return rightPriority - leftPriority || new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
    }).slice(0, 10), [orders]);

  const actionItems: ActionItem[] = role === 'account'
    ? [
        { id: 'payment-review', title: 'Payment and account review', detail: 'Orders waiting on payment status, credit hold or overdue action.', count: paymentReview.length, tone: paymentReview.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'pod-missing', title: 'Delivered without complete POD', detail: 'Proof is required before clean reconciliation and statement follow-up.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'mapping-review', title: 'Commercial mapping exceptions', detail: 'SKU or customer facts need review before release.', count: mappingBlocked.length, tone: mappingBlocked.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'ready-release', title: 'Commercially ready orders', detail: 'Verified orders that can move into operational execution.', count: ready.length, tone: ready.length ? 'good' : 'neutral', next: 'Open Orders' },
      ]
    : [
        { id: 'blocked-orders', title: 'Blocked orders need action', detail: 'Mapping, source or stock controls are stopping execution.', count: new Set([...mappingBlocked, ...stockBlocked]).size, tone: mappingBlocked.length || stockBlocked.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'payment-review', title: 'Finance review before release', detail: 'Payment or account status needs office decision.', count: paymentReview.length, tone: paymentReview.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'pod-missing', title: 'Delivery proof incomplete', detail: 'Delivered orders still missing required POD evidence.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready-release', title: 'Ready to release', detail: 'All current controls passed and the order can progress.', count: ready.length, tone: ready.length ? 'good' : 'neutral', next: 'Open Orders' },
      ];

  const roleName = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : role === 'account' ? 'Accounts' : 'Viewer';
  const deskTitle = role === 'account' ? 'Finance and fulfilment desk' : role === 'viewer' ? 'Live operating picture' : 'Operations control desk';

  if (loading && !snapshotReady) return <section className="field-readiness-loading">Loading the trusted operating snapshot…</section>;

  if (!snapshotReady) {
    return <section className="field-readiness-unavailable" role="alert"><div><strong>Live operating data is unavailable</strong><span>{loadError || 'EcoFlow will not show sample figures.'}</span></div><button type="button" onClick={() => void onReload()} disabled={loading}>{loading ? 'Retrying…' : 'Retry live data'}</button></section>;
  }

  return (
    <section className="ops-home">
      <header className="ops-home-header">
        <div className="ops-home-heading">
          <span>{roleName.toUpperCase()} · {data.businessDay.label.toUpperCase()} · MIRROR {mirrorStatus}</span>
          <h1>{deskTitle}</h1>
          <p>Ordermentum tells us what was ordered. EcoFlow shows what is blocked, who owns the next step and what is happening now.</p>
        </div>
        <div className="ops-home-actions">
          <button type="button" className="primary" onClick={onOpenOrders}>Review orders</button>
          {(role === 'owner' || role === 'admin') && firstStocktakeNeeded ? <a href="/?workspace=warehouse&mode=stocktake">Start first stocktake</a> : null}
          {role === 'owner' || role === 'admin' ? <a href="/warehouse-map">Warehouse map</a> : null}
          {role === 'account' ? <button type="button" onClick={() => openSection('Reconciliation')}>Reconciliation</button> : null}
          <button type="button" onClick={() => void Promise.all([onReload(), reloadReadiness()])} disabled={loading || statusLoading}>{loading || statusLoading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {loadError ? <div className="field-readiness-warning">Last trusted snapshot retained · {loadError}</div> : null}
      {healthNotice || statusNotice ? <div className="field-readiness-note">{healthNotice || statusNotice}</div> : null}

      <section className="ops-metrics" aria-label="Current operating metrics">
        <article className="ops-metric"><span>Current orders</span><strong>{currentOrders}</strong><small>server-classified workload</small></article>
        <article className="ops-metric"><span>Ready to release</span><strong>{n(operations?.ready_to_release) || ready.length}</strong><small>all release controls passed</small></article>
        <article className="ops-metric"><span>Blocked / review</span><strong>{n(operations?.blocked_orders) + n(operations?.source_review_orders) || new Set([...mappingBlocked, ...stockBlocked, ...paymentReview]).size}</strong><small>requires a decision</small></article>
        <article className="ops-metric"><span>In fulfilment</span><strong>{n(operations?.in_progress_orders) || inFulfilment.length}</strong><small>released through delivery</small></article>
        <article className="ops-metric"><span>{role === 'account' ? 'Open AR' : 'Live stock locations'}</span><strong>{role === 'account' ? money(openAr) : liveLocationCount}</strong><small>{role === 'account' ? `${paymentReview.length} accounts need review` : `${locationCount} mapped locations`}</small></article>
        <article className="ops-metric"><span>Source verified</span><strong>{mirrorStatus}</strong><small>{dateTime(mirror?.checked_at)}</small></article>
      </section>

      <section className="ops-home-grid">
        <section className="ops-home-panel">
          <header><h2>Needs attention now</h2><span>Click a row to keep it in the bottom work tray</span></header>
          <div className="ops-action-list">
            {actionItems.map((item) => (
              <button key={item.id} type="button" className={`ops-action-row ${item.tone}`} onClick={() => openWorkItem({
                id: `queue-${item.id}`,
                title: item.title,
                subtitle: item.detail,
                kind: 'Action queue',
                fields: [
                  { label: 'Open items', value: String(item.count) },
                  { label: 'Owner view', value: roleName },
                  { label: 'Next action', value: item.next },
                  { label: 'Source', value: 'Ordermentum commercial facts + EcoFlow operational controls' },
                ],
              })}>
                <i /><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>{item.count}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="ops-home-panel">
          <header><h2>Today’s flow</h2><span>One click opens the relevant workspace</span></header>
          <div className="ops-flow">
            <button type="button" onClick={() => openSection('Orders')}><strong>{currentOrders}</strong><span>Received</span></button>
            <button type="button" onClick={() => openSection('Orders')}><strong>{ready.length}</strong><span>Ready</span></button>
            <button type="button" onClick={() => openSection('Delivery')}><strong>{inFulfilment.length}</strong><span>Fulfilment</span></button>
            <button type="button" onClick={() => openSection('Delivery')}><strong>{onRoute.length}</strong><span>On route</span></button>
            <button type="button" onClick={() => openSection('Delivery')}><strong>{delivered.length}</strong><span>Delivered</span></button>
            <button type="button" onClick={() => openSection(role === 'account' ? 'Reconciliation' : 'Orders')}><strong>{paymentReview.length + mappingBlocked.length + stockBlocked.length}</strong><span>Blocked</span></button>
          </div>
        </section>
      </section>

      <section className="ops-home-panel">
        <header><h2>Active work</h2><span>Priority first · use the global toolbar to search or re-sort</span></header>
        <div className="ops-order-table">
          <div className="ops-order-row head"><span>Order</span><span>Store</span><span>Operational state</span><span>Value</span><span>POD</span></div>
          {activeOrders.map((order) => (
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
                { label: 'Operational status', value: order.status.replace(/_/g, ' ') },
                { label: 'Release gate', value: gateLabel(order) },
                { label: 'Blockers', value: order.releaseBlockers || order.changeSummary || 'None reported' },
                { label: 'POD', value: order.podStatus },
              ],
            })}>
              <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
              <span><strong>{order.store}</strong><small>{order.suburb} · {order.priceTier}</small></span>
              <span><b className={`ops-chip ${gateTone(order)}`}>{gateLabel(order)}</b><small>{order.releaseBlockers || order.changeSummary}</small></span>
              <span>{money(order.amount)}</span>
              <span><b className={`ops-chip ${order.podStatus === 'captured' ? 'good' : 'warn'}`}>{order.podStatus}</b></span>
            </div>
          ))}
          {!activeOrders.length ? <div className="empty-state">No active work in the trusted snapshot.</div> : null}
        </div>
      </section>

      <div className="ops-home-status-line">{n(barcode?.registered_barcodes)} active package codes · {n(inventory?.live_on_hand_units)} live units · source checked {dateTime(mirror?.checked_at)}</div>
    </section>
  );
}
