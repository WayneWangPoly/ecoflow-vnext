import type { BusinessDay, ImportedOrder, OrderChangeImpact, OrderStatus, OrderSyncStatus, SyncBatch } from './types';

const ADELAIDE_TIME_ZONE = 'Australia/Adelaide' as const;
const DEFAULT_CUTOFF_TIME = '22:00';
const ACTIVE_STATUS: OrderStatus[] = ['IMPORTED', 'MAPPING_EXCEPTION', 'RELEASE_READY', 'RELEASED', 'PICKING', 'PACKED', 'STAGED', 'OUT_FOR_DELIVERY', 'FAILED'];
const LOCKED_STATUS: OrderStatus[] = ['PICKING', 'PACKED', 'STAGED', 'OUT_FOR_DELIVERY'];
const FINAL_STATUS: OrderStatus[] = ['DELIVERED', 'CLOSED', 'CANCELLED'];

export function parseIso(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function addMinutes(date: Date, minutes: number): Date {
  const next = new Date(date);
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function businessDateFromIso(value: string | undefined, cutoffTime = DEFAULT_CUTOFF_TIME): string {
  const date = parseIso(value);
  if (!date) return 'unassigned';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ADELAIDE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const [cutHour, cutMinute] = cutoffTime.split(':').map(Number);
  const base = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (hour > cutHour || (hour === cutHour && minute >= cutMinute)) {
    base.setUTCDate(base.getUTCDate() + 1);
  }
  return base.toISOString().slice(0, 10);
}

export function businessDayLabel(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const midday = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: ADELAIDE_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(midday);
}

export function makeBusinessDay(anchorIso: string, cutoffTime = DEFAULT_CUTOFF_TIME): BusinessDay {
  const date = businessDateFromIso(anchorIso, cutoffTime);
  return {
    date,
    label: businessDayLabel(date),
    timezone: ADELAIDE_TIME_ZONE,
    cutoffTime
  };
}

export function formatDateTime(value: string | undefined): string {
  const date = parseIso(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: ADELAIDE_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function formatBusinessDate(value: string | undefined): string {
  const date = parseIso(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: ADELAIDE_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  }).format(date);
}

export function isActiveStatus(status: OrderStatus): boolean {
  return ACTIVE_STATUS.includes(status);
}

export function isFinalStatus(status: OrderStatus): boolean {
  return FINAL_STATUS.includes(status);
}

export function deriveChangeImpact(status: OrderStatus, syncStatus: OrderSyncStatus): OrderChangeImpact {
  if (syncStatus === 'UNCHANGED') return 'NO_CHANGE';
  if (FINAL_STATUS.includes(status)) return 'RECONCILIATION_VARIANCE';
  if (LOCKED_STATUS.includes(status)) return 'REVIEW_REQUIRED';
  return 'SAFE_UPDATE';
}

export function changeImpactLabel(impact: OrderChangeImpact): string {
  if (impact === 'SAFE_UPDATE') return 'Safe update';
  if (impact === 'REVIEW_REQUIRED') return 'Review change';
  if (impact === 'RECONCILIATION_VARIANCE') return 'Reconcile variance';
  return 'No change';
}

export function syncStatusLabel(status: OrderSyncStatus): string {
  if (status === 'NEW') return 'New';
  if (status === 'UPDATED') return 'Updated';
  return 'Unchanged';
}

export function makeSyncBatch(params: {
  completedAt: string;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}): SyncBatch {
  return {
    id: `OM-SYNC-${businessDateFromIso(params.completedAt).replace(/-/g, '')}`,
    source: 'Ordermentum',
    status: params.failed > 0 ? 'PARTIAL' : 'SUCCESS',
    startedAt: toIso(addMinutes(parseIso(params.completedAt) || new Date(), -7)),
    completedAt: params.completedAt,
    businessDay: makeBusinessDay(params.completedAt),
    fetched: params.fetched,
    created: params.created,
    updated: params.updated,
    unchanged: params.unchanged,
    failed: params.failed
  };
}

export function sortOrdersForOperations(orders: ImportedOrder[]): ImportedOrder[] {
  return [...orders].sort((a, b) => {
    const activeDelta = Number(isFinalStatus(a.status)) - Number(isFinalStatus(b.status));
    if (activeDelta !== 0) return activeDelta;
    const dueDelta = String(a.requestedDeliveryBusinessDay).localeCompare(String(b.requestedDeliveryBusinessDay));
    if (dueDelta !== 0) return dueDelta;
    return a.sequence - b.sequence;
  });
}
