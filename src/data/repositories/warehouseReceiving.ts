import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type WarehouseReceivingQueueRow = {
  sku: string | null;
  product_name: string | null;
  receiving_units: number | string | null;
  suggested_shelf: string | null;
  package_mode: string | null;
  primary_barcode: string | null;
  latest_location_movement_at: string | null;
  receiving_signal: string | null;
};

export type WarehouseReceivingMovementRow = {
  id: string;
  sku: string | null;
  product_name: string | null;
  movement_type: string | null;
  quantity: number | string | null;
  from_location: string | null;
  to_location: string | null;
  reference_type: string | null;
  reference_id: string | null;
  action_note: string | null;
  source: string | null;
  moved_at: string | null;
};

export type ReceiveByBarcodeResult = {
  movement_id: string;
  sku: string;
  barcode: string;
  package_level: string;
  packages: number | string;
  units_received: number | string;
  to_location: string;
  moved_at: string;
};

export type PutawayByBarcodeResult = {
  movement_id: string;
  sku: string;
  barcode: string;
  package_level: string;
  packages: number | string;
  units_putaway: number | string;
  from_location: string;
  to_location: string;
  moved_at: string;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code].filter(Boolean).map(String);
    return parts.length ? parts.join(' · ') : JSON.stringify(record);
  }
  return String(error);
}

export async function loadWarehouseReceivingQueue(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_warehouse_receiving_queue')
    .select('*')
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as WarehouseReceivingQueueRow[];
}

export async function loadWarehouseReceivingMovements(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_warehouse_recent_receiving_movements')
    .select('*')
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as WarehouseReceivingMovementRow[];
}

export async function receiveByBarcode(input: { barcode: string; qtyPackages?: number | string | null; toLocation?: string | null; note?: string | null }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_receive_by_barcode', {
    p_barcode: input.barcode,
    p_qty_packages: input.qtyPackages ?? 1,
    p_to_location: input.toLocation ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as ReceiveByBarcodeResult[];
}

export async function putawayByBarcode(input: { barcode: string; qtyPackages?: number | string | null; fromLocation?: string | null; toLocation?: string | null; note?: string | null }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_putaway_by_barcode', {
    p_barcode: input.barcode,
    p_qty_packages: input.qtyPackages ?? 1,
    p_from_location: input.fromLocation ?? 'RECEIVING',
    p_to_location: input.toLocation ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as PutawayByBarcodeResult[];
}
