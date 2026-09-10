import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BATCH2_P3_RESUME_TARGET,
  assertBatch2P3Postflight,
  assertBatch2P3Preflight,
  assertBatch2P3PublishAcknowledgement,
  buildBatch2P3PublishInput,
  formatBatch2P3ResumeFailure,
} from '../src/features/productIdentity/batch2P3ResumePublishContract.ts';

const carrierPath = 'src/features/productIdentity/Batch2P3ResumePublishCarrier.tsx';
const evidenceRepositoryPath = 'src/data/repositories/batch2P3ResumeEvidence.ts';
const wrapperPath = 'src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx';
const unchangedPaths = new Map([
  ['src/features/productIdentity/Batch2ProductIdentityExecutionCarrier.tsx', 'b87b658d98c69aa9c8469d7d145c460ace00c955'],
  ['src/features/productIdentity/batch2ProductIdentityCarrierContract.ts', '5002e2a6cc6734463fbc0032402eb80d062592da'],
  ['src/features/productIdentity/BoundedProductIdentityExecutionCarrier.tsx', '49d6216bdafea0e71c542e89e36e099e62cbcd6d'],
  ['src/features/productIdentity/boundedProductIdentityCarrierContract.ts', 'bfcede1c46b84a8181571e661e38136746b18a30'],
  ['src/features/productIdentity/ProductIdentityCommissioningWorkspace.tsx', '4037bcab1b76baa2e30af0f19f5c7c52ce3e1b79'],
  ['src/features/productIdentity/Batch2P2ResumeSubmitCarrier.tsx', '01dba05a37c97fa82091cc57cc051e2ca7fea288'],
  ['src/features/productIdentity/batch2P2ResumeSubmitContract.ts', '3ade799466113180ed8bc19ee40c785e416a8499'],
  ['src/data/repositories/batch2P2ResumeEvidence.ts', '8cf506441e1d9e9455809c836a2b6368cfa865bf'],
]);

const [carrier, evidenceRepository, wrapper] = await Promise.all([
  readFile(carrierPath, 'utf8'),
  readFile(evidenceRepositoryPath, 'utf8'),
  readFile(wrapperPath, 'utf8'),
]);

const ids = {
  flFamily: 'aaaaaaaa-0000-4000-8000-000000000101',
  sbFamily: 'aaaaaaaa-0000-4000-8000-000000000102',
  flPhysical: 'aaaaaaaa-0000-4000-8000-000000000201',
  sbPhysical: 'aaaaaaaa-0000-4000-8000-000000000202',
  flPackage: 'aaaaaaaa-0000-4000-8000-000000000301',
  sbPackage: 'aaaaaaaa-0000-4000-8000-000000000302',
  flObservation: 'aaaaaaaa-0000-4000-8000-000000000401',
  sbObservation: 'aaaaaaaa-0000-4000-8000-000000000402',
};

function expectedNote(identity) {
  return `SURVEY_OBSERVATION=${identity.surveyObservationId} | ${identity.note}`;
}

function payload(identity) {
  return {
    batchId: BATCH2_P3_RESUME_TARGET.batchId,
    commercialSkuId: identity.commercialSkuId,
    physicalSkuCode: identity.physicalSkuCode,
    physicalName: identity.physicalName,
    brand: null,
    supplier: null,
    familyCode: identity.familyCode,
    familyName: identity.familyName,
    barcode: identity.barcode,
    packageLevel: 'CARTON',
    units: 1,
    policy: 'PROHIBITED',
    preferred: true,
    note: expectedNote(identity),
  };
}

