import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type PackagingSignalKind =
  | 'MIXED_CARTON_SLEEVE'
  | 'CARTON_ONLY_EVIDENCE'
  | 'SLEEVE_ONLY_EVIDENCE'
  | 'UNKNOWN';

export type PackagingSignalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type StocktakePackagingSignalRow = {
  external_sku_code: string;
  external_product_name: string | null;
  total_order_lines: number | string;
  carton_order_lines: number | string;
  loose_order_lines: number | string;
  ambiguous_order_lines: number | string;
  unknown_order_lines: number | string;
  observed_units: string | null;
  packaging_signal: PackagingSignalKind | string;
  confidence: PackagingSignalConfidence | string;
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
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ');
  }
  return String(error);
}

export async function loadStocktakePackagingSignals(client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client)
    .from('v_ecoflow_ordermentum_packaging_signals')
    .select('external_sku_code,external_product_name,total_order_lines,carton_order_lines,loose_order_lines,ambiguous_order_lines,unknown_order_lines,observed_units,packaging_signal,confidence')
    .order('total_order_lines', { ascending: false })
    .limit(4000);

  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as StocktakePackagingSignalRow[];
}
