import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_004C_REFERENCE_BATCH_ID = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9' as const;
export const R5_004C_SOURCE_RUN_ID = '5cd0e73b-956d-4c80-9e70-6d841d27b163' as const;
export const R5_004C_SOURCE_SET_SHA256 = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d' as const;
export const R5_004C_START_COMMAND_ID = 'c2040c88-2b9d-4d68-9b2d-9a6d8797f621' as const;
export const R5_004C_FINALIZE_COMMAND_ID = 'ad052ad1-35e1-4b3f-8923-81fd896e7218' as const;
export const R5_004C_MATERIALIZE_COMMAND_ID = '2d85c435-41f5-4e02-91ea-8ca6b351de2e' as const;

export type R5004CLocationEvidence = {
  locationId: string;
  locationCode: string;
  referenceAllocatedQty: number;
  countedQty: number;
  evidenceNote: string;
  recordedAt: string;
};

export type R5004CCanaryGate = {
  actorRole: string;
  referenceBatchId: typeof R5_004C_REFERENCE_BATCH_ID;
  referenceBatchStatus: 'STAGED' | 'SEALED';
  referenceBatchRevision: number;
  sourceRunId: typeof R5_004C_SOURCE_RUN_ID;
  sourceProductCode: 'BPB8';
  sourceQtyOnHand: 3;
  commercialSkuId: 'ec67ca0a-67b5-437f-96a8-81e6268faa44';
  familyId: '1ff1f446-6e97-4ce6-bf6c-ef063265783a';
  physicalSkuId: '7dcaa2ed-a7db-4722-b91a-e8f17ffe2281';
  packageId: '521dfafc-fd01-4897-a3ac-4e272d8f6ba5';
  packageLevel: 'CARTON';
  unitsPerPackage: 1;
  barcode: '19348045005009';
  commissioningId: string | null;
  commissioningStatus: 'DRAFT' | 'FINALIZED' | 'MATERIALIZED' | 'SUPERSEDED' | null;
  commissioningRevision: number | null;
  stocktakeSessionId: string | null;
  locations: R5004CLocationEvidence[];
  referenceAllocatedQtyTotal: number;
  countedQtyTotal: number;
  acceptedCountVariance: boolean | null;
  varianceReason: string | null;
  inventoryAuthorityCreated: false;
};

export type R5004CLocationInput = {
  locationCode: string;
  referenceAllocatedQty: number;
  countedQty: number;
  evidenceNote: string;
  commandId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown) {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error('R5_004C_NUMERIC_CONTRACT_VIOLATION');
  return result;
}

function assertUuid(value: string, code: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(code);
  }
}

function normalizeLocation(value: unknown): R5004CLocationEvidence {
  if (!isRecord(value)
    || typeof value.locationId !== 'string'
    || typeof value.locationCode !== 'string'
    || typeof value.evidenceNote !== 'string'
    || typeof value.recordedAt !== 'string') {
    throw new Error('R5_004C_LOCATION_GATE_CONTRACT_VIOLATION');
  }
  return {
    locationId: value.locationId,
    locationCode: value.locationCode,
    referenceAllocatedQty: asNumber(value.referenceAllocatedQty),
    countedQty: asNumber(value.countedQty),
    evidenceNote: value.evidenceNote,
    recordedAt: value.recordedAt,
  };
}