function fixture(phase = 'PRE') {
  const target = BATCH2_P3_RESUME_TARGET;
  const fl = target.identities.FL115PLABOX;
  const sb = target.identities['SB24/32/40LBOX'];
  const published = phase === 'POST';
  const status = published ? 'ACTIVE' : 'DRAFT';
  const publishedAt = published ? '2026-09-09T17:00:00.000000Z' : null;
  return {
    currentBatch: published ? null : {
      batchId: target.batchId,
      batchName: target.batchName,
      batchStatus: 'SUBMITTED',
      revision: 3,
      submittedAt: target.submittedAt,
      publishedAt: null,
      openTasks: 0,
      draftReadyTasks: 2,
      conflictTasks: 0,
      resolvedTasks: 0,
      canSubmit: false,
      canPublish: true,
    },
    evidence: {
      batches: [{
        id: target.batchId,
        batch_name: target.batchName,
        batch_status: published ? 'PUBLISHED' : 'SUBMITTED',
        revision: published ? 4 : 3,
        start_command_id: target.startCommandId,
        submit_command_id: target.submitCommandId,
        publish_command_id: published ? target.publishCommandId : null,
        submitted_at: target.submittedAt,
        published_at: publishedAt,
      }],
      scopeItems: [
        { batch_id: target.batchId, commercial_sku_id: fl.commercialSkuId, start_command_id: target.startCommandId },
        { batch_id: target.batchId, commercial_sku_id: sb.commercialSkuId, start_command_id: target.startCommandId },
      ],
      reconciliations: [
        { survey_observation_id: fl.surveyObservationId, batch_id: target.batchId, product_identity_observation_id: ids.flObservation, command_id: fl.reconciliationCommandId, commercial_sku_id: fl.commercialSkuId, carton_barcode: fl.barcode, reconciliation_status: 'DRAFTED' },
        { survey_observation_id: sb.surveyObservationId, batch_id: target.batchId, product_identity_observation_id: ids.sbObservation, command_id: sb.reconciliationCommandId, commercial_sku_id: sb.commercialSkuId, carton_barcode: sb.barcode, reconciliation_status: 'DRAFTED' },
      ],
      observations: [
        { id: ids.flObservation, batch_id: target.batchId, command_id: fl.reconciliationCommandId, commercial_sku_id: fl.commercialSkuId, physical_sku_id: ids.flPhysical, family_id: ids.flFamily, barcode: fl.barcode, package_level: 'CARTON', units_in_base_unit: 1, substitution_policy: 'PROHIBITED', is_preferred: true, observation_status: 'DRAFTED', payload: payload(fl) },
        { id: ids.sbObservation, batch_id: target.batchId, command_id: sb.reconciliationCommandId, commercial_sku_id: sb.commercialSkuId, physical_sku_id: ids.sbPhysical, family_id: ids.sbFamily, barcode: sb.barcode, package_level: 'CARTON', units_in_base_unit: 1, substitution_policy: 'PROHIBITED', is_preferred: true, observation_status: 'DRAFTED', payload: payload(sb) },
      ],
      tasks: [
        { batch_id: target.batchId, commercial_sku_id: fl.commercialSkuId, task_status: published ? 'RESOLVED' : 'DRAFT_READY', blocking: true },
        { batch_id: target.batchId, commercial_sku_id: sb.commercialSkuId, task_status: published ? 'RESOLVED' : 'DRAFT_READY', blocking: true },
      ],
      families: [
        { id: ids.flFamily, family_code: fl.familyCode, family_name: fl.familyName, identity_status: status, created_in_batch_id: target.batchId },
        { id: ids.sbFamily, family_code: sb.familyCode, family_name: sb.familyName, identity_status: status, created_in_batch_id: target.batchId },
      ],
      physicalSkus: [
        { id: ids.flPhysical, physical_sku_code: fl.physicalSkuCode, display_name: fl.physicalName, brand: null, supplier_name: null, family_id: ids.flFamily, identity_status: status, created_in_batch_id: target.batchId },
        { id: ids.sbPhysical, physical_sku_code: sb.physicalSkuCode, display_name: sb.physicalName, brand: null, supplier_name: null, family_id: ids.sbFamily, identity_status: status, created_in_batch_id: target.batchId },
      ],
      packages: [
        { id: ids.flPackage, physical_sku_id: ids.flPhysical, package_level: 'CARTON', units_in_base_unit: 1, identity_status: status, created_in_batch_id: target.batchId },
        { id: ids.sbPackage, physical_sku_id: ids.sbPhysical, package_level: 'CARTON', units_in_base_unit: 1, identity_status: status, created_in_batch_id: target.batchId },
      ],
      barcodeBindings: [
        { barcode: fl.barcode, physical_sku_id: ids.flPhysical, package_id: ids.flPackage, identity_status: status, created_in_batch_id: target.batchId },
        { barcode: sb.barcode, physical_sku_id: ids.sbPhysical, package_id: ids.sbPackage, identity_status: status, created_in_batch_id: target.batchId },
      ],
      commercialFamilyLinks: [
        { commercial_sku_id: fl.commercialSkuId, family_id: ids.flFamily, preferred_physical_sku_id: ids.flPhysical, substitution_policy: 'PROHIBITED', identity_status: status, created_in_batch_id: target.batchId },
        { commercial_sku_id: sb.commercialSkuId, family_id: ids.sbFamily, preferred_physical_sku_id: ids.sbPhysical, substitution_policy: 'PROHIBITED', identity_status: status, created_in_batch_id: target.batchId },
      ],
      publicationAudits: [{
        batch_id: target.batchId,
        batch_name: target.batchName,
        batch_status: published ? 'PUBLISHED' : 'SUBMITTED',
        revision: published ? 4 : 3,
        submitted_at: target.submittedAt,
        published_at: publishedAt,
        observation_count: 2,
        conflict_observation_count: 0,
      }],
      quantitySentinels: {
        inventoryMovements: [],
        warehouseMovements: [],
        warehouseLocationItems: [],
        inventoryBalances: [],
        stockMovements: [],
      },
    },
  };
}

