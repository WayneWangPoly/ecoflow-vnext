import { supabase } from '@/lib/supabaseClient';

export type CustomerOperationalEventType = 'DELIVERY_INSTRUCTION' | 'CUSTOMER_CONTACT';
export type CustomerContactChannel = 'PHONE' | 'EMAIL' | 'IN_PERSON' | 'SMS' | 'OTHER';
export type CustomerOperationalPersistence = 'REMOTE' | 'LOCAL';

export type CustomerOperationalEventRow = {
  id: string;
  store_key: string;
  store_name: string;
  event_type: CustomerOperationalEventType;
  note_text: string;
  contact_channel: CustomerContactChannel | null;
  occurred_at: string;
  created_by: string;
  created_by_email: string | null;
  created_at: string;
  persistence?: CustomerOperationalPersistence;
};

export type DriverDeliveryInstructionRow = {
  store_key: string;
  store_name: string;
  note_text: string;
  occurred_at: string;
  created_by_email: string | null;
  created_at: string;
};

export type CustomerOperationalWriteResult = {
  rows: CustomerOperationalEventRow[];
  persistence: CustomerOperationalPersistence;
};

const EVENTS_TTL_MS = 5 * 60_000;
const DRIVER_TTL_MS = 60_000;
const LOCAL_PREFIX = 'ecoflow-customer-ops-v1:';
const eventCache = new Map<string, { at: number; rows: CustomerOperationalEventRow[] }>();
const eventInflight = new Map<string, Promise<CustomerOperationalEventRow[]>>();
let driverCache: { at: number; rows: DriverDeliveryInstructionRow[] } | null = null;
let driverInflight: Promise<DriverDeliveryInstructionRow[]> | null = null;
let remoteAvailable: boolean | null = null;

function client() {
  if (!supabase) throw new Error('Secure Supabase connection is unavailable.');
  return supabase;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ');
  }
  return String(error);
}

function remoteObjectMissing(error: unknown) {
  const text = errorText(error);
  return /PGRST20[245]|42P01|42883|schema cache|could not find the table|could not find the function/i.test(text);
}

function localStorageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function localKey(storeKey: string) {
  return `${LOCAL_PREFIX}${storeKey}`;
}

function readLocalRows(storeKey: string): CustomerOperationalEventRow[] {
  if (!localStorageAvailable()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localKey(storeKey)) || '[]') as CustomerOperationalEventRow[];
    return Array.isArray(parsed)
      ? parsed.map((row) => ({ ...row, persistence: 'LOCAL' as const }))
        .sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)))
      : [];
  } catch {
    return [];
  }
}

function writeLocalRows(storeKey: string, rows: CustomerOperationalEventRow[]) {
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.setItem(localKey(storeKey), JSON.stringify(rows.slice(0, 120)));
  } catch {
    // Local persistence is best effort; the visible editor keeps the new row in memory.
  }
}

function localId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeRows(remoteRows: CustomerOperationalEventRow[], localRows: CustomerOperationalEventRow[]) {
  const seen = new Set<string>();
  return [...remoteRows.map((row) => ({ ...row, persistence: 'REMOTE' as const })), ...localRows]
    .filter((row) => {
      const fingerprint = `${row.event_type}|${row.occurred_at}|${row.note_text}`;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)));
}

export function normaliseCustomerKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function peekCustomerOperationalEvents(storeName: string) {
  const storeKey = normaliseCustomerKey(storeName);
  if (!storeKey) return [];
  return eventCache.get(storeKey)?.rows ?? readLocalRows(storeKey);
}

export async function loadCustomerOperationalEvents(storeName: string, force = false) {
  const storeKey = normaliseCustomerKey(storeName);
  if (!storeKey) return [];
  const cached = eventCache.get(storeKey);
  if (!force && cached && Date.now() - cached.at < EVENTS_TTL_MS) return cached.rows;
  const pending = eventInflight.get(storeKey);
  if (!force && pending) return pending;
  const localRows = readLocalRows(storeKey);

  if (remoteAvailable === false || !supabase) {
    eventCache.set(storeKey, { at: Date.now(), rows: localRows });
    return localRows;
  }

  const request = (async () => {
    const { data, error } = await client()
      .from('v_ecoflow_customer_operational_events')
      .select('id,store_key,store_name,event_type,note_text,contact_channel,occurred_at,created_by,created_by_email,created_at')
      .eq('store_key', storeKey)
      .order('occurred_at', { ascending: false })
      .limit(120);

    if (error) {
      if (remoteObjectMissing(error)) remoteAvailable = false;
      const fallback = cached?.rows.length ? cached.rows : localRows;
      eventCache.set(storeKey, { at: Date.now(), rows: fallback });
      return fallback;
    }

    remoteAvailable = true;
    const rows = mergeRows((data ?? []) as CustomerOperationalEventRow[], localRows);
    eventCache.set(storeKey, { at: Date.now(), rows });
    return rows;
  })().finally(() => eventInflight.delete(storeKey));

  eventInflight.set(storeKey, request);
  return request;
}

