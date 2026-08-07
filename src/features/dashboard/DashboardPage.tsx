import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
    // Performance telemetry must never affect the operating surface.
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

  // The aggregate operational snapshot is legacy detail data. It starts only
  // after the bounded primary summary has resolved, so it can enrich the flow
  // without controlling first useful paint.
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
  const firstStocktakeNeeded = Boolean(readiness)
    && !secondaryLoading
    && n(readiness?.live_on_hand_units) <= 0
    && liveLocationCount === 0;
  const flow = useMemo(() => buildOperationalFlow(orders), [orders]);
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
  const serverCurrentOrders = readiness
    ? n(readiness.server_current_orders)
    : 0;
  const delivered = groups.DELIVERED;
  const podMissing = delivered.filter((order) => order.podStatus === 'missing');
  const decisionCount = groups.NEEDS_ACTION.length + groups.FINANCE_REVIEW.length;
  const executionCount = groups.WAREHOUSE.length + groups.STAGED.length + groups.ROUTE.length;
  const mirrorStatus = mirror?.overall_status || (secondaryLoading ? 'CHECKING' : 'UNAVAILABLE');
  const detailReady = snapshotReady;

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
  const deskTitle = role === 'account'
    ? 'Finance and fulfilment desk'
    : role === 'viewer'
      ? 'Live operating picture'
      : 'Operations control desk';
  const stages = flow.nodes.map((stage) => ({
    ...stage,
    tab: dashboardStageTarget(stage.key, role),
  }));
  const refreshBusy = primaryLoading || secondaryLoading || loading;

  return (
    <section
      className="ops-home ops-control-room"
      data-server-current={readiness ? serverCurrentOrders : undefined}
      data-source-status={mirrorStatus.toLowerCase()}
      data-flow-state={detailReady ? flow.state : 'loading'}
      data-primary-ready={Boolean(readiness)}
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
            onClick={() => void reloadControlRoom()}
            disabled={refreshBusy}
            busy={refreshBusy}
          >
            {refreshBusy ? 'Refreshing…' : 'Refresh'}
          </ControlButton>
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

      <section className="ops-control-metrics" aria-label="Current operating summary">
        <article className="ops-control-metric" data-signal="information">
          <div><span>Open orders</span><ClipboardList aria-hidden="true" /></div>
          <strong>{readiness ? serverCurrentOrders : '—'}</strong>
          <small>{readiness ? 'server-current operating orders' : 'loading bounded summary…'}</small>
        </article>
        <article className="ops-control-metric" data-signal={detailReady && decisionCount ? 'danger' : 'neutral'}>
          <div><span>Needs decision</span><ShieldAlert aria-hidden="true" /></div>
          <strong>{detailReady ? decisionCount : '—'}</strong>
          <small>{detailReady ? `${groups.NEEDS_ACTION.length} operational · ${groups.FINANCE_REVIEW.length} finance` : 'classifying detailed flow in background…'}</small>
        </article>
        <article className="ops-control-metric" data-signal="success">
          <div><span>Ready</span><BadgeCheck aria-hidden="true" /></div>
          <strong>{detailReady ? groups.READY.length : '—'}</strong>
          <small>{detailReady ? 'release controls passed' : 'detail loads without blocking this page'}</small>
        </article>
        <article className="ops-control-metric" data-signal="information">
          <div><span>In execution</span><Route aria-hidden="true" /></div>
          <strong>{detailReady ? executionCount : '—'}</strong>
          <small>{detailReady ? `${groups.WAREHOUSE.length} warehouse · ${groups.STAGED.length} staged · ${groups.ROUTE.length} route` : 'warehouse and route detail pending…'}</small>
        </article>
        <article className="ops-control-metric" data-signal={secondaryLoading ? 'neutral' : liveLocationCount ? 'neutral' : 'warning'}>
          <div><span>Live stock locations</span><Warehouse aria-hidden="true" /></div>
          <strong>{secondaryLoading ? '—' : liveLocationCount}</strong>
          <small>{secondaryLoading ? 'loading location module…' : `${locationCount} mapped locations`}</small>
        </article>
        <article className="ops-control-metric" data-signal={detailReady && podMissing.length ? 'warning' : 'neutral'}>
          <div><span>Delivered retained</span><PackageCheck aria-hidden="true" /></div>
          <strong>{detailReady ? delivered.length : '—'}</strong>
          <small>{detailReady ? `${podMissing.length} missing POD` : 'delivery detail pending…'}</small>
        </article>
      </section>

      <ActionableExceptionQueue onOpenOrders={() => onOpenTab('orders')} />

      <section className="ops-control-grid">
        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-control-attention"
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
              <p className="ops-control-status-line">Current exceptions above remain independently available while detailed order classification loads.</p>
            </div>
          )}
        </ControlPanel>

        <ControlPanel
          tone="raised"
          className="ops-control-panel ops-control-stage-panel"
          title="Operational flow"
          actions={detailReady ? (
            <ControlStatus
              tone={flow.state === 'partial' || flow.state === 'invalid' ? 'warning' : 'information'}
              label={flow.state === 'partial' || flow.state === 'invalid' ? 'PARTIAL' : `${flow.classifiedCount} CLASSIFIED`}
              compact
            />
          ) : <ControlStatus tone="neutral" label="STREAMING" compact />}
        >
          {detailReady ? (
            <div className="ops-control-flow" aria-label="Eight-stage operational flow">
              {stages.map((stage) => (
                <button
                  key={stage.key}
                  type="button"
                  data-stage={stage.key.toLowerCase()}
                  aria-label={`${stage.label}: ${stage.count} orders`}
                  onClick={() => onOpenTab(stage.tab)}
                >
                  <span className="ops-control-stage-icon" aria-hidden="true">{stageIcon(stage.key)}</span>
                  <strong>{stage.count}</strong>
                  <span>{stage.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div aria-live="polite">
              <ControlSkeleton shape="block" width="100%" />
              <p className="ops-control-status-line">Eight-stage classification is loading as secondary detail; it no longer blocks the Control Room.</p>
            </div>
          )}
        </ControlPanel>
      </section>

      <PriorityWork />

      <div className="ops-control-status-line">
        {readiness ? `${serverCurrentOrders} server-current orders` : 'Primary summary pending'}
        {detailReady ? ` · ${openOrders.length} loaded open · ${flow.classifiedCount} flow-classified · ${flow.excludedCount} cancelled · ${flow.unknownCount} unknown` : ' · detailed flow loading independently'}
        {' · '}{n(readiness?.registered_barcodes)} package codes
        {' · '}{n(readiness?.live_on_hand_units)} live units
        {' · '}source checked {dateTime(mirror?.checked_at)}
      </div>
    </section>
  );
}