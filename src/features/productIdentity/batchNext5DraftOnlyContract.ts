import type { BarcodeSurveyReconciliationRow } from '@/data/repositories/barcodeSurveyReconciliation';

export const ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET = {
  protectedMainSha: 'ee9120437fadd2f2f96b496f5cbe448494034d57',
  batchName: 'ECOFLOW-328 Batch Next 5 DRAFT-only',
  startCommandId: '6e0520a2-42bb-4caa-be57-13978326f4ed',
  referenceBatchId: '4cdb85d3-06d8-44bf-96bb-93660e10c3c9',
  authenticatedCensus: {
    ready: 8,
    needsIdentity: 2,
    conflict: 2,
    insufficient: 77,
    drafted: 0,
    published: 39,
  },
  totalReferenceQty: 14,
  candidates: [
    {
      code: 'PSJALLBLACK',
      commercialSkuId: '074d8387-3158-4324-8c33-27242b96e4d7',
      reconcileCommandId: '0210e278-c82c-420d-b552-3471781bbd89',
      physicalName: '10mm All Black Paper Straw Jumbo - 2500pcs',
      surveyProductName: '10mm All Black Paper Straw Jumbo - 2500pcs',
      commercialName: '10mm All Black Paper Straw Jumbo - 2500pcs',
      cartonBarcode: '19348045023089',
      referenceQty: 3,
    },
    {
      code: 'WRC750',
      commercialSkuId: 'fb3eb334-3511-45b1-83ce-d72a646a5517',
      reconcileCommandId: '3526db98-c1ad-41a5-a89c-d85051837e37',
      physicalName: '750ml Plain Board Takeaway Base Carton - 300pcs',
      surveyProductName: '750ml Plain Board Takeaway Base Carton - 300pcs',
      commercialName: '750ml Plain Board Takeaway Base Carton - 300pcs',
      cartonBarcode: '19348045026400',
      referenceQty: 3,
    },
    {
      code: 'KRC500',
      commercialSkuId: '98a9ca25-5212-4527-95db-dc8c6556818a',
      reconcileCommandId: '63a76d0b-dc00-4a7c-bf6f-d52d18eabe23',
      physicalName: '500ml Kraft Board Takeaway Base Carton - 300pcs',
      surveyProductName: '500ml Kraft Board Takeaway Base Carton - 300pcs',
      commercialName: '500ml Kraft Board Takeaway Base Carton - 300pcs',
      cartonBarcode: '(01)19348045026301',
      referenceQty: 2,
    },
    {
      code: 'Q404S0001',
      commercialSkuId: 'b47f9e60-695d-415a-9d92-f7898128258c',
      reconcileCommandId: '28227a5a-1f14-400d-831f-6883fe5f92c2',
      physicalName: '9inch White Cake Box with Window 240x240x120mm - Pack of 100pcs',
      surveyProductName: '9inch White Cake Box with Window 240x240x120mm - Pack of 100pcs',
      commercialName: '9inch White Cake Box with Window 240x240x120mm - Pack of 100pcs',
      cartonBarcode: '19310707018139',
      referenceQty: 2,
    },
    {
      code: 'SB32BOX',
      commercialSkuId: 'fb02055e-656d-448b-a1b5-2897cace0a09',
      reconcileCommandId: '49faf34e-5731-4a6f-aa74-325cd745e743',
      physicalName: '32oz - 940ml Natural Plant Sugarcane Food Bowl - 125pcs',
      surveyProductName: '32oz - 940ml Natural Plant Sugarcane Food Bowl - 125pcs',
      commercialName: '32oz - 940ml Natural Plant Sugarcane Food Bowl - 125pcs',
      cartonBarcode: '19348045022860',
      referenceQty: 2,
    },
    {
      code: 'Q-500',
      commercialSkuId: 'ba3acca8-471a-4cb7-838d-ac76d8964780',
      reconcileCommandId: '8c8b5149-7918-4a49-b46a-069f98809604',
      physicalName: '500ml Clear Tumbler BioCup',
      surveyProductName: '500ml Clear Tumbler BioCup',
      commercialName: '500ml Clear Tumbler BioCup - 1000pcs',
      cartonBarcode: '19344062035265',
      referenceQty: 1,
    },
    {
      code: 'SB24/32/40SLBOX',
      commercialSkuId: '123b19b8-652f-4159-8ead-b952a1043317',
      reconcileCommandId: '27615c80-6a3b-459d-8dec-04b49be3ab8f',
      physicalName: '800-1,180ml | 24-40oz Natural Sugarcane Plant Lids - 125pcs',
      surveyProductName: '800-1,180ml | 24-40oz Natural Sugarcane Plant Lids - 125pcs',
      commercialName: '800-1,180ml | 24-40oz Natural Sugarcane Plant Lids - 125pcs',
      cartonBarcode: '19348045024383',
      referenceQty: 1,
    },
    {
      code: 'CC832F',
      commercialSkuId: '6cd35ac2-c69b-4231-84ba-ac86b938e41a',
      reconcileCommandId: '8e4f839e-4f46-46cd-8763-809c68ae17f2',
      physicalName: '4-Cup Egg Tray (Non Bio) - 300pcs',
      surveyProductName: '4-Cup Egg Tray (Non Bio) - 300pcs',
      commercialName: '4-Cup Egg Tray (Non Bio) - 300pcs',
      cartonBarcode: '19348045037963',
      referenceQty: 0,
    },
  ],
} as const;

