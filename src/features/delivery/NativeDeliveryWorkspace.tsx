import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { PodAssetLink } from '@/app/PodAsset';
import { setActiveRunCode } from '@/data/repositories/pickSync';
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
import { NativeWorkspaceEmpty, NativeWorkspaceFrame } from '@/features/navigation/NativeWorkspaceFrame';

function statusTone(status: string) {
  if (status === 'DELIVERED') return 'good';
  if (status === 'FAILED') return 'danger';
  if (['STAGED', 'ON THE WAY', 'ARRIVED'].includes(status)) return 'blue';
  return 'neutral';
}

function DeliveryMetric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function StatusChip({ status }: { status: string }) {
  return <span className={`status-chip ${statusTone(status)}`}>{status}</span>;
}

export function NativeDeliveryWorkspace({
  orders,
  day,
  setDay,
  businessDay,
  canPlan,
}: {
  orders: ImportedOrder[];
  day: DriverDayState;
  setDay: Dispatch<SetStateAction<DriverDayState>>;
  businessDay: EcoFlowDataSet['businessDay'];
  canPlan: boolean;
}) {
  const [command, setCommand] = useState<'UNLOCK' | 'NEXT_RUN' | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useMemo(
    () => buildDriverRun(orders, businessDay.date, day.releasedOrders, day.runCode),
    [businessDay.date, day.releasedOrders, day.runCode, orders],
  );
  const orderedIds = reconcileStopOrder(day.pick?.stopOrder || day.stopOrder, run.stops);
  const byId = new Map(run.stops.map((stop) => [stop.orderId, stop]));
  const stops = orderedIds
    .map((orderId, index) => {
      const stop = byId.get(orderId);
      return stop ? {
        ...stop,
        stopNumber: index + 1,
        boxCode: day.pick?.boxCodes[orderId] || boxCodeForStop(index),
      } : null;
    })
    .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
  const stagedCount = day.pick ? stops.filter((stop) => day.pick?.stagedStops[stop.orderId]).length : 0;
  const deliveredCount = stops.filter((stop) => day.stopProgress[stop.orderId]?.status === 'DELIVERED').length;
  const failedCount = stops.filter((stop) => day.stopProgress[stop.orderId]?.status === 'FAILED').length;
  const routeInUse = Boolean(day.routeStartedAt || stagedCount || Object.keys(day.pick?.taskState || {}).length);

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
    setMessage('Draft route optimised. Labels remain unchanged until the route is locked.');
  }

  async function lockRoute() {
    if (!canPlan || day.pick || !stops.length) return;
    setBusy(true);
    setMessage('');
    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);
    const boxCodes = Object.fromEntries(stopOrder.map((orderId, index) => [orderId, boxCodeForStop(index)]));
    try {
      await setActiveRunCode(businessDay.date, day.runCode, 'Office route approval');
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
      setMessage(`Run ${day.runCode} locked. Warehouse labels and pick sequence now use this stop order.`);
    } catch (error) {
      setMessage(`Route was not locked: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function confirmUnlock() {
    if (!canPlan || !day.pick || routeInUse) return;
    setDay((current) => ({ ...current, pick: undefined }));
    setCommand(null);
    setMessage('Route unlocked before picking. Reprint labels after the new order is locked.');
  }

  async function confirmNextRun() {
    if (!canPlan || !day.routeEndedAt) return;
    const next = startFreshRun(day);
    setBusy(true);
    try {
      await setActiveRunCode(businessDay.date, next.runCode, 'Office next run');
      setDay(next);
      setCommand(null);
      setMessage(`Run ${next.runCode} started. Run ${day.runCode} remains in server history.`);
    } catch (error) {
      setMessage(`Next run was not started: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <NativeWorkspaceFrame
      eyebrow="SHARED ROUTE AUTHORITY"
      title={`Delivery Run ${day.runCode}`}
      detail="Office route approval, warehouse staging and driver POD all read the same authoritative day state."
      actions={<span className="status-chip">{businessDay.label}</span>}
    >
      <section className="quick-stats">
        <DeliveryMetric label="Released stops" value={stops.length} detail={`Run ${day.runCode}`} />
        <DeliveryMetric label="Route" value={day.pick ? `Locked ${formatClockTime(day.pick.lockedAt)}` : 'Planning'} detail={day.routeStartedAt ? `Started ${formatClockTime(day.routeStartedAt)}` : 'Office approval required'} />
        <DeliveryMetric label="Staged" value={`${stagedCount}/${stops.length}`} detail="Warehouse progress" />
        <DeliveryMetric label="Delivered" value={`${deliveredCount}${failedCount ? ` · ${failedCount} failed` : ''}`} detail={day.routeEndedAt ? `Ended ${formatClockTime(day.routeEndedAt)}` : 'Live driver state'} />
      </section>

      {message ? <div className="native-workspace-notice" role="status">{message}</div> : null}

      {canPlan && day.routeEndedAt ? (
        <section className="panel">
          <div className="panel-head"><div><h2>Run {day.runCode} completed</h2><span>Previous run facts remain archived in their own server namespace.</span></div></div>
          {command === 'NEXT_RUN' ? <div className="native-workspace-notice"><strong>Start the next sequential run?</strong><span>New releases will belong to the next run. Existing POD and completion facts remain unchanged.</span><div className="row-actions"><button type="button" disabled={busy} onClick={() => setCommand(null)}>Cancel</button><button className="primary-button" type="button" disabled={busy} onClick={() => void confirmNextRun()}>{busy ? 'Starting…' : `Start Run ${startFreshRun(day).runCode}`}</button></div></div> : <button className="primary-button" type="button" onClick={() => setCommand('NEXT_RUN')}>Start next delivery run</button>}
        </section>
      ) : null}

      {canPlan && !day.routeStartedAt ? (
        <section className="panel">
          <div className="panel-head"><div><h2>Office route approval</h2><span>Locked order controls physical labels and warehouse picking.</span></div><div className="row-actions"><button type="button" disabled={Boolean(day.pick) || !stops.length} onClick={optimiseRoute}>Optimise draft</button>{!day.pick ? <button className="primary-button" type="button" disabled={busy || !stops.length} onClick={() => void lockRoute()}>{busy ? 'Locking…' : 'Approve and lock route'}</button> : null}</div></div>
          {day.pick && !routeInUse ? (command === 'UNLOCK' ? <div className="native-workspace-notice"><strong>Unlocking invalidates printed labels.</strong><span>Only continue before any picking or staging activity begins.</span><div className="row-actions"><button type="button" onClick={() => setCommand(null)}>Keep locked</button><button type="button" onClick={confirmUnlock}>Unlock route</button></div></div> : <button type="button" onClick={() => setCommand('UNLOCK')}>Unlock before picking</button>) : null}
          <div className="list-stack">
            {stops.map((stop, index) => <article className="stop-row" key={stop.orderId}><b>{index + 1}</b><div><strong>{stop.boxCode} · {stop.store}</strong><span>{stop.suburb} · {stop.cartons} ctn · {stop.orderNo}</span></div>{!day.pick ? <span className="row-actions"><button type="button" aria-label={`Move ${stop.store} up`} disabled={index === 0} onClick={() => moveStop(stop.orderId, -1)}>↑</button><button type="button" aria-label={`Move ${stop.store} down`} disabled={index === stops.length - 1} onClick={() => moveStop(stop.orderId, 1)}>↓</button></span> : <StatusChip status="LOCKED" />}</article>)}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head"><div><h2>Run board</h2><span>The same facts visible to warehouse and driver devices.</span></div></div>
        {!stops.length ? <NativeWorkspaceEmpty title="No released stops" detail="Release eligible orders from Ordermentum. They will appear here without rebuilding the route shell." /> : null}
        <div className="list-stack">
          {stops.map((stop) => {
            const progress = day.stopProgress[stop.orderId];
            const staged = day.pick?.stagedStops[stop.orderId];
            const status = progress?.status === 'DELIVERED' ? 'DELIVERED'
              : progress?.status === 'FAILED' ? 'FAILED'
              : progress?.status === 'ARRIVED' ? 'ARRIVED'
              : day.routeStartedAt ? 'ON THE WAY'
              : staged ? 'STAGED'
              : day.pick ? 'PICKING'
              : 'RELEASED';
            const pod = progress?.pod;
            return <article className="stop-row" key={stop.orderId}><b>{stop.stopNumber}</b><div><strong>{stop.boxCode} · {stop.store}</strong><span>{stop.cartons} ctn · {status.toLowerCase().replaceAll('_', ' ')}{progress?.completedAt ? ` ${formatClockTime(progress.completedAt)}` : ''}</span>{pod?.pod1Path || pod?.pod2Path || pod?.photoPath || pod?.signaturePath ? <span className="pod-links">{pod.pod1Path || pod.photoPath ? <PodAssetLink path={pod.pod1Path || pod.photoPath}>POD 1 · location</PodAssetLink> : null}{pod.pod2Path || pod.signaturePath ? <PodAssetLink path={pod.pod2Path || pod.signaturePath}>POD 2 · all goods</PodAssetLink> : null}</span> : pod ? <span className="pod-links">POD upload pending</span> : null}</div><StatusChip status={status} /></article>;
          })}
        </div>
      </section>
    </NativeWorkspaceFrame>
  );
}
