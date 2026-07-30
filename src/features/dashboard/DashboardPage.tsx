import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Boxes,
  ClipboardList,
  Landmark,
  MapPinned,
  PackageCheck,
  RefreshCw,
  Route,
  ScanLine,
  ShieldAlert,
  Warehouse,
} from 'lucide-react';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import { dashboardStageTarget, type DashboardNavigationTab } from './dashboardNavigationContract';
import { dashboardControlTone, dashboardSourceTone, type DashboardOperationalTone } from './dashboardControlContract';
import { loadOrderOperationsSummary, type OrderOperationsSummary } from '@/data/repositories/orderOperations';
import { loadBarcodeSprintKpis, loadInventoryKpis, type BarcodeSprintKpis, type InventoryKpis } from '@/data/repositories/inventoryControl';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import { loadOrdermentumMirrorHealth, type OrdermentumMirrorHealthRow } from '@/features/team/ordermentumSync';
import {
  ControlBanner,
  ControlButton,
  ControlPanel,
  ControlSkeleton,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import { useOverlayManager } from '@/features/intelligence/overlays';
import { ActionableExceptionQueue } from '@/features/intelligence/attention';
import { supabase } from '@/lib/supabaseClient';
import './fieldReadinessDashboard.css';
import './dashboardControlRoom.css';

type Props = {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  snapshotReady: boolean;
  loading: boolean;
  loadError?: string;
  healthNotice?: string;
  onReload: () => Promise<void>;
  onOpenTab: (tab: DashboardNavigationTab) => void;
};

type Stage = 'blocked' | 'review' | 'ready' | 'warehouse' | 'route';
type Action = { id: string; title: string; detail: string; count: number; tone: DashboardOperationalTone; next: string };

const CLOSED = new Set(['DELIVERED', 'CLOSED', 'CANCELLED']);
const WAREHOUSE = new Set(['RELEASED', 'PICKING', 'PACKED', 'STAGED']);
const LIMIT = 10;

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

function normalisedIdentity(value: string) {
  return value.trim().toLocaleLowerCase('en-AU');
}

function storeForOrder(order: ImportedOrder, stores: EcoFlowDataSet['stores']) {
  const candidates = stores.filter((store) => normalisedIdentity(store.name) === normalisedIdentity(order.store));
  if (!candidates.length) return undefined;
  const accountMatch = candidates.find((store) => normalisedIdentity(store.account) === normalisedIdentity(order.account));
  if (accountMatch) return accountMatch;
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isOpen(order: ImportedOrder) {
  return !CLOSED.has(order.status);
}

function stageOf(order: ImportedOrder): Stage {
  if (order.status === 'OUT_FOR_DELIVERY') return 'route';
  if (WAREHOUSE.has(order.status)) return 'warehouse';
  if (order.releaseGateStatus === 'READY_TO_RELEASE') return 'ready';
  if (order.releaseGateStatus === 'REVIEW_PAYMENT') return 'review';
  return 'blocked';
}

function stageLabel(stage: Stage) {
  return stage === 'review'
    ? 'FINANCE REVIEW'
    : stage === 'ready'
      ? 'READY'
      : stage === 'warehouse'
        ? 'IN WAREHOUSE'
        : stage === 'route'
          ? 'ON ROUTE'
          : 'NEEDS ACTION';
}

function stageTone(stage: Stage): DashboardOperationalTone {
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
  onOpenTab,
}: Props) {
  const { openPrimaryRecord } = useOverlayManager();
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
      supabase
        ? loadOrdermentumMirrorHealth(supabase)
        : Promise.resolve({ mirrorHealth: null, mirrorError: 'Supabase is unavailable.' }),
      loadInventoryKpis(),
      loadBarcodeSprintKpis(),
      loadWarehouseLocationItems(),
    ]);
    const [operationResult, mirrorResult, inventoryResult, barcodeResult, locationResult] = checks;
    if (operationResult.status === 'fulfilled') setOperations(operationResult.value);
    if (mirrorResult.status === 'fulfilled') {
      setMirror(mirrorResult.value.mirrorHealth);
      if (mirrorResult.value.mirrorError) setStatusNotice(mirrorResult.value.mirrorError);
    }
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
    if (unavailable.length) {
      setStatusNotice(`Summary unavailable: ${unavailable.join(', ')}. Operational records remain unchanged.`);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    if (snapshotReady) void reloadReadiness();
  }, [reloadReadiness, snapshotReady, data.syncBatch.completedAt]);

  const locationCount = useMemo(
    () => new Set(locations.map((row) => row.location_code).filter(Boolean)).size,
    [locations],
  );
  const liveLocationCount = useMemo(
    () => new Set(
      locations
        .filter((row) => row.item_id && n(row.quantity) > 0)
        .map((row) => row.location_code)
        .filter(Boolean),
    ).size,
    [locations],
  );
  const firstStocktakeNeeded = n(inventory?.live_on_hand_units) <= 0 && liveLocationCount === 0;
  const openOrders = useMemo(() => orders.filter(isOpen), [orders]);
  const serverCurrentOrders = operations
    ? n(operations.current_orders) + n(operations.source_review_orders)
    : orders.length;
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
  const activeOrders = useMemo(
    () => [...openOrders]
      .sort((left, right) => {
        const score = (order: ImportedOrder) => priority[stageOf(order)] * 100 + order.openExceptionCount * 10;
        return score(right) - score(left)
          || new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
      })
      .slice(0, LIMIT),
    [openOrders],
  );

  const actions: Action[] = role === 'account'
    ? [
        { id: 'finance', title: 'Finance review', detail: 'Payment status, credit hold or overdue decision.', count: groups.review.length, tone: groups.review.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'blocked', title: 'Commercial or data blockers', detail: 'Mapping, source or stock control requires action.', count: groups.blocked.length, tone: groups.blocked.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'pod', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready', title: 'Ready for execution', detail: 'Orders that passed current release controls.', count: groups.ready.length, tone: groups.ready.length ? 'good' : 'neutral', next: 'Open Orders' },
      ]
    : [
        { id: 'blocked', title: 'Orders needing action', detail: 'Mapping, data, source or stock controls are blocking progress.', count: groups.blocked.length, tone: groups.blocked.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'finance', title: 'Finance review', detail: 'Office decision required before release.', count: groups.review.length, tone: groups.review.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'pod', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready', title: 'Ready to release', detail: 'Current controls passed; waiting for execution.', count: groups.ready.length, tone: groups.ready.length ? 'good' : 'neutral', next: 'Open Orders' },
      ];

  const roleName = role === 'admin'
    ? 'Admin'
    : role === 'owner'
      ? 'Owner'
      : role === 'account'
        ? 'Accounts'
        : 'Viewer';
  const deskTitle = role === 'account'
    ? 'Finance and fulfilment desk'
    : role === 'viewer'
      ? 'Live operating picture'
      : 'Operations control desk';
  const stages: Array<{ key: Stage; label: string; count: number; tab: DashboardNavigationTab }> = [
    { key: 'blocked', label: 'Needs action', count: groups.blocked.length, tab: dashboardStageTarget('blocked', role) },
    { key: 'review', label: 'Finance review', count: groups.review.length, tab: dashboardStageTarget('review', role) },
    { key: 'ready', label: 'Ready', count: groups.ready.length, tab: dashboardStageTarget('ready', role) },
    { key: 'warehouse', label: 'In warehouse', count: groups.warehouse.length, tab: dashboardStageTarget('warehouse', role) },
    { key: 'route', label: 'On route', count: groups.route.length, tab: dashboardStageTarget('route', role) },
  ];

  if (loading && !snapshotReady) {
    return (
      <section className="ops-control-loading" aria-live="polite">
        <ControlPanel tone="dark" title="Loading live operations…">
          <ControlSkeleton shape="block" width="100%" />
        </ControlPanel>
      </section>
    );
  }

  if (!snapshotReady) {
    return (
      <section className="ops-control-unavailable">
        <ControlBanner
          tone="danger"
          role="alert"
          icon={<AlertTriangle />}
          title="Live operating data is unavailable"
          actions={(
            <ControlButton
              variant="danger"
              onClick={() => void onReload()}
              disabled={loading}
              busy={loading}
              leading={<RefreshCw />}
            >
              {loading ? 'Retrying…' : 'Retry live data'}
            </ControlButton>
          )}
        >
          {loadError || 'EcoFlow will not show sample figures.'}
        </ControlBanner>
      </section>
    );
  }

  return (
    <section
      className="ops-home ops-control-room"
      data-server-current={serverCurrentOrders}
      data-source-status={mirrorStatus.toLowerCase()}
    >
      <header className="ops-control-hero">
        <div className="ops-home-heading">
          <div className="ops-control-kicker">
            <span>{roleName.toUpperCase()} · {data.businessDay.label.toUpperCase()}</span>
            <ControlStatus
              tone={dashboardSourceTone(mirrorStatus)}
              label={`SOURCE ${mirrorStatus}`}
              compact
              pulse={mirrorStatus === 'CHECKING'}
            />
          </div>
          <h1>{deskTitle}</h1>
        </div>
        <div className="ops-home-actions">
          <ControlButton variant="primary" leading={<ClipboardList />} onClick={() => onOpenTab('orders')}>
            Review orders
          </ControlButton>
          {(role === 'owner' || role === 'admin') && firstStocktakeNeeded ? (
            <a className="ops-control-link ops-control-link--primary" href="/?workspace=warehouse&mode=stocktake">
              <ScanLine aria-hidden="true" />
              <span>Start first stocktake</span>
            </a>
          ) : null}
          {role === 'owner' || role === 'admin' ? (
            <a className="ops-control-link" href="/warehouse-map">
              <MapPinned aria-hidden="true" />
              <span>Warehouse map</span>
            </a>
          ) : null}
          {role === 'account' ? (
            <ControlButton leading={<Landmark />} onClick={() => onOpenTab('reconciliation')}>
              Reconciliation
            </ControlButton>
          ) : null}
          <ControlButton
            variant="quiet"
            leading={<RefreshCw />}
            onClick={() => void Promise.all([onReload(), reloadReadiness()])}
            disabled={loading || statusLoading}
            busy={loading || statusLoading}
          >
            {loading || statusLoading ? 'Refreshing…' : 'Refresh'}
          </ControlButton>
        </div>
      </header>

      {loadError ? (
        <ControlBanner tone="danger" icon={<AlertTriangle />}>
          Last loaded records retained · {loadError}
        </ControlBanner>
      ) : null}
      {healthNotice || statusNotice ? (
        <ControlBanner tone="warning" icon={<ShieldAlert />}>
          {healthNotice || statusNotice}
        </ControlBanner>
      ) : null}

      <section className="ops-control-metrics" aria-label="Current operating summary">
        <article className="ops-control-metric" data-signal="information">
          <div><span>Open orders</span><ClipboardList aria-hidden="true" /></div>
          <strong>{openOrders.length}</strong>
          <small>five exclusive stages</small>
        </article>
        <article className="ops-control-metric" data-signal={decisionCount ? 'danger' : 'success'}>
          <div><span>Needs decision</span><ShieldAlert aria-hidden="true" /></div>
          <strong>{decisionCount}</strong>
          <small>{groups.blocked.length} operational · {groups.review.length} finance</small>
        </article>
        <article className="ops-control-metric" data-signal="success">
          <div><span>Ready</span><BadgeCheck aria-hidden="true" /></div>
          <strong>{groups.ready.length}</strong>
          <small>release controls passed</small>
        </article>
        <article className="ops-control-metric" data-signal="information">
          <div><span>In execution</span><Route aria-hidden="true" /></div>
          <strong>{executionCount}</strong>
          <small>{groups.warehouse.length} warehouse · {groups.route.length} route</small>
        </article>
        <article className="ops-control-metric" data-signal={liveLocationCount ? 'neutral' : 'warning'}>
          <div><span>Live stock locations</span><Warehouse aria-hidden="true" /></div>
          <strong>{liveLocationCount}</strong>
          <small>{locationCount} mapped locations</small>
        </article>
        <article className="ops-control-metric" data-signal={podMissing.length ? 'warning' : 'success'}>
          <div><span>Delivered retained</span><PackageCheck aria-hidden="true" /></div>
          <strong>{delivered.length}</strong>
          <small>{podMissing.length} missing POD</small>
        </article>
      </section>

      <ActionableExceptionQueue onOpenOrders={() => onOpenTab('orders')} />

      <section className="ops-control-grid">
        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-control-attention"
          eyebrow="Needs attention"
          title="Operational queues"
          actions={(
            <ControlStatus
              tone={decisionCount + podMissing.length ? 'danger' : 'success'}
              label={String(decisionCount + podMissing.length)}
              compact
            />
          )}
        >
          <div className="ops-control-action-list">
            {actions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ops-control-action-row ${item.tone}`}
                onClick={() => openPrimaryRecord({
                  entity: { kind: 'exception', id: `queue-${item.id}` },
                  eyebrow: 'Action queue',
                  title: item.title,
                  subtitle: item.detail,
                  fields: [
                    { label: 'Open items', value: String(item.count) },
                    { label: 'Role view', value: roleName },
                    { label: 'Next action', value: item.next },
                  ],
                })}
              >
                <i aria-hidden="true" />
                <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                <b>{item.count}</b>
              </button>
            ))}
          </div>
        </ControlPanel>

        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-control-stage-panel"
          title="Open order stages"
          actions={<ControlStatus tone="information" label={String(openOrders.length)} compact />}
        >
          <div className="ops-control-flow">
            {stages.map((stage) => (
              <button
                key={stage.key}
                type="button"
                data-stage={stage.key}
                onClick={() => onOpenTab(stage.tab)}
              >
                <span className="ops-control-stage-icon" aria-hidden="true"><Boxes /></span>
                <strong>{stage.count}</strong>
                <span>{stage.label}</span>
              </button>
            ))}
          </div>
        </ControlPanel>
      </section>

      <ControlPanel
        tone="raised"
        className="ops-control-panel ops-control-priority"
        title="Priority work"
        actions={(
          <div className="ops-panel-actions">
            <span>Top {activeOrders.length} of {openOrders.length} open orders</span>
            <ControlButton variant="quiet" size="compact" onClick={() => onOpenTab('orders')}>
              View all
            </ControlButton>
          </div>
        )}
      >
        <div className="ops-control-order-table">
          <div className="ops-control-order-row head">
            <span>Order</span><span>Store</span><span>Stage</span><span>Value</span><span>POD</span>
          </div>
          {activeOrders.map((order) => {
            const stage = stageOf(order);
            const storeProfile = storeForOrder(order, data.stores);
            return (
              <button
                type="button"
                className="ops-control-order-row"
                key={order.id}
                onClick={() => openPrimaryRecord({
                  entity: { kind: 'order', id: order.id },
                  eyebrow: 'Order',
                  title: order.orderNo,
                  subtitle: `${order.store} · ${order.suburb}`,
                  width: 'wide',
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
                  relatedRecords: storeProfile ? [{
                    label: 'Store',
                    entity: { kind: 'store', id: storeProfile.id },
                    eyebrow: 'Store',
                    title: storeProfile.name,
                    subtitle: storeProfile.suburb,
                    fields: [
                      { label: 'Account', value: storeProfile.account },
                      { label: 'Suburb', value: storeProfile.suburb },
                      { label: 'Price tier', value: storeProfile.priceTier },
                      { label: 'Payment terms', value: storeProfile.paymentTerms },
                      { label: 'Status', value: storeProfile.status },
                      { label: 'Address', value: storeProfile.address || '—' },
                      { label: 'Phone', value: storeProfile.phone || '—' },
                      { label: 'Ordermentum ID', value: storeProfile.ordermentumId },
                      { label: 'Statement group', value: storeProfile.statementGroup },
                      ...(storeProfile.orderCount !== undefined
                        ? [{ label: 'Order count', value: String(storeProfile.orderCount) }]
                        : []),
                      ...(storeProfile.totalValue !== undefined
                        ? [{ label: 'Total value', value: money(storeProfile.totalValue) }]
                        : []),
                    ],
                  }] : undefined,
                })}
              >
                <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
                <span><strong>{order.store}</strong><small>{order.suburb} · {order.priceTier}</small></span>
                <span>
                  <ControlStatus tone={dashboardControlTone(stageTone(stage))} label={stageLabel(stage)} compact />
                  <small>{order.releaseBlockers || order.changeSummary}</small>
                </span>
                <span className="ops-control-order-value">{money(order.amount)}</span>
                <span>
                  <ControlStatus
                    tone={order.podStatus === 'captured' ? 'success' : 'warning'}
                    label={order.podStatus}
                    compact
                  />
                </span>
              </button>
            );
          })}
          {!activeOrders.length ? <div className="empty-state">No open orders.</div> : null}
        </div>
      </ControlPanel>

      <div className="ops-control-status-line">
        {openOrders.length === serverCurrentOrders
          ? `${serverCurrentOrders} server-current orders classified`
          : `${openOrders.length} loaded open · ${serverCurrentOrders} server current`}
        {' · '}{n(barcode?.registered_barcodes)} package codes
        {' · '}{n(inventory?.live_on_hand_units)} live units
        {' · '}source checked {dateTime(mirror?.checked_at)}
      </div>
    </section>
  );
}
