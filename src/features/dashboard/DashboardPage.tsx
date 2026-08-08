import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Landmark,
  MapPinned,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Route,
  ScanLine,
  ShieldAlert,
  Truck,
  Warehouse,
  Zap,
} from 'lucide-react';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import { dashboardStageTarget, type DashboardNavigationTab } from './dashboardNavigationContract';
import { dashboardSourceTone, type DashboardOperationalTone } from './dashboardControlContract';
import { loadDashboardReadiness, type DashboardReadiness } from '@/data/repositories/dashboardReadiness';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import { loadOrdermentumMirrorHealth, type OrdermentumMirrorHealthRow } from '@/features/team/ordermentumSync';
import {
  buildOperationalFlow,
  operationalFlowStages,
  type OperationalFlowStage,
} from '@/features/intelligence/operationalFlow';
import {
  ControlBanner,
  ControlButton,
  ControlPanel,
  ControlSkeleton,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import { useOverlayManager } from '@/features/intelligence/overlays';
import { ActionableExceptionQueue, PriorityWork } from '@/features/intelligence/attention';
import { supabase } from '@/lib/supabaseClient';
import './fieldReadinessDashboard.css';
import './dashboardControlRoom.css';
import './operationalFlowSurface.css';

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

type Action = {
  id: string;
  title: string;
  detail: string;
  count: number;
  tone: DashboardOperationalTone;
  next: string;
};

const PERF_SHELL = 'ecoflow:control-room:shell';
const PERF_PRIMARY = 'ecoflow:control-room:primary-summary-ready';
const PERF_MODULES = 'ecoflow:control-room:modules-ready';
const PERF_FLOW = 'ecoflow:control-room:flow-ready';
const PERF_FULL = 'ecoflow:control-room:full-ready';

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function markPerformance(name: string) {
  if (typeof window === 'undefined' || typeof window.performance?.mark !== 'function') return;
  try {
    window.performance.mark(name);
  } catch {
    // Telemetry must never affect the operating surface.
  }
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

function shortTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Adelaide',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function stageIcon(stage: OperationalFlowStage): ReactNode {
  if (stage === 'NEW') return <ClipboardList />;
  if (stage === 'NEEDS_ACTION') return <ShieldAlert />;
  if (stage === 'FINANCE_REVIEW') return <Landmark />;
  if (stage === 'READY') return <BadgeCheck />;
  if (stage === 'WAREHOUSE') return <Warehouse />;
  if (stage === 'STAGED') return <Boxes />;
  if (stage === 'ROUTE') return <Route />;
  return <PackageCheck />;
}

function matchesBusinessDay(order: ImportedOrder, businessDay: string) {
  const deliveryDate = order.deliveryDate?.slice(0, 10);
  if (order.requestedDeliveryBusinessDay === businessDay) return true;
  if (deliveryDate === businessDay) return true;
  return !order.requestedDeliveryBusinessDay && !deliveryDate && order.businessDay === businessDay;
}

function dueOrderSort(left: ImportedOrder, right: ImportedOrder) {
  const leftDue = left.dueAt || left.deliveryDate || left.eta || '';
  const rightDue = right.dueAt || right.deliveryDate || right.eta || '';
  return leftDue.localeCompare(rightDue) || left.sequence - right.sequence;
}

function stageCount(flow: ReturnType<typeof buildOperationalFlow>, stage: OperationalFlowStage) {
  return flow.nodes.find((node) => node.key === stage)?.count ?? 0;
}

function isCommissioningDeferredOrder(order: ImportedOrder, inventoryQuantityCommissioned: boolean) {
  if (inventoryQuantityCommissioned || order.status === 'FAILED') return false;
  return order.releaseGateStatus === 'BLOCKED_MAPPING' || order.releaseGateStatus === 'BLOCKED_STOCK';
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
  const [readiness, setReadiness] = useState<DashboardReadiness | null>(null);
  const [mirror, setMirror] = useState<OrdermentumMirrorHealthRow | null>(null);
  const [locations, setLocations] = useState<WarehouseLocationItemRow[]>([]);
  const [primaryLoading, setPrimaryLoading] = useState(true);
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  const [primaryError, setPrimaryError] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const detailRequestedRef = useRef(false);

  const reloadPrimary = useCallback(async () => {
    setPrimaryLoading(true);
    setPrimaryError('');
    try {
      const next = await loadDashboardReadiness();
      if (!next) throw new Error('Dashboard readiness returned no current row.');
      setReadiness(next);
      markPerformance(PERF_PRIMARY);
    } catch (error) {
      setPrimaryError(error instanceof Error ? error.message : String(error));
    } finally {
      setPrimaryLoading(false);
    }
  }, []);

  const reloadSecondary = useCallback(async () => {
    setSecondaryLoading(true);
    setStatusNotice('');
    const checks = await Promise.allSettled([
      supabase
        ? loadOrdermentumMirrorHealth(supabase)
        : Promise.resolve({ mirrorHealth: null, mirrorError: 'Supabase is unavailable.' }),
      loadWarehouseLocationItems(),
    ]);
    const [mirrorResult, locationResult] = checks;
    const notices: string[] = [];
    if (mirrorResult.status === 'fulfilled') {
      setMirror(mirrorResult.value.mirrorHealth);
      if (mirrorResult.value.mirrorError) notices.push(mirrorResult.value.mirrorError);
    } else {
      notices.push('Source verification is temporarily unavailable.');
    }
    if (locationResult.status === 'fulfilled') setLocations(locationResult.value);
    else notices.push('Warehouse location summary is temporarily unavailable.');
    setStatusNotice(notices.join(' '));
    setSecondaryLoading(false);
    markPerformance(PERF_MODULES);
  }, []);

  const reloadControlRoom = useCallback(async () => {
    detailRequestedRef.current = true;
    await Promise.allSettled([reloadPrimary(), reloadSecondary(), onReload()]);
  }, [onReload, reloadPrimary, reloadSecondary]);

  useEffect(() => {
    markPerformance(PERF_SHELL);
    void reloadPrimary();
    void reloadSecondary();
  }, [reloadPrimary, reloadSecondary]);

  useEffect(() => {
    if (!readiness || snapshotReady || loading || detailRequestedRef.current) return;
    detailRequestedRef.current = true;
    const timer = window.setTimeout(() => void onReload(), 250);
    return () => window.clearTimeout(timer);
  }, [loading, onReload, readiness, snapshotReady]);

  useEffect(() => {
    if (snapshotReady) markPerformance(PERF_FLOW);
  }, [snapshotReady]);

  useEffect(() => {
    if (readiness && snapshotReady && !primaryLoading && !secondaryLoading) markPerformance(PERF_FULL);
  }, [primaryLoading, readiness, secondaryLoading, snapshotReady]);

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
  const inventoryQuantityCommissioned = Boolean(readiness?.inventory_quantity_commissioned);
  const authoritativeInventoryUnits = readiness && inventoryQuantityCommissioned
    ? n(readiness.live_on_hand_units)
    : null;
  const firstStocktakeNeeded = Boolean(readiness) && !inventoryQuantityCommissioned;

  const flow = useMemo(
    () => buildOperationalFlow(orders, {
      inventoryQuantityCommissioned: readiness ? inventoryQuantityCommissioned : undefined,
    }),
    [inventoryQuantityCommissioned, orders, readiness],
  );
  const orderById = useMemo(() => {
    const value = new Map<string, ImportedOrder>();
    orders.forEach((order) => {
      if (!value.has(order.id)) value.set(order.id, order);
    });
    return value;
  }, [orders]);
  const groups = useMemo(() => {
    const value = Object.fromEntries(
      operationalFlowStages.map((stage) => [stage.key, []]),
    ) as unknown as Record<OperationalFlowStage, ImportedOrder[]>;
    flow.assignments.forEach((assignment) => {
      const order = orderById.get(assignment.orderId);
      if (order) value[assignment.stage].push(order);
    });
    return value;
  }, [flow.assignments, orderById]);
  const openOrders = useMemo(
    () => flow.assignments
      .filter((assignment) => assignment.stage !== 'DELIVERED')
      .map((assignment) => orderById.get(assignment.orderId))
      .filter((order): order is ImportedOrder => Boolean(order)),
    [flow.assignments, orderById],
  );

  const businessDay = data.businessDay.date;
  const todayOrders = useMemo(
    () => orders.filter((order) => matchesBusinessDay(order, businessDay)),
    [businessDay, orders],
  );
  const todayFlow = useMemo(
    () => buildOperationalFlow(todayOrders, {
      inventoryQuantityCommissioned: readiness ? inventoryQuantityCommissioned : undefined,
    }),
    [inventoryQuantityCommissioned, readiness, todayOrders],
  );
  const commissioningDeferredCount = useMemo(
    () => orders.filter((order) => isCommissioningDeferredOrder(order, inventoryQuantityCommissioned)).length,
    [inventoryQuantityCommissioned, orders],
  );
  const todayCommissioningDeferred = useMemo(
    () => todayOrders.filter((order) => isCommissioningDeferredOrder(order, inventoryQuantityCommissioned)).length,
    [inventoryQuantityCommissioned, todayOrders],
  );
  const todayTotal = todayFlow.classifiedCount;
  const todayDelivered = stageCount(todayFlow, 'DELIVERED');
  const todayCompletion = todayTotal > 0 ? Math.round((todayDelivered / todayTotal) * 100) : 0;
  const todayNeedsDecision = stageCount(todayFlow, 'NEEDS_ACTION') + stageCount(todayFlow, 'FINANCE_REVIEW');
  const todayReady = stageCount(todayFlow, 'READY');
  const todayWarehouse = stageCount(todayFlow, 'WAREHOUSE');
  const todayStaged = stageCount(todayFlow, 'STAGED');
  const todayRoute = stageCount(todayFlow, 'ROUTE');
  const todayPodMissing = todayOrders.filter((order) => order.status === 'DELIVERED' && order.podStatus === 'missing').length;

  const serverCurrentOrders = readiness ? n(readiness.server_current_orders) : 0;
  const serverExceptions = readiness ? n(readiness.active_exception_count) : 0;
  const delivered = groups.DELIVERED;
  const podMissing = delivered.filter((order) => order.podStatus === 'missing');
  const decisionCount = groups.NEEDS_ACTION.length + groups.FINANCE_REVIEW.length;
  const mirrorStatus = mirror?.overall_status || (secondaryLoading ? 'CHECKING' : 'UNAVAILABLE');
  const detailReady = snapshotReady;

  const warehouseWork = useMemo(
    () => [...groups.WAREHOUSE, ...groups.STAGED].sort(dueOrderSort).slice(0, 4),
    [groups.STAGED, groups.WAREHOUSE],
  );
  const routeWork = useMemo(
    () => [...groups.ROUTE, ...groups.DELIVERED].sort(dueOrderSort).slice(0, 4),
    [groups.DELIVERED, groups.ROUTE],
  );
  const geocodedRouteStops = groups.ROUTE.filter((order) => typeof order.lat === 'number' && typeof order.lng === 'number').length;

  const closeBlockers = detailReady
    ? todayNeedsDecision + todayWarehouse + todayStaged + todayRoute + todayPodMissing + serverExceptions + (firstStocktakeNeeded ? 1 : 0)
    : null;

  const actions: Action[] = role === 'account'
    ? [
        { id: 'finance', title: 'Finance review', detail: 'Payment status, credit hold or overdue decision.', count: groups.FINANCE_REVIEW.length, tone: groups.FINANCE_REVIEW.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'blocked', title: 'Commercial or data blockers', detail: 'Mapping, source or stock control requires action.', count: groups.NEEDS_ACTION.length, tone: groups.NEEDS_ACTION.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'pod', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready', title: 'Ready for execution', detail: 'Orders that passed current release controls.', count: groups.READY.length, tone: groups.READY.length ? 'good' : 'neutral', next: 'Open Orders' },
      ]
    : [
        { id: 'blocked', title: 'Orders needing action', detail: 'Mapping, data, source or stock controls are blocking progress.', count: groups.NEEDS_ACTION.length, tone: groups.NEEDS_ACTION.length ? 'danger' : 'good', next: 'Open Orders' },
        { id: 'finance', title: 'Finance review', detail: 'Office decision required before release.', count: groups.FINANCE_REVIEW.length, tone: groups.FINANCE_REVIEW.length ? 'warn' : 'good', next: 'Open Reconciliation' },
        { id: 'pod', title: 'Delivery proof incomplete', detail: 'Delivered orders without complete POD.', count: podMissing.length, tone: podMissing.length ? 'danger' : 'good', next: 'Open Delivery' },
        { id: 'ready', title: 'Ready to release', detail: 'Current controls passed; waiting for execution.', count: groups.READY.length, tone: groups.READY.length ? 'good' : 'neutral', next: 'Open Orders' },
      ];

  const roleName = role === 'admin'
    ? 'Admin'
    : role === 'owner'
      ? 'Owner'
      : role === 'account'
        ? 'Accounts'
        : 'Viewer';
  const stages = flow.nodes.map((stage) => ({
    ...stage,
    label: firstStocktakeNeeded && stage.key === 'NEW' ? 'Loaded' : stage.label,
    tab: dashboardStageTarget(stage.key, role),
  }));
  const refreshBusy = primaryLoading || secondaryLoading || loading;

  function inspectOrder(order: ImportedOrder, eyebrow: string) {
    openPrimaryRecord({
      entity: { kind: 'order', id: order.id },
      eyebrow,
      title: order.store || order.orderNo,
      subtitle: `${order.orderNo} · ${order.suburb || 'Suburb unavailable'}`,
      fields: [
        { label: 'Status', value: order.status },
        { label: 'Release gate', value: order.releaseGateStatus || '—' },
        { label: 'ETA', value: order.eta || '—' },
        { label: 'Packages', value: String(order.packageCount || 0) },
        { label: 'POD', value: order.podStatus },
        { label: 'Exceptions', value: String(order.openExceptionCount || 0) },
      ],
    });
  }

  return (
    <section
      className="ops-home ops-control-room ops-control-room--vnext"
      data-server-current={readiness ? serverCurrentOrders : undefined}
      data-source-status={mirrorStatus.toLowerCase()}
      data-flow-state={detailReady ? flow.state : 'loading'}
      data-primary-ready={Boolean(readiness)}
      data-inventory-quantity-authority={readiness ? (inventoryQuantityCommissioned ? 'commissioned' : 'pending-first-stocktake') : 'unknown'}
      data-operating-mode={readiness ? (inventoryQuantityCommissioned ? 'live' : 'commissioning') : 'unknown'}
    >
      <header className="ops-control-hero ops-vnext-hero">
        <div className="ops-vnext-hero__main">
          <div className="ops-control-kicker">
            <span>OPERATIONS CONTROL · {data.businessDay.label.toUpperCase()}</span>
            <ControlStatus
              tone={dashboardSourceTone(mirrorStatus)}
              label={`SOURCE ${mirrorStatus}`}
              compact
              pulse={mirrorStatus === 'CHECKING'}
            />
          </div>
          <h1>Run today from one operating picture.</h1>
          <p>Current workload, physical execution, delivery progress and the decisions that can stop the day.</p>
        </div>
        <div className="ops-home-actions ops-vnext-hero__actions">
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
            onClick={() => void reloadControlRoom()}
            disabled={refreshBusy}
            busy={refreshBusy}
          >
            {refreshBusy ? 'Refreshing…' : 'Refresh'}
          </ControlButton>
        </div>

        <div className="ops-vnext-live-strip" aria-label="Live operating signals">
          <div>
            <span>Source freshness</span>
            <strong>{mirrorStatus}</strong>
            <small>{secondaryLoading ? 'checking…' : `checked ${dateTime(mirror?.checked_at)}`}</small>
          </div>
          <div>
            <span>Current workload</span>
            <strong>{readiness ? serverCurrentOrders : '—'}</strong>
            <small>server-current orders</small>
          </div>
          <div data-alert={serverExceptions > 0 ? 'true' : undefined}>
            <span>Active exceptions</span>
            <strong>{readiness ? serverExceptions : '—'}</strong>
            <small>current governed queue</small>
          </div>
          <div data-alert={readiness && !inventoryQuantityCommissioned ? 'true' : undefined}>
            <span>Physical inventory</span>
            <strong>{authoritativeInventoryUnits === null ? '—' : authoritativeInventoryUnits.toLocaleString('en-AU')}</strong>
            <small>{readiness
              ? inventoryQuantityCommissioned
                ? `${n(readiness.registered_barcodes)} registered package codes`
                : `Not commissioned · ${n(readiness.registered_barcodes)} package codes known`
              : 'bounded summary loading'}</small>
          </div>
        </div>
      </header>

      {!readiness && primaryLoading ? (
        <ControlPanel tone="dark" title="Connecting to current operations…" className="ops-control-loading" aria-live="polite">
          <ControlSkeleton shape="block" width="100%" />
        </ControlPanel>
      ) : null}
      {!readiness && primaryError ? (
        <ControlBanner
          tone="danger"
          role="alert"
          icon={<AlertTriangle />}
          title="Current operating summary is unavailable"
          actions={(
            <ControlButton variant="danger" onClick={() => void reloadPrimary()} disabled={primaryLoading} busy={primaryLoading} leading={<RefreshCw />}>
              Retry summary
            </ControlButton>
          )}
        >
          {primaryError}
        </ControlBanner>
      ) : null}
      {readiness && loadError ? (
        <ControlBanner tone="warning" icon={<ShieldAlert />}>
          Detailed order classification is unavailable. The live primary summary remains authoritative. · {loadError}
        </ControlBanner>
      ) : null}
      {healthNotice || statusNotice ? (
        <ControlBanner tone="warning" icon={<ShieldAlert />}>
          {healthNotice || statusNotice}
        </ControlBanner>
      ) : null}
      {readiness && firstStocktakeNeeded ? (
        <ControlBanner
          tone="warning"
          icon={<ScanLine />}
          title="Warehouse commissioning required"
          actions={(role === 'owner' || role === 'admin') ? (
            <a className="ops-control-link ops-control-link--primary" href="/?workspace=warehouse&mode=stocktake">
              <ScanLine aria-hidden="true" />
              <span>Continue commissioning</span>
            </a>
          ) : undefined}
        >
          {serverCurrentOrders.toLocaleString('en-AU')} current orders are safely loaded. {detailReady ? commissioningDeferredCount.toLocaleString('en-AU') : 'Mapping and stock-dependent'} order records are waiting behind one warehouse go-live gate, not separate action items. Finish SKU/barcode identity work, then approve the INITIAL stocktake. Release remains closed until commissioning is complete.
        </ControlBanner>
      ) : null}

      <section className="ops-vnext-today" aria-labelledby="ops-vnext-today-title">
        <div className="ops-vnext-section-heading">
          <div>
            <span>TODAY · ADELAIDE BUSINESS DAY</span>
            <h2 id="ops-vnext-today-title">Execution progress</h2>
          </div>
          {detailReady ? (
            <div className="ops-vnext-completion">
              <strong>{todayCompletion}%</strong>
              <span>delivered</span>
            </div>
          ) : <ControlStatus tone="neutral" label="CLASSIFYING" compact />}
        </div>

        <div className="ops-vnext-progress-track" aria-label={detailReady ? `${todayCompletion}% of today's classified workload delivered` : 'Today progress loading'}>
          <span style={{ width: `${detailReady ? todayCompletion : 0}%` }} />
        </div>

        <div className="ops-control-metrics ops-vnext-today-metrics">
          <article className="ops-control-metric" data-signal="information">
            <div><span>Today orders</span><ClipboardList aria-hidden="true" /></div>
            <strong>{detailReady ? todayTotal : '—'}</strong>
            <small>{detailReady && firstStocktakeNeeded && todayCommissioningDeferred
              ? `${todayCommissioningDeferred} await warehouse commissioning`
              : 'business-day classified'}</small>
          </article>
          <article className="ops-control-metric" data-signal={detailReady && todayNeedsDecision ? 'danger' : 'neutral'}>
            <div><span>Needs decision</span><ShieldAlert aria-hidden="true" /></div>
            <strong>{detailReady ? todayNeedsDecision : '—'}</strong>
            <small>operational + finance</small>
          </article>
          <article className="ops-control-metric" data-signal="success">
            <div><span>Ready</span><BadgeCheck aria-hidden="true" /></div>
            <strong>{detailReady ? todayReady : '—'}</strong>
            <small>release controls passed</small>
          </article>
          <article className="ops-control-metric" data-signal="information">
            <div><span>Warehouse</span><Warehouse aria-hidden="true" /></div>
            <strong>{detailReady ? todayWarehouse + todayStaged : '—'}</strong>
            <small>{detailReady ? `${todayWarehouse} active · ${todayStaged} staged` : 'detail loads without blocking this page'}</small>
          </article>
          <article className="ops-control-metric" data-signal="information">
            <div><span>On route</span><Truck aria-hidden="true" /></div>
            <strong>{detailReady ? todayRoute : '—'}</strong>
            <small>current delivery execution</small>
          </article>
          <article className="ops-control-metric" data-signal={detailReady && todayPodMissing ? 'warning' : 'success'}>
            <div><span>Delivered</span><PackageCheck aria-hidden="true" /></div>
            <strong>{detailReady ? todayDelivered : '—'}</strong>
            <small>{detailReady ? `${todayPodMissing} missing POD` : 'delivery detail pending…'}</small>
          </article>
        </div>
      </section>

      <section className="ops-vnext-command-grid">
        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-control-stage-panel ops-vnext-flow-panel"
          eyebrow="CURRENT WORKLOAD"
          title="Operational flow"
          actions={detailReady ? (
            <ControlStatus
              tone={flow.state === 'partial' || flow.state === 'invalid' ? 'warning' : 'information'}
              label={flow.state === 'partial' || flow.state === 'invalid'
                ? 'PARTIAL'
                : firstStocktakeNeeded
                  ? `${flow.classifiedCount} LOADED`
                  : `${flow.classifiedCount} CLASSIFIED`}
              compact
            />
          ) : <ControlStatus tone="neutral" label="STREAMING" compact />}
        >
          {detailReady ? (
            <div className="ops-control-flow" aria-label="Eight-stage operational flow">
              {stages.map((stage, index) => (
                <div className="ops-vnext-flow-node" key={stage.key}>
                  <button
                    type="button"
                    data-stage={stage.key.toLowerCase()}
                    aria-label={`${stage.label}: ${stage.count} orders`}
                    onClick={() => onOpenTab(stage.tab)}
                  >
                    <span className="ops-control-stage-icon" aria-hidden="true">{stageIcon(stage.key)}</span>
                    <strong>{stage.count}</strong>
                    <span>{stage.label}</span>
                  </button>
                  {index < stages.length - 1 ? <ArrowRight className="ops-vnext-flow-arrow" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="ops-vnext-flow-loading" aria-live="polite">
              <ControlSkeleton shape="block" width="100%" />
              <p className="ops-control-status-line">Eight-stage classification is loading as secondary detail; it no longer blocks the Control Room.</p>
            </div>
          )}
          <div className="ops-vnext-flow-footer">
            <span>{readiness ? `${serverCurrentOrders} server-current orders` : 'Primary summary pending'}</span>
            <span>{detailReady ? `${openOrders.length} loaded open · ${flow.excludedCount} cancelled · ${flow.unknownCount} unknown` : 'detailed flow loading independently'}</span>
          </div>
        </ControlPanel>

        <div className="ops-vnext-priority-slot">
          <PriorityWork />
        </div>
      </section>

      <section className="ops-vnext-live-grid">
        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-vnext-live-panel"
          eyebrow="WAREHOUSE LIVE"
          title="Physical execution"
          actions={<ControlButton variant="quiet" onClick={() => onOpenTab('inventory')}>Open inventory <ArrowRight /></ControlButton>}
        >
          <div className="ops-vnext-live-summary">
            <div><Warehouse /><span>Picking</span><strong>{detailReady ? groups.WAREHOUSE.length : '—'}</strong></div>
            <div><Boxes /><span>Staged</span><strong>{detailReady ? groups.STAGED.length : '—'}</strong></div>
            <div><MapPinned /><span>Live locations</span><strong>{secondaryLoading || !inventoryQuantityCommissioned ? '—' : liveLocationCount}</strong></div>
          </div>
          <div className="ops-vnext-work-list">
            {!detailReady ? <ControlSkeleton shape="block" width="100%" /> : warehouseWork.length ? warehouseWork.map((order) => (
              <button type="button" key={order.id} onClick={() => inspectOrder(order, 'Warehouse execution')}>
                <span className="ops-vnext-work-icon"><PackageOpen /></span>
                <span><strong>{order.store}</strong><small>{order.orderNo} · {order.suburb || 'Location unavailable'}</small></span>
                <span><b>{order.status}</b><small>{order.eta || 'ETA —'}</small></span>
              </button>
            )) : <div className="ops-vnext-empty-line"><CheckCircle2 /> No current warehouse execution rows.</div>}
          </div>
          <footer>{locationCount} mapped locations · {readiness
            ? inventoryQuantityCommissioned
              ? `${authoritativeInventoryUnits?.toLocaleString('en-AU') ?? '—'} live units`
              : 'quantity not commissioned — approve the first stocktake'
            : 'quantity summary pending'}</footer>
        </ControlPanel>

        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-vnext-live-panel"
          eyebrow="DELIVERY LIVE"
          title="Route execution"
          actions={<ControlButton variant="quiet" onClick={() => onOpenTab('delivery')}>Open delivery <ArrowRight /></ControlButton>}
        >
          <div className="ops-vnext-live-summary">
            <div><Truck /><span>On route</span><strong>{detailReady ? groups.ROUTE.length : '—'}</strong></div>
            <div><PackageCheck /><span>Delivered</span><strong>{detailReady ? groups.DELIVERED.length : '—'}</strong></div>
            <div><MapPinned /><span>Geocoded active</span><strong>{detailReady ? geocodedRouteStops : '—'}</strong></div>
          </div>
          <div className="ops-vnext-work-list">
            {!detailReady ? <ControlSkeleton shape="block" width="100%" /> : routeWork.length ? routeWork.map((order) => (
              <button type="button" key={order.id} onClick={() => inspectOrder(order, 'Delivery execution')}>
                <span className="ops-vnext-work-icon"><Truck /></span>
                <span><strong>{order.store}</strong><small>{order.suburb || 'Location unavailable'} · {order.orderNo}</small></span>
                <span><b>{order.status}</b><small>{order.eta || (order.podStatus === 'captured' ? 'POD captured' : 'POD pending')}</small></span>
              </button>
            )) : <div className="ops-vnext-empty-line"><CheckCircle2 /> No current route execution rows.</div>}
          </div>
          <footer>{detailReady ? `${podMissing.length} delivered records missing POD` : 'Delivery detail streaming independently'}</footer>
        </ControlPanel>
      </section>

      <section className="ops-vnext-decision-grid">
        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-control-attention ops-vnext-decision-panel"
          eyebrow="Needs attention"
          title="Operational queues"
          actions={detailReady ? (
            <ControlStatus
              tone={decisionCount + podMissing.length ? 'danger' : 'success'}
              label={String(decisionCount + podMissing.length)}
              compact
            />
          ) : <ControlStatus tone="neutral" label="LOADING DETAIL" compact />}
        >
          {detailReady ? (
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
          ) : (
            <div className="ops-control-action-list" aria-label="Operational queue detail loading">
              <ControlSkeleton shape="block" width="100%" />
              <p className="ops-control-status-line">Current exceptions remain independently available while detailed order classification loads.</p>
            </div>
          )}
        </ControlPanel>

        <ControlPanel
          tone={closeBlockers === 0 ? 'raised' : 'dark'}
          className="ops-control-panel ops-vnext-close-panel"
          eyebrow="BUSINESS DAY"
          title="Pre-close control"
          actions={closeBlockers === null
            ? <ControlStatus tone="neutral" label="WAITING FOR DETAIL" compact />
            : <ControlStatus tone={closeBlockers === 0 ? 'success' : 'warning'} label={closeBlockers === 0 ? 'CLEAR' : `${closeBlockers} OPEN SIGNALS`} compact />}
        >
          <div className="ops-vnext-close-copy">
            <div className="ops-vnext-close-icon">{closeBlockers === 0 ? <CheckCircle2 /> : <Clock3 />}</div>
            <div>
              <strong>{closeBlockers === 0 ? 'No pre-close blockers detected in the current view.' : 'Finish the operating day with known work visible.'}</strong>
              <p>This is a pre-close operating view. Final Business Day Close remains server-authoritative in the governed exception workspace.</p>
            </div>
          </div>
          <div className="ops-vnext-close-checks">
            <span data-state={detailReady && todayNeedsDecision === 0 ? 'good' : 'attention'}><i />Today decisions <b>{detailReady ? todayNeedsDecision : '—'}</b></span>
            <span data-state={detailReady && todayWarehouse + todayStaged + todayRoute === 0 ? 'good' : 'attention'}><i />Today execution open <b>{detailReady ? todayWarehouse + todayStaged + todayRoute : '—'}</b></span>
            <span data-state={detailReady && todayPodMissing === 0 ? 'good' : 'attention'}><i />Missing POD <b>{detailReady ? todayPodMissing : '—'}</b></span>
            <span data-state={readiness && serverExceptions + (firstStocktakeNeeded ? 1 : 0) === 0 ? 'good' : 'attention'}><i />Global gates <b>{readiness ? serverExceptions + (firstStocktakeNeeded ? 1 : 0) : '—'}</b></span>
          </div>
          <ControlButton variant="primary" leading={<Zap />} onClick={() => onOpenTab('orders')}>
            Continue operating work
          </ControlButton>
        </ControlPanel>
      </section>

      <details className="ops-vnext-exception-detail">
        <summary>
          <span><ShieldAlert /> Full current exception register</span>
          <span>{readiness ? serverExceptions : '—'} active <ArrowRight /></span>
        </summary>
        <ActionableExceptionQueue onOpenOrders={() => onOpenTab('orders')} />
      </details>

      <div className="ops-control-status-line ops-vnext-source-footnote">
        <span><Clock3 /> Control Room summary calculated {dateTime(readiness?.calculated_at)}</span>
        <span>Exception snapshot {dateTime(readiness?.exception_snapshot_refreshed_at)}</span>
        <span>Inventory quantity authority {readiness ? (inventoryQuantityCommissioned ? `approved ${dateTime(readiness.initial_stocktake_approved_at)}` : 'pending first approved stocktake') : 'not verified'}</span>
        <span>Source mirror checked {dateTime(mirror?.checked_at)}</span>
        <span>Latest source time {shortTime(mirror?.checked_at)}</span>
      </div>
    </section>
  );
}