export type BatchNext5Candidate = typeof ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.candidates[number];

export type BatchNext5QueueEvidence = {
  candidate: BatchNext5Candidate;
  row: BarcodeSurveyReconciliationRow;
  alreadyDrafted: boolean;
};

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function exactQueueMatches(rows: BarcodeSurveyReconciliationRow[], candidate: BatchNext5Candidate) {
  return rows.filter((item) =>
    normalized(item.skuContext) === candidate.code
    && item.cartonBarcode === candidate.cartonBarcode
  );
}

export function validateBatchNext5CandidateRow(
  candidate: BatchNext5Candidate,
  row: BarcodeSurveyReconciliationRow,
  allowExistingDrafts: boolean,
): BatchNext5QueueEvidence {
  const alreadyDrafted = row.queueStatus === 'DRAFT_CREATED'
    && row.reconciliationStatus === 'DRAFTED'
    && Boolean(row.reconciliationId)
    && Boolean(row.productIdentityObservationId);

  if (normalized(row.skuContext) !== candidate.code || row.cartonBarcode !== candidate.cartonBarcode) {
    throw new Error(`${candidate.code}: resolved Survey row no longer matches the frozen SKU + carton barcode.`);
  }
  if (row.queueStatus !== 'READY_TO_RECONCILE' && !(allowExistingDrafts && alreadyDrafted)) {
    throw new Error(`${candidate.code}: queue drifted to ${row.queueStatus}; stop.`);
  }
  if (row.commercialMatchCount !== 1 || row.commercialSkuId !== candidate.commercialSkuId) {
    throw new Error(`${candidate.code}: Commercial identity no longer matches the frozen unique target.`);
  }
  if (normalized(row.commercialSkuCode) !== candidate.code) {
    throw new Error(`${candidate.code}: canonical Commercial code drifted to ${row.commercialSkuCode ?? 'NULL'}.`);
  }
  if (row.commercialName !== candidate.commercialName || row.skuProductName !== candidate.surveyProductName) {
    throw new Error(`${candidate.code}: frozen Commercial / Survey display name drifted.`);
  }
  if (row.evidenceSource !== 'OBSERVED_NOW') {
    throw new Error(`${candidate.code}: direct physical evidence is no longer OBSERVED_NOW.`);
  }
  if (!['SCANNED', 'NO_SEPARATE_BARCODE'].includes(row.sleeveStatus)) {
    throw new Error(`${candidate.code}: physical package verification drifted to ${row.sleeveStatus}.`);
  }
  if (row.sleeveStatus === 'SCANNED' && !row.sleeveBarcode) {
    throw new Error(`${candidate.code}: SCANNED sleeve evidence has no barcode.`);
  }
  if (row.existingPhysicalSkuCode) {
    throw new Error(`${candidate.code}: carton barcode already has a published Physical SKU owner; stop.`);
  }
  if (!alreadyDrafted && (row.reconciliationId || row.productIdentityObservationId || row.reconciliationStatus)) {
    throw new Error(`${candidate.code}: reconciliation state is inconsistent with READY_TO_RECONCILE.`);
  }
  return { candidate, row, alreadyDrafted };
}

