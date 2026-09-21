import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_007_PROVISIONAL_TARGETS = {
  'R-360Y': {
    commissioningId: '44f09191-85f6-4682-8934-98c459cc4d88',
    referenceRowId: '2a710fa3-0467-4c05-9317-033fb863815e',
    plannedLocationCode: 'A2-03-02A',
    sourceQtyOnHand: 3,
    physicalSkuId: '8905b519-6418-4bb1-a2a4-bdd8d48157f7',
    packageId: 'ff12d5f1-ba94-4960-bee6-c3c12aaf53ba',
    barcode: '19344062000652',
  },
  'SB24/32/40LBOX': {
    commissioningId: '2124ea46-765f-488a-8442-baf9dbd268d0',
    referenceRowId: '44aca94f-bb82-457d-9998-c397b687140a',
    plannedLocationCode: 'A2-03-03A',
    sourceQtyOnHand: 5,
    physicalSkuId: 'd8d9a558-37e6-4a22-99a2-7f0caf7492ac',
    packageId: '203dedb0-3ab7-425d-85e2-ac646b1fa601',
    barcode: '19348045022914',
  },
} as const;

export const R5_007_REFERENCE_BATCH_ID = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9' as const;
export const R5_007_SOURCE_RUN_ID = '5cd0e73b-956d-4c80-9e70-6d841d27b163' as const;
export const R5_007_SOURCE_SET_SHA256 = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d' as const;

export type R5007ProductCode = keyof typeof R5_007_PROVISIONAL_TARGETS;

export type R5007Gate = {
  actorRole: string;
  commissioningId: string;
  commissioningStatus: string;
  commissioningRevision: number;
  referenceBatchId: string;
  referenceRowId: string;
  sourceRunId: string;
  sourceSetSha256: string;
  sourceRowSha256: string;
  sourceProductCode: R5007ProductCode;
  sourceQtyOnHand: number;
  physicalSkuId: string;
  physicalSkuCode: string;
  physicalSkuName: string;
  packageId: string;
  packageLevel: string;
  unitsPerPackage: number;
  barcode: string;
  plannedLocationCode: string;
  plannedLocationId: string;
  provisionalEligible: boolean;
  provisionalOpeningId: string | null;
  provisionalStatus: 'PROVISIONAL_HOLD' | 'RECONCILED' | null;
  provisionalAppliedAt: string | null;
  provisionalQuantity: number | null;
  operationalInventoryAuthorityCreated: boolean;
  physicalCountClaimed: boolean;
  requiresLaterPhysicalStocktake: boolean;
  existingNonZeroLocationRows: number;
  existingInventoryMovements: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('R5_007_GATE_CONTRACT_VIOLATION');
  return value as Record<string, unknown>;
}

function asString(value: unknown, code: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function asNumber(value: unknown, code: string) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(code);
  return n;
}

function assertUuid(value: string, code: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(code);
  }
}

