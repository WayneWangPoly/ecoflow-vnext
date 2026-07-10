import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type StagedReceivingBatch = {
  id: string;
  batch_no: string;
  batch_status: string | null;
  line_count: number | string | null;
  confirmed_count: number | string | null;
  posted_count: number | string | null;
  total_units: number | string | null;
  receive_signal: string | null;
};

export type StagedReceivingLine = {
  id: string;
  batch_id: string;
  batch_no: string | null;
  batch_status: string | null;
  sku: string | null;
  product_name: string | null;
  barcode: string | null;
  package_level: string | null;
  qty_packages: number | string | null;
  units_per_package: number | string | null;
  units_received: number | string | null;
  suggested_location: string | null;
  confirmation_checked: boolean | null;
  line_status: string | null;
  movement_id: string | null;
  scanned_at: string | null;
  idempotency_key?: string | null;
};

function activeClient(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(record);
  }
  return String(error);
}

export async function loadOpenStagedReceivingBatches(client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client)
    .from('v_ecoflow_warehouse_receiving_batches')
    .select('*')
    .in('batch_status', ['SCANNING', 'READY_TO_POST'])
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) throw new Error(message(error));
  return (data ?? []) as StagedReceivingBatch[];
}

export async function loadStagedReceivingLines(batchId: string, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client)
    .from('v_ecoflow_warehouse_receiving_batch_lines')
    .select('*')
    .eq('batch_id', batchId)
    .order('scanned_at', { ascending: false })
    .limit(120);
  if (error) throw new Error(message(error));
  return (data ?? []) as StagedReceivingLine[];
}

export async function startStagedReceivingBatch(client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_start_warehouse_receiving_batch', {
    p_supplier_name: null,
    p_supplier_order_ref: null,
    p_invoice_ref: null,
    p_note: 'Warehouse staged receiving',
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ batch_id: string; batch_no: string; batch_status: string; created_at: string }>;
}

export async function stageReceivingScan(input: {
  batchId?: string | null;
  barcode: string;
  qtyPackages?: string | number | null;
  targetLocation?: string | null;
  note?: string | null;
  idempotencyKey: string;
  clientScannedAt?: string | null;
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_stage_receiving_scan_v2', {
    p_batch_id: input.batchId ?? null,
    p_barcode: input.barcode,
    p_qty_packages: input.qtyPackages ?? 1,
    p_target_location: input.targetLocation ?? null,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_client_scanned_at: input.clientScannedAt ?? new Date().toISOString(),
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ line_id: string; batch_id: string; sku: string; product_name: string | null; units_received: number | string; suggested_location: string }>;
}

export async function setReceivingLineTick(input: { lineId: string; ticked: boolean }, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_confirm_warehouse_receiving_line', {
    p_line_id: input.lineId,
    p_confirmed: input.ticked,
    p_note: null,
  });
  if (error) throw new Error(message(error));
  return data ?? [];
}

export async function finishStagedReceivingBatch(input: { batchId: string; note?: string | null }, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_complete_warehouse_receiving_batch', {
    p_batch_id: input.batchId,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ batch_id: string; batch_no: string; posted_lines: number | string; posted_units: number | string; batch_status: string }>;
}

export async function cancelStagedReceivingBatch(input: { batchId: string; reason: string }, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_cancel_warehouse_receiving_batch', {
    p_batch_id: input.batchId,
    p_reason: input.reason,
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ batch_id: string; batch_no: string; batch_status: string; cancelled_at: string }>;
}
