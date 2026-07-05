import type { ImportedOrder, OrderStatus } from './types';
import type { PickState } from './pickPlan';

export type StopStatus = 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'FAILED' | 'SKIPPED';

export type StopFailReason =
  | 'NO_ONE_ON_SITE'
  | 'PREMISES_CLOSED'
  | 'WRONG_ADDRESS'
  | 'CUSTOMER_REFUSED'
  | 'DAMAGED_GOODS'
  | 'MISSING_CARTONS'
  | 'CANNOT_ACCESS'
  | 'OTHER';

export const stopFailReasons: { reason: StopFailReason; label: string }[] = [
  { reason: 'NO_ONE_ON_SITE', label: 'No one on site' },
  { reason: 'PREMISES_CLOSED', label: 'Premises closed' },
  { reason: 'WRONG_ADDRESS', label: 'Wrong or incomplete address' },
  { reason: 'CUSTOMER_REFUSED', label: 'Customer refused delivery' },
  { reason: 'DAMAGED_GOODS', label: 'Goods damaged in transit' },
  { reason: 'MISSING_CARTONS', label: 'Cartons missing or short' },
  { reason: 'CANNOT_ACCESS', label: 'Cannot access delivery point' },
  { reason: 'OTHER', label: 'Other issue' }
];

export function stopFailReasonLabel(reason: StopFailReason): string {
  return stopFailReasons.find((item) => item.reason === reason)?.label ?? reason;
}

export type GeoPoint = { lat: number; lng: number };

/** Normalised 0..1 position used to draw the schematic run map until real geocodes exist. */
export type MapPoint = { x: number; y: number };

export const WAREHOUSE = {
  name: 'EcoFlow Warehouse',
  address: 'Unit 12/88 Exeter Terrace, Dudley Park SA 5008',
  suburb: 'Dudley Park',
  lat: -34.8746,
  lng: 138.5626,
  /** Fallback schematic position when no stop has real coordinates. */
  mapPoint: { x: 0.08, y: 0.5 } as MapPoint
};

export type PodRecord = {
  /** Local data URL cache — device-only, stripped before sync. */
  photo?: string;
  /** Local data URL cache — device-only, stripped before sync. */
  signature?: string;
  /** Supabase Storage path once uploaded — the shared source of truth. */
  photoPath?: string;
  signaturePath?: string;
  receiverName?: string;
  note?: string;
  location?: GeoPoint;
  capturedAt: string;
};

export type StopException = {
  reason: StopFailReason;
  note?: string;
  location?: GeoPoint;
  recordedAt: string;
};

export type RunStopLine = { sku: string; name: string; qty: number; unit: string; location: string; barcode?: string; isService?: boolean };

export type RunStop = {
  orderId: string;
  stopNumber: number;
  boxCode: string;
  store: string;
  address: string;
  suburb: string;
  orderNo: string;
  invoiceNo: string;
  cartons: number;
  eta: string;
  deliveryNote?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  lines: RunStopLine[];
  warehouseReady: boolean;
  orderStatus: OrderStatus;
  mapPoint: MapPoint;
};

export type DriverRun = {
  id: string;
  label: string;
  businessDay: string;
  stops: RunStop[];
  totalCartons: number;
  readyStops: number;
  /** Warehouse position in the same normalised space as stop mapPoints. */
  warehousePoint: MapPoint;
  /** True when at least one stop is placed from real coordinates. */
  geoProjected: boolean;
};

export type StopProgress = {
  status: StopStatus;
  arrivedAt?: string;
  arrivedLocation?: GeoPoint;
  completedAt?: string;
  loaded?: boolean;
  pod?: PodRecord;
  exception?: StopException;
};

export type ShiftEventType = 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END' | 'ROUTE_START' | 'ROUTE_END';
export type ShiftStatus = 'OFF_SHIFT' | 'ON_SHIFT' | 'ON_BREAK';

export type ShiftEvent = { type: ShiftEventType; at: string; location?: GeoPoint };

