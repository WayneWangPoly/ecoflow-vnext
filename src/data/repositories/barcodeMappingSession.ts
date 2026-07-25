import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { BarcodePackageLevel } from './inventoryControl';

export type BarcodeRegistryMappingRow = {
  id: string;
  sku: string;
  barcode: string;
  package_level: BarcodePackageLevel | string;
  units_per_barcode: number | string;
  product_name: string | null;
  fixed_shelf: string | null;
  source_session_id: string | null;
  scan_count: number | string;
  verified: boolean | null;
  note: string | null;
  first_scanned_at: string | null;
  last_scanned_at: string | null;
};

export type BarcodeSessionRow = {
  id: string;
  session_name: string;
  target_area: string | null;
  session_status: string;
  created_at: string;
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

const mappingColumns = 'id,sku,barcode,package_level,units_per_barcode,product_name,fixed_shelf,source_session_id,scan_count,verified,note,first_scanned_at,last_scanned_at';

export async function loadBarcodeMappingsForSession(sessionId: string, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('ecoflow_sku_barcode_registry')
    .select(mappingColumns)
    .eq('source_session_id', sessionId)
    .order('last_scanned_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as BarcodeRegistryMappingRow[];
}

export async function lookupBarcodeMapping(barcode: string, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('ecoflow_sku_barcode_registry')
    .select(mappingColumns)
    .eq('barcode', barcode.trim())
    .maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as BarcodeRegistryMappingRow | null;
}

export async function loadLatestOpenProductMappingSession(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data: userData } = await active.auth.getUser();
  let query = active
    .from('ecoflow_barcode_scan_sessions')
    .select('id,session_name,target_area,session_status,created_at')
    .eq('session_status', 'OPEN')
    .ilike('session_name', 'Product mapping%')
    .order('created_at', { ascending: false })
    .limit(1);
  if (userData.user?.id) query = query.eq('created_by', userData.user.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as BarcodeSessionRow | null;
}
