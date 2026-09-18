import type { BarcodeSurveyReconciliationRow } from '@/data/repositories/barcodeSurveyReconciliation';

export const ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET = {
  protectedMainSha: 'e615cb686cbc374a0c3100929e881d7e5d7e1379',
  batchName: 'ECOFLOW-328 Batch Next DRAFT-only',
  startCommandId: '54a86be1-b497-48aa-a9e1-5d61aab29b51',
  candidates: [
    {
      code: 'CCLBPLA-80',
      commercialSkuId: 'cc0d56f1-9ac8-47a4-a5b7-5a3f1c990e5d',
      surveyObservationId: 'd8226c36-057c-4cc8-925e-4f99276ddb60',
      reconcileCommandId: 'fd66defd-9dd6-47b4-8701-60dc8e73370a',
    },
    {
      code: 'CCSKBM12-90',
      commercialSkuId: '04b0ff03-bdbf-4897-9171-156af5fb8e00',
      surveyObservationId: '2fda2caa-0727-4e32-b036-0da3c8196e03',
      reconcileCommandId: '32ebe526-0f9a-4762-8fb0-e35db47b1934',
    },
    {
      code: 'NPK2DK',
      commercialSkuId: 'f5c68b72-1684-4029-8219-f40b7513c54c',
      surveyObservationId: 'cf15dad3-07e1-4fe8-a184-35968b64a485',
      reconcileCommandId: 'efffab32-38e7-43d0-ac0b-03fceca9db3f',
    },
    {
      code: 'CCLWPLA-80',
      commercialSkuId: '7d387ca1-482b-4143-8ec7-e20f82a8109e',
      surveyObservationId: 'f61dd655-9a7b-4f7a-ad10-f7a3a795d13e',
      reconcileCommandId: 'a9f58d3b-c4fc-4bb7-aa28-126ad773f03a',
    },
    {
      code: 'CCSA12-90',
      commercialSkuId: '6b8e0688-d256-4bdb-acc4-175203905796',
      surveyObservationId: '9bde5c61-87de-4f3c-9006-fa9a8e9a3d08',
      reconcileCommandId: '3391354c-8733-498d-b626-719b4456fae1',
    },
  ],
} as const;

export type BatchNextCandidate = typeof ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates[number];

export type BatchNextPhysicalFactsDraft = {
  physicalSkuCode: string;
  physicalName: string;
  brand: string;
  supplierName: string;
  familyCode: string;
  familyName: string;
  packageLevel: '' | 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: string;
  substitutionPolicy: '' | 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  confirmed: boolean;
  note: string;
};

export type BatchNextQueueEvidence = {
  candidate: BatchNextCandidate;
  row: BarcodeSurveyReconciliationRow;
};

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function required(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required; do not infer it from Commercial SKU names.`);
  return trimmed;
}

export function emptyBatchNextPhysicalFacts(candidate: BatchNextCandidate): BatchNextPhysicalFactsDraft {
  return {
    physicalSkuCode: '',
    physicalName: '',
    brand: '',
    supplierName: '',
    familyCode: '',
    familyName: '',
    packageLevel: '',
    unitsInBaseUnit: '',
    substitutionPolicy: '',
    isPreferred: false,
    confirmed: false,
    note: `ECOFLOW-328-BATCH-NEXT-DRAFT · ${candidate.code} · physical facts explicitly confirmed by Owner/Admin; DRAFT only; no submit/publish/inventory authority.`,
  };
}

export function validateBatchNextQueue(rows: BarcodeSurveyReconciliationRow[]): BatchNextQueueEvidence[] {
  const result = ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.map((candidate) => {
    const row = rows.find((item) => item.surveyObservationId === candidate.surveyObservationId);
    if (!row) throw new Error(`${candidate.code}: frozen Survey observation is not present in the current queue.`);
    if (row.queueStatus !== 'READY_TO_RECONCILE') {
      throw new Error(`${candidate.code}: queue drifted to ${row.queueStatus}; stop before START.`);
    }
    if (row.commercialMatchCount !== 1 || row.commercialSkuId !== candidate.commercialSkuId) {
      throw new Error(`${candidate.code}: Commercial identity no longer matches the frozen unique target.`);
    }
    if (normalized(row.skuContext) !== candidate.code) {
      throw new Error(`${candidate.code}: Survey SKU context drifted to ${row.skuContext ?? 'NULL'}.`);
    }
    if (row.reconciliationId || row.productIdentityObservationId || row.reconciliationStatus) {
      throw new Error(`${candidate.code}: Survey observation is already reconciled; stop before START.`);
    }
    if (row.existingPhysicalSkuCode) {
      throw new Error(`${candidate.code}: barcode already has a published Physical SKU owner; stop before START.`);
    }
    if (row.evidenceSource !== 'OBSERVED_NOW') {
      throw new Error(`${candidate.code}: direct physical evidence is no longer OBSERVED_NOW.`);
    }
    if (!['SCANNED', 'NO_SEPARATE_BARCODE'].includes(row.sleeveStatus)) {
      throw new Error(`${candidate.code}: package evidence is no longer physically verified.`);
    }
    return { candidate, row };
  });

  const distinctCommercial = new Set(result.map((item) => item.candidate.commercialSkuId));
  const distinctSurvey = new Set(result.map((item) => item.candidate.surveyObservationId));
  if (distinctCommercial.size !== ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.length || distinctSurvey.size !== ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.length) {
    throw new Error('Frozen Batch Next scope is not five distinct Commercial SKUs / Survey observations.');
  }
  return result;
}

export function buildBatchNextStartInput() {
  return {
    batchName: ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.batchName,
    commercialSkuIds: ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.map((candidate) => candidate.commercialSkuId),
    commandId: ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.startCommandId,
  };
}

export function buildBatchNextReconcileInput(
  candidate: BatchNextCandidate,
  batchId: string,
  draft: BatchNextPhysicalFactsDraft,
) {
  if (!draft.confirmed) throw new Error(`${candidate.code}: confirm the physical facts before creating a DRAFT.`);
  const unitsInBaseUnit = Number(draft.unitsInBaseUnit);
  if (!Number.isFinite(unitsInBaseUnit) || unitsInBaseUnit <= 0) {
    throw new Error(`${candidate.code}: units in base unit must be an explicitly confirmed positive number.`);
  }
  if (!draft.packageLevel) throw new Error(`${candidate.code}: package level must be explicitly confirmed.`);
  if (!draft.substitutionPolicy) throw new Error(`${candidate.code}: substitution policy must be explicitly confirmed.`);

  return {
    surveyObservationId: candidate.surveyObservationId,
    batchId,
    commandId: candidate.reconcileCommandId,
    physicalSkuCode: required(draft.physicalSkuCode, `${candidate.code} Physical SKU code`),
    physicalName: required(draft.physicalName, `${candidate.code} Physical name`),
    brand: draft.brand.trim() || undefined,
    supplierName: draft.supplierName.trim() || undefined,
    familyCode: required(draft.familyCode, `${candidate.code} Family code`),
    familyName: required(draft.familyName, `${candidate.code} Family name`),
    packageLevel: draft.packageLevel,
    unitsInBaseUnit,
    substitutionPolicy: draft.substitutionPolicy,
    isPreferred: draft.isPreferred,
    note: draft.note.trim() || undefined,
  };
}
