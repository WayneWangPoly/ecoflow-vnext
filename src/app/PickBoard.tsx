import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
import type { BulkPickTask, PickState, PickTaskState } from '@/domain/pickPlan';
import type { BusinessDay, ImportedOrder } from '@/domain/types';
import { loadWarehouseLocationItems, pickWarehouseStock, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import { BoxChip } from './Brand';
import { LabelSheet } from './LabelSheet';
import './PickBoardWarehouse.css';

function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function nowIso() {
  return new Date().toISOString();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function mapUrlForSku(sku: string) {
  return `/warehouse-map?sku=${encodeURIComponent(sku)}`;
}

function mapUrlForLocation(location: string) {
  return `/warehouse-map?location=${encodeURIComponent(location)}`;
}

type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type WarehouseSkuStock = {
  sku: string;
  locations: string[];
  barcodes: string[];
  cartonQty: number;
  looseQty: number;
  totalQty: number;
  primaryLocation: string;
  hasTempStock: boolean;
};

type WarehousePickPlan = {
  stock: WarehouseSkuStock | null;
  displayLocation: string;
  expectedBarcodes: string[];
  pickCartons: number;
  pickSleeves: number;
  cartonShortage: number;
  sleeveShortage: number;
  hasEnough: boolean;
  warning: string;
};

function buildWarehouseSkuStock(rows: WarehouseLocationItemRow[]) {
  const map = new Map<string, WarehouseSkuStock>();
  rows.forEach((row) => {
    if (!row.item_id || !row.sku) return;
    const qty = numberValue(row.quantity, 0);
    if (qty <= 0) return;
    const current = map.get(row.sku) ?? {
      sku: row.sku,
      locations: [],
      barcodes: [],
      cartonQty: 0,
      looseQty: 0,
      totalQty: 0,
      primaryLocation: row.location_code,
      hasTempStock: false
    };
    if (!current.locations.includes(row.location_code)) current.locations.push(row.location_code);
    if (row.source_barcode && !current.barcodes.includes(row.source_barcode)) current.barcodes.push(row.source_barcode);
    const unit = normalize(row.unit_level);
    if (unit === 'carton') current.cartonQty += qty;
    else current.looseQty += qty;
    current.totalQty += qty;
    current.hasTempStock = current.hasTempStock || row.location_code === 'TEMP';
    if (!current.primaryLocation || current.primaryLocation === 'TEMP') current.primaryLocation = row.location_code;
    map.set(row.sku, current);
  });
  return map;
}

function planWarehousePick(task: BulkPickTask, stock: WarehouseSkuStock | undefined, state: PickTaskState): WarehousePickPlan {
  const pickCartons = Math.max(0, task.totalCartons - (state.shortCartons || 0));
  const pickSleeves = Math.max(0, task.totalSleeves - (state.shortSleeves || 0));
  const expectedBarcodes = Array.from(new Set([task.barcode, ...(stock?.barcodes || [])].filter((value): value is string => Boolean(value))));
  const cartonShortage = Math.max(0, pickCartons - (stock?.cartonQty || 0));
  const sleeveShortage = Math.max(0, pickSleeves - (stock?.looseQty || 0));
  const locations = stock?.locations?.length ? stock.locations.join(' / ') : task.location || '';
  const displayLocation = stock?.primaryLocation || task.location || 'NO LIVE LOC';
  const warnings: string[] = [];

  if (!stock) warnings.push('No live warehouse stock for this SKU yet.');
  else {
    if (cartonShortage) warnings.push(`${cartonShortage} carton short from live stock`);
    if (sleeveShortage) warnings.push(`${sleeveShortage} sleeve/each short from live stock`);
    if (stock.hasTempStock) warnings.push('TEMP also has stock — verify before picking.');
  }
  if (locations && locations !== displayLocation) warnings.push(`Other locations: ${locations}`);

  return {
    stock: stock || null,
    displayLocation,
    expectedBarcodes,
    pickCartons,
    pickSleeves,
    cartonShortage,
    sleeveShortage,
    hasEnough: !cartonShortage && !sleeveShortage,
    warning: warnings.join(' · ')
  };
}

function ScanSheet({ task, expectedBarcodes, onResult, onClose }: {
  task: BulkPickTask;
  expectedBarcodes: string[];
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
      setError('This device has no built-in barcode scanner. Type the code to continue.');
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
      .catch(() => setError('Camera unavailable. Type the code to continue.'));
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
            <strong>Scan product barcode</strong>
            <span>{task.sku} · {task.name}</span>
          </div>
          <button type="button" className="driver-icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {expectedBarcodes.length ? <div className="driver-inline-hint">Expected: {expectedBarcodes.join(' / ')}</div> : null}
        {!error ? <video ref={videoRef} className="scan-video" muted playsInline /> : <div className="driver-inline-hint">{error}</div>}
        <label className="pod-input">
          <span>Or type the code</span>
          <input value={manual} inputMode="numeric" placeholder="Barcode digits" onChange={(event) => setManual(event.target.value)} />
        </label>
        <div className="driver-button-row">
          <button type="button" className="driver-ghost-button" disabled={!manual.trim()} onClick={() => onResult(manual.trim())}>
            <Check size={16} /> Use typed code
          </button>
          <button type="button" className="driver-ghost-button" onClick={() => onResult(null)}>
            Close without scan
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
  setDay: Dispatch<SetStateAction<DriverDayState>>;
  syncStatus?: PickBoardSyncStatus;
}) {
  const [view, setView] = useState<PickView>('bulk');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [scanSku, setScanSku] = useState<string | null>(null);
  const [shortSku, setShortSku] = useState<string | null>(null);
  const [warehouseRows, setWarehouseRows] = useState<WarehouseLocationItemRow[]>([]);
  const [warehouseError, setWarehouseError] = useState('');
  const [savingPickSku, setSavingPickSku] = useState<string | null>(null);
  const [pickPersistErrors, setPickPersistErrors] = useState<Record<string, string>>({});

  const run = useMemo(() => buildDriverRun(orders, businessDay.date, day.releasedOrders), [orders, businessDay.date, day.releasedOrders]);
  const pick = day.pick;
  const stops: RunStop[] = useMemo(() => (pick ? stopsInLockedOrder(run.stops, pick) : []), [run.stops, pick]);
  const baseTasks = useMemo(() => buildBulkTasks(stops), [stops]);
  const warehouseSkuStock = useMemo(() => buildWarehouseSkuStock(warehouseRows), [warehouseRows]);
  const tasks = useMemo(() => baseTasks
    .map((task) => ({ ...task, location: warehouseSkuStock.get(task.sku)?.primaryLocation || task.location }))
    .sort((a, b) => {
      if (!a.location && !b.location) return a.sku.localeCompare(b.sku);
      if (!a.location) return 1;
      if (!b.location) return -1;
      return a.location.localeCompare(b.location) || a.sku.localeCompare(b.sku);
    }), [baseTasks, warehouseSkuStock]);
  const cartons = useMemo(() => buildRunCartons(stops), [stops]);

  async function refreshWarehouseStock() {
    try {
      const rows = await loadWarehouseLocationItems();
      setWarehouseRows(rows);
      setWarehouseError('');
    } catch (error) {
      setWarehouseError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void refreshWarehouseStock();
  }, []);

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

  const activePick: PickState = pick;
  const pickedCount = countPickedTasks(activePick, tasks);
  const stagedCount = stops.filter((stop) => Boolean(activePick.stagedStops[stop.orderId])).length;
  const trips = groupIntoTrips(tasks);
  const scanTask = scanSku ? tasks.find((task) => task.sku === scanSku) ?? null : null;
  const shortTask = shortSku ? tasks.find((task) => task.sku === shortSku) ?? null : null;
  const scanPlan = scanTask ? planWarehousePick(scanTask, warehouseSkuStock.get(scanTask.sku), taskStateFor(activePick, scanTask.sku)) : null;

  function markPickedLocal(sku: string) {
    patchPick((current) => ({
      ...current,
      taskState: { ...current.taskState, [sku]: { ...taskStateFor(current, sku), status: 'PICKED' } }
    }));
  }

  async function confirmPicked(task: BulkPickTask) {
    const state = taskStateFor(activePick, task.sku);
    const plan = planWarehousePick(task, warehouseSkuStock.get(task.sku), state);
    if (!state.scannedValue) {
      setPickPersistErrors((current) => ({ ...current, [task.sku]: 'Scan the product barcode before picking.' }));
      return;
    }
    if (plan.expectedBarcodes.length && !plan.expectedBarcodes.map(normalize).includes(normalize(state.scannedValue))) {
      setPickPersistErrors((current) => ({ ...current, [task.sku]: `Scanned barcode does not match expected ${plan.expectedBarcodes.join(' / ')}.` }));
      return;
    }
    if (!plan.hasEnough) {
      setPickPersistErrors((current) => ({ ...current, [task.sku]: plan.warning || 'Live warehouse stock is not enough. Record shortage first.' }));
      return;
    }

    setSavingPickSku(task.sku);
    setPickPersistErrors((current) => ({ ...current, [task.sku]: '' }));
    try {
      const moves: string[] = [];
      if (plan.pickCartons > 0) {
        const result = await pickWarehouseStock({ sku: task.sku, quantity: plan.pickCartons, unitLevel: 'carton', barcode: state.scannedValue, note: 'Picked to dock from bulk pick' });
        moves.push(...result.map((row) => `${row.picked_quantity} ctn from ${row.location_code}`));
      }
      if (plan.pickSleeves > 0) {
        const result = await pickWarehouseStock({ sku: task.sku, quantity: plan.pickSleeves, unitLevel: 'sleeve', barcode: state.scannedValue, note: 'Picked to dock from bulk pick' });
        moves.push(...result.map((row) => `${row.picked_quantity} slv from ${row.location_code}`));
      }
      markPickedLocal(task.sku);
      setPickPersistErrors((current) => ({ ...current, [task.sku]: moves.length ? `Stock deducted: ${moves.join(' · ')}` : 'Short picked with no stock deducted.' }));
      await refreshWarehouseStock();
    } catch (error) {
      setPickPersistErrors((current) => ({ ...current, [task.sku]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSavingPickSku(null);
    }
  }

  function undoPicked(sku: string) {
    patchPick((current) => ({
      ...current,
      taskState: { ...current.taskState, [sku]: { ...taskStateFor(current, sku), status: 'PENDING' } }
    }));
  }

  function recordScan(sku: string, value: string | null) {
    setScanSku(null);
    if (!value) return;
    patchPick((current) => ({
      ...current,
      taskState: {
        ...current.taskState,
        [sku]: { ...taskStateFor(current, sku), scannedValue: value, scanSkipped: false }
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
      {warehouseError ? <div className="driver-inline-hint pick-live-error">Live warehouse stock unavailable: {warehouseError}</div> : null}
      {trips.map((trip) => (
        <div className="pick-trip" key={trip.trip}>
          <div className="trip-header">
            <ShoppingCart size={15} />
            <strong>Trip {trip.trip}</strong>
            <span>~{trip.load} boxes{trip.load > TROLLEY_CAPACITY ? ` · ${Math.ceil(trip.load / TROLLEY_CAPACITY)} runs` : ''}</span>
          </div>
          {trip.tasks.map((task) => {
            const state = taskStateFor(activePick, task.sku);
            const plan = planWarehousePick(task, warehouseSkuStock.get(task.sku), state);
            const scannedValue = state.scannedValue || '';
            const scanDone = Boolean(scannedValue);
            const expectedNormalized = plan.expectedBarcodes.map(normalize);
            const scanMatch = scanDone && (!expectedNormalized.length || expectedNormalized.includes(normalize(scannedValue)));
            const scanInvalid = scanDone && !scanMatch;
            const short = (state.shortCartons || 0) + (state.shortSleeves || 0) > 0;
            const pickBlocked = !scanDone || scanInvalid || !plan.hasEnough || savingPickSku === task.sku;
            const mapHref = plan.displayLocation && plan.displayLocation !== 'NO LIVE LOC' ? mapUrlForLocation(plan.displayLocation) : mapUrlForSku(task.sku);

            if (state.status === 'PICKED') {
              return (
                <article key={task.sku} className="pick-task done">
                  <CheckCircle2 size={20} className="pick-done-icon" />
                  <div className="pick-task-copy">
                    <strong>{task.sku}</strong>
                    <span>
                      {task.totalCartons ? `${task.totalCartons} ctn` : ''}{task.totalCartons && task.totalSleeves ? ' + ' : ''}{task.totalSleeves ? `${task.totalSleeves} sleeves` : ''}{short ? ' · SHORT' : ''}
                    </span>
                    {pickPersistErrors[task.sku] ? <small className="pick-persist-message">{pickPersistErrors[task.sku]}</small> : null}
                  </div>
                  <button type="button" className="driver-icon-button" onClick={() => undoPicked(task.sku)} aria-label={`Reopen ${task.sku}`}><RotateCcw size={16} /></button>
                </article>
              );
            }

            return (
              <article key={task.sku} className={cls('pick-task', !plan.hasEnough && 'pick-stock-short')}>
                <div className="pick-task-top">
                  <a className={cls('pick-location', !plan.displayLocation && 'pick-location-missing')} href={mapHref}>{plan.displayLocation || 'NO LOC'}</a>
                  <div className="pick-task-copy">
                    <strong>{task.sku}</strong>
                    <span>{task.name}</span>
                  </div>
                  <div className="pick-qty">
                    {task.totalCartons ? <b>{task.totalCartons}<small> ctn</small></b> : null}
                    {task.totalSleeves ? <b className="pick-qty-loose">{task.totalSleeves}<small> slv</small></b> : null}
                  </div>
                </div>
                <div className={cls('pick-stock-strip', plan.hasEnough ? 'stock-ok' : 'stock-warn')}>
                  <span>Live stock: {plan.stock ? `${plan.stock.cartonQty} ctn · ${plan.stock.looseQty} loose` : 'none'}</span>
                  <span>{plan.stock?.locations.length ? plan.stock.locations.join(' / ') : 'no stock location'}</span>
                </div>
                {plan.warning ? <div className="driver-inline-hint">{plan.warning}</div> : null}
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
                <button type="button" className={cls('driver-ghost-button pick-scan-button', scanDone && 'scanned', scanInvalid && 'scan-invalid')} onClick={() => setScanSku(task.sku)}>
                  <ScanLine size={16} />
                  {scannedValue ? (scanMatch ? 'Scanned · match' : `Wrong barcode · ${scannedValue}`) : 'Scan product barcode'}
                </button>
                {pickPersistErrors[task.sku] ? <div className="driver-inline-hint pick-persist-error">{pickPersistErrors[task.sku]}</div> : null}
                <div className="driver-button-row">
                  <button type="button" className="driver-danger-ghost" onClick={() => setShortSku(task.sku)}><AlertTriangle size={15} /> Short</button>
                  <button type="button" className="driver-primary-button confirm-in-row" disabled={pickBlocked} onClick={() => void confirmPicked(task)}>
                    <Check size={18} /> {savingPickSku === task.sku ? 'Saving…' : !scanDone ? 'Scan first' : !plan.hasEnough ? 'Stock short' : 'Picked to dock'}
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
      {tasks.filter((task) => taskStateFor(activePick, task.sku).status === 'PICKED').map((task) => {
        const allDone = task.allocations.every((allocation) => activePick.allocDone[allocKey(task.sku, allocation.orderId)]);
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
                const done = activePick.allocDone[allocKey(task.sku, allocation.orderId)];
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
        const allocatedCount = relevantTasks.filter((task) => activePick.allocDone[allocKey(task.sku, stop.orderId)]).length;
        const complete = stopAllocationsComplete(activePick, tasks, stop.orderId);
        const stagedAt = activePick.stagedStops[stop.orderId];
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

      {scanTask && scanPlan ? <ScanSheet task={scanTask} expectedBarcodes={scanPlan.expectedBarcodes} onResult={(value) => recordScan(scanTask.sku, value)} onClose={() => setScanSku(null)} /> : null}
      {shortTask ? <ShortSheet task={shortTask} onSave={(cartonsShort, sleevesShort) => recordShort(shortTask.sku, cartonsShort, sleevesShort)} onClose={() => setShortSku(null)} /> : null}
      {labelsOpen ? <LabelSheet cartons={cartons} runLabel={run.label} dateLabel={businessDay.label} onClose={() => setLabelsOpen(false)} /> : null}
    </div>
  );
}
