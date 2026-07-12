import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type WarehouseLayoutBox = { left: string; top: string; width: string; height: string };
export type WarehouseLayoutState = Record<string, WarehouseLayoutBox>;
export type WarehouseLayoutRow = {
  site_code: string;
  layout_json: WarehouseLayoutState;
  layout_version: number;
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

export async function loadWarehouseLayout(siteCode = 'SITE-01', client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client)
    .from('ecoflow_warehouse_layouts')
    .select('site_code,layout_json,layout_version,updated_at')
    .eq('site_code', siteCode.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(message(error));
  return (data ?? null) as WarehouseLayoutRow | null;
}

export async function saveWarehouseLayout(input: {
  siteCode?: string;
  layout: WarehouseLayoutState;
  expectedVersion?: number | null;
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_save_warehouse_layout', {
    p_site_code: (input.siteCode || 'SITE-01').toUpperCase(),
    p_layout_json: input.layout,
    p_expected_version: input.expectedVersion ?? null,
  });
  if (error) throw new Error(message(error));
  return ((data ?? [])[0] ?? null) as WarehouseLayoutRow | null;
}