function saveLocalEvent(input: {
  storeKey: string;
  storeName: string;
  eventType: CustomerOperationalEventType;
  noteText: string;
  contactChannel?: CustomerContactChannel | null;
  occurredAt?: string | null;
}): CustomerOperationalWriteResult {
  const now = new Date().toISOString();
  const row: CustomerOperationalEventRow = {
    id: localId(),
    store_key: input.storeKey,
    store_name: input.storeName.trim(),
    event_type: input.eventType,
    note_text: input.noteText.trim(),
    contact_channel: input.contactChannel ?? null,
    occurred_at: input.occurredAt || now,
    created_by: 'local-browser',
    created_by_email: null,
    created_at: now,
    persistence: 'LOCAL',
  };
  const rows = mergeRows([], [row, ...readLocalRows(input.storeKey)]);
  writeLocalRows(input.storeKey, rows);
  eventCache.set(input.storeKey, { at: Date.now(), rows });
  if (input.eventType === 'DELIVERY_INSTRUCTION') driverCache = null;
  return { rows, persistence: 'LOCAL' };
}

export async function recordCustomerOperationalEvent(input: {
  storeName: string;
  eventType: CustomerOperationalEventType;
  noteText: string;
  contactChannel?: CustomerContactChannel | null;
  occurredAt?: string | null;
}): Promise<CustomerOperationalWriteResult> {
  const storeKey = normaliseCustomerKey(input.storeName);
  if (!storeKey) throw new Error('Customer name is required.');
  const payload = { ...input, storeKey };

  if (remoteAvailable === false || !supabase) return saveLocalEvent(payload);

  const { data, error } = await client().rpc('ecoflow_record_customer_operational_event', {
    p_store_key: storeKey,
    p_store_name: input.storeName.trim(),
    p_event_type: input.eventType,
    p_note_text: input.noteText.trim(),
    p_contact_channel: input.contactChannel ?? null,
    p_occurred_at: input.occurredAt || new Date().toISOString(),
  });

  if (error) {
    if (remoteObjectMissing(error)) remoteAvailable = false;
    return saveLocalEvent(payload);
  }

  remoteAvailable = true;
  eventCache.delete(storeKey);
  if (input.eventType === 'DELIVERY_INSTRUCTION') driverCache = null;
  const rows = (data ?? []) as CustomerOperationalEventRow[];
  return { rows: rows.map((row) => ({ ...row, persistence: 'REMOTE' })), persistence: 'REMOTE' };
}

function localDriverInstructions() {
  if (!localStorageAvailable()) return [];
  const rows: DriverDeliveryInstructionRow[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(LOCAL_PREFIX)) continue;
    const latest = readLocalRows(key.slice(LOCAL_PREFIX.length))
      .find((row) => row.event_type === 'DELIVERY_INSTRUCTION');
    if (latest) rows.push({
      store_key: latest.store_key,
      store_name: latest.store_name,
      note_text: latest.note_text,
      occurred_at: latest.occurred_at,
      created_by_email: latest.created_by_email,
      created_at: latest.created_at,
    });
  }
  return rows;
}

export async function loadLatestDriverDeliveryInstructions(force = false) {
  if (!force && driverCache && Date.now() - driverCache.at < DRIVER_TTL_MS) return driverCache.rows;
  if (!force && driverInflight) return driverInflight;
  const localRows = localDriverInstructions();

  if (remoteAvailable === false || !supabase) {
    driverCache = { at: Date.now(), rows: localRows };
    return localRows;
  }

  driverInflight = (async () => {
    const { data, error } = await client()
      .from('v_ecoflow_latest_driver_delivery_instructions')
      .select('store_key,store_name,note_text,occurred_at,created_by_email,created_at')
      .order('store_name', { ascending: true })
      .limit(1000);
    if (error) {
      if (remoteObjectMissing(error)) remoteAvailable = false;
      return driverCache?.rows.length ? driverCache.rows : localRows;
    }
    remoteAvailable = true;
    const remoteRows = (data ?? []) as DriverDeliveryInstructionRow[];
    const byKey = new Map(remoteRows.map((row) => [row.store_key, row]));
    localRows.forEach((row) => { if (!byKey.has(row.store_key)) byKey.set(row.store_key, row); });
    const rows = [...byKey.values()].sort((left, right) => left.store_name.localeCompare(right.store_name));
    driverCache = { at: Date.now(), rows };
    return rows;
  })().finally(() => { driverInflight = null; });

  return driverInflight;
}
