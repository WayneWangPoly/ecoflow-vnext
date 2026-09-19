import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET,
  buildBatchNext5ReconcileInput,
  buildBatchNext5StartInput,
  validateBatchNext5Queue,
} from '../src/features/productIdentity/batchNext5DraftOnlyContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNext5DraftOnlyCarrier.tsx', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNext5DraftResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');

function queueRow(candidate, index, patch = {}) {
  return {
    surveyObservationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sourceObservationId: null,
    skuContext: candidate.code,
    skuProductName: candidate.surveyProductName,
    cartonBarcode: candidate.cartonBarcode,
    sleeveStatus: 'NO_SEPARATE_BARCODE',
    sleeveBarcode: null,
    evidenceSource: 'OBSERVED_NOW',
    surveyNote: null,
    surveyOccurredAt: '2026-09-19T00:00:00Z',
    commercialMatchCount: 1,
    commercialSkuId: candidate.commercialSkuId,
    commercialSkuCode: candidate.code,
    commercialName: candidate.commercialName,
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

test('Batch Next 5 freezes the final eight evidence-backed READY cohort', () => {
  const target = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET;
  assert.equal(target.protectedMainSha, 'ee9120437fadd2f2f96b496f5cbe448494034d57');
  assert.equal(target.batchName, 'ECOFLOW-328 Batch Next 5 DRAFT-only');
  assert.equal(target.startCommandId, '6e0520a2-42bb-4caa-be57-13978326f4ed');
  assert.equal(target.referenceBatchId, '4cdb85d3-06d8-44bf-96bb-93660e10c3c9');
  assert.deepEqual(target.authenticatedCensus, {
    ready: 8,
    needsIdentity: 2,
    conflict: 2,
    insufficient: 77,
    drafted: 0,
    published: 39,
  });
  assert.equal(target.candidates.length, 8);
  assert.equal(target.totalReferenceQty, 14);
  assert.equal(new Set(target.candidates.map((x) => x.code)).size, 8);
  assert.equal(new Set(target.candidates.map((x) => x.commercialSkuId)).size, 8);
  assert.equal(new Set(target.candidates.map((x) => x.reconcileCommandId)).size, 8);
  assert.equal(target.candidates.reduce((sum, x) => sum + x.referenceQty, 0), 14);
  assert.deepEqual(target.candidates.map((x) => x.code), [
    'PSJALLBLACK','WRC750','KRC500','Q404S0001',
    'SB32BOX','Q-500','SB24/32/40SLBOX','CC832F',
  ]);
  assert.deepEqual(target.candidates.map((x) => x.referenceQty), [3,3,2,2,2,1,1,0]);
  const q500 = target.candidates.find((x) => x.code === 'Q-500');
  assert.equal(q500?.physicalName, '500ml Clear Tumbler BioCup');
  assert.equal(q500?.surveyProductName, '500ml Clear Tumbler BioCup');
  assert.equal(q500?.commercialName, '500ml Clear Tumbler BioCup - 1000pcs');
});

test('authenticated queue resolution ignores only harmless historical insufficient rows and keeps current evidence fail-closed', () => {
  const target = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET;
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

  const evidence = validateBatchNext5Queue([...rows, legacyIc4, legacyKsb16], false);
  assert.equal(evidence.length, 8);
  assert.equal(new Set(evidence.map((x) => x.row.surveyObservationId)).size, 8);
  assert.deepEqual(evidence.map((x) => x.candidate.code), target.candidates.map((x) => x.code));
  assert.equal(evidence[0].row.surveyObservationId, rows[0].surveyObservationId);
  assert.equal(evidence[7].row.surveyObservationId, rows[7].surveyObservationId);

  assert.throws(
    () => validateBatchNext5Queue([...rows, { ...rows[0], surveyObservationId: 'duplicate-ready-observation' }], false),
    /found 2 executable row\(s\)/,
  );

  assert.throws(
    () => validateBatchNext5Queue([...rows, queueRow(target.candidates[0], 52, {
      queueStatus: 'INSUFFICIENT_EVIDENCE',
      evidenceSource: 'OBSERVED_NOW',
    })], false),
    /non-historical blocking queue row/,
  );

  assert.throws(
    () => validateBatchNext5Queue([...rows, queueRow(target.candidates[0], 53, {
      queueStatus: 'DUPLICATE_CONFLICT',
      evidenceSource: 'OBSERVED_NOW',
    })], false),
    /non-historical blocking queue row/,
  );

  assert.throws(
    () => validateBatchNext5Queue(rows.map((row, i) => i === 0 ? { ...row, queueStatus: 'NEEDS_IDENTITY_CONFIRMATION' } : row), false),
    /non-historical blocking queue row/,
  );
  assert.throws(
    () => validateBatchNext5Queue(rows.map((row, i) => i === 0 ? { ...row, evidenceSource: 'LEGACY' } : row), false),
    /OBSERVED_NOW/,
  );
  assert.throws(
    () => validateBatchNext5Queue(rows.map((row, i) => i === 0 ? { ...row, sleeveStatus: 'UNKNOWN' } : row), false),
    /physical package verification drifted/,
  );
  assert.throws(
    () => validateBatchNext5Queue(rows.map((row, i) => i === 0 ? { ...row, existingPhysicalSkuCode: 'OTHER' } : row), false),
    /published Physical SKU owner/,
  );
});

test('resume accepts one exact DRAFT_CREATED row plus harmless historical insufficient evidence', () => {
  const target = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET;
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

  const evidence = validateBatchNext5Queue([...rows, legacy], true);
  assert.equal(evidence[0].alreadyDrafted, true);
  assert.equal(evidence[0].row.surveyObservationId, rows[0].surveyObservationId);
});

test('start input is exactly one bounded eight-SKU scope with frozen unused command', () => {
  const input = buildBatchNext5StartInput();
  assert.equal(input.batchName, ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.batchName);
  assert.equal(input.commandId, ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.startCommandId);
  assert.deepEqual(input.commercialSkuIds, ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.candidates.map((x) => x.commercialSkuId));
});

test('reconcile input binds the runtime authenticated Survey ID and remains CARTON x1 / PROHIBITED / preferred', () => {
  const candidate = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET.candidates[0];
  const row = queueRow(candidate, 0);
  assert.throws(
    () => buildBatchNext5ReconcileInput(candidate, row, '11111111-1111-4111-8111-111111111111', false),
    /explicit Owner\/Admin confirmation/,
  );
  const input = buildBatchNext5ReconcileInput(candidate, row, '11111111-1111-4111-8111-111111111111', true);
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
  assert.match(carrier, /readBatchNext5ResumeEvidence\(batchId\)/);
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

test('completed NEXT5 DRAFT carrier remains archived when P3 becomes active, while DRAFT contract stays CI-gated', () => {
  assert.doesNotMatch(wrapper, /lazy\(\(\) => import\('\.\/BatchNext5DraftOnlyCarrier'\)/);
  assert.doesNotMatch(wrapper, /<BatchNext5DraftOnlyCarrier/);
  assert.doesNotMatch(wrapper, /lazy\(\(\) => import\('\.\/BatchNext5P2ResumeSubmitCarrier'\)/);
  assert.doesNotMatch(wrapper, /<BatchNext5P2ResumeSubmitCarrier/);
  assert.match(wrapper, /lazy\(\(\) => import\('\.\/BatchNext5P3ResumePublishCarrier'\)/);
  assert.match(wrapper, /<BatchNext5P3ResumePublishCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next4-draft-carrier-contract\.test\.mjs/);
  assert.match(workflow, /BatchNext5DraftOnlyCarrier\.tsx/);
  assert.match(workflow, /batchNext5DraftOnlyContract\.ts/);
  assert.match(workflow, /batchNext5DraftResumeEvidence\.ts/);
});
