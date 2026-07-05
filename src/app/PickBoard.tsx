import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Lock,
  Printer,
  RotateCcw,
  ScanLine,
  ShoppingCart,
  X
} from 'lucide-react';
import { buildDriverRun, formatClockTime, stopsInLockedOrder } from '@/domain/driverRun';
import type { DriverDayState, RunStop } from '@/domain/driverRun';
import {
  allocKey,
  buildBulkTasks,
  buildRunCartons,
  countPickedTasks,
  groupIntoTrips,
  stopAllocationsComplete,
  taskStateFor,
  TROLLEY_CAPACITY
} from '@/domain/pickPlan';
import type { BulkPickTask, PickState } from '@/domain/pickPlan';
import type { BusinessDay, ImportedOrder } from '@/domain/types';
import { BoxChip } from './Brand';
import { LabelSheet } from './LabelSheet';

function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function nowIso() {
  return new Date().toISOString();
}

type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function ScanSheet({ task, onResult, onClose }: {
  task: BulkPickTask;
  onResult: (value: string | null) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let active = true;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setError('This device has no built-in barcode scanner. Type the code or skip.');
      return undefined;
    }
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((mediaStream) => {
        if (!active) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => undefined);
        }
        timer = window.setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || !active) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && active) {
              active = false;
              onResultRef.current(codes[0].rawValue);
            }
          } catch {
            // keep scanning; transient decode errors are normal
          }
        }, 350);
      })
      .catch(() => setError('Camera unavailable. Type the code or skip.'));
    return () => {
      active = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="driver-overlay" role="dialog" aria-label={`Scan barcode for ${task.sku}`}>
      <div className="driver-bottom-sheet">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div>
            <strong>Scan sleeve barcode</strong>
            <span>{task.sku} · {task.name}</span>
          </div>
          <button type="button" className="driver-icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {!error ? (
          <video ref={videoRef} className="scan-video" muted playsInline />
        ) : (
          <div className="driver-inline-hint">{error}</div>
        )}
        <label className="pod-input">
          <span>Or type the code</span>
          <input value={manual} inputMode="numeric" placeholder="Barcode digits" onChange={(event) => setManual(event.target.value)} />
        </label>
        <div className="driver-button-row">
          <button type="button" className="driver-ghost-button" disabled={!manual.trim()} onClick={() => onResult(manual.trim())}>
            <Check size={16} /> Use typed code
          </button>
          <button type="button" className="driver-ghost-button" onClick={() => onResult(null)}>
            Can’t scan — skip
          </button>
        </div>
      </div>
    </div>
  );
}

function ShortSheet({ task, onSave, onClose }: {
  task: BulkPickTask;
  onSave: (shortCartons: number, shortSleeves: number) => void;
  onClose: () => void;
}) {
  const [shortCartons, setShortCartons] = useState(0);
  const [shortSleeves, setShortSleeves] = useState(0);

  return (
    <div className="driver-overlay" role="dialog" aria-label={`Short pick for ${task.sku}`}>
      <div className="driver-bottom-sheet">
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div>
            <strong>Short pick</strong>
            <span>{task.sku} · how much is missing?</span>
          </div>
          <button type="button" className="driver-icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {task.totalCartons > 0 ? (
          <label className="pod-input">
            <span>Cartons short (of {task.totalCartons})</span>
            <input type="number" min={0} max={task.totalCartons} value={shortCartons} onChange={(event) => setShortCartons(Math.max(0, Math.min(task.totalCartons, Number(event.target.value) || 0)))} />
          </label>
        ) : null}
        {task.totalSleeves > 0 ? (
          <label className="pod-input">
            <span>Sleeves short (of {task.totalSleeves})</span>
            <input type="number" min={0} max={task.totalSleeves} value={shortSleeves} onChange={(event) => setShortSleeves(Math.max(0, Math.min(task.totalSleeves, Number(event.target.value) || 0)))} />
          </label>
        ) : null}
        <button type="button" className="driver-danger-button" disabled={!shortCartons && !shortSleeves} onClick={() => onSave(shortCartons, shortSleeves)}>
          <AlertTriangle size={18} /> Record shortage
        </button>
      </div>
    </div>
  );
}

type PickView = 'bulk' | 'sort' | 'stops';

export type PickBoardSyncStatus = 'off' | 'connecting' | 'live' | 'error';

