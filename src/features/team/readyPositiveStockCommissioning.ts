import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_005B_REFERENCE_BATCH_ID = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9' as const;
export const R5_005B_SOURCE_RUN_ID = '5cd0e73b-956d-4c80-9e70-6d841d27b163' as const;
export const R5_005B_SOURCE_SET_SHA256 = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d' as const;

export const R5_005B_EXECUTABLE_CANDIDATES = {
  'R-360Y': {
    referenceRowId: '2a710fa3-0467-4c05-9317-033fb863815e',
    sourceRowSha256: 'bf95d275d9419dae66a29e10a2a1e4e4f4b57d83a1ae872f4626260cb1592e0d',
    sourceQtyOnHand: 3,
    barcode: '19344062000652',
    packageId: 'ff12d5f1-ba94-4960-bee6-c3c12aaf53ba',
    familyId: '49561d1a-ff69-435f-9088-fe80ab5f775c',
    physicalSkuId: '8905b519-6418-4bb1-a2a4-bdd8d48157f7',
  },
  'SB24/32/40LBOX': {
    referenceRowId: '44aca94f-bb82-457d-9998-c397b687140a',
    sourceRowSha256: 'afbf51ee85d8785036a4532f9ab5ba4f9334ceee6c87998ba09762ed82e9afb6',
    sourceQtyOnHand: 5,
    barcode: '19348045022914',
    packageId: '203dedb0-3ab7-425d-85e2-ac646b1fa601',
    familyId: 'cfa45c82-46fe-44e1-b0f8-9397ce132599',
    physicalSkuId: 'd8d9a558-37e6-4a22-99a2-7f0caf7492ac',
  },
} as const;

export const R5_005B_ZERO_STOCK_HOLD = {
  sourceProductCode: 'FL115PLABOX',
  referenceRowId: '5b280f2f-cb47-41eb-8934-1b527324c193',
  sourceRowSha256: '6f18af7fb997399d64e67ece3cfc2dc13be9cb478a6b2fe4819881207f2e8524',
  sourceQtyOnHand: 0,
  barcode: '19348045010188',
  reason: 'ZERO_STOCK_LOCATION_EVIDENCE_SEMANTICS_UNRESOLVED',
} as const;

export type R5005BProductCode = keyof typeof R5_005B_EXECUTABLE_CANDIDATES;

export type R5005BLocationEvidence = {
  locationId: string;
  locationCode: string;
  referenceAllocatedQty: number;
  countedQty: number;
  evidenceNote: string;
  recordedAt: string;
};

export type R5005BGate = {
  actorRole: string;
  referenceRowId: string;
  referenceBatchId: string;
  referenceBatchStatus: string;
  referenceBatchRevision: number;
  isLatestSealedBatch: boolean;
  sourceRunId: string;
  sourceSetSha256: string;
  sourceRowSha256: string;
  sourceProductCode: R5005BProductCode;
  sourceWarehouseCode: string;
  sourceQtyOnHand: number;
  commercialSkuId: string;
  familyId: string;
  physicalSkuId: string;
  packageId: string;
  packageLevel: string;
  unitsPerPackage: number;
  barcode: string;
  startEligible: boolean;
  commissioningId: string | null;
  commissioningStatus: 'DRAFT' | 'FINALIZED' | 'MATERIALIZED' | 'SUPERSEDED' | null;
  commissioningRevision: number | null;
  stocktakeSessionId: string | null;
  stocktakeSessionStatus: string | null;
  locations: R5005BLocationEvidence[];
  referenceAllocatedQtyTotal: number;
  countedQtyTotal: number;
  acceptedCountVariance: boolean | null;
  varianceReason: string | null;
  inventoryAuthorityCreated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown, code = 'R5_005B_NUMERIC_CONTRACT_VIOLATION') {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(code);
  return result;
}

function asString(value: unknown, code: string) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code);
  return value;
}

function assertUuid(value: string, code: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(code);
  }
}

