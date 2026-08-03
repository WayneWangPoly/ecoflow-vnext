import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { productIdentityFriendlyError } from './productIdentityCommissioning';

export type ReturnIdentityQueueRow = {
  exception_id: string;
  business_day: string;
  order_id: string;
  order_number: string | null;
  stop_number: number | null;
  box_code: string | null;
  store_name: string | null;
  outcome: string;
  return_cartons: number | string;
  reason: string | null;
  driver_note: string | null;
  return_code: string;
  return_status: string;
  warehouse_location: string | null;
  warehouse_action: string;
  received_at: string | null;
  inspected_packages: number | string;
  restocked_packages: number | string;
  disposed_packages: number | string;
  latest_inspection_at: string | null;
};

export type ReturnIdentityInspection = {
  inspection_id: string;
  exception_id: string;
  product_barcode: string;
  commercial_sku: string | null;
  physical_sku: string;
  product_name: string;
  family_code: string;
  family_name: string;
  package_level: string;
  units_per_barcode: number | string;
  package_quantity: number | string;
  goods_condition: string;
  disposition: 'RESTOCK' | 'DISPOSE';
  warehouse_location: string;
  inspection_note: string | null;
  stock_movement_recorded: boolean;
  actor_role: string;
  inspected_at: string;
};

function activeClient(client?: SupabaseClient | null) {
  const value = client ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function commandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure command ID.');
}

function detail(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

async function rpc<T>(name: string, args: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(detail(result.error));
  return result.data as T;
}

function first<T>(rows: T[] | null | undefined, label: string) {
  const row = rows?.[0];
  if (!row) throw new Error(`${label} returned no result.`);
  return row;
}

export function returnIdentityFriendlyError(error: unknown) {
  const message = productIdentityFriendlyError(error);
  if (message.includes('RETURN_CODE_NOT_FOUND')) return 'Return Code was not found. Check the driver label and scan it again.';
  if (message.includes('RETURN_ALREADY_CLOSED')) return 'This return has already been completed and cannot be processed again.';
  if (message.includes('RECEIVE_RETURN_CODE_BEFORE_PRODUCT_INSPECTION')) return 'Receive the Return Code into the warehouse before scanning product packages.';
  if (message.includes('UNSALEABLE_RETURN_CANNOT_RESTOCK')) return 'Opened, damaged, contaminated or unknown-condition goods cannot return to sellable stock.';
  if (message.includes('RESTOCK_LOCATION_REQUIRED')) return 'Choose an active sellable warehouse location before restocking.';
  if (message.includes('WHOLE_RETURN_PACKAGE_QUANTITY_REQUIRED')) return 'Enter a whole package quantity greater than zero.';
  return message;
}

export async function loadReturnIdentityQueue(search?: string, client?: SupabaseClient | null) {
  return await rpc<ReturnIdentityQueueRow[]>('ecoflow_read_return_identity_queue', {
    p_search: search?.trim() || null,
    p_limit: 500,
  }, client) ?? [];
}

export async function loadReturnIdentityInspections(exceptionId: string, client?: SupabaseClient | null) {
  return await rpc<ReturnIdentityInspection[]>('ecoflow_read_return_identity_inspections', {
    p_exception_id: exceptionId,
  }, client) ?? [];
}

export async function receiveDeliveryReturn(input: {
  returnCode: string;
  warehouseLocation: string;
  note?: string | null;
}, client?: SupabaseClient | null) {
  const rows = await rpc<Array<{
    exception_id: string;
    return_code: string;
    return_status: string;
    warehouse_location: string;
    received_at: string;
  }>>('ecoflow_receive_delivery_return', {
    p_return_code: input.returnCode.trim().toUpperCase(),
    p_warehouse_location: input.warehouseLocation.trim().toUpperCase(),
    p_note: input.note?.trim() || null,
    p_command_id: commandId(),
  }, client);
  return first(rows, 'Return receipt');
}

export async function inspectDeliveryReturnItem(input: {
  returnCode: string;
  productBarcode: string;
  packageQuantity: number;
  goodsCondition: 'SEALED' | 'SALEABLE' | 'OPENED' | 'DAMAGED' | 'CONTAMINATED' | 'UNKNOWN';
  disposition: 'RESTOCK' | 'DISPOSE';
  warehouseLocation: string;
  note?: string | null;
}, client?: SupabaseClient | null) {
  const rows = await rpc<Array<{
    inspection_id: string;
    exception_id: string;
    return_status: string;
    physical_sku: string;
    family_code: string;
    package_quantity: number | string;
    disposition: 'RESTOCK' | 'DISPOSE';
    stock_movement_recorded: boolean;
    inspected_at: string;
  }>>('ecoflow_inspect_delivery_return_item', {
    p_return_code: input.returnCode.trim().toUpperCase(),
    p_product_barcode: input.productBarcode.trim(),
    p_package_quantity: input.packageQuantity,
    p_goods_condition: input.goodsCondition,
    p_disposition: input.disposition,
    p_warehouse_location: input.warehouseLocation.trim().toUpperCase(),
    p_note: input.note?.trim() || null,
    p_command_id: commandId(),
  }, client);
  return first(rows, 'Return inspection');
}
