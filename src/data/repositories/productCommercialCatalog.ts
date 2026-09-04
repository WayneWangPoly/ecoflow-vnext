import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogRow } from '@/domain/types';
import { supabase } from '@/lib/supabaseClient';

const COMMERCIAL_CATALOG_BATCH_SIZE = 500;

type SyncedSkuCatalogRow = {
  sku: string | null;
  product_name: string | null;
  base_price: number | string | null;
  source_type: string | null;
  last_synced_at: string | null;
};

export type CommercialCatalogSnapshot = {
  catalog: CatalogRow[];
  sourceObservedAt: string | null;
};

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function numeric(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestIso(rows: readonly SyncedSkuCatalogRow[]) {
  return rows
    .map((row) => row.last_synced_at)
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || 'Commercial catalog read failed.';
  }
  return String(error || 'Commercial catalog read failed.');
}

export async function readOrdermentumCommercialCatalog(
  client: SupabaseClient | null = supabase,
): Promise<CommercialCatalogSnapshot> {
  if (!client) throw new Error('Supabase is not configured for the governed commercial catalog read.');

  const sourceRows: SyncedSkuCatalogRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client
      .from('v_ecoflow_synced_sku_catalog')
      .select('sku,product_name,base_price,source_type,last_synced_at')
      .order('sku', { ascending: true })
      .range(offset, offset + COMMERCIAL_CATALOG_BATCH_SIZE - 1);
    if (error) throw new Error(message(error));
    const batch = (data ?? []) as SyncedSkuCatalogRow[];
    sourceRows.push(...batch);
    if (batch.length < COMMERCIAL_CATALOG_BATCH_SIZE) break;
    offset += COMMERCIAL_CATALOG_BATCH_SIZE;
  }

  const bySku = new Map<string, CatalogRow>();
  for (const row of sourceRows) {
    const sku = clean(row.sku);
    if (!sku) continue;
    const key = sku.toUpperCase();
    const basePrice = numeric(row.base_price);
    bySku.set(key, {
      id: `ordermentum-commercial:${sku}`,
      source: clean(row.source_type).toLowerCase() === 'product' ? 'product' : 'variant',
      sku,
      name: clean(row.product_name) || sku,
      basePrice,
      displayPrice: Number.isFinite(basePrice) ? `$${basePrice.toFixed(2)}` : 'Unavailable',
      unit: '',
      category: '',
      // Visibility/sellability is not asserted by this projection. Product Master
      // keeps the Sellable field unavailable rather than interpreting this flag.
      visible: true,
      tierPrices: {},
    });
  }

  return {
    catalog: [...bySku.values()].sort((left, right) => left.sku.localeCompare(right.sku, 'en-AU', { numeric: true })),
    sourceObservedAt: latestIso(sourceRows),
  };
}