function normalizeLocation(value: unknown): R5005BLocationEvidence {
  if (!isRecord(value)) throw new Error('R5_005B_LOCATION_CONTRACT_VIOLATION');
  return {
    locationId: asString(value.locationId, 'R5_005B_LOCATION_ID_REQUIRED'),
    locationCode: asString(value.locationCode, 'R5_005B_LOCATION_CODE_REQUIRED'),
    referenceAllocatedQty: asNumber(value.referenceAllocatedQty),
    countedQty: asNumber(value.countedQty),
    evidenceNote: asString(value.evidenceNote, 'R5_005B_EVIDENCE_NOTE_REQUIRED'),
    recordedAt: asString(value.recordedAt, 'R5_005B_RECORDED_AT_REQUIRED'),
  };
}

function normalizeGate(productCode: R5005BProductCode, value: unknown): R5005BGate {
  if (!isRecord(value)) throw new Error('R5_005B_GATE_CONTRACT_VIOLATION');
  const frozen = R5_005B_EXECUTABLE_CANDIDATES[productCode];
  const commissioningStatus = value.commissioningStatus == null ? null : String(value.commissioningStatus);
  if (commissioningStatus !== null && !['DRAFT', 'FINALIZED', 'MATERIALIZED', 'SUPERSEDED'].includes(commissioningStatus)) {
    throw new Error('R5_005B_COMMISSIONING_STATUS_CONTRACT_VIOLATION');
  }
  if (
    value.referenceRowId !== frozen.referenceRowId
    || value.referenceBatchId !== R5_005B_REFERENCE_BATCH_ID
    || value.sourceRunId !== R5_005B_SOURCE_RUN_ID
    || value.sourceSetSha256 !== R5_005B_SOURCE_SET_SHA256
    || value.sourceRowSha256 !== frozen.sourceRowSha256
    || value.sourceProductCode !== productCode
    || asNumber(value.sourceQtyOnHand) !== frozen.sourceQtyOnHand
    || value.familyId !== frozen.familyId
    || value.physicalSkuId !== frozen.physicalSkuId
    || value.packageId !== frozen.packageId
    || value.barcode !== frozen.barcode
    || value.packageLevel !== 'CARTON'
    || asNumber(value.unitsPerPackage) !== 1
    || !Array.isArray(value.locations)
  ) {
    throw new Error('R5_005B_FROZEN_READY_ROW_BINDING_MISMATCH');
  }
  return {
    actorRole: String(value.actorRole ?? ''),
    referenceRowId: frozen.referenceRowId,
    referenceBatchId: R5_005B_REFERENCE_BATCH_ID,
    referenceBatchStatus: String(value.referenceBatchStatus ?? ''),
    referenceBatchRevision: asNumber(value.referenceBatchRevision),
    isLatestSealedBatch: value.isLatestSealedBatch === true,
    sourceRunId: R5_005B_SOURCE_RUN_ID,
    sourceSetSha256: R5_005B_SOURCE_SET_SHA256,
    sourceRowSha256: frozen.sourceRowSha256,
    sourceProductCode: productCode,
    sourceWarehouseCode: String(value.sourceWarehouseCode ?? ''),
    sourceQtyOnHand: frozen.sourceQtyOnHand,
    commercialSkuId: asString(value.commercialSkuId, 'R5_005B_COMMERCIAL_SKU_REQUIRED'),
    familyId: frozen.familyId,
    physicalSkuId: frozen.physicalSkuId,
    packageId: frozen.packageId,
    packageLevel: 'CARTON',
    unitsPerPackage: 1,
    barcode: frozen.barcode,
    startEligible: value.startEligible === true,
    commissioningId: value.commissioningId == null ? null : String(value.commissioningId),
    commissioningStatus: commissioningStatus as R5005BGate['commissioningStatus'],
    commissioningRevision: value.commissioningRevision == null ? null : asNumber(value.commissioningRevision),
    stocktakeSessionId: value.stocktakeSessionId == null ? null : String(value.stocktakeSessionId),
    stocktakeSessionStatus: value.stocktakeSessionStatus == null ? null : String(value.stocktakeSessionStatus),
    locations: value.locations.map(normalizeLocation),
    referenceAllocatedQtyTotal: asNumber(value.referenceAllocatedQtyTotal ?? 0),
    countedQtyTotal: asNumber(value.countedQtyTotal ?? 0),
    acceptedCountVariance: value.acceptedCountVariance == null ? null : value.acceptedCountVariance === true,
    varianceReason: value.varianceReason == null ? null : String(value.varianceReason),
    inventoryAuthorityCreated: value.inventoryAuthorityCreated === true,
  };
}

