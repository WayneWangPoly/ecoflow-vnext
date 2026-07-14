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

function readOnlyRow(row: GenericRow): PriceMatrixRow | null {
  const sku = text(row, ['sku', 'external_sku_code', 'SKU']);
  const groupId = text(row, ['price_group_id', 'external_price_group_id', 'id']);
  if (!sku || !groupId) return null;
  const sourcePrice = numeric(row.source_base_price ?? row.base_price ?? row.effective_price ?? row.unit_price) ?? 0;
  return {
    sku,
    product_name: text(row, ['product_name', 'external_product_name', 'name']) || null,
    price_group_id: groupId,
    price_group_name: text(row, ['price_group_name', 'name']) || groupId,
    effective_price: sourcePrice,
    source_base_price: sourcePrice,
    has_override: false,
    matrix_version_id: null,
    version_no: null,
    effective_from: null,
    change_reason: null,
    created_by: null,
    created_at: null,
    sku_last_synced_at: text(row, ['sku_last_synced_at', 'last_synced_at', 'lastSyncedAt']) || null,
  };
}

async function fallbackPriceMatrix(client: SupabaseClient) {
  const [rawGroups, rawSkus] = await Promise.all([
    firstRows(client, ['v_ecoflow_synced_price_groups', 'v_ecoflow_ordermentum_price_groups_v1'], 100),
    firstRows(client, ['v_ecoflow_synced_sku_catalog', 'v_ecoflow_ordermentum_sku_master_v1'], 4000),
  ]);

  const groups = rawGroups.map((row) => ({
    id: text(row, ['price_group_id', 'external_price_group_id', 'id']),
    name: text(row, ['price_group_name', 'name']),
  })).filter((row) => row.id);

  const skus = rawSkus.map((row) => ({
    sku: text(row, ['sku', 'external_sku_code', 'SKU']),
    productName: text(row, ['product_name', 'external_product_name', 'name']) || null,
    basePrice: numeric(row.base_price ?? row.basePrice) ?? 0,
    lastSyncedAt: text(row, ['last_synced_at', 'lastSyncedAt']) || null,
  })).filter((row) => row.sku);

  return skus.flatMap((sku) => groups.map((group): PriceMatrixRow => ({
    sku: sku.sku,
    product_name: sku.productName,
    price_group_id: group.id,
    price_group_name: group.name || group.id,
    effective_price: sku.basePrice,
    source_base_price: sku.basePrice,
    has_override: false,
    matrix_version_id: null,
    version_no: null,
    effective_from: null,
    change_reason: null,
    created_by: null,
    created_at: null,
    sku_last_synced_at: sku.lastSyncedAt,
  })));
}

export async function loadPriceMatrix(client?: SupabaseClient | null) {
  const current = active(client);
  for (const view of ['v_ecoflow_ordermentum_price_matrix_readonly_v1', 'v_ecoflow_price_matrix_workbench']) {
    const { data, error } = await current.from(view).select('*').order('sku', { ascending: true }).limit(5000);
    if (!error && data?.length) return (data as GenericRow[]).map(readOnlyRow).filter((row): row is PriceMatrixRow => Boolean(row));
    if (error && !message(error).toLowerCase().match(/does not exist|schema cache|pgrst205|42p01/)) throw new Error(message(error));
  }
  return fallbackPriceMatrix(current);
}

export async function loadPriceMatrixHistory() {
  return [] as PriceMatrixHistoryRow[];
}

export async function loadPriceMatrixRole(client?: SupabaseClient | null) {
  const { data, error } = await active(client).from('v_ecoflow_current_user').select('app_role,is_active,team_status').maybeSingle();
  if (error) throw new Error(message(error));
  return data as { app_role: PriceMatrixRole; is_active: boolean; team_status: string } | null;
}

export async function setPriceMatrixPrice() {
  throw new Error('ORDERMENTUM_SOURCE_OWNED · Selling prices must be changed in Ordermentum and re-synced.');
}

export async function bulkAdjustPriceMatrix() {
  throw new Error('ORDERMENTUM_SOURCE_OWNED · Bulk selling-price changes must be made in Ordermentum and re-synced.');
}
