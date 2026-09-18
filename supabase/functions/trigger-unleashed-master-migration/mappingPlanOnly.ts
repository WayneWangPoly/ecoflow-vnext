export const R5_006_MAPPING_PLAN_ONLY_TARGET = {
  protectedMainSha: '2545fd0c455f36f157c5609eff36d147f0c925b3',
  referenceBatchId: '4cdb85d3-06d8-44bf-96bb-93660e10c3c9',
  sourceSetSha256: '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d',
  referenceRowCount: 427,
  pendingProductMappingCount: 247,
  autoMatchableCount: 151,
  autoMatchablePositiveRows: 128,
  autoMatchablePositiveQty: 1675,
  noTargetCount: 96,
  ambiguousTargetCount: 0,
  mappingInvariantFailureCount: 0,
  cohortSha256: '8e5974ea2ef8725977c2c38c135d517d1595cc2064bd6f03b9801e1b03adb020',
  predictedPendingProductMappingCount: 96,
  predictedPendingPhysicalIdentityCount: 327,
  predictedReadyForLocationEvidenceCount: 4,
} as const;

export type MappingPlanOnlyBatch = {
  id: string;
  batch_status: string;
  source_set_sha256: string;
  source_row_count: number | string;
};

export type MappingPlanOnlyReferenceRow = {
  reference_row_id: string;
  batch_id: string;
  source_product_guid: string;
  source_product_code: string;
  source_row_sha256: string;
  qty_on_hand: number | string;
  readiness_status: string;
};

export type MappingPlanOnlyMasterMapping = {
  id: string;
  entity_type: string;
  mapping_status: string;
  source_external_guid: string | null;
  source_duplicate_count: number | string;
  revision: number | string;
  source_payload_sha256: string;
};

export type MappingPlanOnlySku = {
  id: string;
  sku_code: string;
};

export type MappingPlanOnlyExternalMapping = {
  internal_sku_id: string;
  external_product_code: string;
  provider: string;
  is_active: boolean;
};

export type MappingPlanOnlyEvidence = {
  ready: boolean;
  status: 'READY' | 'HOLD';
  protectedMainSha: string;
  referenceBatchId: string;
  sourceSetSha256: string;
  referenceRowCount: number;
  pendingProductMappingCount: number;
  autoMatchableCount: number;
  autoMatchablePositiveRows: number;
  autoMatchablePositiveQty: number;
  noTargetCount: number;
  ambiguousTargetCount: number;
  mappingInvariantFailureCount: number;
  cohortSha256: string;
  predictedPostflight: {
    pendingProductMappingCount: number;
    pendingPhysicalIdentityCount: number;
    readyForLocationEvidenceCount: number;
  };
};