export type DriverDayState = {
  version: 1;
  businessDay: string;
  /** orderId -> release timestamp; the shared fact of which orders are in today's run. */
  releasedOrders: Record<string, string>;
  stopProgress: Record<string, StopProgress>;
  shiftEvents: ShiftEvent[];
  stopOrder?: string[];
  pick?: PickState;
  routeStartedAt?: string;
  routeEndedAt?: string;
};

/** Box letters freeze at route lock so physical labels stay valid if the driver reorders mid-route. */
export function applyLockedBoxCodes(stops: RunStop[], pick: PickState | undefined): RunStop[] {
  if (!pick) return stops;
  return stops.map((stop) => ({ ...stop, boxCode: pick.boxCodes[stop.orderId] ?? stop.boxCode }));
}

/** Stops in the order they were locked, for labels and the pick plan. */
export function stopsInLockedOrder(stops: RunStop[], pick: PickState): RunStop[] {
  const byId = new Map(stops.map((stop) => [stop.orderId, stop]));
  const ordered = pick.stopOrder.map((id) => byId.get(id)).filter((stop): stop is RunStop => Boolean(stop));
  const seen = new Set(pick.stopOrder);
  const extras = stops.filter((stop) => !seen.has(stop.orderId));
  return [...ordered, ...extras].map((stop, index) => ({
    ...stop,
    stopNumber: index + 1,
    boxCode: pick.boxCodes[stop.orderId] ?? stop.boxCode
  }));
}

