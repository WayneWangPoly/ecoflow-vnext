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

export type OperationalBarcodeResolutionStatus =
  | 'RESOLVED'
  | 'RETIRED'
  | 'UNKNOWN'
  | 'COMMERCIAL_UNMAPPED'
  | 'COMMERCIAL_AMBIGUOUS'
  | 'COMMERCIAL_MISMATCH';

export type OperationalBarcodeResolution = {
  resolutionStatus: OperationalBarcodeResolutionStatus;
  bindingId: string | null;
  barcode: string;
  physicalSkuId: string | null;
  physicalSkuCode: string | null;
  physicalName: string | null;
  familyId: string | null;
  familyCode: string | null;
  packageLevel: string | null;
  unitsInBaseUnit: number | null;
  commercialSkuId: string | null;
  commercialSkuCode: string | null;
  commercialName: string | null;
  substitutionPolicy: string | null;
};

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const units = finiteNumber(row.units_in_base_unit);
  const revision = finiteNumber(row.binding_revision);
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
    unitsInBaseUnit: units,
    bindingRevision: Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : null,
  };
}

export async function resolveOperationalBarcode(
  barcode: string,
  expectedSku?: string | null,
  client?: SupabaseClient | null,
): Promise<OperationalBarcodeResolution> {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  const result = await active.rpc('ecoflow_resolve_operational_barcode', {
    p_barcode: barcode,
    p_expected_sku: expectedSku?.trim() || null,
  });
  if (result.error) throw new Error(result.error.message || 'Warehouse barcode authority is unavailable.');
  const row = (Array.isArray(result.data) ? result.data[0] : null) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Warehouse barcode authority returned no result.');
  const status = String(row.resolution_status || 'UNKNOWN');
  const validStatuses: OperationalBarcodeResolutionStatus[] = [
    'RESOLVED',
    'RETIRED',
    'UNKNOWN',
    'COMMERCIAL_UNMAPPED',
    'COMMERCIAL_AMBIGUOUS',
    'COMMERCIAL_MISMATCH',
  ];
  if (!validStatuses.includes(status as OperationalBarcodeResolutionStatus)) {
    throw new Error(`Warehouse barcode authority returned an invalid status: ${status}.`);
  }
  return {
    resolutionStatus: status as OperationalBarcodeResolutionStatus,
    bindingId: text(row.binding_id),
    barcode: String(row.barcode || barcode),
    physicalSkuId: text(row.physical_sku_id),
    physicalSkuCode: text(row.physical_sku_code),
    physicalName: text(row.physical_name),
    familyId: text(row.family_id),
    familyCode: text(row.family_code),
    packageLevel: text(row.package_level),
    unitsInBaseUnit: finiteNumber(row.units_in_base_unit),
    commercialSkuId: text(row.commercial_sku_id),
    commercialSkuCode: text(row.commercial_sku_code),
    commercialName: text(row.commercial_name),
    substitutionPolicy: text(row.substitution_policy),
  };
}

export function operationalBarcodeFailureMessage(result: OperationalBarcodeResolution) {
  if (result.resolutionStatus === 'UNKNOWN') return 'Unknown barcode. Open Warehouse Control → Live Barcode, set it up once, then retry this operation.';
  if (result.resolutionStatus === 'RETIRED') return 'This barcode is retired. Scan the current published packaging code.';
  if (result.resolutionStatus === 'COMMERCIAL_MISMATCH') return 'This physical product is not approved for the selected Commercial SKU.';
  if (result.resolutionStatus === 'COMMERCIAL_AMBIGUOUS') return 'This physical product has an ambiguous Commercial SKU contract. Resolve Product Identity before continuing.';
  if (result.resolutionStatus === 'COMMERCIAL_UNMAPPED') return 'This physical product has no published Commercial SKU contract.';
  return 'Barcode could not be resolved for this warehouse operation.';
}
