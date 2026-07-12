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

type GenericRow = Record<string, unknown>;

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

function text(row: GenericRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function firstRows(client: SupabaseClient, views: string[], limit: number) {
  for (const view of views) {
    const { data, error } = await client.from(view).select('*').limit(limit);
    if (!error && data?.length) return data as GenericRow[];
  }
  return [];
}

async function fallbackPriceMatrix(client: SupabaseClient) {
  const [rawGroups, rawSkus] = await Promise.all([
    firstRows(client, ['v_ecoflow_synced_price_groups', 'v_ecoflow_ordermentum_price_groups_v1'], 100),
    firstRows(client, ['v_ecoflow_synced_sku_catalog', 'v_ecoflow_ordermentum_sku_master_v1'], 4000),
  ]);

  const groups = rawGroups.map((row) => {
    const id = text(row, ['price_group_id', 'external_price_group_id', 'id']);
    return { id, name: text(row, ['price_group_name', 'name']) || id };
  }).filter((row) => row.id);

  const skus = rawSkus.map((row) => {
    const sku = text(row, ['sku', 'external_sku_code', 'SKU']);
    return {
      sku,
      productName: text(row, ['product_name', 'external_product_name', 'name']) || null,
      basePrice: numeric(row.base_price ?? row.basePrice),
      lastSyncedAt: text(row, ['last_synced_at', 'lastSyncedAt']) || null,
    };
  }).filter((row) => row.sku);

  if (!groups.length || !skus.length) return [] as PriceMatrixRow[];

  const { data: versionData } = await client
    .from('ecoflow_price_matrix_versions')
    .select('*')
    .eq('is_current', true)
    .limit(5000);
  const versions = (versionData ?? []) as GenericRow[];
  const byCell = new Map(versions.map((row) => [`${text(row, ['sku'])}::${text(row, ['price_group_id'])}`, row]));

  return skus.flatMap((sku) => groups.map((group): PriceMatrixRow => {
    const version = byCell.get(`${sku.sku}::${group.id}`);
    const override = numeric(version?.unit_price);
    return {
      sku: sku.sku,
      product_name: sku.productName,
      price_group_id: group.id,
      price_group_name: group.name,
      effective_price: override ?? sku.basePrice ?? 0,
      source_base_price: sku.basePrice,
      has_override: Boolean(version),
      matrix_version_id: version ? text(version, ['id']) || null : null,
      version_no: version?.version_no as number | string | null ?? null,
      effective_from: version ? text(version, ['effective_from']) || null : null,
      change_reason: version ? text(version, ['change_reason']) || null : null,
      created_by: version ? text(version, ['created_by']) || null : null,
      created_at: version ? text(version, ['created_at']) || null : null,
      sku_last_synced_at: sku.lastSyncedAt,
    };
  }));
}

export async function loadPriceMatrix(client?: SupabaseClient | null) {
  const current = active(client);
  const { data, error } = await current
    .from('v_ecoflow_price_matrix_workbench')
    .select('*')
    .order('sku', { ascending: true })
    .limit(4000);
  if (!error && data?.length) return data as PriceMatrixRow[];

  const fallback = await fallbackPriceMatrix(current);
  if (fallback.length) return fallback;
  if (error) {
    const raw = message(error).toLowerCase();
    if (!raw.includes('25p02') && !raw.includes('transaction is aborted')) throw new Error(message(error));
  }
  return [];
}

export async function loadPriceMatrixHistory(limit = 160, client?: SupabaseClient | null) {
  const { data, error } = await active(client)
    .from('v_ecoflow_price_matrix_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    const raw = message(error).toLowerCase();
    if (raw.includes('25p02') || raw.includes('transaction is aborted') || raw.includes('does not exist')) return [];
    throw new Error(message(error));
  }
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
