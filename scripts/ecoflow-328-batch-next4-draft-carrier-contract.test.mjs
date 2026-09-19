import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET,
  buildBatchNext4ReconcileInput,
  buildBatchNext4StartInput,
  validateBatchNext4Queue,
} from '../src/features/productIdentity/batchNext4DraftOnlyContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNext4DraftOnlyCarrier.tsx', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNext4DraftResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');

function queueRow(candidate, index, patch = {}) {
  return {
    surveyObservationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sourceObservationId: null,
    skuContext: candidate.code,
    skuProductName: candidate.physicalName,
    cartonBarcode: candidate.cartonBarcode,
    sleeveStatus: 'NO_SEPARATE_BARCODE',
    sleeveBarcode: null,
    evidenceSource: 'OBSERVED_NOW',
    surveyNote: null,
    surveyOccurredAt: '2026-09-19T00:00:00Z',
    commercialMatchCount: 1,
    commercialSkuId: candidate.commercialSkuId,
    commercialSkuCode: candidate.code,
    commercialName: candidate.physicalName,
    ordermentumSku: candidate.code,
    existingPhysicalSkuCode: null,
    queueStatus: 'READY_TO_RECONCILE',
    queueReason: 'Trusted physical evidence is ready to create a reviewable Product Identity draft.',
    reconciliationId: null,
    productIdentityObservationId: null,
    reconciliationStatus: null,
    reconciledAt: null,
    ...patch,
  };
}

test('Batch Next 4 freezes the top ten authenticated READY x reference-quantity cohort', () => {
  const target = ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET;
  assert.equal(target.protectedMainSha, 'bdf3a64db1e07d633b0afbd5f7c81f5af1b43eb8');
  assert.equal(target.batchName, 'ECOFLOW-328 Batch Next 4 DRAFT-only');
  assert.equal(target.startCommandId, 'f2bf897d-a1e6-54e2-909a-c58204960210');
  assert.equal(target.referenceBatchId, '4cdb85d3-06d8-44bf-96bb-93660e10c3c9');
  assert.deepEqual(target.authenticatedCensus, {
    ready: 18,
    needsIdentity: 2,
    conflict: 2,
    insufficient: 77,
    drafted: 0,
    published: 29,
  });
  assert.equal(target.candidates.length, 10);
  assert.equal(target.totalReferenceQty, 94);
  assert.equal(new Set(target.candidates.map((x) => x.code)).size, 10);
  assert.equal(new Set(target.candidates.map((x) => x.commercialSkuId)).size, 10);
  assert.equal(new Set(target.candidates.map((x) => x.reconcileCommandId)).size, 10);
  assert.equal(target.candidates.reduce((sum, x) => sum + x.referenceQty, 0), 94);
  assert.deepEqual(target.candidates.map((x) => x.code), [
    'IC4BOX','CCEA12-90','CCSW12-80','BSB42LPLA','KSB25',
    'PCB11','KRC650','KSB16','Q514S0001','KSB32',
  ]);
  assert.deepEqual(target.candidates.map((x) => x.referenceQty), [15,14,13,12,12,11,6,4,4,3]);
});

