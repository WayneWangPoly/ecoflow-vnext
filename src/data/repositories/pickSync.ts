import type { DriverDayState, PodRecord, StopProgress } from '@/domain/driverRun';
import type { PickState, PickTaskState } from '@/domain/pickPlan';
import { supabase } from '@/lib/supabaseClient';
import {
  comparePickSyncRows,
  sequenceFromPickSyncCursor
} from '@/data/pickSyncCursor';
export {
  advancePickSyncCursor,
  INITIAL_PICK_SYNC_CURSOR
} from '@/data/pickSyncCursor';

export type PickSyncRow = {
  business_day: string;
  scope: string;
  payload: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
  change_seq?: number | string | null;
  revision?: number | string | null;
};

export type PickSyncPushResult = {
  rows: PickSyncRow[];
  conflict: boolean;
  detail?: string;
};

/** scope -> serialized payload; used to diff local state against what the server knows. */
export type ScopeMap = Record<string, string>;

const POD_BUCKET = 'pod-photos';
const PAGE_SIZE = 500;
const MAX_SEQUENCE_PAGES = 20;
const AUTHORITY_READ_RPC = 'rpc/ecoflow_read_day_state';
const AUTHORITY_SCOPE_RPC = 'rpc/ecoflow_read_day_state_scope';
const AUTHORITY_WRITE_RPC = 'rpc/ecoflow_apply_day_state_commands';
const EPOCH = '1970-01-01T00:00:00.000Z';

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
  if (!response.ok) {
    const failure = new Error(`Supabase ${response.status}: ${await response.text()}`) as Error & { status?: number };
    failure.status = response.status;
    throw failure;
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function revisionNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function fetchSequencedPickRows(businessDay: string, cursor: string): Promise<PickSyncRow[]> {
  let afterSequence = sequenceFromPickSyncCursor(cursor) ?? 0n;
  const rows: PickSyncRow[] = [];

  for (let page = 0; page < MAX_SEQUENCE_PAGES; page += 1) {
    const batch = await rest<PickSyncRow[]>(AUTHORITY_READ_RPC, {
      method: 'POST',
      body: JSON.stringify({
        p_business_day: businessDay,
        p_after_change_seq: afterSequence.toString(),
        p_limit: PAGE_SIZE
      })
    });
    if (batch.length === 0) return rows;

    const nextSequence = batch.reduce((latest, row) => {
      const value = row.change_seq === null || row.change_seq === undefined
        ? latest
        : BigInt(String(row.change_seq));
      return value > latest ? value : latest;
    }, afterSequence);
    if (nextSequence <= afterSequence) {
      throw new Error('Shared-state sequence did not advance; sync stopped to avoid skipping rows.');
    }

    rows.push(...batch);
    afterSequence = nextSequence;
    if (batch.length < PAGE_SIZE) return rows;
  }

  throw new Error(`Shared-state sync exceeded ${PAGE_SIZE * MAX_SEQUENCE_PAGES} rows in one poll; pagination stopped safely.`);
}

export async function fetchPickRows(businessDay: string, cursor: string): Promise<PickSyncRow[]> {
  return fetchSequencedPickRows(businessDay, cursor);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function fallbackDigest(input: string) {
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    for (let word = 0; word < words.length; word += 1) {
      words[word] ^= code + word * 131;
      words[word] = Math.imul(words[word], 0x01000193 + word * 2) >>> 0;
    }
  }
  return words.flatMap((word) => [word >>> 24, word >>> 16, word >>> 8, word].map((part) => part & 0xff));
}

/** Stable across retries and reloads for the same intent and server revision. */
export async function operationalCommandId(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  let bytes: number[];
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    bytes = Array.from(new Uint8Array(digest).slice(0, 16));
  } else {
    bytes = fallbackDigest(input);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

type DayStateCommandResult = {
  command_id: string;
  business_day: string;
  scope: string;
  command_status: 'APPLIED' | 'REPLAYED' | 'CONFLICT';
  revision: number | string;
  payload: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string | null;
  change_seq: number | string | null;
};

function resultRow(result: DayStateCommandResult): PickSyncRow {
  return {
    business_day: result.business_day,
    scope: result.scope,
    payload: result.payload ?? {},
    updated_by: result.updated_by,
    updated_at: result.updated_at || EPOCH,
    change_seq: result.change_seq ?? 0,
    revision: result.revision
  };
}

export async function pushPickRows(
  businessDay: string,
  entries: { scope: string; payload: unknown; expectedRevision?: number }[],
  updatedBy: string
): Promise<PickSyncPushResult> {
  if (!entries.length) return { rows: [], conflict: false };

  const commands = await Promise.all(entries.map(async (entry) => {
    const expectedRevision = Math.max(0, Math.floor(entry.expectedRevision ?? 0));
    const canonical = stableJson(entry.payload);
    return {
      commandId: await operationalCommandId(`${businessDay}\n${entry.scope}\n${expectedRevision}\n${canonical}`),
      scope: entry.scope,
      expectedRevision,
      payload: entry.payload
    };
  }));

  const results = await rest<DayStateCommandResult[]>(AUTHORITY_WRITE_RPC, {
    method: 'POST',
    body: JSON.stringify({
      p_business_day: businessDay,
      p_commands: commands,
      p_updated_by: updatedBy
    })
  });

  const conflict = results.some((result) => result.command_status === 'CONFLICT');
  const rows = results.map(resultRow);
  return {
    rows,
    conflict,
    detail: conflict
      ? `A newer server revision was kept for ${rows.map((row) => row.scope).join(', ')}. Review the refreshed state before repeating the action.`
      : undefined
  };
}

async function readDayScope(businessDay: string, scope: string): Promise<PickSyncRow | null> {
  const rows = await rest<PickSyncRow[]>(AUTHORITY_SCOPE_RPC, {
    method: 'POST',
    body: JSON.stringify({ p_business_day: businessDay, p_scope: scope })
  });
  return rows[0] ?? null;
}

export async function setActiveRunCode(businessDay: string, runCode: string, updatedBy: string): Promise<void> {
  const normalizedRunCode = runCode.trim().toUpperCase() || 'A';
  const current = await readDayScope(businessDay, 'run-control');
  const desired = { activeRunCode: normalizedRunCode };
  let result = await pushPickRows(businessDay, [{
    scope: 'run-control',
    payload: desired,
    expectedRevision: revisionNumber(current?.revision)
  }], updatedBy);

  if (!result.conflict) return;
  const authoritative = result.rows[0];
  if (String(authoritative?.payload?.activeRunCode || '').toUpperCase() === normalizedRunCode) return;

  result = await pushPickRows(businessDay, [{
    scope: 'run-control',
    payload: desired,
    expectedRevision: revisionNumber(authoritative?.revision)
  }], updatedBy);
  if (!result.conflict) return;

  const failure = new Error(result.detail || 'Active run changed on another device. Refresh and try again.') as Error & { status?: number };
  failure.status = 409;
  throw failure;
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
  if (day.shiftEvents.length) map.shift = JSON.stringify({ events: day.shiftEvents });
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

/** Applies remote rows (oldest first) onto the current server-backed day. */
export function mergeRowsIntoDay(day: DriverDayState, rows: PickSyncRow[]): DriverDayState {
  if (!rows.length) return day;
  const sorted = [...rows].sort(comparePickSyncRows);
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
    } else if (remoteRunCode !== 'A') return;

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
      releasedOrders = next;
      return;
    }
    if (scope.startsWith('stop:')) {
      const orderId = scope.slice('stop:'.length);
      const incoming = row.payload as StopProgress;
      const local = stopProgress[orderId];
      const pod = incoming.pod && local?.pod && incoming.pod.capturedAt === local.pod.capturedAt
        ? { ...incoming.pod, photo: local.pod.photo, signature: local.pod.signature, pod1Photo: local.pod.pod1Photo, pod2Photo: local.pod.pod2Photo }
        : incoming.pod;
      stopProgress = { ...stopProgress, [orderId]: { ...incoming, pod } };
      return;
    }
    if (scope === 'route') {
      const route = row.payload as { startedAt?: string | null; endedAt?: string | null };
      routeStartedAt = route.startedAt ?? undefined;
      routeEndedAt = route.endedAt ?? undefined;
      return;
    }
    if (!pick) return;
    if (scope.startsWith('task:')) {
      const sku = scope.slice('task:'.length);
      pick = { ...pick, taskState: { ...pick.taskState, [sku]: row.payload as PickTaskState } };
    } else if (scope.startsWith('alloc:')) {
      const key = scope.slice('alloc:'.length);
      pick = { ...pick, allocDone: { ...pick.allocDone, [key]: Boolean((row.payload as { done?: boolean }).done) } };
    } else if (scope.startsWith('stage:')) {
      const orderId = scope.slice('stage:'.length);
      const stagedAt = (row.payload as { stagedAt?: string | null }).stagedAt;
      const stagedStops = { ...pick.stagedStops };
      if (stagedAt) stagedStops[orderId] = stagedAt; else delete stagedStops[orderId];
      pick = { ...pick, stagedStops };
    }
  });
  return { ...base, pick, stopOrder, releasedOrders, stopProgress, shiftEvents, routeStartedAt, routeEndedAt };
}

/** Device cache is discarded on first successful hydration, including empty server days. */
export function replaceRowsIntoDay(day: DriverDayState, rows: PickSyncRow[]): DriverDayState {
  const empty: DriverDayState = {
    version: 1,
    businessDay: day.businessDay,
    runCode: 'A',
    releasedOrders: {},
    stopProgress: {},
    shiftEvents: []
  };
  return rows.length ? mergeRowsIntoDay(empty, rows) : empty;
}
