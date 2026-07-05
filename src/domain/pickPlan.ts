import type { RunStop } from './driverRun';

export type CartonType = 'FULL' | 'MIXED';

export type CartonSpec = {
  id: string;
  orderId: string;
  orderNo: string;
  store: string;
  stopNumber: number;
  boxCode: string;
  index: number;
  total: number;
  type: CartonType;
  contents: { sku: string; name: string; qty: number; unit: string }[];
};

export type BulkAllocation = {
  orderId: string;
  store: string;
  stopNumber: number;
  boxCode: string;
  cartons: number;
  sleeves: number;
};

export type BulkPickTask = {
  sku: string;
  name: string;
  location: string;
  barcode?: string;
  totalCartons: number;
  totalSleeves: number;
  allocations: BulkAllocation[];
};

export type PickTaskState = {
  status: 'PENDING' | 'PICKED';
  scannedValue?: string;
  scanSkipped?: boolean;
  shortCartons?: number;
  shortSleeves?: number;
};

export type PickState = {
  lockedAt: string;
  stopOrder: string[];
  boxCodes: Record<string, string>;
  taskState: Record<string, PickTaskState>;
  allocDone: Record<string, boolean>;
  stagedStops: Record<string, string>;
};

/** The trolley fits 8–10 small cartons; plan trips at 9. */
export const TROLLEY_CAPACITY = 9;

export type TrolleyTrip = { trip: number; load: number; tasks: BulkPickTask[] };

function taskLoad(task: BulkPickTask): number {
  const sleeveBoxes = task.totalSleeves ? Math.max(1, Math.round(task.totalSleeves / 12)) : 0;
  return task.totalCartons + sleeveBoxes;
}

/**
 * Groups location-sorted tasks into trolley trips: fill up to capacity, then start
 * a new trip. An oversize SKU keeps its own trip and is walked in multiple runs.
 */
export function groupIntoTrips(tasks: BulkPickTask[], capacity = TROLLEY_CAPACITY): TrolleyTrip[] {
  const trips: TrolleyTrip[] = [];
  let current: TrolleyTrip | null = null;
  tasks.forEach((task) => {
    const load = taskLoad(task);
    if (!current || (current.load + load > capacity && current.load > 0)) {
      current = { trip: trips.length + 1, load: 0, tasks: [] };
      trips.push(current);
    }
    current.load += load;
    current.tasks.push(task);
  });
  return trips;
}

export function allocKey(sku: string, orderId: string) {
  return `${sku}|${orderId}`;
}

/**
 * Loose items go into the stop's MIXED carton. Real Ordermentum units observed:
 * Carton / Box (full cartons), unit (single items), sleeve. Until the SKU master
 * drives this, 'unit'/'each'/'sleeve' count as loose.
 */
function isLooseUnit(unit: string) {
  const normalized = unit.toLowerCase().trim();
  return normalized.includes('sleeve') || normalized === 'unit' || normalized === 'each' || normalized === 'ea';
}

/**
 * Freight / service lines are invoiced but never picked, boxed or labelled.
 * The SKU master's is_service_item is authoritative; keywords only cover unmastered SKUs.
 */
export function isServiceLine(line: { sku: string; name: string; isService?: boolean }): boolean {
  if (line.isService !== undefined) return line.isService;
  const sku = line.sku.toUpperCase();
  const name = line.name.toLowerCase();
  if (sku.startsWith('FC') && sku.length <= 6) return true;
  return name.includes('freight') || name.includes('delivery fee') || name.includes('surcharge') || name.includes('service charge');
}

/** Full-carton lines become one carton per unit; all loose lines merge into a single MIXED carton. */
export function cartonsForStop(stop: RunStop): CartonSpec[] {
  const physicalLines = stop.lines.filter((line) => !isServiceLine(line));
  const fullLines = physicalLines.filter((line) => !isLooseUnit(line.unit));
  const looseLines = physicalLines.filter((line) => isLooseUnit(line.unit));
  const cartons: CartonSpec[] = [];

  fullLines.forEach((line) => {
    for (let unitIndex = 0; unitIndex < Math.max(1, line.qty); unitIndex += 1) {
      cartons.push({
        id: '',
        orderId: stop.orderId,
        orderNo: stop.orderNo,
        store: stop.store,
        stopNumber: stop.stopNumber,
        boxCode: stop.boxCode,
        index: 0,
        total: 0,
        type: 'FULL',
        contents: [{ sku: line.sku, name: line.name, qty: 1, unit: line.unit }]
      });
    }
  });

  if (looseLines.length) {
    cartons.push({
      id: '',
      orderId: stop.orderId,
      orderNo: stop.orderNo,
      store: stop.store,
      stopNumber: stop.stopNumber,
      boxCode: stop.boxCode,
      index: 0,
      total: 0,
      type: 'MIXED',
      contents: looseLines.map((line) => ({ sku: line.sku, name: line.name, qty: line.qty, unit: line.unit }))
    });
  }

  return cartons.map((carton, index) => ({
    ...carton,
    id: `${stop.orderId}-C${index + 1}`,
    index: index + 1,
    total: cartons.length
  }));
}

export function buildRunCartons(stops: RunStop[]): CartonSpec[] {
  return stops.flatMap((stop) => cartonsForStop(stop));
}

/** Aggregates the locked run into per-SKU bulk tasks, sorted by warehouse walking path. */
export function buildBulkTasks(stops: RunStop[]): BulkPickTask[] {
  const bySku = new Map<string, BulkPickTask>();

  stops.forEach((stop) => {
    stop.lines.forEach((line) => {
      if (isServiceLine(line)) return;
      const loose = isLooseUnit(line.unit);
      const task = bySku.get(line.sku) ?? {
        sku: line.sku,
        name: line.name,
        location: line.location,
        barcode: line.barcode,
        totalCartons: 0,
        totalSleeves: 0,
        allocations: []
      };
      const qty = Math.max(1, line.qty);
      if (loose) task.totalSleeves += qty;
      else task.totalCartons += qty;

      const existing = task.allocations.find((allocation) => allocation.orderId === stop.orderId);
      if (existing) {
        if (loose) existing.sleeves += qty;
        else existing.cartons += qty;
      } else {
        task.allocations.push({
          orderId: stop.orderId,
          store: stop.store,
          stopNumber: stop.stopNumber,
          boxCode: stop.boxCode,
          cartons: loose ? 0 : qty,
          sleeves: loose ? qty : 0
        });
      }
      bySku.set(line.sku, task);
    });
  });

  return Array.from(bySku.values()).sort((a, b) => {
    if (!a.location && !b.location) return a.sku.localeCompare(b.sku);
    if (!a.location) return 1;
    if (!b.location) return -1;
    return a.location.localeCompare(b.location);
  });
}

export function taskStateFor(pick: PickState, sku: string): PickTaskState {
  return pick.taskState[sku] ?? { status: 'PENDING' };
}

export function stopAllocationsComplete(pick: PickState, tasks: BulkPickTask[], orderId: string): boolean {
  const relevant = tasks.filter((task) => task.allocations.some((allocation) => allocation.orderId === orderId));
  if (!relevant.length) return true;
  return relevant.every((task) => pick.allocDone[allocKey(task.sku, orderId)]);
}

export function countPickedTasks(pick: PickState, tasks: BulkPickTask[]): number {
  return tasks.filter((task) => taskStateFor(pick, task.sku).status === 'PICKED').length;
}

export function allStopsStaged(pick: PickState, stops: RunStop[]): boolean {
  return stops.length > 0 && stops.every((stop) => Boolean(pick.stagedStops[stop.orderId]));
}