function normalizeGate(value: unknown): R5004CCanaryGate {
  if (!isRecord(value)) throw new Error('R5_004C_GATE_CONTRACT_VIOLATION');
  if (
    value.referenceBatchId !== R5_004C_REFERENCE_BATCH_ID
    || !['STAGED', 'SEALED'].includes(String(value.referenceBatchStatus))
    || value.sourceRunId !== R5_004C_SOURCE_RUN_ID
    || value.sourceProductCode !== 'BPB8'
    || asNumber(value.sourceQtyOnHand) !== 3
    || value.commercialSkuId !== 'ec67ca0a-67b5-437f-96a8-81e6268faa44'
    || value.familyId !== '1ff1f446-6e97-4ce6-bf6c-ef063265783a'
    || value.physicalSkuId !== '7dcaa2ed-a7db-4722-b91a-e8f17ffe2281'
    || value.packageId !== '521dfafc-fd01-4897-a3ac-4e272d8f6ba5'
    || value.packageLevel !== 'CARTON'
    || asNumber(value.unitsPerPackage) !== 1
    || value.barcode !== '19348045005009'
    || value.inventoryAuthorityCreated !== false
    || !Array.isArray(value.locations)
  ) throw new Error('R5_004C_FROZEN_CANARY_BINDING_MISMATCH');

  const commissioningStatus = value.commissioningStatus == null ? null : String(value.commissioningStatus);
  if (commissioningStatus !== null && !['DRAFT', 'FINALIZED', 'MATERIALIZED', 'SUPERSEDED'].includes(commissioningStatus)) {
    throw new Error('R5_004C_COMMISSIONING_STATUS_CONTRACT_VIOLATION');
  }

  return {
    actorRole: String(value.actorRole ?? ''),
    referenceBatchId: R5_004C_REFERENCE_BATCH_ID,
    referenceBatchStatus: String(value.referenceBatchStatus) as R5004CCanaryGate['referenceBatchStatus'],
    referenceBatchRevision: asNumber(value.referenceBatchRevision),
    sourceRunId: R5_004C_SOURCE_RUN_ID,
    sourceProductCode: 'BPB8',
    sourceQtyOnHand: 3,
    commercialSkuId: 'ec67ca0a-67b5-437f-96a8-81e6268faa44',
    familyId: '1ff1f446-6e97-4ce6-bf6c-ef063265783a',
    physicalSkuId: '7dcaa2ed-a7db-4722-b91a-e8f17ffe2281',
    packageId: '521dfafc-fd01-4897-a3ac-4e272d8f6ba5',
    packageLevel: 'CARTON',
    unitsPerPackage: 1,
    barcode: '19348045005009',
    commissioningId: value.commissioningId == null ? null : String(value.commissioningId),
    commissioningStatus: commissioningStatus as R5004CCanaryGate['commissioningStatus'],
    commissioningRevision: value.commissioningRevision == null ? null : asNumber(value.commissioningRevision),
    stocktakeSessionId: value.stocktakeSessionId == null ? null : String(value.stocktakeSessionId),
    locations: value.locations.map(normalizeLocation),
    referenceAllocatedQtyTotal: asNumber(value.referenceAllocatedQtyTotal ?? 0),
    countedQtyTotal: asNumber(value.countedQtyTotal ?? 0),
    acceptedCountVariance: value.acceptedCountVariance == null ? null : value.acceptedCountVariance === true,
    varianceReason: value.varianceReason == null ? null : String(value.varianceReason),
    inventoryAuthorityCreated: false,
  };
}

export async function readR5004CCanaryGate(supabase: SupabaseClient): Promise<R5004CCanaryGate> {
  const { data, error } = await supabase.rpc('ecoflow_read_bpb8_inventory_commissioning_gate');
  if (error) throw error;
  return normalizeGate(data);
}

