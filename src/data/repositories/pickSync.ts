import type { DriverDayState } from '@/domain/driverRun';
import type { PickState, PickTaskState } from '@/domain/pickPlan';

export type PickSyncRow = {
  business_day: string;
  scope: string;
  payload: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

/** scope -> serialized payload; used to diff local state against what the server knows. */
export type ScopeMap = Record<string, string>;

function envValue(key: string) {
  return (import.meta.env[key] as string | undefined)?.trim() || '';
}

export function pickSyncAvailable(): boolean {
  return Boolean(envValue('VITE_SUPABASE_URL') && envValue('VITE_SUPABASE_ANON_KEY'));
}

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function fetchPickRows(businessDay: string, afterIso: string): Promise<PickSyncRow[]> {
  const filter = `business_day=eq.${businessDay}&updated_at=gt.${encodeURIComponent(afterIso)}`;
  return rest<PickSyncRow[]>(`ecoflow_pick_state?${filter}&order=updated_at.asc&select=*`);
}

export async function pushPickRows(
  businessDay: string,
  entries: { scope: string; payload: unknown }[],
  updatedBy: string
): Promise<void> {
  if (!entries.length) return;
  await rest<void>('ecoflow_pick_state?on_conflict=business_day,scope', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(entries.map((entry) => ({
      business_day: businessDay,
      scope: entry.scope,
      payload: entry.payload,
      updated_by: updatedBy
    })))
  });
}

export function scopesFromPick(pick: PickState | undefined): ScopeMap {
  const map: ScopeMap = {};
  if (!pick) return map;
  map['meta'] = JSON.stringify({ lockedAt: pick.lockedAt, stopOrder: pick.stopOrder, boxCodes: pick.boxCodes });
  Object.entries(pick.taskState).forEach(([sku, state]) => {
    map[`task:${sku}`] = JSON.stringify(state);
  });
  Object.entries(pick.allocDone).forEach(([key, done]) => {
    map[`alloc:${key}`] = JSON.stringify({ done });
  });
  Object.entries(pick.stagedStops).forEach(([orderId, stagedAt]) => {
    map[`stage:${orderId}`] = JSON.stringify({ stagedAt });
  });
  return map;
}

/** Changed scopes plus tombstones for scopes that disappeared (unstage, unlock). */
export function diffScopes(previous: ScopeMap, current: ScopeMap): { scope: string; payload: unknown }[] {
  const changes: { scope: string; payload: unknown }[] = [];
  Object.entries(current).forEach(([scope, json]) => {
    if (previous[scope] !== json) changes.push({ scope, payload: JSON.parse(json) as unknown });
  });
  Object.keys(previous).forEach((scope) => {
    if (scope in current) return;
    if (scope === 'meta') {
      const hadLock = (() => {
        try { return Boolean((JSON.parse(previous[scope]) as { lockedAt?: string | null }).lockedAt); } catch { return false; }
      })();
      if (hadLock) changes.push({ scope, payload: { lockedAt: null } });
    } else if (scope.startsWith('stage:')) {
      changes.push({ scope, payload: { stagedAt: null } });
    } else if (scope.startsWith('alloc:')) {
      changes.push({ scope, payload: { done: false } });
    }
  });
  return changes;
}

type MetaPayload = { lockedAt?: string | null; stopOrder?: string[]; boxCodes?: Record<string, string> };

/** Applies remote rows (oldest first) onto the local day; per-scope last-write-wins. */
export function mergeRowsIntoDay(day: DriverDayState, rows: PickSyncRow[]): DriverDayState {
  if (!rows.length) return day;
  let pick = day.pick;
  let stopOrder = day.stopOrder;
  const sorted = [...rows].sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  sorted.forEach((row) => {
    if (row.scope === 'meta') {
      const meta = row.payload as MetaPayload;
      if (meta?.lockedAt) {
        if (pick && pick.lockedAt === meta.lockedAt) {
          pick = {
            ...pick,
            stopOrder: meta.stopOrder ?? pick.stopOrder,
            boxCodes: meta.boxCodes ?? pick.boxCodes
          };
        } else {
          pick = {
            lockedAt: meta.lockedAt,
            stopOrder: meta.stopOrder ?? [],
            boxCodes: meta.boxCodes ?? {},
            taskState: {},
            allocDone: {},
            stagedStops: {}
          };
        }
        if (meta.stopOrder?.length) stopOrder = meta.stopOrder;
      } else {
        pick = undefined;
      }
      return;
    }
    if (!pick) return;
    if (row.scope.startsWith('task:')) {
      const sku = row.scope.slice('task:'.length);
      pick = { ...pick, taskState: { ...pick.taskState, [sku]: row.payload as PickTaskState } };
    } else if (row.scope.startsWith('alloc:')) {
      const key = row.scope.slice('alloc:'.length);
      pick = { ...pick, allocDone: { ...pick.allocDone, [key]: Boolean((row.payload as { done?: boolean }).done) } };
    } else if (row.scope.startsWith('stage:')) {
      const orderId = row.scope.slice('stage:'.length);
      const stagedAt = (row.payload as { stagedAt?: string | null }).stagedAt;
      const stagedStops = { ...pick.stagedStops };
      if (stagedAt) stagedStops[orderId] = stagedAt;
      else delete stagedStops[orderId];
      pick = { ...pick, stagedStops };
    }
  });

  return { ...day, pick, stopOrder };
}