test('authenticated queue resolution ignores only harmless historical insufficient rows and keeps current evidence fail-closed', () => {
  const target = ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET;
  const rows = target.candidates.map((candidate, index) => queueRow(candidate, index));

  const legacyIc4 = queueRow(target.candidates[0], 50, {
    queueStatus: 'INSUFFICIENT_EVIDENCE',
    evidenceSource: 'LEGACY',
    queueReason: 'Only direct OBSERVED_NOW physical evidence can seed a Product Identity draft.',
  });
  const legacyKsb16 = queueRow(target.candidates[7], 51, {
    queueStatus: 'INSUFFICIENT_EVIDENCE',
    evidenceSource: 'IMPORTED_HISTORY',
    queueReason: 'Only direct OBSERVED_NOW physical evidence can seed a Product Identity draft.',
  });

  const evidence = validateBatchNext4Queue([...rows, legacyIc4, legacyKsb16], false);
  assert.equal(evidence.length, 10);
  assert.equal(new Set(evidence.map((x) => x.row.surveyObservationId)).size, 10);
  assert.deepEqual(evidence.map((x) => x.candidate.code), target.candidates.map((x) => x.code));
  assert.equal(evidence[0].row.surveyObservationId, rows[0].surveyObservationId);
  assert.equal(evidence[7].row.surveyObservationId, rows[7].surveyObservationId);

  assert.throws(
    () => validateBatchNext4Queue([...rows, { ...rows[0], surveyObservationId: 'duplicate-ready-observation' }], false),
    /found 2 executable row\(s\)/,
  );

  assert.throws(
    () => validateBatchNext4Queue([...rows, queueRow(target.candidates[0], 52, {
      queueStatus: 'INSUFFICIENT_EVIDENCE',
      evidenceSource: 'OBSERVED_NOW',
    })], false),
    /non-historical blocking queue row/,
  );

  assert.throws(
    () => validateBatchNext4Queue([...rows, queueRow(target.candidates[0], 53, {
      queueStatus: 'DUPLICATE_CONFLICT',
      evidenceSource: 'OBSERVED_NOW',
    })], false),
    /non-historical blocking queue row/,
  );

  assert.throws(
    () => validateBatchNext4Queue(rows.map((row, i) => i === 0 ? { ...row, queueStatus: 'NEEDS_IDENTITY_CONFIRMATION' } : row), false),
    /non-historical blocking queue row/,
  );
  assert.throws(
    () => validateBatchNext4Queue(rows.map((row, i) => i === 0 ? { ...row, evidenceSource: 'LEGACY' } : row), false),
    /OBSERVED_NOW/,
  );
  assert.throws(
    () => validateBatchNext4Queue(rows.map((row, i) => i === 0 ? { ...row, sleeveStatus: 'UNKNOWN' } : row), false),
    /physical package verification drifted/,
  );
  assert.throws(
    () => validateBatchNext4Queue(rows.map((row, i) => i === 0 ? { ...row, existingPhysicalSkuCode: 'OTHER' } : row), false),
    /published Physical SKU owner/,
  );
});

test('resume accepts one exact DRAFT_CREATED row plus harmless historical insufficient evidence', () => {
  const target = ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET;
  const rows = target.candidates.map((candidate, index) => queueRow(candidate, index));
  rows[0] = queueRow(target.candidates[0], 0, {
    queueStatus: 'DRAFT_CREATED',
    reconciliationId: '11111111-1111-4111-8111-111111111111',
    productIdentityObservationId: '22222222-2222-4222-8222-222222222222',
    reconciliationStatus: 'DRAFTED',
  });
  const legacy = queueRow(target.candidates[0], 60, {
    queueStatus: 'INSUFFICIENT_EVIDENCE',
    evidenceSource: 'LEGACY',
  });

  const evidence = validateBatchNext4Queue([...rows, legacy], true);
  assert.equal(evidence[0].alreadyDrafted, true);
  assert.equal(evidence[0].row.surveyObservationId, rows[0].surveyObservationId);
});

test('start input is exactly one bounded ten-SKU scope with frozen unused command', () => {
  const input = buildBatchNext4StartInput();
  assert.equal(input.batchName, ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.batchName);
  assert.equal(input.commandId, ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.startCommandId);
  assert.deepEqual(input.commercialSkuIds, ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.candidates.map((x) => x.commercialSkuId));
});

