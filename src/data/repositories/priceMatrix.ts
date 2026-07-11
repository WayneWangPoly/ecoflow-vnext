import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type PriceMatrixRow = {
  sku: string;
  product_name: string | null;
  price_group_id: string;
  price_group_name: string;
  effective_price: number | string;
  source_base_price: number | string | null;
  has_override: boolean;
  matrix_version_id: string | null;
  version_no: number | string | null;
  effective_from: string | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: string | null;
  sku_last_synced_at: string | null;
};

export type PriceMatrixHistoryRow = {
  id: string;
  sku: string;
  product_name: string | null;
  price_group_id: string;
  price_group_name: string | null;
  unit_price: number | string;
  effective_from: string;
  effective_to: string | null;
  version_no: number | string;
  is_current: boolean;
  change_reason: string;
  source: string;
  created_by: string | null;
  created_at: string;
  superseded_at: string | null;
};

export type PriceMatrixRole = 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'VIEWER' | string;

function active(client?: SupabaseClient | null) {
  const value = client ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(' · ') || JSON.stringify(value);
  }
  return String(error);
}

export async function loadPriceMatrix(client?: SupabaseClient | null) {
  const { data, error } = await active(client)
    .from('v_ecoflow_price_matrix_workbench')
    .select('*')
    .order('sku', { ascending: true })
    .limit(4000);
  if (error) throw new Error(message(error));
  return (data ?? []) as PriceMatrixRow[];
}

export async function loadPriceMatrixHistory(limit = 160, client?: SupabaseClient | null) {
  const { data, error } = await active(client)
    .from('v_ecoflow_price_matrix_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(message(error));
  return (data ?? []) as PriceMatrixHistoryRow[];
}

export async function loadPriceMatrixRole(client?: SupabaseClient | null) {
  const { data, error } = await active(client).from('v_ecoflow_current_user').select('app_role,is_active,team_status').maybeSingle();
  if (error) throw new Error(message(error));
  return data as { app_role: PriceMatrixRole; is_active: boolean; team_status: string } | null;
}

export async function setPriceMatrixPrice(input: {
  sku: string;
  priceGroupId: string;
  unitPrice: number;
  effectiveFrom: string;
  reason: string;
}, client?: SupabaseClient | null) {
  const { data, error } = await active(client).rpc('ecoflow_set_price_matrix_price', {
    p_sku: input.sku,
    p_price_group_id: input.priceGroupId,
    p_unit_price: input.unitPrice,
    p_effective_from: input.effectiveFrom,
    p_reason: input.reason,
  });
  if (error) throw new Error(message(error));
  return data ?? [];
}

export async function bulkAdjustPriceMatrix(input: {
  priceGroupId: string;
  percent: number;
  effectiveFrom: string;
  reason: string;
  skus?: string[];
}, client?: SupabaseClient | null) {
  const { data, error } = await active(client).rpc('ecoflow_bulk_adjust_price_matrix', {
    p_price_group_id: input.priceGroupId,
    p_percent: input.percent,
    p_effective_from: input.effectiveFrom,
    p_reason: input.reason,
    p_skus: input.skus?.length ? input.skus : null,
  });
  if (error) throw new Error(message(error));
  return data ?? [];
}
