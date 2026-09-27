import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_010_REFERENCE_BATCH_ID = '9a1b323c-46fb-4478-87d0-94573819fe1c';
export const R5_010_MIGRATION_LOCATION = 'MIGRATION-UNASSIGNED';

export const R5_010_CANARIES = [
  {
    label: 'R-360Y',
    referenceRowId: '8e483068-c086-4e19-bbb3-2c5baf7d0d82',
  },
  {
    label: 'SB24/32/40LBOX',
    referenceRowId: 'c2536c8c-d559-41ae-99a0-c487cead9675',
  },
] as const;

export type R5010PreviewRow = {
  referenceRowId: string;
  referenceBatchId: string;
  sourceProductCode: string;
  sourceWarehouseCode: string;
  sourceQtyOnHand: number;
  sourceRowSha256: string;
  sourceSetSha256: string;
  sourceRunId: string;
  commercialSkuId: string | null;
  commercialSkuCode: string | null;
  physicalSkuId: string | null;
  physicalSkuCode: string | null;
  physicalSkuName: string | null;
  packageId: string | null;
  packageLevel: string;
  unitsPerPackage: number | null;
  barcode: string | null;
  locationCode: string;
  locationSemantics: 'PHYSICAL' | 'MIGRATION_HOLDING';
  currentWarehouseCartonQty: number;
  liveWarehouseBalanceRowCount: number;
  alreadyInitialized: boolean;
  executable: boolean;
  blockReason: string | null;
};

export type R5010Preview = {
  referenceBatchId: string;
  referenceBatchStatus: string;
  referenceBatchRevision: number;
  sourceRunId: string;
  sourceSetSha256: string;
  declaredSourceRowCount: number;
  readyRowCount: number;
  readyPositiveRowCount: number;
  readyZeroRowCount: number;
  pendingProductMappingCount: number;
  ambiguousProductMappingCount: number;
  pendingWarehouseMappingCount: number;
  ambiguousWarehouseMappingCount: number;
  pendingPhysicalIdentityCount: number;
  alreadyInitializedCount: number;
  requestedRowCount: number | null;
  selectedRowCount: number;
  executableRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  positiveQtyOnHandTotal: number;
  locationCode: string;
  locationSemantics: 'PHYSICAL' | 'MIGRATION_HOLDING';
  manifestSha256: string;
  rows: R5010PreviewRow[];
  canApply: boolean;
  authorityEffect: 'NONE';
};

export type R5010ApplyResult = {
  commandId: string;
  referenceBatchId: string;
  manifestSha256: string;
  stocktakeSessionId: string;
  stocktakeSessionStatus: string;
  stocktakeSessionRevision: number;
  selectedRowCount: number;
  positiveRowCount: number;
  zeroRowCount: number;
  positiveQtyOnHandTotal: number;
  openingMovementCount: number;
  locationCode: string;
  locationSemantics: 'PHYSICAL' | 'MIGRATION_HOLDING';
  evidenceType: 'UNLEASHED_MIGRATION_REFERENCE';
  authorityEffect: 'OPENING_INVENTORY_CREATED';
  approvedAt: string;
};

type PreviewInput = {
  referenceRowIds?: string[] | null;
  locationCode?: string;
};

type ApplyInput = PreviewInput & {
  manifestSha256: string;
  commandId: string;
  reason: string;
  acknowledged: boolean;
};

function objectResult<T>(value: unknown, label: string): T {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`${label} returned an invalid payload.`);
  }
  return candidate as T;
}

export async function previewR5010BulkOpening(
  supabase: SupabaseClient,
  input: PreviewInput = {},
): Promise<R5010Preview> {
  const { data, error } = await supabase.rpc('ecoflow_preview_r5_010_bulk_opening', {
    p_expected_reference_batch_id: R5_010_REFERENCE_BATCH_ID,
    p_reference_row_ids: input.referenceRowIds ?? null,
    p_location_code: input.locationCode ?? R5_010_MIGRATION_LOCATION,
  });
  if (error) throw error;
  const result = objectResult<R5010Preview>(data, 'R5-010 PREVIEW');
  if (result.referenceBatchId !== R5_010_REFERENCE_BATCH_ID) {
    throw new Error('R5-010 PREVIEW returned an unexpected reference batch.');
  }
  return result;
}

export async function applyR5010BulkOpening(
  supabase: SupabaseClient,
  input: ApplyInput,
): Promise<R5010ApplyResult> {
  if (!input.acknowledged) throw new Error('Explicit R5-010 acknowledgement is required.');
  if (!input.reason.trim()) throw new Error('R5-010 apply reason is required.');
  if (!/^[0-9a-f]{64}$/.test(input.manifestSha256)) {
    throw new Error('R5-010 manifest SHA-256 is invalid.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) {
    throw new Error('R5-010 command UUID is invalid.');
  }

  const { data, error } = await supabase.rpc('ecoflow_apply_r5_010_bulk_opening', {
    p_reference_batch_id: R5_010_REFERENCE_BATCH_ID,
    p_manifest_sha256: input.manifestSha256,
    p_command_id: input.commandId,
    p_reason: input.reason.trim(),
    p_acknowledged: true,
    p_reference_row_ids: input.referenceRowIds ?? null,
    p_location_code: input.locationCode ?? R5_010_MIGRATION_LOCATION,
  });
  if (error) throw error;
  const result = objectResult<R5010ApplyResult>(data, 'R5-010 APPLY');
  if (
    result.referenceBatchId !== R5_010_REFERENCE_BATCH_ID ||
    result.manifestSha256 !== input.manifestSha256 ||
    result.evidenceType !== 'UNLEASHED_MIGRATION_REFERENCE'
  ) {
    throw new Error('R5-010 APPLY returned evidence outside the authorised manifest.');
  }
  return result;
}