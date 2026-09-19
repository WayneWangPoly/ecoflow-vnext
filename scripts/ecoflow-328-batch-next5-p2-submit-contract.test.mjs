import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BATCH_NEXT5_P2_TARGET,
  assertBatchNext5P2SubmitAcknowledgement,
  buildBatchNext5P2SubmitInput,
} from '../src/features/productIdentity/batchNext5P2ResumeSubmitContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNext5P2ResumeSubmitCarrier.tsx', 'utf8');
const contract = readFileSync('src/features/productIdentity/batchNext5P2ResumeSubmitContract.ts', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNext5P2ResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');

test('Batch Next 5 P2 target is frozen to exact production DRAFT rev8 and one unused SUBMIT command', () => {
  assert.equal(BATCH_NEXT5_P2_TARGET.protectedMainSha, '71c3a016cdc9e33c0302ea9c9fabecb90bedfcb3');
  assert.equal(BATCH_NEXT5_P2_TARGET.batchId, 'ab01a3b6-04c6-4ce2-b7d1-65d878fb6669');
  assert.equal(BATCH_NEXT5_P2_TARGET.batchName, 'ECOFLOW-328 Batch Next 5 DRAFT-only');
  assert.equal(BATCH_NEXT5_P2_TARGET.expectedRevision, 8);
  assert.equal(BATCH_NEXT5_P2_TARGET.startCommandId, '6e0520a2-42bb-4caa-be57-13978326f4ed');
  assert.equal(BATCH_NEXT5_P2_TARGET.submitCommandId, '29ba6829-d831-4c8c-bf45-f6e79dfb64d6');
  assert.equal(Object.keys(BATCH_NEXT5_P2_TARGET.identities).length, 8);
});

test('SUBMIT input and acknowledgement are exact and revisioned', () => {
  assert.deepEqual(buildBatchNext5P2SubmitInput(), {
    batchId: BATCH_NEXT5_P2_TARGET.batchId,
    expectedRevision: 8,
    commandId: BATCH_NEXT5_P2_TARGET.submitCommandId,
    note: BATCH_NEXT5_P2_TARGET.submitNote,
  });
  assert.doesNotThrow(() => assertBatchNext5P2SubmitAcknowledgement({
    batchId: BATCH_NEXT5_P2_TARGET.batchId,
    batchStatus: 'SUBMITTED',
    revision: 9,
    commandStatus: 'APPLIED',
  }));
  assert.throws(() => assertBatchNext5P2SubmitAcknowledgement({
    batchId: BATCH_NEXT5_P2_TARGET.batchId,
    batchStatus: 'PUBLISHED',
    revision: 10,
    commandStatus: 'APPLIED',
  }));
});

test('contract freezes all eight canonical reconciliation graphs and fail-closes on cardinality drift', () => {
  for (const identity of Object.values(BATCH_NEXT5_P2_TARGET.identities)) {
    for (const value of [
      identity.commercialSkuId,
      identity.surveyObservationId,
      identity.reconcileCommandId,
      identity.reconciliationId,
      identity.observationId,
      identity.familyId,
      identity.physicalSkuId,
      identity.packageId,
      identity.bindingId,
      identity.linkId,
      identity.barcode,
    ]) assert.ok(contract.includes(value), value);
  }
  assert.match(contract, /requireCount\(rows, 8/);
  assert.match(contract, /currentBatch\.openTasks !== 0 \|\| currentBatch\.draftReadyTasks !== 8 \|\| currentBatch\.conflictTasks !== 0/);
  assert.match(contract, /currentBatch\.canSubmit/);
  assert.match(contract, /submit_command_id: null/);
  assert.match(contract, /publish_command_id: null/);
  assert.match(contract, /identity_status: 'DRAFT'/);
  assert.match(contract, /substitution_policy: 'PROHIBITED'/);
  assert.match(contract, /is_preferred: true/);
});

test('carrier performs authenticated SELECT evidence gate before exactly one incumbent SUBMIT', () => {
  assert.equal((carrier.match(/submitProductIdentityBatch\(input\)/g) || []).length, 1);
  const readCurrent = carrier.indexOf('await readCurrentProductIdentityBatch()');
  const readEvidence = carrier.indexOf('await readBatchNext5P2ResumeEvidence()');
  const assertion = carrier.indexOf('assertBatchNext5P2ResumeEvidence(currentBatch, serverEvidence)');
  const attempted = carrier.indexOf('setCommandAttempted(true)');
  const submit = carrier.indexOf('await submitProductIdentityBatch(input)');
  assert.ok(readCurrent >= 0 && readEvidence > readCurrent && assertion > readEvidence && attempted > assertion && submit > attempted);
  assert.match(carrier, /SUBMIT-only hard stop/);
  assert.doesNotMatch(carrier, /publishProductIdentityBatch|startProductIdentityBatch|startBoundedProductIdentityBatch|reconcileBarcodeSurveyObservation|retireProductIdentityBarcode/);
  assert.doesNotMatch(carrier, /service[_-]?role|access[_-]?token|refresh[_-]?token|jwt/i);
  assert.doesNotMatch(carrier, /api\.unleashedsoftware\.com|api\.ordermentum\.com|fetch\(/i);
});

test('evidence repository is nine exact SELECT-only RLS reads', () => {
  for (const table of [
    'ecoflow_product_identity_batches',
    'ecoflow_product_identity_batch_scope_items',
    'ecoflow_barcode_survey_identity_reconciliations',
    'ecoflow_product_identity_observations',
    'ecoflow_sku_families',
    'ecoflow_physical_skus',
    'ecoflow_physical_sku_packages',
    'ecoflow_physical_barcode_bindings',
    'ecoflow_commercial_family_links',
  ]) assert.ok(evidence.includes(`.from('${table}')`), table);
  assert.equal((evidence.match(/\.select\(/g) || []).length, 9);
  assert.doesNotMatch(evidence, /\.(?:insert|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(evidence, /\.rpc\s*\(|service[_-]?role|access[_-]?token|jwt/i);
});

test('completed NEXT5 P2 remains archived and CI-gated after P3 activation', () => {
  assert.doesNotMatch(wrapper, /lazy\(\(\) => import\('\.\/BatchNext5P2ResumeSubmitCarrier'\)/);
  assert.doesNotMatch(wrapper, /<BatchNext5P2ResumeSubmitCarrier/);
  assert.doesNotMatch(wrapper, /lazy\(\(\) => import\('\.\/BatchNext4DraftOnlyCarrier'\)/);
  assert.doesNotMatch(wrapper, /<BatchNext4DraftOnlyCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next4-p2-submit-contract\.test\.mjs/);
  assert.match(workflow, /BatchNext5P2ResumeSubmitCarrier\.tsx/);
  assert.match(workflow, /batchNext5P2ResumeSubmitContract\.ts/);
  assert.match(workflow, /batchNext5P2ResumeEvidence\.ts/);
});
