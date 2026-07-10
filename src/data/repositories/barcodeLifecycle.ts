import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BarcodeHistoryRow = {
  id: string;
  sku: string;
  product_name: string | null;
  barcode: string;
  package_level: string;
  units_per_barcode: number | string;
  fixed_shelf: string | null;
  is_active: boolean;
  valid_from: string;
  retired_at: string | null;
  retirement_reason: string | null;
  packaging_version: string | null;
  updated_at: string;
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

export async function loadBarcodeHistory(input?: { sku?: string; barcode?: string }, client?: SupabaseClient | null) {
  let query = activeClient(client)
    .from('v_ecoflow_barcode_registry_history')
    .select('*')
    .order('valid_from', { ascending: false })
    .limit(80);
  if (input?.sku) query = query.eq('sku', input.sku.toUpperCase());
  if (input?.barcode) query = query.eq('barcode', input.barcode.trim());
  const { data, error } = await query;
  if (error) throw new Error(message(error));
  return (data ?? []) as BarcodeHistoryRow[];
}

export async function retireBarcodeMapping(input: {
  barcode: string;
  reason: string;
  replacementBarcode?: string | null;
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_retire_barcode_mapping', {
    p_barcode: input.barcode,
    p_reason: input.reason,
    p_replacement_barcode: input.replacementBarcode || null,
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ barcode: string; sku: string; package_level: string; retired_at: string; replacement_barcode: string | null }>;
}
