import type { DriverDayState, PodRecord, StopProgress } from '@/domain/driverRun';
import type { PickState, PickTaskState } from '@/domain/pickPlan';
import { supabase } from '@/lib/supabaseClient';

export type PickSyncRow = {
  business_day: string;
  scope: string;
  payload: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

/** scope -> serialized payload; used to diff local state against what the server knows. */
export type ScopeMap = Record<string, string>;

const TABLE = 'ecoflow_day_state';
const POD_BUCKET = 'pod-photos';

function envValue(key: string) {
  return (import.meta.env[key] as string | undefined)?.trim() || '';
}

export function pickSyncAvailable(): boolean {
  return Boolean(envValue('VITE_SUPABASE_URL') && envValue('VITE_SUPABASE_ANON_KEY'));
}

async function authenticatedHeaders(): Promise<Record<string, string>> {
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Authenticated EcoFlow session is required for shared operational state.');
  return { apikey: anonKey, Authorization: `Bearer ${token}` };
}

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(await authenticatedHeaders()),
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
  return rest<PickSyncRow[]>(`${TABLE}?${filter}&order=updated_at.asc&select=*`);
}

export async function pushPickRows(
  businessDay: string,
  entries: { scope: string; payload: unknown }[],
  updatedBy: string
): Promise<void> {
  if (!entries.length) return;
  await rest<void>(`${TABLE}?on_conflict=business_day,scope`, {
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

export async function setActiveRunCode(businessDay: string, runCode: string, updatedBy: string): Promise<void> {
  await rest<void>(`${TABLE}?on_conflict=business_day,scope`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ business_day: businessDay, scope: 'run-control', payload: { activeRunCode: runCode }, updated_by: updatedBy }]),
  });
}

/** Uploads a data-URL image to Storage; returns the object path or null on failure. */
export async function uploadPodAsset(path: string, dataUrl: string): Promise<string | null> {
  if (!pickSyncAvailable()) return null;
  try {
    const [meta, base64] = dataUrl.split(',');
    if (!base64) return null;
    const mime = /data:(.*?)[;,]/.exec(meta)?.[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/storage/v1/object/${POD_BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...(await authenticatedHeaders()), 'Content-Type': mime, 'x-upsert': 'true' },
      body: bytes
    });
    return response.ok ? path : null;
  } catch {
    return null;
  }
}

