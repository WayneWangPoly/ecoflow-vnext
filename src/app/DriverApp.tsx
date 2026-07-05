import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Coffee,
  Flag,
  GripVertical,
  History,
  Home,
  List,
  Lock,
  Map as MapIcon,
  MapPin,
  Navigation,
  PenLine,
  Phone,
  Play,
  Printer,
  RotateCcw,
  Route,
  SkipForward,
  Truck,
  Unlock,
  Warehouse as WarehouseIcon,
  X
} from 'lucide-react';
import {
  appleMapsUrl,
  boxCodeForStop,
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
  optimiseStopOrder,
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
import { uploadPodAsset } from '@/data/repositories/pickSync';
import { allStopsStaged, buildRunCartons } from '@/domain/pickPlan';
import { stopsInLockedOrder } from '@/domain/driverRun';
import { BoxChip, BrandMark } from './Brand';
import { LabelSheet } from './LabelSheet';
import { PickBoard } from './PickBoard';
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

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.62));
      };
      img.onerror = () => reject(new Error('Image could not be read'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.readAsDataURL(file);
  });
}

function PhotoField({ label, value, onChange }: { label: string; value?: string; onChange: (next?: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange(await readImageAsDataUrl(file));
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

function SignaturePad({ onChange }: { onChange: (dataUrl?: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#123528';
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handleDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handleMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
  }

  function handleUp() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasInk.current) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    onChange(undefined);
  }

  return (
    <div className="signature-block">
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      />
      <div className="signature-hint-row">
        <span><PenLine size={14} /> Customer signs above</span>
        <button type="button" className="driver-ghost-button" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}

function PodSheet({ stop, stopNumber, onCancel, onSubmit }: { stop: RunStop; stopNumber: number; onCancel: () => void; onSubmit: (pod: PodRecord) => void }) {
  const [photo, setPhoto] = useState<string | undefined>();
  const [signature, setSignature] = useState<string | undefined>();
  const [receiverName, setReceiverName] = useState('');
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

  const canSubmit = Boolean(photo || signature);

  return (
    <div className="driver-overlay" role="dialog" aria-label={`Proof of delivery for ${stop.store}`}>
      <div className="driver-bottom-sheet">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div>
            <strong>Proof of delivery</strong>
            <span>Stop {stopNumber} · {stop.store}</span>
          </div>
          <button type="button" className="driver-icon-button" onClick={onCancel} aria-label="Close"><X size={20} /></button>
        </div>
        <PhotoField label="Take delivery photo" value={photo} onChange={setPhoto} />
        <SignaturePad onChange={setSignature} />
        <label className="pod-input">
          <span>Received by</span>
          <input value={receiverName} placeholder="Name of person on site" onChange={(event) => setReceiverName(event.target.value)} />
        </label>
        <label className="pod-input">
          <span>Delivery note</span>
          <input value={note} placeholder="Left at counter, cool room, etc." onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="pod-meta-line"><MapPin size={14} /> {formatGeoPoint(location)} · {formatClockTime(nowIso())}</div>
        {!canSubmit ? <div className="pod-requirement">A photo or a signature is required to complete this delivery.</div> : null}
        <button
          type="button"
          className="driver-primary-button"
          disabled={!canSubmit}
          onClick={() => onSubmit({
            photo,
            signature,
            receiverName: receiverName.trim() || undefined,
            note: note.trim() || undefined,
            location,
            capturedAt: nowIso()
          })}
        >
          <CheckCircle2 size={20} /> Confirm delivered
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
  return (
    <div className="pod-summary">
      <div className="pod-summary-head"><CheckCircle2 size={18} /> Delivered {formatClockTime(pod.capturedAt)}</div>
      <div className="pod-summary-meta">
        {pod.receiverName ? <span>Received by {pod.receiverName}</span> : <span>No receiver name recorded</span>}
        <span><MapPin size={13} /> {formatGeoPoint(pod.location)}</span>
        {pod.note ? <span>“{pod.note}”</span> : null}
      </div>
      <div className="pod-summary-thumbs">
        {pod.photo ? <img src={pod.photo} alt="Delivery photo" /> : null}
        {pod.signature ? <img className="pod-signature-thumb" src={pod.signature} alt="Customer signature" /> : null}
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
  const run = useMemo(() => buildDriverRun(orders, businessDay.date, day.releasedOrders), [orders, businessDay.date, day.releasedOrders]);
  const [tab, setTab] = useState<DriverTab>('today');
  const [stopsView, setStopsView] = useState<'map' | 'list'>('map');
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [podOpen, setPodOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [drag, setDrag] = useState<{ id: string; offset: number } | null>(null);
  const dragRef = useRef<{ id: string; offset: number } | null>(null);
  const dragStartY = useRef(0);
  const dragRowHeight = useRef(68);

  useEffect(() => saveDriverDayState(day), [day]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const pickSyncStatus = usePickSync(businessDay.date, day, setDay, actorLabel || 'Driver');

  // First look at the day: seed the driving order with the optimised route from the warehouse.
  useEffect(() => {
    if (!run.stops.length) return;
    setDay((current) => current.stopOrder ? current : { ...current, stopOrder: optimiseStopOrder(run.stops, run.warehousePoint) });
  }, [run.stops]);

  const orderIds = useMemo(
    () => day.stopOrder ? reconcileStopOrder(day.stopOrder, run.stops) : optimiseStopOrder(run.stops, run.warehousePoint),
    [day.stopOrder, run.stops]
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
    // Record locally first (offline-safe), then upload assets and sync the storage paths.
    patchStop(row.stop.orderId, { status: 'DELIVERED', completedAt: pod.capturedAt, pod });
    setOrderStatus(row.stop.orderId, 'DELIVERED', true);
    setPodOpen(false);
    setActiveStopId(null);
    setTab('stops');
    const stamp = pod.capturedAt.replace(/[:.]/g, '-');
    const prefix = `${businessDay.date}/${row.stop.orderId}`;
    const [photoPath, signaturePath] = await Promise.all([
      pod.photo ? uploadPodAsset(`${prefix}/photo-${stamp}.jpg`, pod.photo) : Promise.resolve(null),
      pod.signature ? uploadPodAsset(`${prefix}/signature-${stamp}.png`, pod.signature) : Promise.resolve(null)
    ]);
    if (photoPath || signaturePath) {
      setDay((current) => {
        const progress = current.stopProgress[row.stop.orderId];
        if (!progress?.pod || progress.pod.capturedAt !== pod.capturedAt) return current;
        return {
          ...current,
          stopProgress: {
            ...current.stopProgress,
            [row.stop.orderId]: {
              ...progress,
              pod: { ...progress.pod, photoPath: photoPath ?? progress.pod.photoPath, signaturePath: signaturePath ?? progress.pod.signaturePath }
            }
          }
        };
      });
    }
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

  function moveStop(orderId: string, delta: number) {
    setDay((current) => {
      const order = reconcileStopOrder(current.stopOrder, run.stops);
      const from = order.indexOf(orderId);
      if (from < 0) return current;
      const to = Math.max(0, Math.min(order.length - 1, from + delta));
      if (to === from) return current;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, orderId);
      return { ...current, stopOrder: next };
    });
  }

  function lockRoute() {
    const boxCodes: Record<string, string> = {};
    rows.forEach((row, index) => { boxCodes[row.stop.orderId] = boxCodeForStop(index); });
    setDay((current) => ({
      ...current,
      stopOrder: [...orderIds],
      pick: {
        lockedAt: nowIso(),
        stopOrder: [...orderIds],
        boxCodes,
        taskState: {},
        allocDone: {},
        stagedStops: {}
      }
    }));
    setTab('pick');
  }

  function unlockRoute() {
    const confirmed = window.confirm('Unlock the route? Printed labels become invalid and the pick plan is cleared.');
    if (!confirmed) return;
    setDay((current) => ({ ...current, pick: undefined }));
  }

  function applyOptimise() {
    const closedRowsInOrder = rows.filter((row) => isClosed(row.progress.status));
    const openStops = rows.filter((row) => !isClosed(row.progress.status)).map((row) => row.stop);
    const startPoint = closedRowsInOrder.length
      ? closedRowsInOrder[closedRowsInOrder.length - 1].stop.mapPoint
      : run.warehousePoint;
    const nextOrder = [
      ...closedRowsInOrder.map((row) => row.stop.orderId),
      ...optimiseStopOrder(openStops, startPoint)
    ];
    setDay((current) => ({ ...current, stopOrder: nextOrder }));
  }

  function handleDragStart(event: React.PointerEvent<HTMLButtonElement>, orderId: string) {
    const rowEl = event.currentTarget.closest('.reorder-row');
    dragRowHeight.current = rowEl instanceof HTMLElement ? rowEl.offsetHeight + 9 : 68;
    dragStartY.current = event.clientY;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture can fail for exotic pointer sources; drag still tracks via move events
    }
    dragRef.current = { id: orderId, offset: 0 };
    setDrag(dragRef.current);
  }

  function handleDragMove(event: React.PointerEvent<HTMLButtonElement>, orderId: string) {
    if (dragRef.current?.id !== orderId) return;
    dragRef.current = { id: orderId, offset: event.clientY - dragStartY.current };
    setDrag(dragRef.current);
  }

  function handleDragEnd(orderId: string) {
    const active = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (active && active.id === orderId) {
      const delta = Math.round(active.offset / dragRowHeight.current);
      if (delta) moveStop(orderId, delta);
    }
  }

  function handleDragCancel() {
    dragRef.current = null;
    setDrag(null);
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
            <p className="driver-card-meta">Step 1 · Review the stop order, then lock the route — locking fixes the A–F box letters and generates the pick plan and labels.</p>
            <button type="button" className="driver-primary-button" onClick={() => setTab('stops')}>
              <Route size={18} /> Review &amp; lock route
            </button>
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
        {stopsView === 'map' && rows.length > 1 && !routeLocked ? (
          <button type="button" className="optimise-button" onClick={applyOptimise}><Route size={15} /> Optimise</button>
        ) : null}
        {routeLocked ? (
          <button type="button" className="optimise-button" onClick={unlockRoute}><Unlock size={15} /> Unlock</button>
        ) : null}
      </div>

      {!routeLocked && rows.length ? (
        <section className="driver-card lock-cta-card">
          <p className="driver-card-meta">Happy with this order? Locking fixes the A–F box letters, prints from here on stay valid, and the pick plan is generated.</p>
          <button type="button" className="driver-primary-button" onClick={lockRoute}><Lock size={18} /> Confirm route &amp; lock</button>
        </section>
      ) : null}

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
              const dragging = drag?.id === row.stop.orderId;
              return (
                <div
                  key={row.stop.orderId}
                  className={cls('reorder-row', isCurrent && 'current', closed && 'closed', dragging && 'dragging')}
                  style={dragging ? { transform: `translateY(${drag.offset}px)` } : undefined}
                >
                  <button
                    type="button"
                    className="drag-handle"
                    disabled={closed}
                    aria-label={`Drag to reorder stop ${row.displayNumber}`}
                    onPointerDown={(event) => handleDragStart(event, row.stop.orderId)}
                    onPointerMove={(event) => handleDragMove(event, row.stop.orderId)}
                    onPointerUp={() => handleDragEnd(row.stop.orderId)}
                    onPointerCancel={handleDragCancel}
                  >
                    <GripVertical size={18} />
                  </button>
                  <span className={cls('reorder-num', isCurrent && 'current')}>{row.displayNumber}</span>
                  <BoxChip code={row.stop.boxCode} />
                  <button type="button" className="reorder-body" onClick={() => setActiveStopId(row.stop.orderId)}>
                    <strong>{row.stop.store}</strong>
                    <span>{row.stop.suburb} · {row.stop.cartons} ctn</span>
                    {isCurrent ? <em>UP NEXT</em> : null}
                  </button>
                  <StopStatusChip status={row.progress.status} />
                  <span className="reorder-arrows">
                    <button type="button" disabled={closed || index === 0} aria-label="Move stop earlier" onClick={() => moveStop(row.stop.orderId, -1)}><ArrowUp size={16} /></button>
                    <button type="button" disabled={closed || index === rows.length - 1} aria-label="Move stop later" onClick={() => moveStop(row.stop.orderId, 1)}><ArrowDown size={16} /></button>
                  </span>
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
      <p className="driver-card-meta">Lock the route first — the pick plan and box letters come from the locked stop order.</p>
      <button type="button" className="driver-primary-button" onClick={() => setTab('stops')}><Route size={18} /> Review &amp; lock route</button>
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