function SyncChip({ status }: { status: PickBoardSyncStatus }) {
  const label = status === 'live' ? 'Live sync' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'Sync error' : 'Local only';
  return <span className={cls('sync-chip', `sync-chip-${status}`)}>{label}</span>;
}

export function PickBoard({ orders, businessDay, day, setDay, syncStatus = 'off' }: {
  orders: ImportedOrder[];
  businessDay: BusinessDay;
  day: DriverDayState;
  setDay: React.Dispatch<React.SetStateAction<DriverDayState>>;
  syncStatus?: PickBoardSyncStatus;
}) {
  const [view, setView] = useState<PickView>('bulk');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [scanSku, setScanSku] = useState<string | null>(null);
  const [shortSku, setShortSku] = useState<string | null>(null);

  const run = useMemo(() => buildDriverRun(orders, businessDay.date, day.releasedOrders), [orders, businessDay.date, day.releasedOrders]);
  const pick = day.pick;
  const stops: RunStop[] = useMemo(() => (pick ? stopsInLockedOrder(run.stops, pick) : []), [run.stops, pick]);
  const tasks = useMemo(() => buildBulkTasks(stops), [stops]);
  const cartons = useMemo(() => buildRunCartons(stops), [stops]);

  function patchPick(mutate: (current: PickState) => PickState) {
    setDay((current) => (current.pick ? { ...current, pick: mutate(current.pick) } : current));
  }

  if (!pick) {
    return (
      <section className="driver-card pick-waiting">
        <div className="driver-card-head"><h2><Lock size={18} /> Pick plan</h2></div>
        <p className="driver-card-meta">
          No pick plan yet. The route has to be reviewed and locked first — locking fixes the stop order and box letters, then the bulk pick list and labels are generated from it.
        </p>
      </section>
    );
  }

  const pickedCount = countPickedTasks(pick, tasks);
  const stagedCount = stops.filter((stop) => Boolean(pick.stagedStops[stop.orderId])).length;
  const trips = groupIntoTrips(tasks);
  const scanTask = scanSku ? tasks.find((task) => task.sku === scanSku) ?? null : null;
  const shortTask = shortSku ? tasks.find((task) => task.sku === shortSku) ?? null : null;

  function confirmPicked(sku: string) {
    patchPick((current) => ({
      ...current,
      taskState: { ...current.taskState, [sku]: { ...taskStateFor(current, sku), status: 'PICKED' } }
    }));
  }

  function undoPicked(sku: string) {
    patchPick((current) => ({
      ...current,
      taskState: { ...current.taskState, [sku]: { ...taskStateFor(current, sku), status: 'PENDING' } }
    }));
  }

  function recordScan(sku: string, value: string | null) {
    setScanSku(null);
    patchPick((current) => ({
      ...current,
      taskState: {
        ...current.taskState,
        [sku]: value === null
          ? { ...taskStateFor(current, sku), scanSkipped: true, scannedValue: undefined }
          : { ...taskStateFor(current, sku), scannedValue: value, scanSkipped: false }
      }
    }));
  }

  function recordShort(sku: string, shortCartons: number, shortSleeves: number) {
    setShortSku(null);
    patchPick((current) => ({
      ...current,
      taskState: { ...current.taskState, [sku]: { ...taskStateFor(current, sku), shortCartons: shortCartons || undefined, shortSleeves: shortSleeves || undefined } }
    }));
  }

  function toggleAlloc(sku: string, orderId: string) {
    const key = allocKey(sku, orderId);
    patchPick((current) => ({ ...current, allocDone: { ...current.allocDone, [key]: !current.allocDone[key] } }));
  }

  function stageStop(orderId: string) {
    patchPick((current) => ({ ...current, stagedStops: { ...current.stagedStops, [orderId]: nowIso() } }));
  }

  function unstageStop(orderId: string) {
    patchPick((current) => {
      const next = { ...current.stagedStops };
      delete next[orderId];
      return { ...current, stagedStops: next };
    });
  }

  const bulkView = (
    <div className="pick-stack">
      {trips.map((trip) => (
        <div className="pick-trip" key={trip.trip}>
          <div className="trip-header">
            <ShoppingCart size={15} />
            <strong>Trip {trip.trip}</strong>
            <span>~{trip.load} boxes{trip.load > TROLLEY_CAPACITY ? ` · ${Math.ceil(trip.load / TROLLEY_CAPACITY)} runs` : ''}</span>
          </div>
          {trip.tasks.map((task) => {
            const state = taskStateFor(pick, task.sku);
            const scanNeeded = task.totalSleeves > 0;
            const scanDone = Boolean(state.scannedValue) || state.scanSkipped;
            const scanMatch = state.scannedValue && task.barcode && state.scannedValue === task.barcode;
            const short = (state.shortCartons || 0) + (state.shortSleeves || 0) > 0;

            if (state.status === 'PICKED') {
              return (
                <article key={task.sku} className="pick-task done">
                  <CheckCircle2 size={20} className="pick-done-icon" />
                  <div className="pick-task-copy">
                    <strong>{task.sku}</strong>
                    <span>
                      {task.totalCartons ? `${task.totalCartons} ctn` : ''}{task.totalCartons && task.totalSleeves ? ' + ' : ''}{task.totalSleeves ? `${task.totalSleeves} sleeves` : ''}{short ? ' · SHORT' : ''}
                    </span>
                  </div>
                  <button type="button" className="driver-icon-button" onClick={() => undoPicked(task.sku)} aria-label={`Reopen ${task.sku}`}><RotateCcw size={16} /></button>
                </article>
              );
            }

            return (
              <article key={task.sku} className="pick-task">
                <div className="pick-task-top">
                  <span className={cls('pick-location', !task.location && 'pick-location-missing')}>{task.location || 'NO LOC'}</span>
                  <div className="pick-task-copy">
                    <strong>{task.sku}</strong>
                    <span>{task.name}</span>
                  </div>
                  <div className="pick-qty">
                    {task.totalCartons ? <b>{task.totalCartons}<small> ctn</small></b> : null}
                    {task.totalSleeves ? <b className="pick-qty-loose">{task.totalSleeves}<small> slv</small></b> : null}
                  </div>
                </div>
                <div className="pick-alloc-preview">
                  {task.allocations.map((allocation) => (
                    <span key={allocation.orderId} className="alloc-mini">
                      {allocation.boxCode}{allocation.cartons ? `×${allocation.cartons}` : ''}{allocation.sleeves ? `+${allocation.sleeves}s` : ''}
                    </span>
                  ))}
                </div>
                {short ? (
                  <div className="driver-inline-hint">
                    Short: {state.shortCartons ? `${state.shortCartons} ctn` : ''}{state.shortCartons && state.shortSleeves ? ', ' : ''}{state.shortSleeves ? `${state.shortSleeves} sleeves` : ''} — office is notified.
                  </div>
                ) : null}
                {scanNeeded ? (
                  <button type="button" className={cls('driver-ghost-button pick-scan-button', scanDone && 'scanned')} onClick={() => setScanSku(task.sku)}>
                    <ScanLine size={16} />
                    {state.scannedValue ? (scanMatch ? 'Scanned · match' : `Scanned · ${state.scannedValue}`) : state.scanSkipped ? 'Scan skipped' : 'Scan sleeve barcode'}
                  </button>
                ) : null}
                <div className="driver-button-row">
                  <button type="button" className="driver-danger-ghost" onClick={() => setShortSku(task.sku)}><AlertTriangle size={15} /> Short</button>
                  <button type="button" className="driver-primary-button confirm-in-row" onClick={() => confirmPicked(task.sku)}>
                    <Check size={18} /> Picked to dock
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ))}
      {!tasks.length ? <div className="empty-state">No pick tasks in this run.</div> : null}
    </div>
  );

  const sortView = (
    <div className="pick-stack">
      {tasks.filter((task) => taskStateFor(pick, task.sku).status === 'PICKED').map((task) => {
        const allDone = task.allocations.every((allocation) => pick.allocDone[allocKey(task.sku, allocation.orderId)]);
        return (
          <article key={task.sku} className={cls('pick-task', allDone && 'done-soft')}>
            <div className="pick-task-top">
              <div className="pick-task-copy">
                <strong>{task.sku}</strong>
                <span>{task.name}</span>
              </div>
              {allDone ? <CheckCircle2 size={20} className="pick-done-icon" /> : null}
            </div>
            <div className="alloc-grid">
              {task.allocations.map((allocation) => {
                const done = pick.allocDone[allocKey(task.sku, allocation.orderId)];
                return (
                  <button
                    key={allocation.orderId}
                    type="button"
                    className={cls('alloc-chip', done && 'done')}
                    onClick={() => toggleAlloc(task.sku, allocation.orderId)}
                  >
                    <b>{allocation.boxCode}</b>
                    <span>{allocation.cartons ? `×${allocation.cartons} ctn` : ''}{allocation.cartons && allocation.sleeves ? ' · ' : ''}{allocation.sleeves ? `${allocation.sleeves} slv` : ''}</span>
                    <small>{allocation.store}</small>
                  </button>
                );
              })}
            </div>
          </article>
        );
      })}
      {!pickedCount ? <div className="empty-state">Nothing to sort yet — confirm bulk picks first.</div> : null}
    </div>
  );

  const stopsView = (
    <div className="pick-stack">
      <button type="button" className="driver-ghost-button labels-button" onClick={() => setLabelsOpen(true)}>
        <Printer size={16} /> Labels · {cartons.length} cartons on A6
      </button>
      {stops.map((stop) => {
        const stopCartons = cartons.filter((carton) => carton.orderId === stop.orderId);
        const mixedCount = stopCartons.filter((carton) => carton.type === 'MIXED').length;
        const relevantTasks = tasks.filter((task) => task.allocations.some((allocation) => allocation.orderId === stop.orderId));
        const allocatedCount = relevantTasks.filter((task) => pick.allocDone[allocKey(task.sku, stop.orderId)]).length;
        const complete = stopAllocationsComplete(pick, tasks, stop.orderId);
        const stagedAt = pick.stagedStops[stop.orderId];
        return (
          <article key={stop.orderId} className={cls('pick-stop-card', stagedAt && 'staged')}>
            <div className="pick-stop-head">
              <BoxChip code={stop.boxCode} />
              <div className="pick-task-copy">
                <strong>{stop.stopNumber}. {stop.store}</strong>
                <span>{stopCartons.length} carton{stopCartons.length === 1 ? '' : 's'}{mixedCount ? ` (${mixedCount} mixed)` : ''} · {allocatedCount}/{relevantTasks.length} SKUs allocated</span>
              </div>
              {stagedAt ? <span className="stop-status-chip stop-status-delivered">Staged {formatClockTime(stagedAt)}</span> : null}
            </div>
            {stagedAt ? (
              <button type="button" className="driver-ghost-button" onClick={() => unstageStop(stop.orderId)}><RotateCcw size={15} /> Unstage</button>
            ) : (
              <button type="button" className="driver-primary-button" disabled={!complete} onClick={() => stageStop(stop.orderId)}>
                <Check size={18} /> {complete ? 'Seal, label and stage' : `Allocate ${relevantTasks.length - allocatedCount} more SKU${relevantTasks.length - allocatedCount === 1 ? '' : 's'}`}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );

  return (
    <div className="pick-board">
      <section className="pick-header-card">
        <div className="run-progress-head">
          <strong>{pickedCount}/{tasks.length} SKUs picked</strong>
          <span>{stagedCount}/{stops.length} stops staged</span>
          <SyncChip status={syncStatus} />
        </div>
        <div className="run-progress-track">
          <div className="run-progress-fill" style={{ width: tasks.length ? `${(pickedCount / tasks.length) * 100}%` : '0%' }} />
        </div>
      </section>

      <div className="view-toggle pick-view-toggle" role="tablist" aria-label="Pick phases">
        <button type="button" className={cls(view === 'bulk' && 'active')} onClick={() => setView('bulk')}>1 · Bulk</button>
        <button type="button" className={cls(view === 'sort' && 'active')} onClick={() => setView('sort')}>2 · Sort</button>
        <button type="button" className={cls(view === 'stops' && 'active')} onClick={() => setView('stops')}>3 · Stage</button>
      </div>

      {view === 'bulk' ? bulkView : null}
      {view === 'sort' ? sortView : null}
      {view === 'stops' ? stopsView : null}

      {scanTask ? <ScanSheet task={scanTask} onResult={(value) => recordScan(scanTask.sku, value)} onClose={() => setScanSku(null)} /> : null}
      {shortTask ? <ShortSheet task={shortTask} onSave={(cartonsShort, sleevesShort) => recordShort(shortTask.sku, cartonsShort, sleevesShort)} onClose={() => setShortSku(null)} /> : null}
      {labelsOpen ? <LabelSheet cartons={cartons} runLabel={run.label} dateLabel={businessDay.label} onClose={() => setLabelsOpen(false)} /> : null}
    </div>
  );
}
