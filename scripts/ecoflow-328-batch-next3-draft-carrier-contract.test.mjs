import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET,
  buildBatchNext3ReconcileInput,
  buildBatchNext3StartInput,
} from '../src/features/productIdentity/batchNext3DraftOnlyContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNext3DraftOnlyCarrier.tsx', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNext3DraftResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');

test('Batch Next 3 freezes ten distinct high-impact Survey candidates', () => {
  const target = ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET;
  assert.equal(target.protectedMainSha, 'b61a3e8839de188dfab6d909d3b552589b742cc5');
  assert.equal(target.batchName, 'ECOFLOW-328 Batch Next 3 DRAFT-only');
  assert.equal(target.startCommandId, '8d1ecf05-6ebd-5661-aaff-b0e82b9b2e59');
  assert.equal(target.referenceBatchId, '4cdb85d3-06d8-44bf-96bb-93660e10c3c9');
  assert.equal(target.candidates.length, 10);
  assert.equal(target.totalReferenceQty, 401);
  assert.equal(new Set(target.candidates.map((x) => x.code)).size, 10);
  assert.equal(new Set(target.candidates.map((x) => x.commercialSkuId)).size, 10);
  assert.equal(new Set(target.candidates.map((x) => x.surveyObservationId)).size, 10);
  assert.equal(new Set(target.candidates.map((x) => x.reconcileCommandId)).size, 10);
  assert.equal(target.candidates.reduce((sum, x) => sum + x.referenceQty, 0), 401);
  assert.deepEqual(target.candidates.map((x) => x.code), [
    'NPK1LW','NPK2LK','CCEB16-90','CCSB12-80','CCSKBM12-80',
    'CCSB16-90','CCSB8-90','CCLWPLA-62','CCSPW6-80','IC5BBOX',
  ]);
  assert.deepEqual(target.candidates.map((x) => x.reconcileCommandId), [
    '9e2dc95d-b60a-5c2a-8eb0-af63bb9bcd43',
    'f3741782-edef-58e3-bf7b-09a438f8ed5e',
    '3a87bfdd-86b1-5f76-a26e-f7c862f451c7',
    'c23fed38-16aa-5ee1-834f-799d6ce2e4b1',
    'a61fdfc2-efb5-54e3-a62b-75d77ade8bf0',
    'd14a41d9-ea69-5332-9d44-007600ca300f',
    '647e65a8-e401-5d0d-b2bc-61272dd8e6e3',
    'c4fd7c00-7598-5b4b-8171-de8bf54cf483',
    'b91632ca-8d17-5339-81d6-ba376188f3b0',
    '2c6e667d-2064-5180-be71-4500431cfb6d',
  ]);
  assert.deepEqual(target.candidates.map((x) => x.cartonBarcode), [
    '757953135845','757953135876','757953138709','757953138624','757953139676',
    '757953138648','757953138617','757953139737','757953135494','19348045026554',
  ]);
});

test('start input is exactly one bounded ten-SKU scope', () => {
  const input = buildBatchNext3StartInput();
  assert.equal(input.batchName, ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET.batchName);
  assert.equal(input.commandId, ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET.startCommandId);
  assert.deepEqual(input.commercialSkuIds, ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET.candidates.map((x) => x.commercialSkuId));
});

test('reconcile input is frozen CARTON x1 / PROHIBITED / preferred and requires explicit confirmation', () => {
  const candidate = ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET.candidates[0];
  assert.throws(
    () => buildBatchNext3ReconcileInput(candidate, '11111111-1111-4111-8111-111111111111', false),
    /explicit Owner\/Admin confirmation/,
  );
  const input = buildBatchNext3ReconcileInput(candidate, '11111111-1111-4111-8111-111111111111', true);
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

test('carrier is DRAFT-only and supports exact DRAFT resume after refresh', () => {
  assert.match(carrier, /readBatchNext3ResumeEvidence/);
  assert.match(carrier, /batch\.start_command_id !== target\.startCommandId/);
  assert.match(carrier, /batch\.submit_command_id !== null/);
  assert.match(carrier, /batch\.publish_command_id !== null/);
  assert.match(carrier, /Existing Product Identity batch .* is SUBMITTED/);
  assert.match(carrier, /Preflight PASS \/ RESUME/);
  assert.match(carrier, /Completed DRAFTs: \{completeCount\}\/10/);
  assert.equal((carrier.match(/startBoundedProductIdentityBatch\(/g) || []).length, 1);
  assert.equal((carrier.match(/reconcileBarcodeSurveyObservation\(/g) || []).length, 1);
  assert.doesNotMatch(carrier, /submitProductIdentityBatch|publishProductIdentityBatch|retireProductIdentityBarcode|reopenProductIdentityBatch/);
  assert.doesNotMatch(carrier, /ecoflow_inventory_movements|ecoflow_warehouse_movements|ecoflow_warehouse_location_items|inventory_balances|stock_movements|approveStocktake|record[A-Za-z]*Location|api\.ordermentum\.com|api\.unleashedsoftware\.com|fetch\(/i);
});

test('resume evidence is SELECT-only and bound to exact batch + scope', () => {
  assert.ok(evidence.includes(".from('ecoflow_product_identity_batches')"));
  assert.ok(evidence.includes(".from('ecoflow_product_identity_batch_scope_items')"));
  assert.equal((evidence.match(/\.select\(/g) || []).length, 2);
  assert.doesNotMatch(evidence, /\.(?:insert|update|delete|upsert|rpc)\s*\(/);
  assert.doesNotMatch(evidence, /service[_-]?role|access[_-]?token|refresh[_-]?token|jwt/i);
});

test('native surface lazy-loads Batch Next 3 and CI gates it', () => {
  assert.match(wrapper, /lazy\(\(\) => import\('\.\/BatchNext3DraftOnlyCarrier'\)/);
  assert.match(wrapper, /<BatchNext3DraftOnlyCarrier/);
  assert.match(wrapper, /<Suspense fallback=\{null\}>/);
  assert.match(workflow, /ecoflow-328-batch-next2-draft-carrier-contract\.test\.mjs/);
  assert.match(workflow, /BatchNext3DraftOnlyCarrier\.tsx/);
  assert.match(workflow, /batchNext3DraftOnlyContract\.ts/);
  assert.match(workflow, /batchNext3DraftResumeEvidence\.ts/);
});
