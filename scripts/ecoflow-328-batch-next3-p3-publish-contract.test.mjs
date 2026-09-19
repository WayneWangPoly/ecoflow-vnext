import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BATCH_NEXT3_P3_TARGET,
  assertBatchNext3P3PublishAcknowledgement,
  buildBatchNext3P3PublishInput,
  formatBatchNext3P3Failure,
} from '../src/features/productIdentity/batchNext3P3ResumePublishContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNext3P3ResumePublishCarrier.tsx', 'utf8');
const contract = readFileSync('src/features/productIdentity/batchNext3P3ResumePublishContract.ts', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNext3P3ResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');
const authorityMigration = readFileSync('supabase/migrations/20260808180500_product_identity_authority.sql', 'utf8');

test('Batch Next 3 P3 target is frozen to exact SUBMITTED rev11 and one unused PUBLISH command', () => {
  assert.equal(BATCH_NEXT3_P3_TARGET.protectedMainSha, '6bd53298ecd1c1b3e9969734d81a8c3c58e54b88');
  assert.equal(BATCH_NEXT3_P3_TARGET.batchId, 'e4c8b31b-73e6-4607-9e10-b46509f49365');
  assert.equal(BATCH_NEXT3_P3_TARGET.expectedRevision, 11);
  assert.equal(BATCH_NEXT3_P3_TARGET.submitCommandId, '75d35e90-e939-4da5-8469-b4183bff5cf4');
  assert.equal(BATCH_NEXT3_P3_TARGET.publishCommandId, 'b2f74120-86de-4de9-8c80-435627ad76c9');
  assert.deepEqual(Object.keys(BATCH_NEXT3_P3_TARGET.identities), [
    'CCEB16-90',
    'CCLWPLA-62',
    'CCSB12-80',
    'CCSB16-90',
    'CCSB8-90',
    'CCSKBM12-80',
    'CCSPW6-80',
    'IC5BBOX',
    'NPK1LW',
    'NPK2LK',
  ]);
});

test('PUBLISH input and acknowledgement are exact', () => {
  assert.deepEqual(buildBatchNext3P3PublishInput(), {
    batchId: BATCH_NEXT3_P3_TARGET.batchId,
    expectedRevision: 11,
    commandId: BATCH_NEXT3_P3_TARGET.publishCommandId,
    note: BATCH_NEXT3_P3_TARGET.publishNote,
  });

  const accepted = {
    batchId: BATCH_NEXT3_P3_TARGET.batchId,
    batchStatus: 'PUBLISHED',
    revision: 12,
    commandStatus: 'APPLIED',
    publishedFamilies: 10,
    publishedPhysicalSkus: 10,
    publishedBarcodes: 10,
    publishedLinks: 10,
    publishedAt: '2026-09-18T15:15:00Z',
  };
  assert.doesNotThrow(() => assertBatchNext3P3PublishAcknowledgement(accepted));
  assert.doesNotThrow(() => assertBatchNext3P3PublishAcknowledgement({ ...accepted, commandStatus: 'REPLAYED' }));
  for (const invalid of [
    { batchStatus: 'SUBMITTED' },
    { revision: 11 },
    { commandStatus: 'CONFLICT' },
    { publishedFamilies: 9 },
    { publishedPhysicalSkus: 9 },
    { publishedBarcodes: 9 },
    { publishedLinks: 9 },
    { publishedAt: null },
  ]) assert.throws(() => assertBatchNext3P3PublishAcknowledgement({ ...accepted, ...invalid }), /acknowledgement/i);
});

test('contract freezes the ten exact canonical graphs and PRE/POST states', () => {
  for (const identity of Object.values(BATCH_NEXT3_P3_TARGET.identities)) {
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
  assert.match(contract, /currentBatch\.batchStatus !== 'SUBMITTED'/);
  assert.match(contract, /currentBatch\.revision !== t\.expectedRevision/);
  assert.match(contract, /currentBatch\.draftReadyTasks !== 10/);
  assert.match(contract, /currentBatch\.resolvedTasks !== 0/);
  assert.match(contract, /!currentBatch\.canPublish/);
  assert.match(contract, /phase === 'POST' \? 'PUBLISHED' : 'SUBMITTED'/);
  assert.match(contract, /phase === 'POST' \? 12 : 11/);
  assert.match(contract, /phase === 'POST' \? 'ACTIVE' : 'DRAFT'/);
  assert.match(contract, /phase === 'POST' \? 'RESOLVED' : 'DRAFT_READY'/);
  assert.match(contract, /reconciliation_status: 'DRAFTED'/);
  assert.match(contract, /observation_status: 'DRAFTED'/);
  assert.match(contract, /quantity isolation sentinel/);
});

test('carrier performs exactly one incumbent PUBLISH between exact preflight and postflight', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.equal((carrier.match(/publishProductIdentityBatch\(input\)/g) || []).length, 1);
  const currentRead = carrier.indexOf('await readCurrentProductIdentityBatch()');
  const preRead = carrier.indexOf("await readBatchNext3P3ResumeEvidence('PRE')");
  const preAssert = carrier.indexOf('assertBatchNext3P3Preflight(currentBatch, serverEvidence)');
  const attempted = carrier.indexOf('setCommandAttempted(true)');
  const publish = carrier.indexOf('await publishProductIdentityBatch(input)');
  const postRead = carrier.indexOf("await readBatchNext3P3ResumeEvidence('POST')");
  const postAssert = carrier.indexOf('assertBatchNext3P3Postflight(postflight)');
  assert.ok(currentRead >= 0 && currentRead < preRead && preRead < preAssert && preAssert < attempted && attempted < publish && publish < postRead && postRead < postAssert);
  assert.match(carrier, /disabled=\{busy \|\| commandAttempted \|\| result !== null\}/);
  assert.match(carrier, /PUBLISH-only hard stop/);
  assert.doesNotMatch(carrier, /submitProductIdentityBatch|startBoundedProductIdentityBatch|startProductIdentityBatch|reconcileBarcodeSurveyObservation|retireProductIdentityBarcode|createProductIdentityCommandId|reopenProductIdentityBatch/);
  assert.doesNotMatch(carrier, /service[_-]?role|access[_-]?token|refresh[_-]?token|jwt/i);
  assert.doesNotMatch(carrier, /api\.unleashedsoftware\.com|api\.ordermentum\.com|fetch\(/i);
});

test('evidence repository is sixteen authenticated SELECT-only reads', () => {
  for (const table of [
    'ecoflow_product_identity_batches',
    'ecoflow_product_identity_batch_scope_items',
    'ecoflow_barcode_survey_identity_reconciliations',
    'ecoflow_product_identity_observations',
    'ecoflow_product_identity_tasks',
    'ecoflow_sku_families',
    'ecoflow_physical_skus',
    'ecoflow_physical_sku_packages',
    'ecoflow_physical_barcode_bindings',
    'ecoflow_commercial_family_links',
    'v_ecoflow_product_identity_publication_audit',
    'ecoflow_inventory_movements',
    'ecoflow_warehouse_movements',
    'ecoflow_warehouse_location_items',
    'inventory_balances',
    'stock_movements',
  ]) assert.ok(evidence.includes(`.from('${table}')`), table);
  assert.equal((evidence.match(/\.select\(/g) || []).length, 16);
  assert.doesNotMatch(evidence, /\.(?:insert|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(evidence, /\.rpc\s*\(|service[_-]?role|access[_-]?token|jwt/i);
});

test('incumbent publish authority contains no operational quantity mutation', () => {
  const start = authorityMigration.indexOf('create or replace function public.ecoflow_publish_product_identity_batch');
  assert.ok(start >= 0);
  const tail = authorityMigration.slice(start);
  const end = tail.indexOf('revoke all on function public.ecoflow_publish_product_identity_batch');
  const publishSection = end >= 0 ? tail.slice(0, end) : tail;
  assert.doesNotMatch(
    publishSection,
    /(?:insert\s+into|update|delete\s+from)\s+public\.(?:ecoflow_inventory_movements|ecoflow_warehouse_movements|ecoflow_warehouse_location_items|inventory_balances|stock_movements|ecoflow_stocktake)/i,
  );
  assert.doesNotMatch(publishSection, /api\.unleashedsoftware\.com|api\.ordermentum\.com|http_post|net\.http/i);
});

test('post-boundary failure wording prohibits blind retry', () => {
  assert.match(formatBatchNext3P3Failure(new Error('read failed'), false), /PUBLISH was not called\.$/);
  const uncertain = formatBatchNext3P3Failure(new Error('network uncertain'), true);
  assert.match(uncertain, /PUBLISH may have been called/);
  assert.match(uncertain, /do not retry or use a new command ID/i);
  assert.match(uncertain, /read-only server verification/i);
});

test('native surface mounts carrier and CI executes the dedicated contract', () => {
  assert.match(wrapper, /lazy\(\(\) => import\('\.\/BatchNext3P3ResumePublishCarrier'\)/);
  assert.match(wrapper, /<BatchNext3P3ResumePublishCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next2-p3-publish-contract\.test\.mjs/);
});
