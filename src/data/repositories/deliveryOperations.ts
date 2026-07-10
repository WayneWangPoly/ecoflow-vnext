import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type DeliveryOutcome = 'DELIVERED' | 'PARTIAL' | 'MISSING_CARTON' | 'REFUSED' | 'DAMAGED' | 'WRONG_GOODS' | 'FAILED';

export type DeliveryContext = {
  businessDay: string;
  orderId: string;
  orderNumber?: string | null;
  stopNumber?: number | null;
  boxCode?: string | null;
  storeName?: string | null;
  storeEmail?: string | null;
  storePhone?: string | null;
  pod1Path?: string | null;
  pod2Path?: string | null;
  actorLabel?: string | null;
};

export type DeliveryExceptionResult = {
  exception_id: string;
  return_code: string | null;
  return_status: string;
  outcome: DeliveryOutcome;
  recorded_at: string;
};

export type OpenDeliveryReturn = {
  id: string;
  business_day: string;
  order_id: string;
  order_number: string | null;
  stop_number: number | null;
  box_code: string | null;
  store_name: string | null;
  outcome: string | null;
  expected_cartons: number | string | null;
  delivered_cartons: number | string | null;
  return_cartons: number | string | null;
  reason: string | null;
  driver_note: string | null;
  return_code: string | null;
  return_status: string | null;
  warehouse_location: string | null;
  recorded_by: string | null;
  recorded_at: string | null;
  warehouse_received_by: string | null;
  warehouse_received_at: string | null;
  warehouse_action: string | null;
};

export type DeliveryNotificationRow = {
  id: string;
  event_key: string;
  business_day: string;
  order_id: string;
  order_number: string | null;
  stop_number: number | null;
  box_code: string | null;
  store_name: string | null;
  delivery_outcome: string;
  audience: string;
  channel: string;
  recipient: string | null;
  subject: string | null;
  message_text: string;
  pod1_path: string | null;
  pod2_path: string | null;
  notification_status: string;
  error_message: string | null;
  queued_by: string | null;
  queued_at: string;
  sent_at: string | null;
};

function activeClient(client?: SupabaseClient | null) {
  const next = client ?? supabase;
  if (!next) throw new Error('Supabase is not configured.');
  return next;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

export async function queueDeliveryNotifications(input: DeliveryContext & { outcome?: DeliveryOutcome; eventKey?: string; internalDetail?: string | null }, client?: SupabaseClient | null) {
  const active = activeClient(client);
  const eventKey = input.eventKey || `${input.businessDay}:${input.orderId}:${input.outcome || 'DELIVERED'}`;
  const { data, error } = await active.rpc('ecoflow_queue_delivery_notifications', {
    p_event_key: eventKey,
    p_business_day: input.businessDay,
    p_order_id: input.orderId,
    p_order_number: input.orderNumber ?? null,
    p_stop_number: input.stopNumber ?? null,
    p_box_code: input.boxCode ?? null,
    p_store_name: input.storeName ?? null,
    p_outcome: input.outcome ?? 'DELIVERED',
    p_store_email: input.storeEmail ?? null,
    p_store_phone: input.storePhone ?? null,
    p_pod1_path: input.pod1Path ?? null,
    p_pod2_path: input.pod2Path ?? null,
    p_internal_detail: input.internalDetail ?? null,
    p_queued_by: input.actorLabel ?? 'Driver',
  });
  if (error) throw new Error(errorMessage(error));
  return data ?? [];
}

export async function dispatchDeliveryNotifications(input: { notificationId?: string | null; businessDay?: string | null; orderId?: string | null }, client?: SupabaseClient | null) {
  const active = activeClient(client);
  const { data, error } = await active.functions.invoke('delivery-notification-dispatch', { body: input });
  if (error) throw new Error(errorMessage(error));
  return data;
}

export async function recordDeliveryException(input: DeliveryContext & { outcome: Exclude<DeliveryOutcome, 'DELIVERED'>; expectedCartons: number | string; deliveredCartons: number | string; returnCartons: number | string; reason?: string | null; driverNote?: string | null }, client?: SupabaseClient | null) {
  const active = activeClient(client);
  const { data, error } = await active.rpc('ecoflow_record_delivery_exception', {
    p_business_day: input.businessDay,
    p_order_id: input.orderId,
    p_order_number: input.orderNumber ?? null,
    p_stop_number: input.stopNumber ?? null,
    p_box_code: input.boxCode ?? null,
    p_store_name: input.storeName ?? null,
    p_outcome: input.outcome,
    p_expected_cartons: input.expectedCartons,
    p_delivered_cartons: input.deliveredCartons,
    p_return_cartons: input.returnCartons,
    p_reason: input.reason ?? null,
    p_driver_note: input.driverNote ?? null,
    p_pod2_path: input.pod2Path ?? null,
    p_store_email: input.storeEmail ?? null,
    p_store_phone: input.storePhone ?? null,
    p_recorded_by: input.actorLabel ?? 'Driver',
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as DeliveryExceptionResult[];
}

export async function loadOpenDeliveryReturns(client?: SupabaseClient | null) {
  const active = activeClient(client);
  const { data, error } = await active.from('v_ecoflow_open_delivery_returns').select('*').limit(100);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OpenDeliveryReturn[];
}

export async function scanDeliveryReturn(input: { returnCode: string; warehouseLocation?: string | null; note?: string | null; actorLabel?: string | null }, client?: SupabaseClient | null) {
  const active = activeClient(client);
  const { data, error } = await active.rpc('ecoflow_scan_delivery_return', {
    p_return_code: input.returnCode,
    p_warehouse_location: input.warehouseLocation ?? 'RETURNS-HOLD',
    p_scan_note: input.note ?? null,
    p_scanned_by: input.actorLabel ?? 'Warehouse',
  });
  if (error) throw new Error(errorMessage(error));
  return data ?? [];
}

export async function loadOwnerDeliveryNotifications(client?: SupabaseClient | null) {
  const active = activeClient(client);
  const { data, error } = await active
    .from('v_ecoflow_delivery_notification_outbox')
    .select('*')
    .eq('audience', 'OWNER')
    .eq('channel', 'INTERNAL')
    .order('queued_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as DeliveryNotificationRow[];
}