function rejectsPreflight(mutator, pattern = /HOLD/) {
  const value = fixture();
  mutator(value);
  assert.throws(() => assertBatch2P3Preflight(value.currentBatch, value.evidence), pattern);
}

test('fresh-session preflight accepts only the exact SUBMITTED rev3 current authority', () => {
  const value = fixture();
  assert.doesNotThrow(() => assertBatch2P3Preflight(value.currentBatch, value.evidence));
  for (const [field, replacement] of [
    ['batchId', 'aaaaaaaa-0000-4000-8000-000000000999'], ['batchStatus', 'DRAFT'], ['revision', 2],
    ['submittedAt', null], ['publishedAt', '2026-09-09T17:00:00Z'], ['openTasks', 1],
    ['draftReadyTasks', 1], ['conflictTasks', 1], ['resolvedTasks', 1], ['canPublish', false],
  ]) rejectsPreflight((draft) => { draft.currentBatch[field] = replacement; });
});

test('batch, scope, reconcile and observation evidence are exact and fail closed', () => {
  for (const [field, replacement] of [
    ['batch_status', 'DRAFT'], ['revision', 2], ['start_command_id', 'aaaaaaaa-0000-4000-8000-000000000999'],
    ['submit_command_id', 'aaaaaaaa-0000-4000-8000-000000000998'], ['publish_command_id', 'aaaaaaaa-0000-4000-8000-000000000997'],
    ['submitted_at', null], ['published_at', '2026-09-09T17:00:00Z'],
  ]) rejectsPreflight((draft) => { draft.evidence.batches[0][field] = replacement; });
  rejectsPreflight((draft) => { draft.evidence.scopeItems.pop(); }, /scope/i);
  rejectsPreflight((draft) => { draft.evidence.reconciliations[0].command_id = 'changed'; }, /reconciliation/i);
  rejectsPreflight((draft) => { draft.evidence.observations[0].payload.units = 50; }, /payload/i);
  rejectsPreflight((draft) => { draft.evidence.observations[1].is_preferred = false; }, /observation/i);
});

