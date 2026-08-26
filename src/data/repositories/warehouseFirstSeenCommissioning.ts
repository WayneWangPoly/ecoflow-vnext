import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { resolveOperationalBarcode, type OperationalBarcodeResolution } from './productIdentityBarcodeResolution';

export type FirstSeenCommercialSku = {
  skuCode: string;
  name: string;
  category: string | null;
  ordermentumSku: string | null;
  fixedShelf: string | null;
  familyCode: string | null;
  familyName: string | null;
  preferredPhysicalSkuCode: string | null;
  substitutionPolicy: string | null;
};

export type FirstSeenFamily = { familyCode: string; familyName: string };
export type FirstSeenPhysicalSku = {
  physicalSkuCode: string;
  name: string;
  brand: string | null;
  supplierName: string | null;
  familyCode: string;
  familyName: string;
};
export type FirstSeenLocation = {
  locationCode: string;
  rackTitle: string;
  displayLevel: string;
  zone: string;
};

export type FirstSeenReference = {
  commercialSkus: FirstSeenCommercialSku[];
  families: FirstSeenFamily[];
  physicalSkus: FirstSeenPhysicalSku[];
  locations: FirstSeenLocation[];
};

export type CommissionFirstSeenInput = {
  commandId: string;
  barcode: string;
  commercialSkuCode: string;
  physicalSkuCode: string;
  physicalName: string;
  brand?: string | null;
  supplierName?: string | null;
  familyCode: string;
  familyName: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: number;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  defaultLocationCode?: string | null;
  note?: string | null;
};

export type FirstSeenCommissionResult = {
  commissionId: string;
  commandStatus: string;
  resolutionStatus: string;
  barcode: string;
  commercialSkuCode: string;
  commercialName: string;
  familyCode: string;
  familyName: string;
  physicalSkuCode: string;
  physicalName: string;
  packageLevel: string;
  unitsInBaseUnit: number;
  substitutionPolicy: string;
  defaultLocationCode: string | null;
  commissionedAt: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function activeClient(client?: SupabaseClient | null) {
  const value = client ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

/**
 * Older/insecure browser contexts may not expose crypto.randomUUID(). The
 * Warehouse panel still supplies a stable command token, so deterministically
 * fold any non-UUID token into an RFC 4122 v4-shaped UUID before calling the
 * Postgres RPC. This preserves replay/idempotency for the same caller token.
 */
export function normalizeFirstSeenCommandId(value: string) {
  const source = value.trim();
  if (uuidPattern.test(source)) return source;

  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    words[0] = Math.imul(words[0] ^ code, 0x01000193);
    words[1] = Math.imul(words[1] ^ (code + index), 0x27d4eb2d);
    words[2] = Math.imul(words[2] ^ (code << (index % 8)), 0x165667b1);
    words[3] = Math.imul(words[3] ^ (code + words[0]), 0x85ebca6b);
  }

  const bytes = new Uint8Array(16);
  words.forEach((word, wordIndex) => {
    const unsigned = word >>> 0;
    bytes[wordIndex * 4] = (unsigned >>> 24) & 0xff;
    bytes[wordIndex * 4 + 1] = (unsigned >>> 16) & 0xff;
    bytes[wordIndex * 4 + 2] = (unsigned >>> 8) & 0xff;
    bytes[wordIndex * 4 + 3] = unsigned & 0xff;
  });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export async function readFirstSeenReference(client?: SupabaseClient | null): Promise<FirstSeenReference> {
  const result = await activeClient(client).rpc('ecoflow_read_first_seen_reference_v1');
  if (result.error) throw new Error(result.error.message || 'Warehouse commissioning reference is unavailable.');
  const data = (result.data && typeof result.data === 'object' ? result.data : {}) as Record<string, unknown>;
  return {
    commercialSkus: list(data.commercialSkus).map((row) => ({
      skuCode: asString(row.skuCode),
      name: asString(row.name),
      category: nullableString(row.category),
      ordermentumSku: nullableString(row.ordermentumSku),
      fixedShelf: nullableString(row.fixedShelf),
      familyCode: nullableString(row.familyCode),
      familyName: nullableString(row.familyName),
      preferredPhysicalSkuCode: nullableString(row.preferredPhysicalSkuCode),
      substitutionPolicy: nullableString(row.substitutionPolicy),
    })),
    families: list(data.families).map((row) => ({ familyCode: asString(row.familyCode), familyName: asString(row.familyName) })),
    physicalSkus: list(data.physicalSkus).map((row) => ({
      physicalSkuCode: asString(row.physicalSkuCode),
      name: asString(row.name),
      brand: nullableString(row.brand),
      supplierName: nullableString(row.supplierName),
      familyCode: asString(row.familyCode),
      familyName: asString(row.familyName),
    })),
    locations: list(data.locations).map((row) => ({
      locationCode: asString(row.locationCode),
      rackTitle: asString(row.rackTitle),
      displayLevel: asString(row.displayLevel),
      zone: asString(row.zone),
    })),
  };
}

export async function resolveFirstSeenBarcode(
  barcode: string,
  expectedSku?: string | null,
  client?: SupabaseClient | null,
): Promise<OperationalBarcodeResolution> {
  return resolveOperationalBarcode(barcode, expectedSku, client);
}

export async function commissionFirstSeenBarcode(
  input: CommissionFirstSeenInput,
  client?: SupabaseClient | null,
): Promise<FirstSeenCommissionResult> {
  const result = await activeClient(client).rpc('ecoflow_commission_first_seen_barcode_v1', {
    p_command_id: normalizeFirstSeenCommandId(input.commandId),
    p_barcode: input.barcode.trim(),
    p_commercial_sku_code: input.commercialSkuCode.trim(),
    p_physical_sku_code: input.physicalSkuCode.trim(),
    p_physical_name: input.physicalName.trim(),
    p_brand: input.brand?.trim() || null,
    p_supplier_name: input.supplierName?.trim() || null,
    p_family_code: input.familyCode.trim(),
    p_family_name: input.familyName.trim(),
    p_package_level: input.packageLevel,
    p_units_in_base_unit: input.unitsInBaseUnit,
    p_substitution_policy: input.substitutionPolicy,
    p_is_preferred: input.isPreferred,
    p_default_location_code: input.defaultLocationCode?.trim() || null,
    p_source_context: 'WAREHOUSE_CONTROL_FIRST_SEEN',
    p_note: input.note?.trim() || null,
  });
  if (result.error) throw new Error(result.error.message || 'First-seen commissioning failed.');
  const row = (Array.isArray(result.data) ? result.data[0] : null) as Record<string, unknown> | undefined;
  if (!row) throw new Error('First-seen commissioning returned no result.');
  return {
    commissionId: asString(row.commission_id),
    commandStatus: asString(row.command_status),
    resolutionStatus: asString(row.resolution_status),
    barcode: asString(row.barcode),
    commercialSkuCode: asString(row.commercial_sku_code),
    commercialName: asString(row.commercial_name),
    familyCode: asString(row.family_code),
    familyName: asString(row.family_name),
    physicalSkuCode: asString(row.physical_sku_code),
    physicalName: asString(row.physical_name),
    packageLevel: asString(row.package_level),
    unitsInBaseUnit: Number(row.units_in_base_unit),
    substitutionPolicy: asString(row.substitution_policy),
    defaultLocationCode: nullableString(row.default_location_code),
    commissionedAt: asString(row.commissioned_at),
  };
}