test('reconcile input binds the runtime authenticated Survey ID and remains CARTON x1 / PROHIBITED / preferred', () => {
  const candidate = ECOFLOW_328_BATCH_NEXT4_DRAFT_TARGET.candidates[0];
  const row = queueRow(candidate, 0);
  assert.throws(
    () => buildBatchNext4ReconcileInput(candidate, row, '11111111-1111-4111-8111-111111111111', false),
    /explicit Owner\/Admin confirmation/,
  );
  const input = buildBatchNext4ReconcileInput(candidate, row, '11111111-1111-4111-8111-111111111111', true);
  assert.equal(input.surveyObservationId, row.surveyObservationId);
  assert.equal(input.commandId, candidate.reconcileCommandId);
  assert.equal(input.physicalSkuCode, candidate.code);
  assert.equal(input.physicalName, candidate.physicalName);
  assert.equal(input.familyCode, candidate.code);
  assert.equal(input.familyName, candidate.physicalName);
  assert.equal(input.packageLevel, 'CARTON');
  assert.equal(input.unitsInBaseUnit, 1);
  assert.equal(input.substitutionPolicy, 'PROHIBITED');
  assert.equal(input.isPreferred, true);
  assert.equal(input.brand, undefined);
  assert.equal(input.supplierName, undefined);
  assert.match(input.note, /does not assert pieces\/carton or sleeve conversion/);
});

test('carrier rereads protected queue before every DRAFT write and fail-closes ambiguous command boundaries', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(carrier, /readBarcodeSurveyReconciliationQueue\(500\)/);
  assert.match(carrier, /resolved Survey observation ID changed after preflight/);
  assert.match(carrier, /readBatchNext4ResumeEvidence\(batchId\)/);
  assert.match(carrier, /server already contains the exact frozen DRAFT provenance/);
  assert.match(carrier, /START may have crossed the command boundary/);
  assert.match(carrier, /Reconciliation may have crossed the command boundary/);
  assert.match(carrier, /Do not retry this row; rerun authenticated preflight\/resume/);
  assert.equal((carrier.match(/startBoundedProductIdentityBatch\(/g) || []).length, 1);
  assert.equal((carrier.match(/reconcileBarcodeSurveyObservation\(/g) || []).length, 1);
  assert.doesNotMatch(carrier, /submitProductIdentityBatch|publishProductIdentityBatch|retireProductIdentityBarcode|reopenProductIdentityBatch/);
  assert.doesNotMatch(carrier, /service[_-]?role|access[_-]?token|refresh[_-]?token|jwt/i);
  assert.doesNotMatch(carrier, /ecoflow_inventory_movements|ecoflow_warehouse_movements|ecoflow_warehouse_location_items|inventory_balances|stock_movements|approveStocktake|record[A-Za-z]*Location|api\.ordermentum\.com|api\.unleashedsoftware\.com|fetch\(/i);
});

test('resume evidence is three authenticated SELECT-only reads bound to exact batch provenance', () => {
  assert.ok(evidence.includes(".from('ecoflow_product_identity_batches')"));
  assert.ok(evidence.includes(".from('ecoflow_product_identity_batch_scope_items')"));
  assert.ok(evidence.includes(".from('ecoflow_barcode_survey_identity_reconciliations')"));
  assert.equal((evidence.match(/\.select\(/g) || []).length, 3);
  assert.doesNotMatch(evidence, /\.(?:insert|update|delete|upsert|rpc)\s*\(/);
  assert.doesNotMatch(evidence, /service[_-]?role|access[_-]?token|refresh[_-]?token|jwt/i);
});

test('completed NEXT4 DRAFT carrier remains archived when P3 becomes active, while DRAFT contract stays CI-gated', () => {
  assert.doesNotMatch(wrapper, /lazy\(\(\) => import\('\.\/BatchNext4DraftOnlyCarrier'\)/);
  assert.doesNotMatch(wrapper, /<BatchNext4DraftOnlyCarrier/);
  assert.doesNotMatch(wrapper, /lazy\(\(\) => import\('\.\/BatchNext4P2ResumeSubmitCarrier'\)/);
  assert.doesNotMatch(wrapper, /<BatchNext4P2ResumeSubmitCarrier/);
  assert.match(wrapper, /lazy\(\(\) => import\('\.\/BatchNext4P3ResumePublishCarrier'\)/);
  assert.match(wrapper, /<BatchNext4P3ResumePublishCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next4-draft-carrier-contract\.test\.mjs/);
  assert.match(workflow, /BatchNext4DraftOnlyCarrier\.tsx/);
  assert.match(workflow, /batchNext4DraftOnlyContract\.ts/);
  assert.match(workflow, /batchNext4DraftResumeEvidence\.ts/);
});