function normalCode(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function normalGuid(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function numberValue(value: number | string | null | undefined) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function computeR5006MappingPlanOnlyEvidence(input: {
  batch: MappingPlanOnlyBatch;
  referenceRows: MappingPlanOnlyReferenceRow[];
  masterMappings: MappingPlanOnlyMasterMapping[];
  skus: MappingPlanOnlySku[];
  externalMappings: MappingPlanOnlyExternalMapping[];
}): Promise<MappingPlanOnlyEvidence> {
  const target = R5_006_MAPPING_PLAN_ONLY_TARGET;
  const batch = input.batch;

  const skuById = new Map(input.skus.map((sku) => [sku.id, sku]));
  const mappingsByGuid = new Map<string, MappingPlanOnlyMasterMapping[]>();
  for (const mapping of input.masterMappings) {
    if (mapping.entity_type !== 'PRODUCT') continue;
    const key = normalGuid(mapping.source_external_guid);
    if (!key) continue;
    const rows = mappingsByGuid.get(key) ?? [];
    rows.push(mapping);
    mappingsByGuid.set(key, rows);
  }

  const ordermentumTargetsByCode = new Map<string, Set<string>>();
  for (const mapping of input.externalMappings) {
    if (mapping.provider !== 'ORDERMENTUM' || mapping.is_active !== true) continue;
    const code = normalCode(mapping.external_product_code);
    if (!code) continue;
    const targets = ordermentumTargetsByCode.get(code) ?? new Set<string>();
    targets.add(mapping.internal_sku_id);
    ordermentumTargetsByCode.set(code, targets);
  }

  const pending = input.referenceRows.filter((row) => row.readiness_status === 'PENDING_PRODUCT_MAPPING');
  let autoMatchablePositiveRows = 0;
  let autoMatchablePositiveQty = 0;
  let noTargetCount = 0;
  let ambiguousTargetCount = 0;
  let mappingInvariantFailureCount = 0;
  const cohort: Array<{ code: string; mappingId: string; line: string }> = [];

  for (const row of pending) {
    const code = normalCode(row.source_product_code);
    const targetIds = [...(ordermentumTargetsByCode.get(code) ?? new Set<string>())];
    if (targetIds.length === 0) {
      noTargetCount += 1;
      continue;
    }
    if (targetIds.length !== 1) {
      ambiguousTargetCount += 1;
      continue;
    }

    const sku = skuById.get(targetIds[0]);
    const mappingRows = mappingsByGuid.get(normalGuid(row.source_product_guid)) ?? [];
    const mapping = mappingRows.length === 1 ? mappingRows[0] : null;
    const invariantOk = Boolean(
      sku
      && mapping
      && mapping.mapping_status === 'UNMATCHED'
      && numberValue(mapping.source_duplicate_count) === 1
      && /^[0-9a-f]{64}$/.test(mapping.source_payload_sha256)
      && /^[0-9a-f]{64}$/.test(row.source_row_sha256)
    );
    if (!invariantOk || !sku || !mapping) {
      mappingInvariantFailureCount += 1;
      continue;
    }

    const qty = numberValue(row.qty_on_hand);
    if (qty > 0) {
      autoMatchablePositiveRows += 1;
      autoMatchablePositiveQty += qty;
    }
    cohort.push({
      code,
      mappingId: mapping.id,
      line: [
        row.reference_row_id,
        normalGuid(row.source_product_guid),
        code,
        row.source_row_sha256,
        mapping.id,
        String(numberValue(mapping.revision)),
        mapping.source_payload_sha256,
        sku.id,
        normalCode(sku.sku_code),
      ].join('|'),
    });
  }

  cohort.sort((a, b) => {
    if (a.code < b.code) return -1;
    if (a.code > b.code) return 1;
    if (a.mappingId < b.mappingId) return -1;
    if (a.mappingId > b.mappingId) return 1;
    return 0;
  });
  const cohortSha256 = await sha256Hex(cohort.map((row) => row.line).join('\n'));

  const referenceRowCount = numberValue(batch.source_row_count);
  const batchOk = batch.id === target.referenceBatchId
    && batch.batch_status === 'SEALED'
    && batch.source_set_sha256 === target.sourceSetSha256
    && referenceRowCount === target.referenceRowCount;

  const ready = batchOk
    && input.referenceRows.length === target.referenceRowCount
    && pending.length === target.pendingProductMappingCount
    && cohort.length === target.autoMatchableCount
    && autoMatchablePositiveRows === target.autoMatchablePositiveRows
    && autoMatchablePositiveQty === target.autoMatchablePositiveQty
    && noTargetCount === target.noTargetCount
    && ambiguousTargetCount === target.ambiguousTargetCount
    && mappingInvariantFailureCount === target.mappingInvariantFailureCount
    && cohortSha256 === target.cohortSha256;

  return {
    ready,
    status: ready ? 'READY' : 'HOLD',
    protectedMainSha: target.protectedMainSha,
    referenceBatchId: batch.id,
    sourceSetSha256: batch.source_set_sha256,
    referenceRowCount,
    pendingProductMappingCount: pending.length,
    autoMatchableCount: cohort.length,
    autoMatchablePositiveRows,
    autoMatchablePositiveQty,
    noTargetCount,
    ambiguousTargetCount,
    mappingInvariantFailureCount,
    cohortSha256,
    predictedPostflight: {
      pendingProductMappingCount: target.predictedPendingProductMappingCount,
      pendingPhysicalIdentityCount: target.predictedPendingPhysicalIdentityCount,
      readyForLocationEvidenceCount: target.predictedReadyForLocationEvidenceCount,
    },
  };
}
