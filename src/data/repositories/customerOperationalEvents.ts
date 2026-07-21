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

function remoteUnavailableError(error?: unknown) {
  const detail = error ? errorText(error) : '';
  return new Error(
    detail
      ? `Customer operational records are unavailable and nothing was saved. ${detail}`
      : 'Customer operational records are unavailable and nothing was saved.',
  );
}

function mergeRows(rows: CustomerOperationalEventRow[]) {
  const seen = new Set<string>();
  return rows
    .map((row) => ({ ...row, persistence: 'REMOTE' as const }))
    .filter((row) => {
      const fingerprint = `${row.id}|${row.event_type}|${row.occurred_at}|${row.note_text}`;
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
  return eventCache.get(storeKey)?.rows ?? [];
}

export async function loadCustomerOperationalEvents(storeName: string, force = false) {
  const storeKey = normaliseCustomerKey(storeName);
  if (!storeKey) return [];
  const cached = eventCache.get(storeKey);
  if (!force && cached && Date.now() - cached.at < EVENTS_TTL_MS) return cached.rows;
  const pending = eventInflight.get(storeKey);
  if (!force && pending) return pending;

  if (remoteAvailable === false || !supabase) {
    if (cached?.rows.length) return cached.rows;
    throw remoteUnavailableError();
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
      if (cached?.rows.length) return cached.rows;
      throw remoteUnavailableError(error);
    }

    remoteAvailable = true;
    const rows = mergeRows((data ?? []) as CustomerOperationalEventRow[]);
    eventCache.set(storeKey, { at: Date.now(), rows });
    return rows;
  })().finally(() => eventInflight.delete(storeKey));

  eventInflight.set(storeKey, request);
  return request;
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
  if (remoteAvailable === false || !supabase) throw remoteUnavailableError();

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
    throw remoteUnavailableError(error);
  }

  remoteAvailable = true;
  eventCache.delete(storeKey);
  if (input.eventType === 'DELIVERY_INSTRUCTION') driverCache = null;
  const rows = mergeRows((data ?? []) as CustomerOperationalEventRow[]);
  eventCache.set(storeKey, { at: Date.now(), rows });
  return { rows, persistence: 'REMOTE' };
}

export async function loadLatestDriverDeliveryInstructions(force = false) {
  if (!force && driverCache && Date.now() - driverCache.at < DRIVER_TTL_MS) return driverCache.rows;
  if (!force && driverInflight) return driverInflight;

  if (remoteAvailable === false || !supabase) {
    if (driverCache?.rows.length) return driverCache.rows;
    throw remoteUnavailableError();
  }

  driverInflight = (async () => {
    const { data, error } = await client()
      .from('v_ecoflow_latest_driver_delivery_instructions')
      .select('store_key,store_name,note_text,occurred_at,created_by_email,created_at')
      .order('store_name', { ascending: true })
      .limit(1000);

    if (error) {
      if (remoteObjectMissing(error)) remoteAvailable = false;
      if (driverCache?.rows.length) return driverCache.rows;
      throw remoteUnavailableError(error);
    }

    remoteAvailable = true;
    const rows = ((data ?? []) as DriverDeliveryInstructionRow[])
      .sort((left, right) => left.store_name.localeCompare(right.store_name));
    driverCache = { at: Date.now(), rows };
    return rows;
  })().finally(() => { driverInflight = null; });

  return driverInflight;
}
