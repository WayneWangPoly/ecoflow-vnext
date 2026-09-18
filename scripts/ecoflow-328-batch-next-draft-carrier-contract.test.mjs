import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = readFileSync('src/features/productIdentity/batchNextDraftOnlyContract.ts', 'utf8');
const carrier = readFileSync('src/features/productIdentity/BatchNextDraftOnlyCarrier.tsx', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');

const protectedMain = 'e615cb686cbc374a0c3100929e881d7e5d7e1379';
const startCommand = '54a86be1-b497-48aa-a9e1-5d61aab29b51';
const candidates = [
  ['CCLBPLA-80', 'cc0d56f1-9ac8-47a4-a5b7-5a3f1c990e5d', 'd8226c36-057c-4cc8-925e-4f99276ddb60', 'fd66defd-9dd6-47b4-8701-60dc8e73370a'],
  ['CCSKBM12-90', '04b0ff03-bdbf-4897-9171-156af5fb8e00', '2fda2caa-0727-4e32-b036-0da3c8196e03', '32ebe526-0f9a-4762-8fb0-e35db47b1934'],
  ['NPK2DK', 'f5c68b72-1684-4029-8219-f40b7513c54c', 'cf15dad3-07e1-4fe8-a184-35968b64a485', 'efffab32-38e7-43d0-ac0b-03fceca9db3f'],
  ['CCLWPLA-80', '7d387ca1-482b-4143-8ec7-e20f82a8109e', 'f61dd655-9a7b-4f7a-ad10-f7a3a795d13e', 'a9f58d3b-c4fc-4bb7-aa28-126ad773f03a'],
  ['CCSA12-90', '6b8e0688-d256-4bdb-acc4-175203905796', '9bde5c61-87de-4f3c-9006-fa9a8e9a3d08', '3391354c-8733-498d-b626-719b4456fae1'],
];

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

test('Batch Next target is frozen to the authorized production main and exact five candidates', () => {
  assert.match(contract, new RegExp(protectedMain));
  assert.match(contract, new RegExp(startCommand));
  for (const [code, commercialId, surveyId, reconcileId] of candidates) {
    for (const token of [code, commercialId, surveyId, reconcileId]) {
      assert.match(contract, new RegExp(escapeRegex(token)));
    }
  }
  assert.match(contract, /candidates\.map\(\(candidate\) => candidate\.commercialSkuId\)/);
  assert.match(contract, /distinctCommercial\.size !== ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET\.candidates\.length/);
  assert.match(contract, /distinctSurvey\.size !== ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET\.candidates\.length/);
});

test('Batch Next preflight is caller-authenticated and fail-closed on live queue drift', () => {
  assert.match(carrier, /readBarcodeSurveyReconciliationQueue\(500\)/);
  assert.match(carrier, /readCurrentProductIdentityBatch\(\)/);
  assert.match(contract, /queueStatus !== 'READY_TO_RECONCILE'/);
  assert.match(contract, /commercialMatchCount !== 1/);
  assert.match(contract, /existingPhysicalSkuCode/);
  assert.match(contract, /evidenceSource !== 'OBSERVED_NOW'/);
  assert.match(contract, /SCANNED', 'NO_SEPARATE_BARCODE/);
  assert.match(carrier, /\['DRAFT', 'SUBMITTED'\]\.includes\(activeBatch\.batchStatus\)/);
  assert.doesNotMatch(carrier + contract, /service[_-]?role|access[_-]?token|refresh[_-]?token|auth\.uid/i);
});

test('START is one exact five-SKU bounded batch and cannot silently degrade to one-SKU execution', () => {
  assert.match(carrier, /startBoundedProductIdentityBatch\(buildBatchNextStartInput\(\)\)/);
  assert.match(carrier, /scopedSkuCount !== ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET\.candidates\.length/);
  assert.match(carrier, /Five-SKU bounded START/);
  assert.doesNotMatch(carrier, /startProductIdentityBatch\(/);
});

test('physical facts are blank by default and require explicit operator confirmation', () => {
  for (const fragment of [
    "physicalSkuCode: ''",
    "physicalName: ''",
    "familyCode: ''",
    "familyName: ''",
    "packageLevel: ''",
    "unitsInBaseUnit: ''",
    "substitutionPolicy: ''",
    "isPreferred: false",
    "confirmed: false",
  ]) assert.match(contract, new RegExp(escapeRegex(fragment)));

  assert.match(contract, /do not infer it from Commercial SKU names/);
  assert.match(contract, /confirm the physical facts before creating a DRAFT/);
  assert.match(carrier, /they were not inferred from the product name/);
  assert.match(carrier, /Leave a candidate untouched until those facts are known/);
});

test('reconciliation is DRAFT-only and no submit/publish/provider/inventory authority is mounted', () => {
  assert.match(carrier, /reconcileBarcodeSurveyObservation\(input\)/);
  assert.match(carrier, /result\.reconciliationStatus !== 'DRAFTED'/);
  assert.doesNotMatch(carrier, /submitProductIdentityBatch|publishProductIdentityBatch|SUBMIT command|PUBLISH command/);
  assert.doesNotMatch(carrier, /api\.unleashedsoftware\.com|api\.ordermentum\.com|fetch\(/i);
  assert.doesNotMatch(carrier, /inventory.*(insert|update|delete)|stocktake.*(insert|update|delete)|location.*(insert|update|delete)/i);
  assert.match(carrier, /DRAFT-only hard stop/);
});

test('native Product Identity surface mounts the dedicated carrier and CI executes this contract', () => {
  assert.match(wrapper, /import \{ BatchNextDraftOnlyCarrier \} from '\.\/BatchNextDraftOnlyCarrier';/);
  assert.match(wrapper, /<BatchNextDraftOnlyCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next-draft-carrier-contract\.test\.mjs/);
});