export async function startR5004CBpb8Canary(supabase: SupabaseClient): Promise<R5004CCanaryGate> {
  const before = await readR5004CCanaryGate(supabase);
  if (before.referenceBatchStatus !== 'SEALED' || before.referenceBatchRevision !== 1) {
    throw new Error('R5_004C_EXACT_SEALED_REFERENCE_REQUIRED');
  }
  if (before.commissioningId !== null) throw new Error('R5_004C_COMMISSIONING_ALREADY_EXISTS');

  const { data, error } = await supabase.rpc('ecoflow_start_bpb8_inventory_commissioning', {
    p_command_id: R5_004C_START_COMMAND_ID,
  });
  if (error) throw error;
  if (!isRecord(data)
    || data.status !== 'DRAFT'
    || asNumber(data.revision) !== 0
    || asNumber(data.sourceQtyOnHand) !== 3
    || data.inventoryAuthorityCreated !== false
    || typeof data.commissioningId !== 'string') {
    throw new Error('R5_004C_START_RESULT_REJECTED');
  }

  const after = await readR5004CCanaryGate(supabase);
  if (after.commissioningId !== data.commissioningId || after.commissioningStatus !== 'DRAFT') {
    throw new Error('R5_004C_START_POSTFLIGHT_MISMATCH');
  }
  return after;
}

