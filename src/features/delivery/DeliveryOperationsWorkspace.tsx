import { useEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { setActiveRunCode } from '@/data/repositories/pickSync';
import {
  buildLockedDeliveryRouteSnapshot,
  loadLockedDeliveryRouteSnapshot,
  lockDeliveryRouteSnapshot,
  unlockDeliveryRouteSnapshot,
  type LockedDeliveryRouteRecord,
} from '@/data/repositories/deliveryRouteAuthority';
import { loadActiveDispatchDrivers, type DispatchDriver } from '@/data/repositories/deliveryDispatchDrivers';
import {
  boxCodeForStop,
  buildDriverRun,
  formatClockTime,
  optimiseStopOrder,
  reconcileStopOrder,
  startFreshRun,
  type DriverDayState,
} from '@/domain/driverRun';
import type { EcoFlowDataSet, ImportedOrder } from '@/domain/types';
import { PodAssetLink } from '@/app/PodAsset';
import { DeliveryDispatchCommandSurface } from './DeliveryDispatchCommandSurface';

function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'blue' }) {
  return <span className={cls('pill', `pill-${tone}`)}>{children}</span>;
}

function MetricCard({ label, value, tone = 'green', helper }: { label: string; value: string | number; tone?: 'green' | 'gold' | 'blue' | 'mint'; helper?: string }) {
  return (
    <article className={cls('metric-card', `metric-${tone}`)}>
      <strong>{value}</strong>
      <span>{label}</span>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function stopStatusLabelDesk(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function DeliveryOperationsWorkspace({ orders, day, setDay, businessDay, canPlan }: {
  orders: ImportedOrder[];
  day: DriverDayState;
  setDay: Dispatch<SetStateAction<DriverDayState>>;
  businessDay: EcoFlowDataSet['businessDay'];
  canPlan: boolean;
}) {
  const run = buildDriverRun(orders, businessDay.date, day.releasedOrders, day.runCode);
  const orderedIds = reconcileStopOrder(day.pick?.stopOrder || day.stopOrder, run.stops);
  const byId = new Map(run.stops.map((stop) => [stop.orderId, stop]));
  const stops = orderedIds.map((orderId, index) => {
    const stop = byId.get(orderId);
    return stop ? { ...stop, stopNumber: index + 1, boxCode: day.pick?.boxCodes[orderId] || boxCodeForStop(index) } : null;
  }).filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
  const stagedCount = day.pick ? stops.filter((stop) => day.pick?.stagedStops[stop.orderId]).length : 0;
  const progressFor = (orderId: string) => day.stopProgress[orderId];
  const deliveredCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'DELIVERED').length;
  const failedCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'FAILED').length;
  const routeInUse = Boolean(day.routeStartedAt || stagedCount || Object.keys(day.pick?.taskState || {}).length);
  const [dispatchDrivers, setDispatchDrivers] = useState<DispatchDriver[]>([]);
  const [driverDirectoryState, setDriverDirectoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [driverDirectoryError, setDriverDirectoryError] = useState('');
  const [assignedDriverUserId, setAssignedDriverUserId] = useState('');
  const [lockedRouteRecord, setLockedRouteRecord] = useState<LockedDeliveryRouteRecord | null>(null);
  const [lockedRouteError, setLockedRouteError] = useState('');

  useEffect(() => {
    let active = true;
    if (!canPlan) {
      setDispatchDrivers([]);
      setDriverDirectoryState('idle');
      setDriverDirectoryError('');
      return () => { active = false; };
    }
    setDriverDirectoryState('loading');
    setDriverDirectoryError('');
    void loadActiveDispatchDrivers()
      .then((rows) => {
        if (!active) return;
        setDispatchDrivers(rows);
        setAssignedDriverUserId((current) => rows.some((row) => row.userId === current) ? current : rows[0]?.userId || '');
        setDriverDirectoryState('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setDispatchDrivers([]);
        setAssignedDriverUserId('');
        setDriverDirectoryState('error');
        setDriverDirectoryError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [canPlan]);

  useEffect(() => {
    let active = true;
    if (!day.pick) {
      setLockedRouteRecord(null);
      setLockedRouteError('');
      return () => { active = false; };
    }
    setLockedRouteError('');
    void loadLockedDeliveryRouteSnapshot({ businessDay: businessDay.date, runCode: day.runCode })
      .then((record) => {
        if (!active) return;
        setLockedRouteRecord(record);
        if (record?.assignedDriverUserId) setAssignedDriverUserId(record.assignedDriverUserId);
      })
      .catch((reason) => {
        if (!active) return;
        setLockedRouteRecord(null);
        setLockedRouteError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [businessDay.date, day.pick?.lockedAt, day.runCode]);

  function setRouteOrder(orderIds: string[]) {
    setDay((current) => current.pick || current.routeStartedAt ? current : { ...current, stopOrder: orderIds });
  }

  function moveStop(orderId: string, delta: number) {
    const current = reconcileStopOrder(day.stopOrder, run.stops);
    const from = current.indexOf(orderId);
    const to = Math.max(0, Math.min(current.length - 1, from + delta));
    if (from < 0 || from === to) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, orderId);
    setRouteOrder(next);
  }

  function optimiseRoute() {
    if (day.pick || day.routeStartedAt) return;
    setRouteOrder(optimiseStopOrder(run.stops, run.warehousePoint));
  }

  async function lockRoute() {
    if (!canPlan || day.pick || !stops.length) return;
    if (!assignedDriverUserId) {
      window.alert('Route was not locked: choose an active Driver first.');
      return;
    }
    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);
    const boxCodes = Object.fromEntries(stopOrder.map((orderId, index) => [orderId, boxCodeForStop(index)]));
    const lockedStops = stopOrder
      .map((orderId, index) => {
        const stop = byId.get(orderId);
        return stop ? { ...stop, stopNumber: index + 1, boxCode: boxCodes[orderId] } : null;
      })
      .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
    if (lockedStops.length !== stopOrder.length) {
      window.alert('Route was not locked: one or more released stops disappeared from the route draft. Refresh and approve again.');
      return;
    }

    let authorityLocked = false;
    try {
      const snapshot = buildLockedDeliveryRouteSnapshot({
        ...run,
        stops: lockedStops,
        totalCartons: lockedStops.reduce((sum, stop) => sum + stop.cartons, 0),
        readyStops: lockedStops.filter((stop) => stop.warehouseReady).length,
      }, day.runCode);
      const authority = await lockDeliveryRouteSnapshot({
        businessDay: businessDay.date,
        runCode: day.runCode,
        assignedDriverUserId,
        snapshot,
      });
      setLockedRouteRecord(authority);
      authorityLocked = true;
      await setActiveRunCode(businessDay.date, day.runCode, 'Office route approval');
    } catch (error) {
      if (authorityLocked) {
        await unlockDeliveryRouteSnapshot({
          businessDay: businessDay.date,
          runCode: day.runCode,
          reason: 'Route approval rolled back because shared run activation failed',
        }).catch(() => undefined);
        setLockedRouteRecord(null);
      }
      window.alert(`Route was not locked: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setDay((current) => ({
      ...current,
      stopOrder,
      pick: {
        lockedAt: new Date().toISOString(),
        stopOrder,
        boxCodes,
        taskState: {},
        allocDone: {},
        stagedStops: {},
      },
    }));
  }

  async function unlockRoute() {
    if (!canPlan || !day.pick || routeInUse) return;
    if (!window.confirm('Unlock this route? Printed labels become invalid and must be reprinted.')) return;
    try {
      await unlockDeliveryRouteSnapshot({
        businessDay: businessDay.date,
        runCode: day.runCode,
        reason: 'Office unlocked route before picking',
      });
    } catch (error) {
      window.alert(`Route was not unlocked: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setLockedRouteRecord(null);
    setDay((current) => ({ ...current, pick: undefined }));
  }

  async function startNextRun() {
    if (!canPlan || !day.routeEndedAt) return;
    const next = startFreshRun(day);
    if (!window.confirm(`Start Run ${next.runCode}? Run ${day.runCode} remains in the server history and new releases will belong to the new run.`)) return;
    try {
      await setActiveRunCode(businessDay.date, next.runCode, 'Office next run');
    } catch (error) {
      window.alert(`Next run was not started: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setDay(next);
  }

  return (
    <section className="workspace-stack">
      <section className="quick-stats">
        <MetricCard label={`RUN ${day.runCode} RELEASED`} value={stops.length} tone="green" helper={businessDay.label} />
        <MetricCard label="ROUTE" value={day.pick ? `Locked ${formatClockTime(day.pick.lockedAt)}` : 'Office planning'} tone="gold" helper={day.routeStartedAt ? `started ${formatClockTime(day.routeStartedAt)}` : 'Owner/office approves order'} />
        <MetricCard label="STAGED" value={`${stagedCount}/${stops.length}`} tone="blue" helper="warehouse progress" />
        <MetricCard label="DELIVERED" value={`${deliveredCount}${failedCount ? ` · ${failedCount} failed` : ''}`} tone="mint" helper={day.routeEndedAt ? `run finished ${formatClockTime(day.routeEndedAt)}` : 'live from driver'} />
      </section>
      <DeliveryDispatchCommandSurface
        runCode={day.runCode}
        businessDayLabel={businessDay.label}
        stops={stops}
        warehousePoint={run.warehousePoint}
        day={day}
        assignedDriverLabel={lockedRouteRecord?.assignedDriverLabel || dispatchDrivers.find((driver) => driver.userId === assignedDriverUserId)?.label || ''}
      />
      {canPlan && day.routeEndedAt ? (
        <section className="panel">
          <div className="panel-head"><h2>Run {day.runCode} completed</h2><span>Previous run facts remain archived in their own server namespace</span></div>
          <button className="primary-small" type="button" onClick={() => void startNextRun()}>Start next delivery run</button>
        </section>
      ) : null}
      {canPlan && !day.routeStartedAt ? (
        <section className="panel">
          <div className="panel-head"><h2>Office route approval</h2><span>Labels, Driver hand-off and picking use this locked order</span></div>
          <div className="row-actions">
            {!day.pick ? (
              <select
                aria-label="Assigned Driver"
                value={assignedDriverUserId}
                disabled={driverDirectoryState !== 'ready' || !dispatchDrivers.length}
                onChange={(event) => setAssignedDriverUserId(event.target.value)}
              >
                <option value="">Assign Driver…</option>
                {dispatchDrivers.map((driver) => <option key={driver.userId} value={driver.userId}>{driver.label}</option>)}
              </select>
            ) : <span>Driver: {lockedRouteRecord?.assignedDriverLabel || 'loading assignment…'}</span>}
            <button className="soft-button" type="button" disabled={Boolean(day.pick) || !stops.length} onClick={optimiseRoute}>Optimise draft</button>
            {!day.pick ? <button className="primary-small" type="button" disabled={!stops.length || !assignedDriverUserId || driverDirectoryState !== 'ready'} onClick={() => void lockRoute()}>Approve &amp; lock route</button> : null}
            {day.pick ? <button className="soft-button" type="button" disabled={routeInUse} onClick={() => void unlockRoute()}>Unlock before picking</button> : null}
          </div>
          {!day.pick && driverDirectoryState === 'error' ? <small>Driver directory unavailable: {driverDirectoryError}</small> : null}
          {!day.pick && driverDirectoryState === 'ready' && !dispatchDrivers.length ? <small>No active Driver account is available. Add or activate a Driver before route approval.</small> : null}
          {day.pick && lockedRouteError ? <small>Locked Driver assignment unavailable: {lockedRouteError}. Unlock and re-approve before execution.</small> : null}
          <div className="list-stack">
            {stops.map((stop, index) => (
              <article className="stop-row" key={stop.orderId}>
                <b>{index + 1}</b>
                <div><strong>{stop.boxCode} · {stop.store}</strong><span>{stop.suburb} · {stop.cartons} ctn · {stop.orderNo}</span></div>
                {!day.pick ? <span className="row-actions"><button type="button" disabled={index === 0} onClick={() => moveStop(stop.orderId, -1)}>↑</button><button type="button" disabled={index === stops.length - 1} onClick={() => moveStop(stop.orderId, 1)}>↓</button></span> : <Pill tone="good">LOCKED</Pill>}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-head"><h2>Run board</h2><span>shared facts — same data the driver and warehouse see</span></div>
        <div className="list-stack">
          {stops.map((stop) => {
            const progress = progressFor(stop.orderId);
            const staged = day.pick?.stagedStops[stop.orderId];
            const status = progress?.status === 'DELIVERED' ? 'DELIVERED'
              : progress?.status === 'FAILED' ? 'FAILED'
              : progress?.status === 'ARRIVED' ? 'ARRIVED'
              : day.routeStartedAt ? 'ON THE WAY'
              : staged ? 'STAGED'
              : day.pick ? 'PICKING'
              : 'RELEASED';
            const pod = progress?.pod;
            return (
              <article className="stop-row" key={stop.orderId}>
                <b>{stop.stopNumber}</b>
                <div>
                  <strong>{stop.boxCode} · {stop.store}</strong>
                  <span>{stop.cartons} ctn · {stopStatusLabelDesk(status)}{progress?.completedAt ? ` ${formatClockTime(progress.completedAt)}` : ''}</span>
                  {pod?.pod1Path || pod?.pod2Path || pod?.photoPath || pod?.signaturePath ? (
                    <span className="pod-links">
                      {pod.pod1Path || pod.photoPath ? <PodAssetLink path={pod.pod1Path || pod.photoPath}>POD 1 · location</PodAssetLink> : null}
                      {pod.pod2Path || pod.signaturePath ? <PodAssetLink path={pod.pod2Path || pod.signaturePath}>POD 2 · all goods</PodAssetLink> : null}
                    </span>
                  ) : pod ? <span className="pod-links">POD upload pending</span> : null}
                </div>
                <Pill tone={status === 'DELIVERED' ? 'good' : status === 'FAILED' ? 'danger' : status === 'STAGED' || status === 'ON THE WAY' || status === 'ARRIVED' ? 'blue' : 'neutral'}>{status}</Pill>
              </article>
            );
          })}
          {!stops.length ? <div className="empty-state">No orders released into today’s run yet — release them from the Ordermentum tab.</div> : null}
        </div>
      </section>
    </section>
  );
}
