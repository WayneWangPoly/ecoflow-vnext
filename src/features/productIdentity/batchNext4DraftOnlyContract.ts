import type { BarcodeSurveyReconciliationRow } from '@/data/repositories/barcodeSurveyReconciliation';

export const ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET = {
  protectedMainSha: 'bdf3a64db1e07d633b0afbd5f7c81f5af1b43eb8',
  batchName: 'ECOFLOW-328 Batch Next 4 DRAFT-only',
  startCommandId: 'f2bf897d-a1e6-54e2-909a-c58204960210',
  referenceBatchId: '4cdb85d3-06d8-44bf-96bb-93660e10c3c9',
  authenticatedCensus: {
    ready: 18,
    needsIdentity: 2,
    conflict: 2,
    insufficient: 77,
    drafted: 0,
    published: 29,
  },
  totalReferenceQty: 94,
  candidates: [
    {
      code: 'IC4BOX',
      commercialSkuId: '7eb93774-b496-43b4-acac-c5d2bafbc864',
      reconcileCommandId: 'c531d642-5f37-584a-9726-7c8a660463a8',
      physicalName: '4oz Ice-cream Cup - 50pcs',
      cartonBarcode: '19348045021177',
      referenceQty: 15,
    },
    {
      code: 'CCEA12-90',
      commercialSkuId: '72649e8e-776d-4ebb-b788-3e9942b83319',
      reconcileCommandId: '4e621911-eefb-58d9-b855-4e119fbd39cb',
      physicalName: '(90mm) 12oz Double Wall Art Series - 1000pcs',
      cartonBarcode: '757953138419',
      referenceQty: 14,
    },
    {
      code: 'CCSW12-80',
      commercialSkuId: 'd1d0baf6-9629-48f2-9a99-df3ae61566a2',
      reconcileCommandId: '8866c1c7-285b-5805-a5cd-1130ae1c3caf',
      physicalName: '(80mm) 12oz Compostable White',
      cartonBarcode: '757953139782',
      referenceQty: 13,
    },
    {
      code: 'BSB42LPLA',
      commercialSkuId: '033e87c1-49ae-44b9-b78d-3a07c35ac6cb',
      reconcileCommandId: '24f9ba97-0962-5256-8898-00716dcd49ec',
      physicalName: 'Flat PLA Lids Fit 42oz 1300ml - 300 pcs',
      cartonBarcode: '19348045026820',
      referenceQty: 12,
    },
    {
      code: 'KSB25',
      commercialSkuId: '7b91588d-2b82-4bcf-93ff-4540aab5fb0b',
      reconcileCommandId: '995a3b99-ec17-5f92-a656-f3cd1ed38213',
      physicalName: '25oz - 750ml Small Deli Bowl Kraft - 300pcs',
      cartonBarcode: '19348045021108',
      referenceQty: 12,
    },
    {
      code: 'PCB11',
      commercialSkuId: 'efe3e003-1925-40b8-956f-bbaf81a96edb',
      reconcileCommandId: '11c04225-cfcf-57fb-8357-3231bb85ef95',
      physicalName: 'Family Box - 100pcs',
      cartonBarcode: '19348045017828',
      referenceQty: 11,
    },
    {
      code: 'KRC650',
      commercialSkuId: '63b5efb8-6384-40f5-a78f-13c17ebd7bfb',
      reconcileCommandId: '8bda6430-f171-566c-8381-92573809fab1',
      physicalName: '650ml Kraft Board Takeaway Base Carton - 300pcs',
      cartonBarcode: '(01)19348045026318',
      referenceQty: 6,
    },
    {
      code: 'KSB16',
      commercialSkuId: '6d78bf81-613a-46da-bab9-d379b42b11bf',
      reconcileCommandId: '0c81220c-96ce-5f18-baf8-f9d8bf49d221',
      physicalName: '16oz - 500ml Small Deli Bowl Kraft - 300pcs',
      cartonBarcode: '19348045021092',
      referenceQty: 4,
    },
    {
      code: 'Q514S0001',
      commercialSkuId: 'e9c5467c-b454-487e-83b0-4f9ca38a132e',
      reconcileCommandId: '75728192-7264-50c5-b77d-e466031586e2',
      physicalName: '4 Pack Donut Box with Window 8x8x3inch- 200pcs',
      cartonBarcode: '19310707072803',
      referenceQty: 4,
    },
    {
      code: 'KSB32',
      commercialSkuId: '2e5358e4-9eb3-409d-8e52-cdbc133579c8',
      reconcileCommandId: '5b953340-e020-584f-9940-57895656f0fb',
      physicalName: '32oz - 1000ml Small Deli Bowl Kraft - 300pcs',
      cartonBarcode: '19348045021115',
      referenceQty: 3,
    },
  ],
} as const;

export type BatchNext4Candidate = typeof ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.candidates[number];

export type BatchNext4QueueEvidence = {
  candidate: BatchNext4Candidate;
  row: BarcodeSurveyReconciliationRow;
  alreadyDrafted: boolean;
};

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function exactQueueMatches(rows: BarcodeSurveyReconciliationRow[], candidate: BatchNext4Candidate) {
  return rows.filter((item) =>
    normalized(item.skuContext) === candidate.code
    && item.cartonBarcode === candidate.cartonBarcode
  );
}

export function validateBatchNext4CandidateRow(
  candidate: BatchNext4Candidate,
  row: BarcodeSurveyReconciliationRow,
  allowExistingDrafts: boolean,
): BatchNext4QueueEvidence {
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
  if (row.commercialName !== candidate.physicalName || row.skuProductName !== candidate.physicalName) {
    throw new Error(`${candidate.code}: canonical / Survey display name drifted.`);
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

export function validateBatchNext4Queue(
  rows: BarcodeSurveyReconciliationRow[],
  allowExistingDrafts: boolean,
): BatchNext4QueueEvidence[] {
  const target = ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET;
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
    return validateBatchNext4CandidateRow(candidate, eligible[0], allowExistingDrafts);
  });

  const distinctCommercial = new Set(result.map((item) => item.candidate.commercialSkuId));
  const distinctSurvey = new Set(result.map((item) => item.row.surveyObservationId));
  if (distinctCommercial.size !== target.candidates.length || distinctSurvey.size !== target.candidates.length) {
    throw new Error('Resolved Batch Next 4 scope is not ten distinct Commercial SKUs / Survey observations.');
  }
  return result;
}

export function buildBatchNext4StartInput() {
  return {
    batchName: ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.batchName,
    commercialSkuIds: ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.candidates.map((candidate) => candidate.commercialSkuId),
    commandId: ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.startCommandId,
  };
}

export function buildBatchNext4ReconcileInput(
  candidate: BatchNext4Candidate,
  row: BarcodeSurveyReconciliationRow,
  batchId: string,
  confirmed: boolean,
) {
  if (!confirmed) throw new Error(`${candidate.code}: explicit Owner/Admin confirmation is required.`);
  validateBatchNext4CandidateRow(candidate, row, false);

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
    note: `ECOFLOW-328-BATCH-NEXT4 · ${candidate.code} · authenticated READY_TO_RECONCILE OBSERVED_NOW evidence resolved by exact SKU + carton barcode; CARTON × 1 is the Product Identity operational base and does not assert pieces/carton or sleeve conversion; DRAFT only.`,
  };
}
