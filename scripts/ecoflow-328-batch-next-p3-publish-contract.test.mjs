import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BATCH_NEXT_P3_TARGET,
  assertBatchNextP3PublishAcknowledgement,
  buildBatchNextP3PublishInput,
  formatBatchNextP3Failure,
} from '../src/features/productIdentity/batchNextP3ResumePublishContract.ts';

const carrier = readFileSync('src/features/productIdentity/BatchNextP3ResumePublishCarrier.tsx', 'utf8');
const contract = readFileSync('src/features/productIdentity/batchNextP3ResumePublishContract.ts', 'utf8');
const evidence = readFileSync('src/data/repositories/batchNextP3ResumeEvidence.ts', 'utf8');
const wrapper = readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');
const workflow = readFileSync('.github/workflows/warehouse-survey-002-reconciliation-check.yml', 'utf8');
const authorityMigration = readFileSync('supabase/migrations/20260808180500_product_identity_authority.sql', 'utf8');

test('Batch Next P3 target is frozen to exact SUBMITTED rev6 and one unused PUBLISH command', () => {
  assert.equal(BATCH_NEXT_P3_TARGET.protectedMainSha, 'd468beeec9f8be688b4f17568c95a7dd9b5fd028');
  assert.equal(BATCH_NEXT_P3_TARGET.batchId, '5d5c1d6e-0c27-47b0-9b63-1d2fe34fe61a');
  assert.equal(BATCH_NEXT_P3_TARGET.expectedRevision, 6);
  assert.equal(BATCH_NEXT_P3_TARGET.submitCommandId, 'd0b7e6a9-3b2f-4b14-8c52-7f0f2d6e9a41');
  assert.equal(BATCH_NEXT_P3_TARGET.publishCommandId, '595ee7ac-812f-4305-bcd4-b95e213e1f85');
  assert.deepEqual(Object.keys(BATCH_NEXT_P3_TARGET.identities), [
    'CCLBPLA-80',
    'CCSKBM12-90',
    'NPK2DK',
    'CCLWPLA-80',
    'CCSA12-90',
  ]);
});

test('PUBLISH input and acknowledgement are exact', () => {
  assert.deepEqual(buildBatchNextP3PublishInput(), {
    batchId: BATCH_NEXT_P3_TARGET.batchId,
    expectedRevision: 6,
    commandId: BATCH_NEXT_P3_TARGET.publishCommandId,
    note: BATCH_NEXT_P3_TARGET.publishNote,
  });

  const accepted = {
    batchId: BATCH_NEXT_P3_TARGET.batchId,
    batchStatus: 'PUBLISHED',
    revision: 7,
    commandStatus: 'APPLIED',
    publishedFamilies: 5,
    publishedPhysicalSkus: 5,
    publishedBarcodes: 5,
    publishedLinks: 5,
    publishedAt: '2026-09-18T15:15:00Z',
  };
  assert.doesNotThrow(() => assertBatchNextP3PublishAcknowledgement(accepted));
  assert.doesNotThrow(() => assertBatchNextP3PublishAcknowledgement({ ...accepted, commandStatus: 'REPLAYED' }));
  for (const invalid of [
    { batchStatus: 'SUBMITTED' },
    { revision: 6 },
    { commandStatus: 'CONFLICT' },
    { publishedFamilies: 4 },
    { publishedPhysicalSkus: 4 },
    { publishedBarcodes: 4 },
    { publishedLinks: 4 },
    { publishedAt: null },
  ]) assert.throws(() => assertBatchNextP3PublishAcknowledgement({ ...accepted, ...invalid }), /acknowledgement/i);
});

test('contract freezes the five exact canonical graphs and PRE/POST states', () => {
  for (const identity of Object.values(BATCH_NEXT_P3_TARGET.identities)) {
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
  assert.match(contract, /currentBatch\.batchStatus !== 'SUBMITTED'/);
  assert.match(contract, /currentBatch\.revision !== t\.expectedRevision/);
  assert.match(contract, /currentBatch\.draftReadyTasks !== 5/);
  assert.match(contract, /currentBatch\.resolvedTasks !== 0/);
  assert.match(contract, /!currentBatch\.canPublish/);
  assert.match(contract, /phase === 'POST' \? 'PUBLISHED' : 'SUBMITTED'/);
  assert.match(contract, /phase === 'POST' \? 7 : 6/);
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
  const preRead = carrier.indexOf("await readBatchNextP3ResumeEvidence('PRE')");
  const preAssert = carrier.indexOf('assertBatchNextP3Preflight(currentBatch, serverEvidence)');
  const attempted = carrier.indexOf('setCommandAttempted(true)');
  const publish = carrier.indexOf('await publishProductIdentityBatch(input)');
  const postRead = carrier.indexOf("await readBatchNextP3ResumeEvidence('POST')");
  const postAssert = carrier.indexOf('assertBatchNextP3Postflight(postflight)');
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
  assert.match(formatBatchNextP3Failure(new Error('read failed'), false), /PUBLISH was not called\.$/);
  const uncertain = formatBatchNextP3Failure(new Error('network uncertain'), true);
  assert.match(uncertain, /PUBLISH may have been called/);
  assert.match(uncertain, /do not retry or use a new command ID/i);
  assert.match(uncertain, /read-only server verification/i);
});

test('native surface mounts carrier and CI executes the dedicated contract', () => {
  assert.match(wrapper, /import \{ BatchNextP3ResumePublishCarrier \} from '\.\/BatchNextP3ResumePublishCarrier';/);
  assert.match(wrapper, /<BatchNextP3ResumePublishCarrier/);
  assert.match(workflow, /ecoflow-328-batch-next-p3-publish-contract\.test\.mjs/);
});
