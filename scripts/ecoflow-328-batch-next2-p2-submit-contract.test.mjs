import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BATCH_NEXT2_P2_TARGET,
  assertBatchNext2P2SubmitAcknowledgement,
  buildBatchNext2P2SubmitInput,
} from '../src/features/productIdentity/batchNext2P2ResumeSubmitContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNext2P2ResumeSubmitCarrier.tsx', 'utf8');
const contract = readFileSync('src/features/productIdentity/batchNext2P2ResumeSubmitContract.ts', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNext2P2ResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');

test('Batch Next 2 P2 target is frozen to exact production DRAFT rev10 and one unused SUBMIT command', () => {
  assert.equal(BATCH_NEXT2_P2_TARGET.protectedMainSha, 'be53d50c9978d097443eafa658cb88cacd3a4ed1');
  assert.equal(BATCH_NEXT2_P2_TARGET.batchId, 'db7887ba-937e-4782-81a4-3eff21a6dfd4');
  assert.equal(BATCH_NEXT2_P2_TARGET.batchName, 'ECOFLOW-328 Batch Next 2 DRAFT-only');
  assert.equal(BATCH_NEXT2_P2_TARGET.expectedRevision, 10);
  assert.equal(BATCH_NEXT2_P2_TARGET.startCommandId, 'f93b5ce7-80d0-4b41-a756-d2fd382827dd');
  assert.equal(BATCH_NEXT2_P2_TARGET.submitCommandId, 'a4c5c70e-8171-4d70-8f52-dbc722c1212c');
  assert.equal(Object.keys(BATCH_NEXT2_P2_TARGET.identities).length, 10);
});

test('SUBMIT input and acknowledgement are exact and revisioned', () => {
  assert.deepEqual(buildBatchNext2P2SubmitInput(), {
    batchId: BATCH_NEXT2_P2_TARGET.batchId,
    expectedRevision: 10,
    commandId: BATCH_NEXT2_P2_TARGET.submitCommandId,
    note: BATCH_NEXT2_P2_TARGET.submitNote,
  });
  assert.doesNotThrow(() => assertBatchNext2P2SubmitAcknowledgement({
    batchId: BATCH_NEXT2_P2_TARGET.batchId,
    batchStatus: 'SUBMITTED',
    revision: 11,
    commandStatus: 'APPLIED',
  }));
  assert.throws(() => assertBatchNext2P2SubmitAcknowledgement({
    batchId: BATCH_NEXT2_P2_TARGET.batchId,
    batchStatus: 'PUBLISHED',
    revision: 12,
    commandStatus: 'APPLIED',
  }));
});

test('contract freezes all ten canonical reconciliation graphs and fail-closes on cardinality drift', () => {
  for (const identity of Object.values(BATCH_NEXT2_P2_TARGET.identities)) {
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
      identity.barcode,
    ]) assert.ok(contract.includes(value), value);
  }
  assert.match(contract, /requireCount\(rows, 10/);
  assert.match(contract, /currentBatch\.openTasks !== 0 \|\| currentBatch\.draftReadyTasks !== 10 \|\| currentBatch\.conflictTasks !== 0/);
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
  const readEvidence = carrier.indexOf('await readBatchNext2P2ResumeEvidence()');
  const assertion = carrier.indexOf('assertBatchNext2P2ResumeEvidence(currentBatch, serverEvidence)');
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

test('native Product Identity surface lazy-mounts the dedicated carrier and CI executes this contract', () => {
  assert.match(wrapper, /lazy\(\(\) => import\('\.\/BatchNext2P2ResumeSubmitCarrier'\)/);
  assert.match(wrapper, /<BatchNext2P2ResumeSubmitCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next2-p2-submit-contract\.test\.mjs/);
  assert.match(workflow, /BatchNext2P2ResumeSubmitCarrier\.tsx/);
  assert.match(workflow, /batchNext2P2ResumeSubmitContract\.ts/);
  assert.match(workflow, /batchNext2P2ResumeEvidence\.ts/);
});
