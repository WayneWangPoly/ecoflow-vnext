import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Coffee,
  Flag,
  History,
  Home,
  List,
  Map as MapIcon,
  MapPin,
  Navigation,
  Phone,
  Play,
  Printer,
  RotateCcw,
  Route,
  SkipForward,
  Truck,
  Warehouse as WarehouseIcon,
  X
} from 'lucide-react';
import {
  appleMapsUrl,
  buildDriverRun,
  capturePosition,
  formatClockTime,
  formatDuration,
  formatGeoPoint,
  googleMapsUrl,
  hasVerifiedAddress,
  initialStopProgress,
  lastEventOfType,
  loadDriverDayState,
  reconcileStopOrder,
  RUN_SIZE_WARNING,
  saveDriverDayState,
  shiftEventLabel,
  shiftStatusFromEvents,
  stopFailReasonLabel,
  stopFailReasons,
  WAREHOUSE,
  wazeUrl
} from '@/domain/driverRun';
import { saveDropPointProof, saveGoodsPlacedProof } from '@/data/repositories/deliveryPodQuality';
import { dispatchDeliveryNotifications, queueDeliveryNotifications } from '@/data/repositories/deliveryOperations';
import { readImageDownscaled } from '@/lib/downscaleImage';
import { allStopsStaged, buildRunCartons } from '@/domain/pickPlan';
import { stopsInLockedOrder } from '@/domain/driverRun';
import { BoxChip, BrandMark } from './Brand';
import { LabelSheet } from './LabelSheet';
import { PickBoard } from './PickBoard';
import { PodAssetImage } from './PodAsset';
import { usePickSync } from './usePickSync';
import type {
  DriverDayState,
  GeoPoint,
  MapPoint,
  PodRecord,
  RunStop,
  ShiftEventType,
  StopException,
  StopFailReason,
  StopProgress,
  StopStatus
} from '@/domain/driverRun';
import type { BusinessDay, DriverTab, ImportedOrder, OrderStatus } from '@/domain/types';

function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function nowIso() {
  return new Date().toISOString();
}

const CLOSED_STATUSES: StopStatus[] = ['DELIVERED', 'FAILED', 'SKIPPED'];

function isClosed(status: StopStatus) {
  return CLOSED_STATUSES.includes(status);
}

function stopStatusLabel(status: StopStatus): string {
  if (status === 'PENDING') return 'Pending';
  if (status === 'ARRIVED') return 'Arrived';
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'FAILED') return 'Failed';
  return 'Skipped';
}

function StopStatusChip({ status }: { status: StopStatus }) {
  return <span className={cls('stop-status-chip', `stop-status-${status.toLowerCase()}`)}>{stopStatusLabel(status)}</span>;
}