const RUN_STATUSES: OrderStatus[] = ['RELEASED', 'PICKING', 'PACKED', 'STAGED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];
const READY_STATUSES: OrderStatus[] = ['STAGED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];
const BOX_CODES = ['A', 'B', 'C', 'D', 'E', 'F'];
/** Soft guidance only — the run is never silently truncated. */
export const RUN_SIZE_WARNING = 16;

const ADDRESS_PLACEHOLDER = 'Address pending';

/** True when the stop has a usable street address (never navigate to placeholders). */
export function hasVerifiedAddress(address: string | undefined): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  if (!trimmed || trimmed.startsWith(ADDRESS_PLACEHOLDER)) return false;
  return trimmed.length > 8;
}

export function boxCodeForStop(index: number): string {
  return BOX_CODES[index % BOX_CODES.length];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic scatter east of the warehouse: golden-angle spread by stop index
 * keeps pins apart, the hash jitter keeps the layout stable per order.
 */
function mapPointForStop(index: number, seedValue: string): MapPoint {
  const seed = hashString(seedValue);
  const angle = ((index * 137.5 + (seed % 47) - 23) * Math.PI) / 180;
  const radius = 0.2 + ((seed >>> 8) % 1000) / 1000 * 0.32;
  return {
    x: clamp(0.58 + Math.cos(angle) * radius * 1.18, 0.2, 0.95),
    y: clamp(0.5 + Math.sin(angle) * radius, 0.08, 0.92)
  };
}

function mapDistance(a: MapPoint, b: MapPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Nearest-neighbour route from `startPoint` refined with 2-opt. Returns order ids. */
export function optimiseStopOrder(stops: RunStop[], startPoint: MapPoint = WAREHOUSE.mapPoint): string[] {
  if (stops.length <= 1) return stops.map((stop) => stop.orderId);
  const remaining = [...stops];
  const route: RunStop[] = [];
  let cursor = startPoint;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((stop, index) => {
      const distance = mapDistance(cursor, stop.mapPoint);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    route.push(next);
    cursor = next.mapPoint;
  }

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i += 1) {
      for (let j = i + 1; j < route.length; j += 1) {
        const before = i === 0 ? startPoint : route[i - 1].mapPoint;
        const after = j === route.length - 1 ? null : route[j + 1].mapPoint;
        const current = mapDistance(before, route[i].mapPoint) + (after ? mapDistance(route[j].mapPoint, after) : 0);
        const swapped = mapDistance(before, route[j].mapPoint) + (after ? mapDistance(route[i].mapPoint, after) : 0);
        if (swapped + 1e-9 < current) {
          let left = i;
          let right = j;
          while (left < right) {
            [route[left], route[right]] = [route[right], route[left]];
            left += 1;
            right -= 1;
          }
          improved = true;
        }
      }
    }
  }
  return route.map((stop) => stop.orderId);
}

/** Keeps a saved custom order valid when the run changes: drops stale ids, appends new stops. */
export function reconcileStopOrder(saved: string[] | undefined, stops: RunStop[]): string[] {
  const stopIds = stops.map((stop) => stop.orderId);
  if (!saved || !saved.length) return stopIds;
  const known = new Set(stopIds);
  const kept = saved.filter((id) => known.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...stopIds.filter((id) => !keptSet.has(id))];
}

/**
 * Places stops with real coordinates by geographic projection (north up, warehouse
 * included in the frame); stops without coordinates keep their schematic hash point.
 */
function projectRunGeometry(stops: RunStop[]): { stops: RunStop[]; warehousePoint: MapPoint; geoProjected: boolean } {
  const located = stops.filter((stop) => typeof stop.lat === 'number' && typeof stop.lng === 'number');
  if (!located.length) return { stops, warehousePoint: WAREHOUSE.mapPoint, geoProjected: false };

  const lats = [...located.map((stop) => stop.lat as number), WAREHOUSE.lat];
  const lngs = [...located.map((stop) => stop.lng as number), WAREHOUSE.lng];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01);
  const span = Math.max(latSpan, lngSpan);
  const pad = 0.08;
  const project = (lat: number, lng: number): MapPoint => ({
    x: clamp(pad + ((lng - minLng) / span) * (1 - pad * 2), 0.03, 0.97),
    y: clamp(pad + ((maxLat - lat) / span) * (1 - pad * 2), 0.03, 0.97)
  });

  return {
    stops: stops.map((stop) => (typeof stop.lat === 'number' && typeof stop.lng === 'number'
      ? { ...stop, mapPoint: project(stop.lat, stop.lng) }
      : stop)),
    warehousePoint: project(WAREHOUSE.lat, WAREHOUSE.lng),
    geoProjected: true
  };
}

export function buildDriverRun(orders: ImportedOrder[], businessDay: string, releasedOrders?: Record<string, string>): DriverRun {
  const releasedIds = releasedOrders && Object.keys(releasedOrders).length ? releasedOrders : null;
  const rawStops = [...orders]
    .filter((order) => releasedIds
      ? Boolean(releasedIds[order.id]) && order.status !== 'CANCELLED'
      : RUN_STATUSES.includes(order.status))
    .sort((a, b) => releasedIds
      ? String(releasedIds[a.id]).localeCompare(String(releasedIds[b.id])) || a.sequence - b.sequence
      : a.sequence - b.sequence)
    .map((order, index): RunStop => ({
      orderId: order.id,
      stopNumber: index + 1,
      boxCode: boxCodeForStop(index),
      store: order.store,
      address: order.address,
      suburb: order.suburb,
      orderNo: order.orderNo,
      invoiceNo: order.invoiceNo,
      cartons: Math.max(1, order.packageCount),
      eta: order.eta,
      deliveryNote: order.deliveryNote,
      phone: order.phone,
      lat: order.lat,
      lng: order.lng,
      lines: order.lines.map((line) => ({ sku: line.sku, name: line.name, qty: line.qty, unit: line.unit, location: line.location, barcode: line.barcode, isService: line.isService })),
      warehouseReady: READY_STATUSES.includes(order.status),
      orderStatus: order.status,
      mapPoint: mapPointForStop(index, `${order.id}:${order.store}`)
    }));

  const { stops, warehousePoint, geoProjected } = projectRunGeometry(rawStops);

  return {
    id: `RUN-${businessDay.replace(/-/g, '')}-A`,
    label: 'Run A · Adelaide Metro',
    businessDay,
    stops,
    totalCartons: stops.reduce((sum, stop) => sum + stop.cartons, 0),
    readyStops: stops.filter((stop) => stop.warehouseReady).length,
    warehousePoint,
    geoProjected
  };
}

export function initialStopProgress(stop: RunStop): StopProgress {
  if (stop.orderStatus === 'DELIVERED') return { status: 'DELIVERED', loaded: true };
  if (stop.orderStatus === 'FAILED') return { status: 'FAILED', loaded: true };
  return { status: 'PENDING' };
}

const STORAGE_PREFIX = 'ecoflow-driver-day';

function storageKey(businessDay: string) {
  return `${STORAGE_PREFIX}:${businessDay}`;
}

export function emptyDriverDayState(businessDay: string): DriverDayState {
  return { version: 1, businessDay, releasedOrders: {}, stopProgress: {}, shiftEvents: [] };
}

export function loadDriverDayState(businessDay: string): DriverDayState {
  try {
    const raw = window.localStorage.getItem(storageKey(businessDay));
    if (!raw) return emptyDriverDayState(businessDay);
    const parsed = JSON.parse(raw) as DriverDayState;
    if (parsed && parsed.version === 1 && parsed.businessDay === businessDay) {
      return { ...parsed, releasedOrders: parsed.releasedOrders ?? {} };
    }
  } catch {
    // corrupted or unavailable storage falls through to a clean day
  }
  return emptyDriverDayState(businessDay);
}

/**
 * Projects the shared day facts (release, staging, delivery, POD) onto orders so
 * every role sees the same lifecycle regardless of which device produced it.
 */
export function applyDayStateToOrders(orders: ImportedOrder[], day: DriverDayState): ImportedOrder[] {
  const anyFacts = Object.keys(day.releasedOrders).length || Object.keys(day.stopProgress).length || day.pick;
  if (!anyFacts) return orders;
  return orders.map((order) => {
    const released = day.releasedOrders[order.id];
    const progress = day.stopProgress[order.id];
    const staged = day.pick?.stagedStops?.[order.id];
    let status = order.status;
    if (released && (status === 'IMPORTED' || status === 'RELEASE_READY' || status === 'MAPPING_EXCEPTION')) status = 'RELEASED';
    if (released && staged) status = 'STAGED';
    if (released && day.routeStartedAt && (!progress || progress.status === 'PENDING' || progress.status === 'ARRIVED' || progress.status === 'SKIPPED')) status = 'OUT_FOR_DELIVERY';
    if (progress?.status === 'DELIVERED') status = 'DELIVERED';
    if (progress?.status === 'FAILED') status = 'FAILED';
    const podStatus = progress?.pod ? 'captured' as const : order.podStatus;
    if (status === order.status && podStatus === order.podStatus) return order;
    return { ...order, status, podStatus };
  });
}

export function saveDriverDayState(state: DriverDayState) {
  try {
    window.localStorage.setItem(storageKey(state.businessDay), JSON.stringify(state));
  } catch {
    // storage full (large POD photos) or unavailable; in-memory state still works
  }
}

export function shiftStatusFromEvents(events: ShiftEvent[]): ShiftStatus {
  let status: ShiftStatus = 'OFF_SHIFT';
  for (const event of events) {
    if (event.type === 'CLOCK_IN') status = 'ON_SHIFT';
    if (event.type === 'CLOCK_OUT') status = 'OFF_SHIFT';
    if (event.type === 'BREAK_START') status = 'ON_BREAK';
    if (event.type === 'BREAK_END') status = 'ON_SHIFT';
  }
  return status;
}

export function lastEventOfType(events: ShiftEvent[], type: ShiftEventType): ShiftEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return undefined;
}

export function shiftEventLabel(type: ShiftEventType): string {
  if (type === 'CLOCK_IN') return 'Clocked in';
  if (type === 'CLOCK_OUT') return 'Clocked out';
  if (type === 'BREAK_START') return 'Break started';
  if (type === 'BREAK_END') return 'Break ended';
  if (type === 'ROUTE_START') return 'Route started';
  return 'Route finished';
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatClockTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Adelaide' });
}

export function formatGeoPoint(point: GeoPoint | undefined): string {
  if (!point) return 'location not captured';
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function appleMapsUrl(address: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
}

export function wazeUrl(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

export function capturePosition(timeoutMs = 4000): Promise<GeoPoint | undefined> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(undefined);
      return;
    }
    let settled = false;
    const finish = (point: GeoPoint | undefined) => {
      if (settled) return;
      settled = true;
      resolve(point);
    };
    window.setTimeout(() => finish(undefined), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => finish(undefined),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}