test('preflight requires exactly two DRAFT graph rows, tasks and publication audit', () => {
  for (const [key, pattern] of [
    ['families', /family/i], ['physicalSkus', /Physical/i], ['packages', /package/i],
    ['barcodeBindings', /barcode/i], ['commercialFamilyLinks', /link/i],
  ]) {
    rejectsPreflight((draft) => { draft.evidence[key].pop(); }, pattern);
  }
  rejectsPreflight((draft) => { draft.evidence.families[0].identity_status = 'ACTIVE'; }, /family/i);
  rejectsPreflight((draft) => { draft.evidence.tasks.pop(); }, /task/i);
  rejectsPreflight((draft) => { draft.evidence.tasks[0].task_status = 'RESOLVED'; }, /task/i);
  rejectsPreflight((draft) => { draft.evidence.publicationAudits[0].observation_count = 1; }, /publication audit/i);
  rejectsPreflight((draft) => { draft.evidence.publicationAudits[0].published_at = '2026-09-09T17:00:00Z'; }, /publication audit/i);
});

test('every quantity sentinel must remain empty before PUBLISH', () => {
  for (const key of Object.keys(fixture().evidence.quantitySentinels)) {
    rejectsPreflight((draft) => { draft.evidence.quantitySentinels[key].push({ id: 'unexpected' }); }, /quantity isolation/i);
  }
});

test('PUBLISH input and acknowledgement are immutable and exact', () => {
  assert.deepEqual(buildBatch2P3PublishInput(), {
    batchId: '97fd2036-d0ff-492d-8ae7-1c9c0e09e526',
    expectedRevision: 3,
    commandId: '82041faf-fdfa-4d2f-882c-d2c1c33ecd7a',
    note: '#338 Batch 2 production publish; two DRAFT payloads and SUBMIT independently verified; no inventory authority granted.',
  });
  const accepted = {
    batchId: BATCH2_P3_RESUME_TARGET.batchId,
    batchStatus: 'PUBLISHED',
    revision: 4,
    commandStatus: 'APPLIED',
    publishedFamilies: 2,
    publishedPhysicalSkus: 2,
    publishedBarcodes: 2,
    publishedLinks: 2,
    publishedAt: '2026-09-09T17:00:00Z',
  };
  assert.doesNotThrow(() => assertBatch2P3PublishAcknowledgement(accepted));
  assert.doesNotThrow(() => assertBatch2P3PublishAcknowledgement({ ...accepted, commandStatus: 'REPLAYED' }));
  for (const invalid of [
    { batchId: 'changed' }, { batchStatus: 'SUBMITTED' }, { revision: 3 }, { commandStatus: 'CONFLICT' },
    { publishedFamilies: 1 }, { publishedPhysicalSkus: 1 }, { publishedBarcodes: 1 }, { publishedLinks: 1 }, { publishedAt: null },
  ]) assert.throws(() => assertBatch2P3PublishAcknowledgement({ ...accepted, ...invalid }), /acknowledgement/i);
});

test('postflight requires PUBLISHED rev4, frozen command, ACTIVE graph, resolved tasks and zero quantities', () => {
  const value = fixture('POST');
  assert.doesNotThrow(() => assertBatch2P3Postflight(value.evidence));
  assert.throws(() => assertBatch2P3Postflight(fixture().evidence), /postflight/i);
  for (const mutator of [
    (draft) => { draft.batches[0].publish_command_id = 'changed'; },
    (draft) => { draft.physicalSkus[0].identity_status = 'DRAFT'; },
    (draft) => { draft.tasks[0].task_status = 'DRAFT_READY'; },
    (draft) => { draft.publicationAudits[0].published_at = null; },
    (draft) => { draft.quantitySentinels.stockMovements.push({ id: 'unexpected' }); },
  ]) {
    const draft = fixture('POST').evidence;
    mutator(draft);
    assert.throws(() => assertBatch2P3Postflight(draft), /HOLD/);
  }
});