function PhotoField({ label, value, onChange }: { label: string; value?: string; onChange: (next?: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange(await readImageDownscaled(file, 900, 0.62));
    } catch {
      onChange(undefined);
    }
  }

  return (
    <div className="pod-field">
      {value ? (
        <div className="pod-photo-preview">
          <img src={value} alt="Captured proof" />
          <button type="button" className="driver-ghost-button" onClick={() => onChange(undefined)}><X size={15} /> Retake</button>
        </div>
      ) : (
        <button type="button" className="pod-capture-button" onClick={() => inputRef.current?.click()}>
          <Camera size={20} /> {label}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFile} />
    </div>
  );
}

function PodSheet({ stop, stopNumber, onCancel, onSubmit }: { stop: RunStop; stopNumber: number; onCancel: () => void; onSubmit: (pod: PodRecord) => Promise<void> }) {
  const [pod1Photo, setPod1Photo] = useState<string | undefined>();
  const [pod2Photo, setPod2Photo] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [location, setLocation] = useState<GeoPoint | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    capturePosition().then((point) => { if (active) setLocation(point); });
    return () => { active = false; };
  }, []);

  const canSubmit = Boolean(pod1Photo && pod2Photo) && !busy;

  async function submit() {
    if (!pod1Photo || !pod2Photo || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        pod1Photo,
        pod2Photo,
        note: note.trim() || undefined,
        location,
        capturedAt: nowIso(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <div className="driver-overlay" role="dialog" aria-label={`Proof of delivery for ${stop.store}`}>
      <div className="driver-bottom-sheet">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div><strong>Proof of delivery</strong><span>Stop {stopNumber} · {stop.store}</span></div>
          <button type="button" className="driver-icon-button" disabled={busy} onClick={onCancel} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="pod-quality-pod1-note"><b>1</b><span><strong>Store / placement point</strong><small>Show signage, entrance, counter or another recognisable delivery point.</small></span></div>
        <PhotoField label="Take POD 1 · store / placement point" value={pod1Photo} onChange={setPod1Photo} />
        <div className="pod-quality-pod1-note"><b>2</b><span><strong>All goods</strong><small>Show every delivered carton together at the agreed placement point.</small></span></div>
        <PhotoField label="Take POD 2 · all goods" value={pod2Photo} onChange={setPod2Photo} />
        <label className="pod-input"><span>Delivery note (optional)</span><input value={note} placeholder="Left at counter, rear door, etc." onChange={(event) => setNote(event.target.value)} /></label>
        <div className="pod-meta-line"><MapPin size={14} /> {formatGeoPoint(location)} · {formatClockTime(nowIso())}</div>
        {!pod1Photo || !pod2Photo ? <div className="pod-requirement">POD 1 and POD 2 are required. Receiver name and signature are not required.</div> : null}
        {error ? <div className="pod-requirement">Not completed: {error}</div> : null}
        <button type="button" className="driver-primary-button" disabled={!canSubmit} onClick={() => void submit()}>
          <CheckCircle2 size={20} /> {busy ? 'Uploading proof…' : 'Confirm delivered'}
        </button>
      </div>
    </div>
  );
}

function FailSheet({ stop, stopNumber, onCancel, onSubmit }: { stop: RunStop; stopNumber: number; onCancel: () => void; onSubmit: (exception: StopException) => void }) {
  const [reason, setReason] = useState<StopFailReason | null>(null);
  const [note, setNote] = useState('');
  const [location, setLocation] = useState<GeoPoint | undefined>();

  useEffect(() => {
    let active = true;
    capturePosition().then((point) => {
      if (active) setLocation(point);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="driver-overlay" role="dialog" aria-label={`Failed delivery for ${stop.store}`}>
      <div className="driver-bottom-sheet">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div>
            <strong>Failed delivery</strong>
            <span>Stop {stopNumber} · {stop.store}</span>
          </div>
          <button type="button" className="driver-icon-button" onClick={onCancel} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="fail-reason-list">
          {stopFailReasons.map((item) => (
            <button
              key={item.reason}
              type="button"
              className={cls('fail-reason-row', reason === item.reason && 'active')}
              onClick={() => setReason(item.reason)}
            >
              <span>{item.label}</span>
              {reason === item.reason ? <CheckCircle2 size={18} /> : null}
            </button>
          ))}
        </div>
        <label className="pod-input">
          <span>What happened?</span>
          <input value={note} placeholder="Add detail for the office" onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="pod-meta-line"><MapPin size={14} /> {formatGeoPoint(location)} · {formatClockTime(nowIso())}</div>
        <button
          type="button"
          className="driver-danger-button"
          disabled={!reason}
          onClick={() => reason && onSubmit({ reason, note: note.trim() || undefined, location, recordedAt: nowIso() })}
        >
          <AlertTriangle size={20} /> Record failed delivery
        </button>
      </div>
    </div>
  );
}

function PodSummary({ pod }: { pod: PodRecord }) {
  const pod1 = pod.pod1Photo || pod.pod1Path || pod.photo || pod.photoPath;
  const pod2 = pod.pod2Photo || pod.pod2Path || pod.signature || pod.signaturePath;
  return (
    <div className="pod-summary">
      <div className="pod-summary-head"><CheckCircle2 size={18} /> Delivered {formatClockTime(pod.capturedAt)}</div>
      <div className="pod-summary-meta">
        <span><MapPin size={13} /> {formatGeoPoint(pod.location)}</span>
        {pod.note ? <span>“{pod.note}”</span> : null}
      </div>
      <div className="pod-summary-thumbs">
        {pod1 ? <PodAssetImage path={pod1} alt="POD 1 store or placement point" /> : null}
        {pod2 ? <PodAssetImage path={pod2} alt="POD 2 all delivered goods" /> : null}
      </div>
    </div>
  );
}

function ExceptionSummary({ exception }: { exception: StopException }) {
  return (
    <div className="exception-summary">
      <div className="exception-summary-head"><AlertTriangle size={18} /> {stopFailReasonLabel(exception.reason)}</div>
      <div className="pod-summary-meta">
        <span>Recorded {formatClockTime(exception.recordedAt)}</span>
        <span><MapPin size={13} /> {formatGeoPoint(exception.location)}</span>
        {exception.note ? <span>“{exception.note}”</span> : null}
      </div>
    </div>
  );
}

type StopWithProgress = { stop: RunStop; progress: StopProgress; displayNumber: number };

const MAP_W = 400;
const MAP_H = 300;
const MAP_PAD = 32;
const MAP_NODE_R = 13;

function mapPixel(point: MapPoint) {
  return {
    x: MAP_PAD + point.x * (MAP_W - MAP_PAD * 2),
    y: MAP_PAD + point.y * (MAP_H - MAP_PAD * 2)
  };
}

function RouteMap({ rows, currentId, warehousePoint, onSelect }: { rows: StopWithProgress[]; currentId?: string; warehousePoint: MapPoint; onSelect: (orderId: string) => void }) {
  const warehousePx = mapPixel(warehousePoint);
  const points = rows.map((row) => ({ row, ...mapPixel(row.stop.mapPoint) }));

  const segments = points.map((to, index) => {
    const from = index === 0 ? { x: warehousePx.x, y: warehousePx.y } : points[index - 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const startGap = index === 0 ? 15 : MAP_NODE_R + 2;
    const tone = isClosed(to.row.progress.status) ? 'done' : to.row.stop.orderId === currentId ? 'next' : 'open';
    return {
      key: to.row.stop.orderId,
      x1: from.x + ux * startGap,
      y1: from.y + uy * startGap,
      x2: to.x - ux * (MAP_NODE_R + 7),
      y2: to.y - uy * (MAP_NODE_R + 7),
      tone
    };
  });

  return (
    <svg className="route-map-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Run map with stop order">
      <defs>
        <marker id="map-arrow-open" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#0f7d51" />
        </marker>
        <marker id="map-arrow-next" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#d1650a" />
        </marker>
        <marker id="map-arrow-done" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#a8bfb0" />
        </marker>
      </defs>

      {segments.map((segment) => (
        <line
          key={segment.key}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          className={`map-seg map-seg-${segment.tone}`}
          markerEnd={`url(#map-arrow-${segment.tone})`}
        />
      ))}

      <g className="map-warehouse">
        <rect x={warehousePx.x - 14} y={warehousePx.y - 14} width={28} height={28} rx={8} />
        <text x={warehousePx.x} y={warehousePx.y + 4.5} textAnchor="middle">W</text>
        <text className="map-warehouse-label" x={warehousePx.x} y={warehousePx.y + 28} textAnchor="middle">{WAREHOUSE.suburb}</text>
      </g>

      {points.map(({ row, x, y }) => {
        const closed = isClosed(row.progress.status);
        const current = row.stop.orderId === currentId;
        return (
          <g
            key={row.stop.orderId}
            className={cls('map-stop', closed && 'map-stop-done', current && 'map-stop-current')}
            onClick={() => onSelect(row.stop.orderId)}
          >
            <title>{`${row.displayNumber}. ${row.stop.store}`}</title>
            {current ? <circle className="map-stop-halo" cx={x} cy={y} r={MAP_NODE_R + 5} /> : null}
            <circle cx={x} cy={y} r={MAP_NODE_R} />
            <text x={x} y={y + 4.5} textAnchor="middle">{row.displayNumber}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function DriverApp({ orders, setOrders, businessDay, onLogout, loadError, actorLabel }: {
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  businessDay: BusinessDay;
  onLogout: () => void;
  loadError?: string;
  actorLabel?: string;
}) {
  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(businessDay.date));
  const run = useMemo(() => buildDriverRun(orders, businessDay.date, day.releasedOrders, day.runCode), [orders, businessDay.date, day.releasedOrders, day.runCode]);
  const [tab, setTab] = useState<DriverTab>('today');
  const [stopsView, setStopsView] = useState<'map' | 'list'>('map');
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [podOpen, setPodOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => saveDriverDayState(day), [day]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const pickSyncStatus = usePickSync(businessDay.date, day, setDay, actorLabel || 'Driver');

  const orderIds = useMemo(
    () => reconcileStopOrder(day.pick?.stopOrder || day.stopOrder, run.stops),
    [day.pick?.stopOrder, day.stopOrder, run.stops]
  );

  const rows: StopWithProgress[] = useMemo(() => {
    const byId = new Map(run.stops.map((stop) => [stop.orderId, stop]));
    return orderIds
      .map((id, index) => {
        const base = byId.get(id);
        if (!base) return null;
        const stop = day.pick?.boxCodes?.[id] ? { ...base, boxCode: day.pick.boxCodes[id] } : base;
        return { stop, progress: day.stopProgress[stop.orderId] ?? initialStopProgress(stop), displayNumber: index + 1 };
      })
      .filter((row): row is StopWithProgress => Boolean(row));
  }, [run.stops, orderIds, day.stopProgress, day.pick]);

  const closedRows = rows.filter((row) => isClosed(row.progress.status));
  const deliveredCount = rows.filter((row) => row.progress.status === 'DELIVERED').length;
  const failedCount = rows.filter((row) => row.progress.status === 'FAILED').length;
  const loadedCount = rows.filter((row) => row.progress.loaded || isClosed(row.progress.status)).length;
  // Loading runs in reverse stop order, so the most recent tick is the last loaded row in that direction.
  const lastLoadedRow = [...rows].reverse().filter((row) => row.progress.loaded && !isClosed(row.progress.status)).pop();
  const currentRow = rows.find((row) => !isClosed(row.progress.status));
  const allClosed = rows.length > 0 && closedRows.length === rows.length;

  const shiftStatus = shiftStatusFromEvents(day.shiftEvents);
  const clockInEvent = lastEventOfType(day.shiftEvents, 'CLOCK_IN');
  const routeStatus = day.routeEndedAt ? 'COMPLETED' : day.routeStartedAt ? 'IN_PROGRESS' : 'NOT_STARTED';

  const activeRow = activeStopId ? rows.find((row) => row.stop.orderId === activeStopId) ?? null : null;

  const dayHeading = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDay.date)) return businessDay.label;
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Adelaide',
      weekday: 'long',
      day: '2-digit',
      month: 'short'
    }).format(new Date(`${businessDay.date}T12:00:00Z`));
  }, [businessDay.date, businessDay.label]);

  function patchStop(orderId: string, patch: Partial<StopProgress>) {
    setDay((current) => {
      const stop = run.stops.find((item) => item.orderId === orderId);
      const base = current.stopProgress[orderId] ?? (stop ? initialStopProgress(stop) : { status: 'PENDING' as StopStatus });
      return { ...current, stopProgress: { ...current.stopProgress, [orderId]: { ...base, ...patch } } };
    });
  }

  function setOrderStatus(orderId: string, status: OrderStatus, podCaptured?: boolean) {
    setOrders((current) => current.map((order) => order.id === orderId
      ? { ...order, status, podStatus: podCaptured ? 'captured' : order.podStatus }
      : order));
  }

  async function pushShiftEvent(type: ShiftEventType) {
    const location = await capturePosition();
    setDay((current) => ({ ...current, shiftEvents: [...current.shiftEvents, { type, at: nowIso(), location }] }));
  }

  async function startRoute() {
    const pendingIds = rows.filter((row) => row.progress.status === 'PENDING').map((row) => row.stop.orderId);
    const startedAt = nowIso();
    const location = await capturePosition();
    setDay((current) => ({
      ...current,
      routeStartedAt: startedAt,
      shiftEvents: [...current.shiftEvents, { type: 'ROUTE_START', at: startedAt, location }]
    }));
    setOrders((current) => current.map((order) => pendingIds.includes(order.id) ? { ...order, status: 'OUT_FOR_DELIVERY' } : order));
    setTab('stops');
  }

  async function finishRoute() {
    const endedAt = nowIso();
    const location = await capturePosition();
    setDay((current) => ({
      ...current,
      routeEndedAt: endedAt,
      shiftEvents: [...current.shiftEvents, { type: 'ROUTE_END', at: endedAt, location }]
    }));
    setTab('today');
  }

  async function arriveAtStop(row: StopWithProgress) {
    const location = await capturePosition();
    patchStop(row.stop.orderId, { status: 'ARRIVED', arrivedAt: nowIso(), arrivedLocation: location });
  }

  async function completeDelivery(row: StopWithProgress, pod: PodRecord) {
    if (!pod.pod1Photo || !pod.pod2Photo) throw new Error('POD 1 and POD 2 are both required.');
    const context = {
      businessDay: businessDay.date,
      orderId: row.stop.orderId,
      orderNumber: row.stop.orderNo,
      stopNumber: row.displayNumber,
      boxCode: row.stop.boxCode,
      storeName: row.stop.store,
      actorLabel: actorLabel || 'Driver',
    };
    const [pod1Path, pod2Path] = await Promise.all([
      saveDropPointProof({ context, dataUrl: pod.pod1Photo }),
      saveGoodsPlacedProof({ context, dataUrl: pod.pod2Photo }),
    ]);
    await queueDeliveryNotifications({
      ...context,
      outcome: 'DELIVERED',
      eventKey: `${businessDay.date}:${row.stop.orderId}:DELIVERED`,
      storePhone: row.stop.phone || null,
      pod1Path,
      pod2Path,
      internalDetail: 'Full delivery completed with required two-photo POD.',
    });
    void dispatchDeliveryNotifications({ businessDay: businessDay.date, orderId: row.stop.orderId }).catch(() => undefined);

    const savedPod: PodRecord = {
      note: pod.note,
      location: pod.location,
      capturedAt: pod.capturedAt,
      pod1Path,
      pod2Path,
    };
    patchStop(row.stop.orderId, { status: 'DELIVERED', completedAt: pod.capturedAt, pod: savedPod });
    setOrderStatus(row.stop.orderId, 'DELIVERED', true);
    setPodOpen(false);
    setActiveStopId(null);
    setTab('stops');
  }

  function failDelivery(row: StopWithProgress, exception: StopException) {
    patchStop(row.stop.orderId, { status: 'FAILED', completedAt: exception.recordedAt, exception });
    setOrderStatus(row.stop.orderId, 'FAILED');
    setFailOpen(false);
    setActiveStopId(null);
    setTab('stops');
  }

  function skipStop(row: StopWithProgress) {
    patchStop(row.stop.orderId, { status: 'SKIPPED', completedAt: nowIso() });
    setActiveStopId(null);
  }

  function reopenStop(row: StopWithProgress) {
    patchStop(row.stop.orderId, { status: 'PENDING', completedAt: undefined, exception: undefined, pod: undefined, arrivedAt: undefined });
    setOrderStatus(row.stop.orderId, 'OUT_FOR_DELIVERY');
  }

  function toggleLoaded(row: StopWithProgress) {
    patchStop(row.stop.orderId, { loaded: !row.progress.loaded });
  }

  const shiftDuration = clockInEvent && shiftStatus !== 'OFF_SHIFT'
    ? formatDuration(now - new Date(clockInEvent.at).getTime())
    : null;

  const routeLocked = Boolean(day.pick);
  const stagedCount = day.pick ? run.stops.filter((stop) => day.pick?.stagedStops[stop.orderId]).length : 0;
  const stagedOk = day.pick ? allStopsStaged(day.pick, run.stops) : true;
  const runCartons = useMemo(
    () => (day.pick ? buildRunCartons(stopsInLockedOrder(run.stops, day.pick)) : []),
    [run.stops, day.pick]
  );

  const shiftCard = (
    <section className="driver-card">
      <div className="driver-card-head">
        <h2><Clock size={18} /> Shift</h2>
        <span className={cls('shift-chip', shiftStatus === 'ON_SHIFT' && 'on', shiftStatus === 'ON_BREAK' && 'break')}>
          {shiftStatus === 'OFF_SHIFT' ? 'Off shift' : shiftStatus === 'ON_BREAK' ? 'On break' : 'On shift'}
        </span>
      </div>
      {shiftStatus !== 'OFF_SHIFT' && clockInEvent ? (
        <p className="driver-card-meta">Clocked in {formatClockTime(clockInEvent.at)} · {shiftDuration} on shift</p>
      ) : (
        <p className="driver-card-meta">Clock in before starting the route so your day is on the timesheet.</p>
      )}
      <div className="driver-button-row">
        {shiftStatus === 'OFF_SHIFT' ? (
          <button type="button" className="driver-primary-button" onClick={() => pushShiftEvent('CLOCK_IN')}><Play size={18} /> Clock in</button>
        ) : (
          <>
            <button type="button" className="driver-ghost-button" onClick={() => pushShiftEvent(shiftStatus === 'ON_BREAK' ? 'BREAK_END' : 'BREAK_START')}>
              <Coffee size={16} /> {shiftStatus === 'ON_BREAK' ? 'End break' : 'Break'}
            </button>
            <button type="button" className="driver-ghost-button" onClick={() => pushShiftEvent('CLOCK_OUT')}>
              <Flag size={16} /> Clock out
            </button>
          </>
        )}
      </div>
    </section>
  );

  const todayScreen = (
    <>
      <section className="driver-hero">
        <span className="driver-eyebrow">TODAY’S RUN · {run.label}</span>
        <h1>{dayHeading}</h1>
        <div className="driver-hero-metrics">
          <div><strong>{rows.length}</strong><span>stops</span></div>
          <div><strong>{run.totalCartons}</strong><span>cartons</span></div>
          <div><strong>{routeLocked ? stagedCount : run.readyStops}/{rows.length}</strong><span>{routeLocked ? 'staged' : 'ready'}</span></div>
        </div>
      </section>

      {shiftCard}

      {rows.length > RUN_SIZE_WARNING ? (
        <p className="driver-inline-hint">{rows.length} stops in one run — consider splitting into Run A / Run B from the office before locking.</p>
      ) : null}

      <section className="driver-card">
        <div className="driver-card-head">
          <h2><Truck size={18} /> Route</h2>
          <span className={cls('shift-chip', routeStatus === 'IN_PROGRESS' && 'on', routeStatus === 'COMPLETED' && 'done')}>
            {routeStatus === 'NOT_STARTED' ? 'Not started' : routeStatus === 'IN_PROGRESS' ? 'In progress' : 'Completed'}
          </span>
        </div>

        {!rows.length ? (
          <p className="driver-card-meta">No orders released into today’s run yet — the office releases orders from the Ordermentum tab first.</p>
        ) : routeStatus === 'NOT_STARTED' && !routeLocked ? (
          <>
            <p className="driver-card-meta">Waiting for Owner or office to approve and lock today’s route. Stop order and box codes cannot be changed on the driver device.</p>
          </>
        ) : routeStatus === 'NOT_STARTED' && !stagedOk ? (
          <>
            <p className="driver-card-meta">Step 2 · Picking in progress — {stagedCount} of {rows.length} stops staged. Print the labels now and apply them as each stop is sealed.</p>
            <button type="button" className="driver-primary-button" onClick={() => setTab('pick')}>
              <ClipboardList size={18} /> Open picking
            </button>
            <button type="button" className="driver-ghost-button" onClick={() => setLabelsOpen(true)}>
              <Printer size={16} /> Print labels · {runCartons.length} cartons
            </button>
          </>
        ) : routeStatus === 'NOT_STARTED' ? (
          <>
            <p className="driver-card-meta">{loadedCount} of {rows.length} stops loaded · load in reverse order, last stop deepest in the van.</p>
            <button
              type="button"
              className="driver-primary-button"
              disabled={shiftStatus === 'OFF_SHIFT'}
              onClick={startRoute}
            >
              <Navigation size={18} /> Start route
            </button>
            {shiftStatus === 'OFF_SHIFT' ? <p className="driver-inline-hint">Clock in first to start the route.</p> : null}
          </>
        ) : routeStatus === 'IN_PROGRESS' ? (
          <>
            <p className="driver-card-meta">
              {deliveredCount} delivered · {failedCount} failed · {rows.length - closedRows.length} to go · started {formatClockTime(day.routeStartedAt)}
            </p>
            {allClosed ? (
              <button type="button" className="driver-primary-button" onClick={finishRoute}><Flag size={18} /> Finish route</button>
            ) : (
              <button type="button" className="driver-primary-button" onClick={() => setTab('stops')}><ChevronRight size={18} /> Continue route</button>
            )}
          </>
        ) : (
          <p className="driver-card-meta">
            Route finished {formatClockTime(day.routeEndedAt)} · {deliveredCount} delivered, {failedCount} failed
            {day.routeStartedAt && day.routeEndedAt ? ` · ${formatDuration(new Date(day.routeEndedAt).getTime() - new Date(day.routeStartedAt).getTime())} on the road` : ''}.
          </p>
        )}
      </section>

      {routeStatus === 'IN_PROGRESS' && currentRow ? (
        <section className="driver-card next-stop-card">
          <div className="driver-card-head">
            <h2><MapPin size={18} /> Next stop</h2>
            <BoxChip code={currentRow.stop.boxCode} />
          </div>
          <p className="next-stop-store">{currentRow.displayNumber}. {currentRow.stop.store}</p>
          <p className="driver-card-meta">{currentRow.stop.address} · {currentRow.stop.cartons} carton{currentRow.stop.cartons === 1 ? '' : 's'}</p>
          <button type="button" className="driver-primary-button" onClick={() => setActiveStopId(currentRow.stop.orderId)}>
            Open stop <ChevronRight size={18} />
          </button>
        </section>
      ) : null}

      {routeStatus === 'NOT_STARTED' && rows.length && routeLocked && stagedOk ? (
        <section className="driver-card">
          <div className="driver-card-head">
            <h2><Truck size={18} /> Load truck</h2>
            <span className="driver-card-count">{loadedCount}/{rows.length}</span>
          </div>
          <p className="driver-card-meta">Reverse loading order — tick each stop as its cartons go in.</p>
          <div className="load-list">
            {[...rows].reverse().map((row) => (
              <button
                key={row.stop.orderId}
                type="button"
                className={cls('load-row', (row.progress.loaded || isClosed(row.progress.status)) && 'loaded')}
                onClick={() => toggleLoaded(row)}
              >
                <BoxChip code={row.stop.boxCode} />
                <div className="load-copy">
                  <strong>{row.displayNumber}. {row.stop.store}</strong>
                  <span>{row.stop.cartons} carton{row.stop.cartons === 1 ? '' : 's'} · {row.stop.suburb}</span>
                </div>
                <span className="load-check">{row.progress.loaded || isClosed(row.progress.status) ? <CheckCircle2 size={22} /> : null}</span>
              </button>
            ))}
          </div>
          {lastLoadedRow ? (
            <button type="button" className="driver-ghost-button" onClick={() => toggleLoaded(lastLoadedRow)}>
              <RotateCcw size={15} /> Undo last load · {loadedCount}/{rows.length}
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  );

  const stopsScreen = (
    <>
      <section className="run-progress-card">
        <div className="run-progress-head">
          <strong>{closedRows.length} of {rows.length} stops done</strong>
          <span>{deliveredCount} delivered · {failedCount} failed</span>
        </div>
        <div className="run-progress-track">
          <div className="run-progress-fill" style={{ width: rows.length ? `${(closedRows.length / rows.length) * 100}%` : '0%' }} />
        </div>
      </section>

      <div className="stops-toolbar">
        <div className="view-toggle" role="tablist" aria-label="Stops view">
          <button type="button" className={cls(stopsView === 'map' && 'active')} onClick={() => setStopsView('map')}><MapIcon size={15} /> Map</button>
          <button type="button" className={cls(stopsView === 'list' && 'active')} onClick={() => setStopsView('list')}><List size={15} /> List</button>
        </div>
        <span className="driver-inline-hint">Route order is approved by office and read-only on this device.</span>
      </div>


      {stopsView === 'map' ? (
        <>
          <section className="route-map-card">
            <RouteMap rows={rows} currentId={currentRow?.stop.orderId} warehousePoint={run.warehousePoint} onSelect={setActiveStopId} />
            <div className="map-start-line"><WarehouseIcon size={14} /> Start: {WAREHOUSE.address}</div>
          </section>
          <div className="stop-list">
            {rows.map((row, index) => {
              const closed = isClosed(row.progress.status);
              const isCurrent = routeStatus === 'IN_PROGRESS' && currentRow?.stop.orderId === row.stop.orderId;
              return (
                <div
                  key={row.stop.orderId}
                  className={cls('reorder-row', isCurrent && 'current', closed && 'closed')}
                >
                  <span className={cls('reorder-num', isCurrent && 'current')}>{row.displayNumber}</span>
                  <BoxChip code={row.stop.boxCode} />
                  <button type="button" className="reorder-body" onClick={() => setActiveStopId(row.stop.orderId)}>
                    <strong>{row.stop.store}</strong>
                    <span>{row.stop.suburb} · {row.stop.cartons} ctn</span>
                    {isCurrent ? <em>UP NEXT</em> : null}
                  </button>
                  <StopStatusChip status={row.progress.status} />
                </div>
              );
            })}
            {!rows.length ? <div className="empty-state">No stops on today’s run yet.</div> : null}
          </div>
        </>
      ) : (
        <div className="stop-list">
          {rows.map((row) => {
            const isCurrent = routeStatus === 'IN_PROGRESS' && currentRow?.stop.orderId === row.stop.orderId;
            return (
              <button
                key={row.stop.orderId}
                type="button"
                className={cls('stop-card', isCurrent && 'current', isClosed(row.progress.status) && 'closed')}
                onClick={() => setActiveStopId(row.stop.orderId)}
              >
                <span className="stop-seq">{row.displayNumber}</span>
                <BoxChip code={row.stop.boxCode} />
                <div className="stop-copy">
                  <strong>{row.stop.store}</strong>
                  <span>{row.stop.suburb} · {row.stop.cartons} ctn{row.stop.deliveryNote ? ' · note' : ''}</span>
                  {isCurrent ? <em>UP NEXT</em> : null}
                </div>
                <StopStatusChip status={row.progress.status} />
                <ChevronRight size={18} className="stop-chevron" />
              </button>
            );
          })}
          {!rows.length ? <div className="empty-state">No stops on today’s run yet.</div> : null}
        </div>
      )}
    </>
  );

  const historyRows = [...closedRows].sort((a, b) => String(b.progress.completedAt || '').localeCompare(String(a.progress.completedAt || '')));

  const historyScreen = (
    <div className="stop-list">
      {historyRows.map((row) => (
        <article key={row.stop.orderId} className="history-row">
          <div className="history-head">
            <strong>{formatClockTime(row.progress.completedAt)}</strong>
            <span>{row.displayNumber}. {row.stop.store}</span>
            <StopStatusChip status={row.progress.status} />
          </div>
          {row.progress.pod ? <PodSummary pod={row.progress.pod} /> : null}
          {row.progress.exception ? <ExceptionSummary exception={row.progress.exception} /> : null}
        </article>
      ))}
      {!historyRows.length ? <div className="empty-state">Completed and failed stops will appear here with their proof of delivery.</div> : null}
    </div>
  );

  const clockScreen = (
    <>
      {shiftCard}
      <section className="driver-card">
        <div className="driver-card-head"><h2><History size={18} /> Today’s timeline</h2></div>
        <div className="clock-event-list">
          {[...day.shiftEvents].reverse().map((event, index) => (
            <div key={`${event.type}-${event.at}-${index}`} className="clock-event-row">
              <strong>{formatClockTime(event.at)}</strong>
              <div>
                <span>{shiftEventLabel(event.type)}</span>
                <small><MapPin size={12} /> {formatGeoPoint(event.location)}</small>
              </div>
            </div>
          ))}
          {!day.shiftEvents.length ? <div className="empty-state">No shift activity yet today.</div> : null}
        </div>
      </section>
    </>
  );

  const stopDetail = activeRow ? (
    <div className="driver-sheet">
      <header className="sheet-topbar">
        <button type="button" className="driver-icon-button" onClick={() => setActiveStopId(null)} aria-label="Back"><ChevronLeft size={22} /></button>
        <div className="sheet-title">
          <strong>Stop {activeRow.displayNumber} of {rows.length}</strong>
          <span>{run.label}</span>
        </div>
        <StopStatusChip status={activeRow.progress.status} />
      </header>
      <div className="sheet-body">
        <section className="detail-store-block">
          <div className="detail-store-head">
            <h2>{activeRow.stop.store}</h2>
            <BoxChip code={activeRow.stop.boxCode} large />
          </div>
          <p className="detail-address">{activeRow.stop.address}</p>
          <div className="detail-chip-row">
            <span className="detail-chip">{activeRow.stop.cartons} carton{activeRow.stop.cartons === 1 ? '' : 's'}</span>
            <span className="detail-chip">ETA {activeRow.stop.eta}</span>
            <span className={cls('detail-chip', !(activeRow.stop.warehouseReady || day.pick?.stagedStops[activeRow.stop.orderId]) && 'detail-chip-warn')}>
              {activeRow.stop.warehouseReady || day.pick?.stagedStops[activeRow.stop.orderId] ? 'Warehouse ready' : 'Still packing'}
            </span>
          </div>
          {activeRow.stop.deliveryNote ? (
            <div className="driver-callout"><AlertTriangle size={15} /> {activeRow.stop.deliveryNote}</div>
          ) : null}
        </section>

        <section className="detail-section">
          <h3>Navigate</h3>
          {hasVerifiedAddress(activeRow.stop.address) ? (
            <div className="nav-links-row">
              <a className="nav-link-button" href={googleMapsUrl(activeRow.stop.address)} target="_blank" rel="noreferrer"><Navigation size={17} /> Google</a>
              <a className="nav-link-button" href={appleMapsUrl(activeRow.stop.address)} target="_blank" rel="noreferrer"><MapPin size={17} /> Apple</a>
              <a className="nav-link-button" href={wazeUrl(activeRow.stop.address)} target="_blank" rel="noreferrer"><Navigation size={17} /> Waze</a>
            </div>
          ) : (
            <div className="driver-callout"><AlertTriangle size={15} /> No verified delivery address for this store yet — navigation is disabled until the site master has one.</div>
          )}
          {activeRow.stop.phone ? (
            <a className="nav-link-button phone-link" href={`tel:${activeRow.stop.phone}`}><Phone size={17} /> Call {activeRow.stop.store}</a>
          ) : null}
        </section>

        <section className="detail-section">
          <h3>Order {activeRow.stop.orderNo} · {activeRow.stop.invoiceNo}</h3>
          <div className="detail-line-list">
            {activeRow.stop.lines.map((line) => (
              <div key={`${line.sku}-${line.name}`} className="detail-line-row">
                <div><strong>{line.sku}</strong><span>{line.name}</span></div>
                <b>{line.qty} {line.unit}</b>
              </div>
            ))}
          </div>
        </section>

        {activeRow.progress.arrivedAt && !isClosed(activeRow.progress.status) ? (
          <div className="pod-meta-line"><MapPin size={14} /> Arrived {formatClockTime(activeRow.progress.arrivedAt)} · {formatGeoPoint(activeRow.progress.arrivedLocation)}</div>
        ) : null}
        {activeRow.progress.pod ? <PodSummary pod={activeRow.progress.pod} /> : null}
        {activeRow.progress.exception ? <ExceptionSummary exception={activeRow.progress.exception} /> : null}
      </div>

      <footer className="sheet-actions">
        {activeRow.progress.status === 'PENDING' ? (
          <>
            {routeStatus === 'NOT_STARTED' ? <p className="driver-inline-hint">Route hasn’t started yet — start it from Today when the van is loaded.</p> : null}
            <button type="button" className="driver-primary-button" onClick={() => arriveAtStop(activeRow)}><MapPin size={20} /> I’ve arrived</button>
            <div className="driver-button-row">
              <button type="button" className="driver-danger-ghost" onClick={() => setFailOpen(true)}><AlertTriangle size={16} /> Problem</button>
              <button type="button" className="driver-ghost-button" onClick={() => skipStop(activeRow)}><SkipForward size={16} /> Skip for now</button>
            </div>
          </>
        ) : null}
        {activeRow.progress.status === 'ARRIVED' ? (
          <>
            <button type="button" className="driver-primary-button" onClick={() => setPodOpen(true)}><Camera size={20} /> Capture POD &amp; complete</button>
            <button type="button" className="driver-danger-ghost" onClick={() => setFailOpen(true)}><AlertTriangle size={16} /> Failed delivery</button>
          </>
        ) : null}
        {activeRow.progress.status === 'FAILED' || activeRow.progress.status === 'SKIPPED' ? (
          <button type="button" className="driver-ghost-button" onClick={() => reopenStop(activeRow)}><RotateCcw size={16} /> Reopen stop</button>
        ) : null}
      </footer>

      {podOpen ? <PodSheet stop={activeRow.stop} stopNumber={activeRow.displayNumber} onCancel={() => setPodOpen(false)} onSubmit={(pod) => completeDelivery(activeRow, pod)} /> : null}
      {failOpen ? <FailSheet stop={activeRow.stop} stopNumber={activeRow.displayNumber} onCancel={() => setFailOpen(false)} onSubmit={(exception) => failDelivery(activeRow, exception)} /> : null}
    </div>
  ) : null;

  const pickScreen = routeLocked ? (
    <PickBoard orders={orders} businessDay={businessDay} day={day} setDay={setDay} syncStatus={pickSyncStatus} />
  ) : (
    <section className="driver-card">
      <div className="driver-card-head"><h2><ClipboardList size={18} /> Picking</h2></div>
      <p className="driver-card-meta">Waiting for Owner or office to approve and lock today’s route. Picking and labels become available automatically.</p>
    </section>
  );

  const navItems: { id: DriverTab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: 'today', label: 'Today', icon: <Home size={21} /> },
    { id: 'pick', label: 'Pick', icon: <ClipboardList size={21} />, badge: routeLocked && !stagedOk ? rows.length - stagedCount : undefined },
    { id: 'stops', label: 'Stops', icon: <MapPin size={21} />, badge: rows.length - closedRows.length },
    { id: 'history', label: 'History', icon: <History size={21} /> },
    { id: 'clock', label: 'Clock', icon: <Clock size={21} /> }
  ];

  return (
    <main className="driver-shell">
      <header className="driver-topbar">
        <div className="driver-topbar-brand">
          <BrandMark />
          <div>
            <strong>EcoFlow</strong>
            <span>DRIVER · {run.label}</span>
          </div>
        </div>
        <button type="button" className="driver-topbar-logout" onClick={onLogout}>Logout</button>
      </header>

      {loadError ? <div className="sync-error-banner">Supabase orders failed to load — showing fallback data. {loadError}</div> : null}

      <section className="driver-content">
        {tab === 'today' ? todayScreen : null}
        {tab === 'pick' ? pickScreen : null}
        {tab === 'stops' ? stopsScreen : null}
        {tab === 'history' ? historyScreen : null}
        {tab === 'clock' ? clockScreen : null}
      </section>

      <nav className="driver-nav" aria-label="Driver navigation">
        {navItems.map((item) => (
          <button key={item.id} type="button" className={cls(tab === item.id && 'active')} onClick={() => { setTab(item.id); setActiveStopId(null); }}>
            <span className="driver-nav-icon">
              {item.icon}
              {item.badge ? <b className="driver-nav-badge">{item.badge}</b> : null}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {stopDetail}
      {labelsOpen && routeLocked ? (
        <LabelSheet cartons={runCartons} runLabel={run.label} dateLabel={businessDay.label} onClose={() => setLabelsOpen(false)} />
      ) : null}
    </main>
  );
}
