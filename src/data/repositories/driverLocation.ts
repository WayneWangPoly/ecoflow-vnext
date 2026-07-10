import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type DriverLocationSource =
  | 'AUTO_INTERVAL'
  | 'MANUAL'
  | 'ROUTE_START'
  | 'ROUTE_END'
  | 'STOP_ARRIVAL'
  | 'DELIVERY'
  | 'FAILED_DELIVERY';

export type DriverLocationSample = {
  id: string;
  business_day: string;
  route_id: string;
  driver_user_id: string;
  driver_label: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | string | null;
  speed_mps: number | string | null;
  heading_degrees: number | string | null;
  current_order_id: string | null;
  sample_source: DriverLocationSource;
  captured_at: string;
  received_at: string;
};

export type RecordDriverLocationInput = {
  businessDay: string;
  routeId: string;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDegrees?: number | null;
  currentOrderId?: string | null;
  source: DriverLocationSource;
  clientSampleId: string;
  capturedAt: string;
  driverLabel?: string | null;
  deviceTimezone?: string | null;
  metadata?: Record<string, unknown>;
};

function client(active?: SupabaseClient | null) {
  const value = active ?? supabase;
  if (!value) throw new Error('Secure Supabase session is required for driver tracking.');
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ');
  }
  return String(error);
}

export async function recordDriverLocationSample(input: RecordDriverLocationInput, active?: SupabaseClient | null) {
  const { data, error } = await client(active).rpc('ecoflow_record_driver_location_sample', {
    p_business_day: input.businessDay,
    p_route_id: input.routeId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_m: input.accuracyM ?? null,
    p_speed_mps: input.speedMps ?? null,
    p_heading_degrees: input.headingDegrees ?? null,
    p_current_order_id: input.currentOrderId ?? null,
    p_sample_source: input.source,
    p_client_sample_id: input.clientSampleId,
    p_captured_at: input.capturedAt,
    p_driver_label: input.driverLabel ?? null,
    p_device_timezone: input.deviceTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as DriverLocationSample[];
}

export async function loadOwnerDriverLocationTimeline(businessDay: string, active?: SupabaseClient | null) {
  const { data, error } = await client(active)
    .from('v_ecoflow_owner_driver_location_timeline')
    .select('*')
    .eq('business_day', businessDay)
    .order('captured_at', { ascending: true })
    .limit(600);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as DriverLocationSample[];
}

export async function loadDriverIdentity(active?: SupabaseClient | null) {
  const value = client(active);
  const { data, error } = await value
    .from('v_ecoflow_current_user')
    .select('user_id,email,display_name,app_role,is_active,team_status')
    .maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return data as {
    user_id?: string;
    email?: string | null;
    display_name?: string | null;
    app_role?: string | null;
    is_active?: boolean | null;
    team_status?: string | null;
  } | null;
}