export async function readR5005BGate(supabase: SupabaseClient, productCode: R5005BProductCode): Promise<R5005BGate> {
  const frozen = R5_005B_EXECUTABLE_CANDIDATES[productCode];
  const { data, error } = await supabase.rpc('ecoflow_read_ready_inventory_commissioning_gate', {
    p_reference_row_id: frozen.referenceRowId,
  });
  if (error) throw error;
  return normalizeGate(productCode, data);
}

export async function startR5005B(
  supabase: SupabaseClient,
  productCode: R5005BProductCode,
  commandId: string,
): Promise<R5005BGate> {
  assertUuid(commandId, 'R5_005B_START_COMMAND_ID_REQUIRED');
  const before = await readR5005BGate(supabase, productCode);
  if (!before.startEligible || before.commissioningId !== null || before.sourceQtyOnHand <= 0) {
    throw new Error('R5_005B_START_NOT_ELIGIBLE');
  }
  const { error } = await supabase.rpc('ecoflow_start_ready_inventory_commissioning', {
    p_reference_row_id: before.referenceRowId,
    p_command_id: commandId,
  });
  if (error) throw error;
  const after = await readR5005BGate(supabase, productCode);
  if (after.commissioningStatus !== 'DRAFT' || !after.commissioningId || after.inventoryAuthorityCreated) {
    throw new Error('R5_005B_START_POSTFLIGHT_MISMATCH');
  }
  return after;
}

export async function recordR5005BLocation(
  supabase: SupabaseClient,
  productCode: R5005BProductCode,
  commissioningId: string,
  input: { locationCode: string; referenceAllocatedQty: number; countedQty: number; evidenceNote: string; commandId: string },
): Promise<R5005BGate> {
  assertUuid(commissioningId, 'R5_005B_COMMISSIONING_ID_REQUIRED');
  assertUuid(input.commandId, 'R5_005B_LOCATION_COMMAND_ID_REQUIRED');
  const locationCode = input.locationCode.trim().toUpperCase();
  const evidenceNote = input.evidenceNote.trim();
  if (!locationCode) throw new Error('R5_005B_REAL_LOCATION_REQUIRED');
  if (!evidenceNote) throw new Error('R5_005B_PHYSICAL_EVIDENCE_NOTE_REQUIRED');
  if (!Number.isInteger(input.referenceAllocatedQty) || input.referenceAllocatedQty < 0) throw new Error('R5_005B_REFERENCE_ALLOCATION_REQUIRED');
  if (!Number.isInteger(input.countedQty) || input.countedQty < 0) throw new Error('R5_005B_PHYSICAL_COUNT_REQUIRED');

  const before = await readR5005BGate(supabase, productCode);
  if (before.commissioningId !== commissioningId || before.commissioningStatus !== 'DRAFT') throw new Error('R5_005B_DRAFT_REQUIRED');
  const existing = before.locations.find((item) => item.locationCode.toUpperCase() === locationCode);
  if (existing) {
    if (existing.referenceAllocatedQty === input.referenceAllocatedQty && existing.countedQty === input.countedQty && existing.evidenceNote === evidenceNote) return before;
    throw new Error('R5_005B_LOCATION_ALREADY_RECORDED_DIFFERENTLY');
  }

  const { error } = await supabase.rpc('ecoflow_record_ready_inventory_commissioning_location', {
    p_commissioning_id: commissioningId,
    p_location_code: locationCode,
    p_reference_allocated_qty: input.referenceAllocatedQty,
    p_counted_qty: input.countedQty,
    p_note: evidenceNote,
    p_command_id: input.commandId,
  });
  if (error) throw error;
  const after = await readR5005BGate(supabase, productCode);
  const recorded = after.locations.find((item) => item.locationCode.toUpperCase() === locationCode);
  if (!recorded || recorded.referenceAllocatedQty !== input.referenceAllocatedQty || recorded.countedQty !== input.countedQty || recorded.evidenceNote !== evidenceNote) {
    throw new Error('R5_005B_LOCATION_POSTFLIGHT_MISMATCH');
  }
  return after;
}