test('pre-command failures and post-boundary uncertainty have truthful terminal wording', () => {
  const before = formatBatch2P3ResumeFailure(new Error('evidence read failed'), false);
  assert.match(before, /^HOLD —/);
  assert.match(before, /PUBLISH was not called\.$/);
  assert.doesNotMatch(before, /may have been called/);
  const after = formatBatch2P3ResumeFailure(new Error('network response unavailable'), true);
  assert.match(after, /^HOLD — PUBLISH may have been called;/);
  assert.match(after, /perform read-only server verification before any retry\./i);
  assert.match(after, /Do not retry or use a new command ID/i);
  assert.doesNotMatch(after, /PUBLISH was not called/);
});

test('fresh-session carrier performs one incumbent PUBLISH between preflight and postflight', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(carrier, /if \(!authorized\) return null/);
  assert.doesNotMatch(carrier, /startResult|flResult|sbResult|submitResult|draftBatchAfter/);
  assert.equal((carrier.match(/publishProductIdentityBatch\(input\)/g) || []).length, 1);
  const currentRead = carrier.indexOf('await readCurrentProductIdentityBatch()');
  const evidenceRead = carrier.indexOf("await readBatch2P3ResumeEvidence('PRE')");
  const assertion = carrier.indexOf('assertBatch2P3Preflight(currentBatch, serverEvidence)');
  const attempted = carrier.indexOf('setCommandAttempted(true)');
  const publish = carrier.indexOf('await publishProductIdentityBatch(input)');
  const postRead = carrier.indexOf("await readBatch2P3ResumeEvidence('POST')");
  const postAssertion = carrier.indexOf('assertBatch2P3Postflight(serverPostflight)');
  assert.ok(currentRead >= 0 && currentRead < evidenceRead && evidenceRead < assertion && assertion < attempted && attempted < publish && publish < postRead && postRead < postAssertion);
  assert.match(carrier, /disabled=\{busy \|\| commandAttempted \|\| result !== null\}/);
  assert.match(carrier, /formatBatch2P3ResumeFailure\(error, commandCrossedBoundary\)/);
  assert.doesNotMatch(carrier, /<(?:input|textarea|select)\b/);
  assert.doesNotMatch(carrier, /submitProductIdentityBatch|startBoundedProductIdentityBatch|startProductIdentityBatch|reconcileBarcodeSurveyObservation|createProductIdentityCommandId|reopenProductIdentityBatch/);
  assert.doesNotMatch(carrier, /service[_-]?role|access[_-]?token|jwt|opening balance|stocktake|receiving|cutover|#339B/i);
  assert.match(wrapper, /<Batch2P3ResumePublishCarrier/);
});

test('evidence repository uses only the exact authenticated SELECT paths', () => {
  for (const table of [
    'ecoflow_product_identity_batches', 'ecoflow_product_identity_batch_scope_items',
    'ecoflow_barcode_survey_identity_reconciliations', 'ecoflow_product_identity_observations',
    'ecoflow_product_identity_tasks', 'ecoflow_sku_families', 'ecoflow_physical_skus',
    'ecoflow_physical_sku_packages', 'ecoflow_physical_barcode_bindings',
    'ecoflow_commercial_family_links', 'v_ecoflow_product_identity_publication_audit',
    'ecoflow_inventory_movements', 'ecoflow_warehouse_movements',
    'ecoflow_warehouse_location_items', 'inventory_balances', 'stock_movements',
  ]) assert.match(evidenceRepository, new RegExp(`\\.from\\('${table}'\\)`));
  assert.equal((evidenceRepository.match(/\.select\(/g) || []).length, 16);
  assert.doesNotMatch(evidenceRepository, /\.(?:insert|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(evidenceRepository, /\.rpc\s*\(|service[_-]?role|access[_-]?token|jwt/i);
});

test('P1/P2/BPB8 and generic Product Identity carriers remain byte-identical to base', async () => {
  for (const [path, expected] of unchangedPaths) {
    const content = await readFile(path);
    const header = Buffer.from(`blob ${content.length}\0`);
    assert.equal(createHash('sha1').update(header).update(content).digest('hex'), expected, path);
  }
});
