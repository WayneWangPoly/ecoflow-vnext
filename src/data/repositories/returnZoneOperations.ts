import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { OpenDeliveryReturn } from './deliveryOperations';

export type ReturnZone = {
  id: string;
  zone_code: string;
  zone_name: string | null;
  warehouse_location: string | null;
  active: boolean | null;
};

export type ReturnInspectionLine = {
  id: string;
  exception_id: string;
  return_code: string | null;
  store_name: string | null;
  order_number: string | null;
  resolution: string;
  barcode: string | null;
  sku: string | null;
  product_name: string | null;
  package_level: string | null;
  qty_packages: number | string | null;
  units_processed: number | string | null;
  target_location: string | null;
  movement_id: string | null;
  manual_item: string | null;
  inspection_note: string | null;
  inspected_by: string | null;
  inspected_at: string | null;
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

export async function loadReturnZones(client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).from('v_ecoflow_warehouse_return_zones').select('*').limit(10);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as ReturnZone[];
}

export async function loadOpenReturnZoneItems(client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).from('v_ecoflow_open_delivery_returns').select('*').limit(100);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as OpenDeliveryReturn[];
}

export async function driverDropReturn(input: { exceptionId: string; zoneCode: string; note?: string | null; driver?: string | null }, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_driver_drop_return', {
    p_exception_id: input.exceptionId,
    p_zone_code: input.zoneCode,
    p_note: input.note ?? null,
    p_driver: input.driver ?? 'Driver',
  });
  if (error) throw new Error(errorMessage(error));
  return data ?? [];
}

export async function loadReturnInspectionLines(exceptionId: string, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client)
    .from('v_ecoflow_return_inspection_lines')
    .select('*')
    .eq('exception_id', exceptionId)
    .order('inspected_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as ReturnInspectionLine[];
}

export async function recordReturnInspectionItem(input: {
  exceptionId: string;
  resolution: 'RESTOCK' | 'SUPPLIER_CLAIM' | 'DISPOSE';
  barcode?: string | null;
  qtyPackages?: number | string | null;
  targetLocation?: string | null;
  manualItem?: string | null;
  note?: string | null;
  inspectedBy?: string | null;
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_record_return_inspection_item', {
    p_exception_id: input.exceptionId,
    p_resolution: input.resolution,
    p_barcode: input.barcode ?? null,
    p_qty_packages: input.qtyPackages ?? 1,
    p_target_location: input.targetLocation ?? null,
    p_manual_item: input.manualItem ?? null,
    p_note: input.note ?? null,
    p_inspected_by: input.inspectedBy ?? 'Warehouse',
  });
  if (error) throw new Error(errorMessage(error));
  return data ?? [];
}

export async function completeReturnInspection(input: { exceptionId: string; note?: string | null; inspectedBy?: string | null }, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_complete_return_inspection', {
    p_exception_id: input.exceptionId,
    p_note: input.note ?? null,
    p_inspected_by: input.inspectedBy ?? 'Warehouse',
  });
  if (error) throw new Error(errorMessage(error));
  return data ?? [];
}