export async function createPodAssetSignedUrl(path: string, expiresIn = 60 * 60): Promise<string | null> {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from(POD_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

export type InternaliseResultRow = {
  raw_order_id: string | null;
  order_number: string | null;
  action: string | null;
  internal_order_id: string | null;
  account_release_status: string | null;
  warehouse_gate_status: string | null;
};

/** Formal internal-order creation through the database RPC (never a front-end status flip). */
export async function callInternaliseOrders(limit = 50, dryRun = false): Promise<InternaliseResultRow[]> {
  return rest<InternaliseResultRow[]>('rpc/ecoflow_internalise_ordermentum_orders', {
    method: 'POST',
    body: JSON.stringify({ p_limit: limit, p_dry_run: dryRun, p_include_payment_review: false })
  });
}

/** POD data-URLs never travel through day state — only storage paths do. */
function stripPod(pod: PodRecord | undefined): PodRecord | undefined {
  if (!pod) return undefined;
  const { photo: _photo, signature: _signature, pod1Photo: _pod1Photo, pod2Photo: _pod2Photo, ...rest } = pod;
  return rest;
}

function serializeStop(progress: StopProgress): string {
  return JSON.stringify({ ...progress, pod: stripPod(progress.pod) });
}

export function scopesFromDay(day: DriverDayState): ScopeMap {
  const map: ScopeMap = {};
  const prefix = `run:${day.runCode || 'A'}:`;
  const pick = day.pick;
  if (pick) {
    map[`${prefix}meta`] = JSON.stringify({ lockedAt: pick.lockedAt, stopOrder: pick.stopOrder, boxCodes: pick.boxCodes });
    Object.entries(pick.taskState).forEach(([sku, state]) => { map[`${prefix}task:${sku}`] = JSON.stringify(state); });
    Object.entries(pick.allocDone).forEach(([key, done]) => { map[`${prefix}alloc:${key}`] = JSON.stringify({ done }); });
    Object.entries(pick.stagedStops).forEach(([orderId, stagedAt]) => { map[`${prefix}stage:${orderId}`] = JSON.stringify({ stagedAt }); });
  }
  Object.entries(day.releasedOrders).forEach(([orderId, releasedAt]) => { map[`${prefix}release:${orderId}`] = JSON.stringify({ releasedAt }); });
  Object.entries(day.stopProgress).forEach(([orderId, progress]) => { map[`${prefix}stop:${orderId}`] = serializeStop(progress); });
  if (day.routeStartedAt || day.routeEndedAt) map[`${prefix}route`] = JSON.stringify({ startedAt: day.routeStartedAt ?? null, endedAt: day.routeEndedAt ?? null });
  if (day.shiftEvents.length) map['shift'] = JSON.stringify({ events: day.shiftEvents });
  return map;
}

function activeRunFromScopes(scopes: ScopeMap): string {
  try {
    const control = (JSON.parse(scopes['run-control'] || '{}') as { activeRunCode?: string }).activeRunCode;
    if (control) return String(control).toUpperCase();
  } catch { /* infer from run-prefixed scopes */ }
  const runScope = Object.keys(scopes).find((scope) => /^run:[A-Z]+:/.test(scope));
  return runScope?.split(':')[1] || 'A';
}

function scopeRelevantToRun(scope: string, runCode: string) {
  return scope === 'run-control' || scope === 'shift' || scope.startsWith(`run:${runCode}:`);
}

/** Changed scopes plus tombstones for scopes that disappeared (unstage, un-release, unlock). */
export function diffScopes(previous: ScopeMap, current: ScopeMap): { scope: string; payload: unknown }[] {
  const changes: { scope: string; payload: unknown }[] = [];
  const runCode = activeRunFromScopes(current);
  const relevantPrevious = Object.fromEntries(Object.entries(previous).filter(([scope]) => scopeRelevantToRun(scope, runCode)));
  Object.entries(current).forEach(([scope, json]) => {
    if (relevantPrevious[scope] !== json) changes.push({ scope, payload: JSON.parse(json) as unknown });
  });
  Object.keys(relevantPrevious).forEach((scope) => {
    if (scope in current || scope === 'run-control' || scope === 'shift') return;
    const localScope = scope.replace(`run:${runCode}:`, '');
    if (localScope === 'meta') {
      const hadLock = (() => { try { return Boolean((JSON.parse(relevantPrevious[scope]) as { lockedAt?: string | null }).lockedAt); } catch { return false; } })();
      if (hadLock) changes.push({ scope, payload: { lockedAt: null } });
    } else if (localScope.startsWith('stage:')) changes.push({ scope, payload: { stagedAt: null } });
    else if (localScope.startsWith('alloc:')) changes.push({ scope, payload: { done: false } });
    else if (localScope.startsWith('release:')) changes.push({ scope, payload: { releasedAt: null } });
  });
  return changes;
}

type MetaPayload = { lockedAt?: string | null; stopOrder?: string[]; boxCodes?: Record<string, string> };

/** Applies remote rows (oldest first) onto the local day; per-scope last-write-wins. */
export function mergeRowsIntoDay(day: DriverDayState, rows: PickSyncRow[]): DriverDayState {
  if (!rows.length) return day;
  const sorted = [...rows].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const latestControl = [...sorted].reverse().find((row) => row.scope === 'run-control');
  const remoteRunCode = latestControl ? String((latestControl.payload as { activeRunCode?: string }).activeRunCode || 'A').toUpperCase() : (day.runCode || 'A');
  const switchingRun = remoteRunCode !== (day.runCode || 'A');
  let base: DriverDayState = switchingRun ? {
    version: 1,
    businessDay: day.businessDay,
    runCode: remoteRunCode,
    releasedOrders: {},
    stopProgress: {},
    shiftEvents: day.shiftEvents,
  } : { ...day, runCode: remoteRunCode };
  let pick = base.pick;
  let stopOrder = base.stopOrder;
  let releasedOrders = base.releasedOrders;
  let stopProgress = base.stopProgress;
  let shiftEvents = base.shiftEvents;
  let routeStartedAt = base.routeStartedAt;
  let routeEndedAt = base.routeEndedAt;
  const prefix = `run:${remoteRunCode}:`;

  sorted.forEach((row) => {
    if (row.scope === 'run-control') return;
    if (row.scope === 'shift') {
      const shift = row.payload as { events?: DriverDayState['shiftEvents'] };
      if (shift.events && shift.events.length >= shiftEvents.length) shiftEvents = shift.events;
      return;
    }
    let scope = row.scope;
    if (scope.startsWith('run:')) {
      if (!scope.startsWith(prefix)) return;
      scope = scope.slice(prefix.length);
    } else if (remoteRunCode !== 'A') return; // Unprefixed rows are legacy Run A only.

    if (scope === 'meta') {
      const meta = row.payload as MetaPayload;
      if (meta?.lockedAt) {
        pick = pick && pick.lockedAt === meta.lockedAt
          ? { ...pick, stopOrder: meta.stopOrder ?? pick.stopOrder, boxCodes: meta.boxCodes ?? pick.boxCodes }
          : { lockedAt: meta.lockedAt, stopOrder: meta.stopOrder ?? [], boxCodes: meta.boxCodes ?? {}, taskState: {}, allocDone: {}, stagedStops: {} };
        if (meta.stopOrder?.length) stopOrder = meta.stopOrder;
      } else pick = undefined;
      return;
    }
    if (scope.startsWith('release:')) {
      const orderId = scope.slice('release:'.length);
      const releasedAt = (row.payload as { releasedAt?: string | null }).releasedAt;
      const next = { ...releasedOrders };
      if (releasedAt) next[orderId] = releasedAt; else delete next[orderId];
      releasedOrders = next; return;
    }
    if (scope.startsWith('stop:')) {
      const orderId = scope.slice('stop:'.length);
      const incoming = row.payload as StopProgress;
      const local = stopProgress[orderId];
      const pod = incoming.pod && local?.pod && incoming.pod.capturedAt === local.pod.capturedAt
        ? { ...incoming.pod, photo: local.pod.photo, signature: local.pod.signature, pod1Photo: local.pod.pod1Photo, pod2Photo: local.pod.pod2Photo }
        : incoming.pod;
      stopProgress = { ...stopProgress, [orderId]: { ...incoming, pod } }; return;
    }
    if (scope === 'route') {
      const route = row.payload as { startedAt?: string | null; endedAt?: string | null };
      routeStartedAt = route.startedAt ?? undefined; routeEndedAt = route.endedAt ?? undefined; return;
    }
    if (!pick) return;
    if (scope.startsWith('task:')) {
      const sku = scope.slice('task:'.length); pick = { ...pick, taskState: { ...pick.taskState, [sku]: row.payload as PickTaskState } };
    } else if (scope.startsWith('alloc:')) {
      const key = scope.slice('alloc:'.length); pick = { ...pick, allocDone: { ...pick.allocDone, [key]: Boolean((row.payload as { done?: boolean }).done) } };
    } else if (scope.startsWith('stage:')) {
      const orderId = scope.slice('stage:'.length); const stagedAt = (row.payload as { stagedAt?: string | null }).stagedAt;
      const stagedStops = { ...pick.stagedStops }; if (stagedAt) stagedStops[orderId] = stagedAt; else delete stagedStops[orderId];
      pick = { ...pick, stagedStops };
    }
  });
  return { ...base, pick, stopOrder, releasedOrders, stopProgress, shiftEvents, routeStartedAt, routeEndedAt };
}