export async function recordR5004CBpb8Location(
  supabase: SupabaseClient,
  commissioningId: string,
  input: R5004CLocationInput,
): Promise<R5004CCanaryGate> {
  assertUuid(commissioningId, 'R5_004C_COMMISSIONING_ID_REQUIRED');
  assertUuid(input.commandId, 'R5_004C_LOCATION_COMMAND_ID_REQUIRED');
  const locationCode = input.locationCode.trim().toUpperCase();
  const evidenceNote = input.evidenceNote.trim();
  if (!locationCode) throw new Error('R5_004C_REAL_LOCATION_CODE_REQUIRED');
  if (!evidenceNote) throw new Error('R5_004C_PHYSICAL_EVIDENCE_NOTE_REQUIRED');
  for (const [value, code] of [
    [input.referenceAllocatedQty, 'R5_004C_REFERENCE_ALLOCATION_REQUIRED'],
    [input.countedQty, 'R5_004C_PHYSICAL_COUNT_REQUIRED'],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(code);
  }

  const before = await readR5004CCanaryGate(supabase);
  if (before.commissioningId !== commissioningId || before.commissioningStatus !== 'DRAFT') {
    throw new Error('R5_004C_DRAFT_COMMISSIONING_REQUIRED');
  }
  const existing = before.locations.find((location) => location.locationCode.toUpperCase() === locationCode);
  if (existing) {
    if (existing.referenceAllocatedQty === input.referenceAllocatedQty
      && existing.countedQty === input.countedQty
      && existing.evidenceNote === evidenceNote) return before;
    throw new Error('R5_004C_LOCATION_ALREADY_RECORDED_DIFFERENTLY');
  }

  const { data, error } = await supabase.rpc('ecoflow_record_bpb8_inventory_commissioning_location', {
    p_commissioning_id: commissioningId,
    p_location_code: locationCode,
    p_reference_allocated_qty: input.referenceAllocatedQty,
    p_counted_qty: input.countedQty,
    p_note: evidenceNote,
    p_command_id: input.commandId,
  });
  if (error) throw error;
  if (!isRecord(data)
    || data.commissioningId !== commissioningId
    || data.status !== 'DRAFT'
    || data.locationCode !== locationCode
    || asNumber(data.referenceAllocatedQty) !== input.referenceAllocatedQty
    || asNumber(data.countedQty) !== input.countedQty
    || data.inventoryAuthorityCreated !== false) {
    throw new Error('R5_004C_LOCATION_RESULT_REJECTED');
  }

  const after = await readR5004CCanaryGate(supabase);
  const recorded = after.locations.find((location) => location.locationCode.toUpperCase() === locationCode);
  if (!recorded
    || recorded.referenceAllocatedQty !== input.referenceAllocatedQty
    || recorded.countedQty !== input.countedQty
    || recorded.evidenceNote !== evidenceNote) {
    throw new Error('R5_004C_LOCATION_POSTFLIGHT_MISMATCH');
  }
  return after;
}

export async function finalizeR5004CBpb8Canary(
  supabase: SupabaseClient,
  commissioningId: string,
  acceptCountVariance: boolean,
  varianceReason: string,
): Promise<R5004CCanaryGate> {
  const before = await readR5004CCanaryGate(supabase);
  if (before.commissioningId !== commissioningId || before.commissioningStatus !== 'DRAFT') {
    throw new Error('R5_004C_DRAFT_COMMISSIONING_REQUIRED');
  }
  if (before.locations.length < 1) throw new Error('R5_004C_REAL_LOCATION_EVIDENCE_REQUIRED');
  const referenceTotal = before.locations.reduce((sum, item) => sum + item.referenceAllocatedQty, 0);
  const countedTotal = before.locations.reduce((sum, item) => sum + item.countedQty, 0);
  if (referenceTotal !== 3) throw new Error('R5_004C_REFERENCE_ALLOCATION_MUST_EQUAL_THREE');
  const hasVariance = countedTotal !== 3;
  if (hasVariance && !acceptCountVariance) throw new Error('R5_004C_EXPLICIT_VARIANCE_ACCEPTANCE_REQUIRED');
  if (hasVariance && !varianceReason.trim()) throw new Error('R5_004C_VARIANCE_REASON_REQUIRED');

  const { data, error } = await supabase.rpc('ecoflow_finalize_bpb8_inventory_commissioning', {
    p_commissioning_id: commissioningId,
    p_accept_count_variance: hasVariance && acceptCountVariance,
    p_variance_reason: hasVariance ? varianceReason.trim() : '',
    p_command_id: R5_004C_FINALIZE_COMMAND_ID,
  });
  if (error) throw error;
  if (!isRecord(data)
    || data.commissioningId !== commissioningId
    || data.status !== 'FINALIZED'
    || asNumber(data.referenceAllocatedQtyTotal) !== 3
    || asNumber(data.countedQtyTotal) !== countedTotal
    || asNumber(data.countVariance) !== countedTotal - 3
    || data.inventoryAuthorityCreated !== false) {
    throw new Error('R5_004C_FINALIZE_RESULT_REJECTED');
  }

  const after = await readR5004CCanaryGate(supabase);
  if (after.commissioningStatus !== 'FINALIZED'
    || after.referenceAllocatedQtyTotal !== 3
    || after.countedQtyTotal !== countedTotal) {
    throw new Error('R5_004C_FINALIZE_POSTFLIGHT_MISMATCH');
  }
  return after;
}

export async function materializeR5004CBpb8InitialReview(
  supabase: SupabaseClient,
  commissioningId: string,
): Promise<R5004CCanaryGate> {
  const before = await readR5004CCanaryGate(supabase);
  if (before.commissioningId !== commissioningId || before.commissioningStatus !== 'FINALIZED') {
    throw new Error('R5_004C_FINALIZED_COMMISSIONING_REQUIRED');
  }
  if (before.stocktakeSessionId !== null) throw new Error('R5_004C_STOCKTAKE_ALREADY_MATERIALIZED');

  const { data, error } = await supabase.rpc('ecoflow_materialize_bpb8_initial_stocktake', {
    p_commissioning_id: commissioningId,
    p_command_id: R5_004C_MATERIALIZE_COMMAND_ID,
  });
  if (error) throw error;
  if (!isRecord(data)
    || data.commissioningId !== commissioningId
    || data.status !== 'MATERIALIZED'
    || data.stocktakeSessionStatus !== 'REVIEW'
    || data.approvalRequired !== true
    || data.inventoryAuthorityCreated !== false
    || typeof data.stocktakeSessionId !== 'string') {
    throw new Error('R5_004C_MATERIALIZE_RESULT_REJECTED');
  }

  const after = await readR5004CCanaryGate(supabase);
  if (after.commissioningStatus !== 'MATERIALIZED'
    || after.stocktakeSessionId !== data.stocktakeSessionId
    || after.inventoryAuthorityCreated !== false) {
    throw new Error('R5_004C_MATERIALIZE_POSTFLIGHT_MISMATCH');
  }
  return after;
}