export async function finalizeR5005B(
  supabase: SupabaseClient,
  productCode: R5005BProductCode,
  commissioningId: string,
  acceptCountVariance: boolean,
  varianceReason: string,
  commandId: string,
): Promise<R5005BGate> {
  assertUuid(commandId, 'R5_005B_FINALIZE_COMMAND_ID_REQUIRED');
  const before = await readR5005BGate(supabase, productCode);
  if (before.commissioningId !== commissioningId || before.commissioningStatus !== 'DRAFT') throw new Error('R5_005B_DRAFT_REQUIRED');
  if (before.locations.length < 1) throw new Error('R5_005B_REAL_LOCATION_EVIDENCE_REQUIRED');
  const referenceTotal = before.locations.reduce((sum, item) => sum + item.referenceAllocatedQty, 0);
  const countedTotal = before.locations.reduce((sum, item) => sum + item.countedQty, 0);
  if (referenceTotal !== before.sourceQtyOnHand) throw new Error('R5_005B_REFERENCE_ALLOCATION_MUST_RECONCILE');
  const hasVariance = countedTotal !== before.sourceQtyOnHand;
  if (hasVariance && !acceptCountVariance) throw new Error('R5_005B_EXPLICIT_VARIANCE_ACCEPTANCE_REQUIRED');
  if (hasVariance && !varianceReason.trim()) throw new Error('R5_005B_VARIANCE_REASON_REQUIRED');

  const { error } = await supabase.rpc('ecoflow_finalize_ready_inventory_commissioning', {
    p_commissioning_id: commissioningId,
    p_accept_count_variance: hasVariance && acceptCountVariance,
    p_variance_reason: hasVariance ? varianceReason.trim() : '',
    p_command_id: commandId,
  });
  if (error) throw error;
  const after = await readR5005BGate(supabase, productCode);
  if (after.commissioningStatus !== 'FINALIZED' || after.inventoryAuthorityCreated) throw new Error('R5_005B_FINALIZE_POSTFLIGHT_MISMATCH');
  return after;
}

export async function materializeR5005B(
  supabase: SupabaseClient,
  productCode: R5005BProductCode,
  commissioningId: string,
  commandId: string,
): Promise<R5005BGate> {
  assertUuid(commandId, 'R5_005B_MATERIALIZE_COMMAND_ID_REQUIRED');
  const before = await readR5005BGate(supabase, productCode);
  if (before.commissioningId !== commissioningId || before.commissioningStatus !== 'FINALIZED') throw new Error('R5_005B_FINALIZED_REQUIRED');
  const { error } = await supabase.rpc('ecoflow_materialize_ready_initial_stocktake', {
    p_commissioning_id: commissioningId,
    p_command_id: commandId,
  });
  if (error) throw error;
  const after = await readR5005BGate(supabase, productCode);
  if (after.commissioningStatus !== 'MATERIALIZED' || after.stocktakeSessionStatus !== 'REVIEW' || after.inventoryAuthorityCreated) {
    throw new Error('R5_005B_MATERIALIZE_POSTFLIGHT_MISMATCH');
  }
  return after;
}