function isHarmlessHistoricalInsufficient(row: BarcodeSurveyReconciliationRow) {
  return row.queueStatus === 'INSUFFICIENT_EVIDENCE'
    && row.evidenceSource !== 'OBSERVED_NOW'
    && row.reconciliationId === null
    && row.productIdentityObservationId === null
    && row.reconciliationStatus === null
    && row.existingPhysicalSkuCode === null;
}

export function validateBatchNext5Queue(
  rows: BarcodeSurveyReconciliationRow[],
  allowExistingDrafts: boolean,
): BatchNext5QueueEvidence[] {
  const target = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET;
  const result = target.candidates.map((candidate) => {
    const matches = exactQueueMatches(rows, candidate);
    const eligible = matches.filter((row) =>
      row.queueStatus === 'READY_TO_RECONCILE'
      || (allowExistingDrafts && row.queueStatus === 'DRAFT_CREATED'),
    );
    const blockers = matches.filter((row) =>
      !eligible.includes(row) && !isHarmlessHistoricalInsufficient(row),
    );

    if (blockers.length !== 0) {
      throw new Error(
        `${candidate.code}: exact SKU + carton barcode has ${blockers.length} non-historical blocking queue row(s); stop.`,
      );
    }
    if (eligible.length !== 1) {
      throw new Error(
        `${candidate.code}: authenticated queue must resolve to exactly one executable READY/DRAFT row after excluding harmless historical insufficient evidence; found ${eligible.length} executable row(s) across ${matches.length} exact match(es).`,
      );
    }
    return validateBatchNext5CandidateRow(candidate, eligible[0], allowExistingDrafts);
  });

  const distinctCommercial = new Set(result.map((item) => item.candidate.commercialSkuId));
  const distinctSurvey = new Set(result.map((item) => item.row.surveyObservationId));
  if (distinctCommercial.size !== target.candidates.length || distinctSurvey.size !== target.candidates.length) {
    throw new Error('Resolved Batch Next 5 scope is not eight distinct Commercial SKUs / Survey observations.');
  }
  return result;
}

export function buildBatchNext5StartInput() {
  return {
    batchName: ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.batchName,
    commercialSkuIds: ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.candidates.map((candidate) => candidate.commercialSkuId),
    commandId: ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.startCommandId,
  };
}

export function buildBatchNext5ReconcileInput(
  candidate: BatchNext5Candidate,
  row: BarcodeSurveyReconciliationRow,
  batchId: string,
  confirmed: boolean,
) {
  if (!confirmed) throw new Error(`${candidate.code}: explicit Owner/Admin confirmation is required.`);
  validateBatchNext5CandidateRow(candidate, row, false);

  return {
    surveyObservationId: row.surveyObservationId,
    batchId,
    commandId: candidate.reconcileCommandId,
    physicalSkuCode: candidate.code,
    physicalName: candidate.physicalName,
    brand: undefined,
    supplierName: undefined,
    familyCode: candidate.code,
    familyName: candidate.physicalName,
    packageLevel: 'CARTON' as const,
    unitsInBaseUnit: 1,
    substitutionPolicy: 'PROHIBITED' as const,
    isPreferred: true,
    note: `ECOFLOW-328-BATCH-NEXT5 · ${candidate.code} · authenticated READY_TO_RECONCILE OBSERVED_NOW evidence resolved by exact SKU + carton barcode; CARTON × 1 is the Product Identity operational base and does not assert pieces/carton or sleeve conversion; DRAFT only.`,
  };
}
