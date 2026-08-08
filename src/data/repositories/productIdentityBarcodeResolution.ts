import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type PublishedPhysicalBarcodeResolution = {
  resolutionStatus: 'RESOLVED' | 'RETIRED' | 'UNKNOWN';
  bindingId: string | null;
  barcode: string;
  physicalSkuId: string | null;
  physicalSkuCode: string | null;
  physicalName: string | null;
  brand: string | null;
  familyId: string | null;
  familyCode: string | null;
  packageLevel: string | null;
  unitsInBaseUnit: number | null;
  bindingRevision: number | null;
};

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

export async function resolvePublishedPhysicalBarcode(
  barcode: string,
  client?: SupabaseClient | null,
): Promise<PublishedPhysicalBarcodeResolution> {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  const result = await active.rpc('ecoflow_resolve_published_physical_barcode', { p_barcode: barcode });
  if (result.error) throw new Error(result.error.message || 'Barcode authority is unavailable.');
  const row = (Array.isArray(result.data) ? result.data[0] : null) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Barcode authority returned no result.');
  const status = String(row.resolution_status || 'UNKNOWN');
  if (!['RESOLVED', 'RETIRED', 'UNKNOWN'].includes(status)) throw new Error('Barcode authority returned an invalid status.');
  const units = row.units_in_base_unit === null || row.units_in_base_unit === undefined ? null : Number(row.units_in_base_unit);
  const revision = row.binding_revision === null || row.binding_revision === undefined ? null : Number(row.binding_revision);
  return {
    resolutionStatus: status as PublishedPhysicalBarcodeResolution['resolutionStatus'],
    bindingId: text(row.binding_id),
    barcode: String(row.barcode || barcode),
    physicalSkuId: text(row.physical_sku_id),
    physicalSkuCode: text(row.physical_sku_code),
    physicalName: text(row.physical_name),
    brand: text(row.brand),
    familyId: text(row.family_id),
    familyCode: text(row.family_code),
    packageLevel: text(row.package_level),
    unitsInBaseUnit: Number.isFinite(units) ? units : null,
    bindingRevision: Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : null,
  };
}