function normalizeGate(productCode: R5007ProductCode, raw: unknown): R5007Gate {
  const value = asRecord(raw);
  const frozen = R5_007_PROVISIONAL_TARGETS[productCode];
  const provisionalStatus = value.provisionalStatus == null ? null : String(value.provisionalStatus);
  if (provisionalStatus !== null && !['PROVISIONAL_HOLD', 'RECONCILED'].includes(provisionalStatus)) {
    throw new Error('R5_007_STATUS_CONTRACT_VIOLATION');
  }
  if (
    value.commissioningId !== frozen.commissioningId
    || value.referenceBatchId !== R5_007_REFERENCE_BATCH_ID
    || value.referenceRowId !== frozen.referenceRowId
    || value.sourceRunId !== R5_007_SOURCE_RUN_ID
    || value.sourceSetSha256 !== R5_007_SOURCE_SET_SHA256
    || value.sourceProductCode !== productCode
    || asNumber(value.sourceQtyOnHand, 'R5_007_QTY_REQUIRED') !== frozen.sourceQtyOnHand
    || value.physicalSkuId !== frozen.physicalSkuId
    || value.packageId !== frozen.packageId
    || value.barcode !== frozen.barcode
    || value.plannedLocationCode !== frozen.plannedLocationCode
    || value.packageLevel !== 'CARTON'
    || asNumber(value.unitsPerPackage, 'R5_007_UNITS_REQUIRED') !== 1
  ) {
    throw new Error('R5_007_FROZEN_BINDING_MISMATCH');
  }
  if (value.physicalCountClaimed === true || value.operationalInventoryAuthorityCreated === true) {
    throw new Error('R5_007_PROVISIONAL_MUST_NOT_CLAIM_PHYSICAL_AUTHORITY');
  }
  return {
    actorRole: String(value.actorRole ?? ''),
    commissioningId: frozen.commissioningId,
    commissioningStatus: String(value.commissioningStatus ?? ''),
    commissioningRevision: asNumber(value.commissioningRevision, 'R5_007_REVISION_REQUIRED'),
    referenceBatchId: R5_007_REFERENCE_BATCH_ID,
    referenceRowId: frozen.referenceRowId,
    sourceRunId: R5_007_SOURCE_RUN_ID,
    sourceSetSha256: R5_007_SOURCE_SET_SHA256,
    sourceRowSha256: asString(value.sourceRowSha256, 'R5_007_SOURCE_ROW_HASH_REQUIRED'),
    sourceProductCode: productCode,
    sourceQtyOnHand: frozen.sourceQtyOnHand,
    physicalSkuId: frozen.physicalSkuId,
    physicalSkuCode: asString(value.physicalSkuCode, 'R5_007_PHYSICAL_CODE_REQUIRED'),
    physicalSkuName: asString(value.physicalSkuName, 'R5_007_PHYSICAL_NAME_REQUIRED'),
    packageId: frozen.packageId,
    packageLevel: 'CARTON',
    unitsPerPackage: 1,
    barcode: frozen.barcode,
    plannedLocationCode: frozen.plannedLocationCode,
    plannedLocationId: asString(value.plannedLocationId, 'R5_007_LOCATION_ID_REQUIRED'),
    provisionalEligible: value.provisionalEligible === true,
    provisionalOpeningId: value.provisionalOpeningId == null ? null : String(value.provisionalOpeningId),
    provisionalStatus: provisionalStatus as R5007Gate['provisionalStatus'],
    provisionalAppliedAt: value.provisionalAppliedAt == null ? null : String(value.provisionalAppliedAt),
    provisionalQuantity: value.provisionalQuantity == null ? null : asNumber(value.provisionalQuantity, 'R5_007_PROVISIONAL_QTY_INVALID'),
    operationalInventoryAuthorityCreated: false,
    physicalCountClaimed: false,
    requiresLaterPhysicalStocktake: value.requiresLaterPhysicalStocktake === true,
    existingNonZeroLocationRows: asNumber(value.existingNonZeroLocationRows ?? 0, 'R5_007_LOCATION_COUNT_INVALID'),
    existingInventoryMovements: asNumber(value.existingInventoryMovements ?? 0, 'R5_007_MOVEMENT_COUNT_INVALID'),
  };
}

export async function readR5007Gate(supabase: SupabaseClient, productCode: R5007ProductCode): Promise<R5007Gate> {
  const frozen = R5_007_PROVISIONAL_TARGETS[productCode];
  const { data, error } = await supabase.rpc('ecoflow_read_provisional_reference_opening_gate', {
    p_commissioning_id: frozen.commissioningId,
  });
  if (error) throw error;
  return normalizeGate(productCode, data);
}

export async function applyR5007ProvisionalOpening(
  supabase: SupabaseClient,
  productCode: R5007ProductCode,
  input: { commandId: string; reason: string },
): Promise<R5007Gate> {
  assertUuid(input.commandId, 'R5_007_COMMAND_ID_REQUIRED');
  if (!input.reason.trim()) throw new Error('R5_007_REASON_REQUIRED');

  const before = await readR5007Gate(supabase, productCode);
  if (!before.provisionalEligible || before.provisionalOpeningId) throw new Error('R5_007_NOT_ELIGIBLE');
  if (before.commissioningStatus !== 'DRAFT' || before.commissioningRevision !== 0) throw new Error('R5_007_DRAFT_REV0_REQUIRED');
  if (before.existingNonZeroLocationRows !== 0 || before.existingInventoryMovements !== 0) throw new Error('R5_007_ZERO_PRIOR_QUANTITY_REQUIRED');

  const { error } = await supabase.rpc('ecoflow_apply_provisional_reference_opening_balance', {
    p_commissioning_id: before.commissioningId,
    p_command_id: input.commandId,
    p_reason: input.reason.trim(),
  });
  if (error) throw error;

  const after = await readR5007Gate(supabase, productCode);
  if (
    after.provisionalStatus !== 'PROVISIONAL_HOLD'
    || after.provisionalQuantity !== before.sourceQtyOnHand
    || after.physicalCountClaimed
    || after.operationalInventoryAuthorityCreated
  ) {
    throw new Error('R5_007_POSTFLIGHT_MISMATCH');
  }
  return after;
}
