import { supabase } from '@/lib/supabaseClient';

export const DRIVER_DEPARTURE_POLICY_VERSION = '2026-07-11-v1';

export const DRIVER_DEPARTURE_DECLARATION =
  'I confirm that I completed the listed pre-departure checks, reported any known defect, will not operate an unsafe vehicle, and understand that EcoFlow records approximate location while this delivery route is active for dispatch visibility, delivery verification and safety. Location collection stops when the route ends. This record does not remove statutory workplace safety, employment, insurance or workers compensation rights or duties.';

export type DriverDepartureChecks = {
  vehicle_walkaround: boolean;
  tyres_wheels: boolean;
  windscreen_mirrors: boolean;
  lights_indicators: boolean;
  fuel_charge: boolean;
  load_secured: boolean;
  phone_navigation: boolean;
  licence_fitness: boolean;
  defects_reported: boolean;
};

export type DriverDepartureAcknowledgement = {
  id?: string;
  acknowledgement_id?: string;
  business_day?: string;
  route_id?: string;
  driver_user_id?: string;
  driver_email?: string | null;
  driver_label?: string | null;
  typed_name?: string;
  policy_version: string;
  checks?: DriverDepartureChecks;
  location_consent?: boolean;
  accepted_at: string;
};

export type RouteNotificationResult = {
  ok: boolean;
  sent: number;
  alreadySent: number;
  missingContact: number;
  disabled: number;
  failed: number;
  configurationRequired?: boolean;
  details?: Array<Record<string, unknown>>;
};

function requireClient() {
  if (!supabase) throw new Error('Secure Supabase connection is unavailable.');
  return supabase;
}

export async function loadDepartureAcknowledgement(input: {
  businessDay: string;
  routeId: string;
}): Promise<DriverDepartureAcknowledgement | null> {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error('Signed-in driver required.');
  const { data, error } = await client
    .from('ecoflow_driver_departure_acknowledgements')
    .select('id,business_day,route_id,driver_user_id,typed_name,policy_version,checks,location_consent,accepted_at')
    .eq('business_day', input.businessDay)
    .eq('route_id', input.routeId)
    .eq('driver_user_id', userData.user.id)
    .eq('policy_version', DRIVER_DEPARTURE_POLICY_VERSION)
    .maybeSingle();
  if (error) throw error;
  return (data as DriverDepartureAcknowledgement | null) ?? null;
}

export async function recordDepartureAcknowledgement(input: {
  businessDay: string;
  routeId: string;
  typedName: string;
  checks: DriverDepartureChecks;
  locationConsent: boolean;
  driverLabel?: string;
}): Promise<DriverDepartureAcknowledgement> {
  const client = requireClient();
  const { data, error } = await client.rpc('ecoflow_record_driver_departure_acknowledgement', {
    p_business_day: input.businessDay,
    p_route_id: input.routeId,
    p_policy_version: DRIVER_DEPARTURE_POLICY_VERSION,
    p_typed_name: input.typedName.trim(),
    p_checks: input.checks,
    p_location_consent: input.locationConsent,
    p_declaration_text: DRIVER_DEPARTURE_DECLARATION,
    p_driver_label: input.driverLabel?.trim() || null,
    p_user_agent: navigator.userAgent.slice(0, 500),
    p_metadata: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      visibility: document.visibilityState,
    },
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Departure acknowledgement was not recorded.');
  return row as DriverDepartureAcknowledgement;
}

export async function notifyRouteStarted(input: {
  businessDay: string;
  routeId: string;
  orderIds: string[];
  startedAt: string;
}): Promise<RouteNotificationResult> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('notify-route-start', {
    body: input,
  });
  if (error) throw error;
  if (data?.error) throw new Error(`${data.error}${data.details ? `: ${data.details}` : ''}`);
  return data as RouteNotificationResult;
}

export async function loadOwnerDepartureAcknowledgements(businessDay: string) {
  const client = requireClient();
  const { data, error } = await client
    .from('v_ecoflow_owner_driver_departure_acknowledgements')
    .select('*')
    .eq('business_day', businessDay)
    .order('accepted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DriverDepartureAcknowledgement[];
}

export async function loadDeliveryNotificationLog(businessDay: string) {
  const client = requireClient();
  const { data, error } = await client
    .from('ecoflow_delivery_notification_log')
    .select('*')
    .eq('business_day', businessDay)
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function updateStoreNotificationContact(input: {
  storeKey: string;
  storeName: string;
  retailerId?: string | null;
  email?: string | null;
  contactName?: string | null;
  enabled: boolean;
}) {
  const client = requireClient();
  const { data, error } = await client.rpc('ecoflow_upsert_store_delivery_notification_contact', {
    p_store_key: input.storeKey,
    p_store_name: input.storeName,
    p_retailer_id: input.retailerId ?? null,
    p_email: input.email?.trim() || null,
    p_contact_name: input.contactName?.trim() || null,
    p_enabled: input.enabled,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
