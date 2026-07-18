import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type StocktakeSkuOption = {
  sku: string;
  productName: string | null;
  orderCount: number;
  source: 'ORDERMENTUM' | 'SKU_MASTER';
};

type SkuMasterAssistRow = {
  external_sku_code: string | null;
  status: string | null;
};

type SkuCandidateAssistRow = {
  external_sku_code: string | null;
  external_product_name: string | null;
  order_count: number | string | null;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function countValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadStocktakeSkuOptions(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const [masterResult, candidateResult] = await Promise.all([
    active
      .from('v_ecoflow_app_sku_master')
      .select('external_sku_code,status')
      .limit(3000),
    active
      .from('v_ecoflow_ordermentum_sku_mapping_candidates')
      .select('external_sku_code,external_product_name,order_count')
      .order('order_count', { ascending: false })
      .limit(3000),
  ]);

  if (masterResult.error && candidateResult.error) {
    throw new Error(`Ordermentum SKU assistance is unavailable: ${candidateResult.error.message || masterResult.error.message}`);
  }

  const options = new Map<string, StocktakeSkuOption>();
  ((candidateResult.data ?? []) as SkuCandidateAssistRow[]).forEach((row) => {
    const sku = row.external_sku_code?.trim().toUpperCase();
    if (!sku) return;
    options.set(sku, {
      sku,
      productName: row.external_product_name?.trim() || null,
      orderCount: countValue(row.order_count),
      source: 'ORDERMENTUM',
    });
  });

  ((masterResult.data ?? []) as SkuMasterAssistRow[]).forEach((row) => {
    const sku = row.external_sku_code?.trim().toUpperCase();
    if (!sku || String(row.status || '').toUpperCase() === 'INACTIVE') return;
    if (!options.has(sku)) {
      options.set(sku, {
        sku,
        productName: null,
        orderCount: 0,
        source: 'SKU_MASTER',
      });
    }
  });

  return Array.from(options.values()).sort((left, right) =>
    right.orderCount - left.orderCount || left.sku.localeCompare(right.sku, undefined, { numeric: true }),
  );
}
