import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusNotice, setStatusNotice] = useState('');

  const reloadReadiness = useCallback(async () => {
    setStatusLoading(true);
    setStatusNotice('');
    const checks = await Promise.allSettled([
      loadDashboardReadiness(),
      supabase
        ? loadOrdermentumMirrorHealth(supabase)
        : Promise.resolve({ mirrorHealth: null, mirrorError: 'Supabase is unavailable.' }),
      loadWarehouseLocationItems(),
    ]);
    const [readinessResult, mirrorResult, locationResult] = checks;
    if (readinessResult.status === 'fulfilled') setReadiness(readinessResult.value);
    if (mirrorResult.status === 'fulfilled') {
      setMirror(mirrorResult.value.mirrorHealth);
      if (mirrorResult.value.mirrorError) setStatusNotice(mirrorResult.value.mirrorError);
    }
    if (locationResult.status === 'fulfilled') setLocations(locationResult.value);
    const unavailable = [
      readinessResult.status === 'rejected' ? 'dashboard readiness' : '',
      mirrorResult.status === 'rejected' ? 'source verification' : '',
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
  const firstStocktakeNeeded = n(readiness?.live_on_hand_units) <= 0 && liveLocationCount === 0;
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
    : orders.length;
  const delivered = groups.DELIVERED;
  const podMissing = delivered.filter((order) => order.podStatus === 'missing');
  const decisionCount = groups.NEEDS_ACTION.length + groups.FINANCE_REVIEW.length;
  const executionCount = groups.WAREHOUSE.length + groups.STAGED.length + groups.ROUTE.length;
  const mirrorStatus = mirror?.overall_status || (snapshotReady ? 'CHECKING' : 'UNAVAILABLE');

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
      data-flow-state={flow.state}
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
          <small>active across the eight-stage flow</small>
        </article>
        <article className="ops-control-metric" data-signal={decisionCount ? 'danger' : 'success'}>
          <div><span>Needs decision</span><ShieldAlert aria-hidden="true" /></div>
          <strong>{decisionCount}</strong>
          <small>{groups.NEEDS_ACTION.length} operational · {groups.FINANCE_REVIEW.length} finance</small>
        </article>
        <article className="ops-control-metric" data-signal="success">
          <div><span>Ready</span><BadgeCheck aria-hidden="true" /></div>
          <strong>{groups.READY.length}</strong>
          <small>release controls passed</small>
        </article>
        <article className="ops-control-metric" data-signal="information">
          <div><span>In execution</span><Route aria-hidden="true" /></div>
          <strong>{executionCount}</strong>
          <small>{groups.WAREHOUSE.length} warehouse · {groups.STAGED.length} staged · {groups.ROUTE.length} route</small>
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
          title="Operational flow"
          actions={(
            <ControlStatus
              tone={flow.state === 'partial' || flow.state === 'invalid' ? 'warning' : 'information'}
              label={flow.state === 'partial' || flow.state === 'invalid' ? 'PARTIAL' : `${flow.classifiedCount} CLASSIFIED`}
              compact
            />
          )}
        >
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
        </ControlPanel>
      </section>

      <PriorityWork />

      <div className="ops-control-status-line">
        {openOrders.length === serverCurrentOrders
          ? `${serverCurrentOrders} server-current orders classified`
          : `${openOrders.length} loaded open · ${serverCurrentOrders} server current`}
        {' · '}{flow.classifiedCount} flow-classified
        {' · '}{flow.excludedCount} cancelled
        {' · '}{flow.unknownCount} unknown
        {' · '}{n(readiness?.registered_barcodes)} package codes
        {' · '}{n(readiness?.live_on_hand_units)} live units
        {' · '}source checked {dateTime(mirror?.checked_at)}
      </div>
    </section>
  );
}