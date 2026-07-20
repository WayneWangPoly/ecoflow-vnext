import { supabase } from '@/lib/supabaseClient';

export type CustomerOperationalEventType = 'DELIVERY_INSTRUCTION' | 'CUSTOMER_CONTACT';
export type CustomerContactChannel = 'PHONE' | 'EMAIL' | 'IN_PERSON' | 'SMS' | 'OTHER';

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
};

export type DriverDeliveryInstructionRow = {
  store_key: string;
  store_name: string;
  note_text: string;
  occurred_at: string;
  created_by_email: string | null;
  created_at: string;
};

const EVENTS_TTL_MS = 45_000;
const DRIVER_TTL_MS = 30_000;
const eventCache = new Map<string, { at: number; rows: CustomerOperationalEventRow[] }>();
const eventInflight = new Map<string, Promise<CustomerOperationalEventRow[]>>();
let driverCache: { at: number; rows: DriverDeliveryInstructionRow[] } | null = null;
let driverInflight: Promise<DriverDeliveryInstructionRow[]> | null = null;

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

export function normaliseCustomerKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function loadCustomerOperationalEvents(storeName: string, force = false) {
  const storeKey = normaliseCustomerKey(storeName);
  if (!storeKey) return [];
  const cached = eventCache.get(storeKey);
  if (!force && cached && Date.now() - cached.at < EVENTS_TTL_MS) return cached.rows;
  const pending = eventInflight.get(storeKey);
  if (!force && pending) return pending;

  const request = (async () => {
    const { data, error } = await client()
      .from('v_ecoflow_customer_operational_events')
      .select('id,store_key,store_name,event_type,note_text,contact_channel,occurred_at,created_by,created_by_email,created_at')
      .eq('store_key', storeKey)
      .order('occurred_at', { ascending: false })
      .limit(120);
    if (error) {
      if (cached?.rows.length) return cached.rows;
      throw new Error(errorText(error));
    }
    const rows = (data ?? []) as CustomerOperationalEventRow[];
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
}) {
  const storeKey = normaliseCustomerKey(input.storeName);
  if (!storeKey) throw new Error('Customer name is required.');
  const { data, error } = await client().rpc('ecoflow_record_customer_operational_event', {
    p_store_key: storeKey,
    p_store_name: input.storeName.trim(),
    p_event_type: input.eventType,
    p_note_text: input.noteText.trim(),
    p_contact_channel: input.contactChannel ?? null,
    p_occurred_at: input.occurredAt || new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
  eventCache.delete(storeKey);
  if (input.eventType === 'DELIVERY_INSTRUCTION') driverCache = null;
  return (data ?? []) as CustomerOperationalEventRow[];
}

export async function loadLatestDriverDeliveryInstructions(force = false) {
  if (!force && driverCache && Date.now() - driverCache.at < DRIVER_TTL_MS) return driverCache.rows;
  if (!force && driverInflight) return driverInflight;
  const stale = driverCache;

  driverInflight = (async () => {
    const { data, error } = await client()
      .from('v_ecoflow_latest_driver_delivery_instructions')
      .select('store_key,store_name,note_text,occurred_at,created_by_email,created_at')
      .order('store_name', { ascending: true })
      .limit(1000);
    if (error) {
      if (stale?.rows.length) return stale.rows;
      throw new Error(errorText(error));
    }
    const rows = (data ?? []) as DriverDeliveryInstructionRow[];
    driverCache = { at: Date.now(), rows };
    return rows;
  })().finally(() => { driverInflight = null; });

  return driverInflight;
}
