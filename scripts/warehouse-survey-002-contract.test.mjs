import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BPB8_DRAFT_CANARY_DEFAULTS,
  BPB8_P2_SUBMIT_DEFAULTS,
  BPB8_P3_PUBLISH_DEFAULTS,
  assertBoundedPublishAcknowledgement,
  assertBoundedPublishPreflight,
  assertBoundedSubmitAcknowledgement,
  assertBoundedSubmitPreflight,
  buildBoundedPublishInput,
  buildBoundedReconcileInput,
  buildBoundedStartInput,
  buildBoundedSubmitInput,
} from '../src/features/productIdentity/boundedProductIdentityCarrierContract.ts';
import {
  BATCH2_PRODUCT_IDENTITY_DEFAULTS,
  assertBatch2DraftProgress,
  assertBatch2PublishAcknowledgement,
  assertBatch2PublishPreflight,
  assertBatch2ReconcileAcknowledgement,
  assertBatch2StartAcknowledgement,
  assertBatch2SubmitAcknowledgement,
  assertBatch2SubmitPreflight,
  buildBatch2PublishInput,
  buildBatch2ReconcileInput,
  buildBatch2StartInput,
  buildBatch2SubmitInput,
} from '../src/features/productIdentity/batch2ProductIdentityCarrierContract.ts';

const migrationPath = 'supabase/migrations/20260826093000_warehouse_survey_002_product_identity_reconciliation.sql';
const repositoryPath = 'src/data/repositories/barcodeSurveyReconciliation.ts';
const panelPath = 'src/features/productIdentity/BarcodeSurveyReconciliationPanel.tsx';
const wrapperPath = 'src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx';
const boundedCarrierPath = 'src/features/productIdentity/BoundedProductIdentityExecutionCarrier.tsx';
const batch2CarrierPath = 'src/features/productIdentity/Batch2ProductIdentityExecutionCarrier.tsx';
const productIdentityRepositoryPath = 'src/data/repositories/productIdentity.ts';
const productIdentityWorkspacePath = 'src/features/productIdentity/ProductIdentityCommissioningWorkspace.tsx';
const routePath = 'src/features/operationalRoutes/UnifiedOperationalRoutes.tsx';

const [migration, repository, panel, wrapper, boundedCarrier, batch2Carrier, productIdentityRepository, productIdentityWorkspace, route] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(panelPath, 'utf8'),
  readFile(wrapperPath, 'utf8'),
  readFile(boundedCarrierPath, 'utf8'),
  readFile(batch2CarrierPath, 'utf8'),
  readFile(productIdentityRepositoryPath, 'utf8'),
  readFile(productIdentityWorkspacePath, 'utf8'),
  readFile(routePath, 'utf8'),
]);

const BATCH2_TEST_BATCH_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

test('reconciliation is a draft-only provenance bridge, not a second barcode authority', () => {
  assert.match(migration, /Product Identity DRAFT commissioning data/i);
  assert.match(migration, /existing Product Identity capture function remains the only draft writer/i);
  assert.match(migration, /public\.ecoflow_capture_product_identity\(/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.ecoflow_physical_barcode_bindings/i);
  assert.doesNotMatch(migration, /update\s+public\.ecoflow_physical_barcode_bindings/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.ecoflow_physical_barcode_bindings/i);
  assert.doesNotMatch(migration, /ecoflow_publish_product_identity_batch\s*\(/i);
});

test('reconciliation cannot mutate warehouse quantities', () => {
  for (const target of [
    'ecoflow_inventory_movements',
    'ecoflow_inventory_balances',
    'ecoflow_warehouse_receiving',
    'ecoflow_stocktake',
    'ecoflow_pick',
    'ecoflow_delivery',
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${target}`, 'i'),
    );
  }
});

test('only Owner/Admin can read the reconciliation queue or create a draft', () => {
  assert.match(migration, /v_actor_role\s+is\s+null\s+or\s+v_actor_role\s+not\s+in\s*\('OWNER','ADMIN'\)/i);
  assert.match(migration, /if not public\.ecoflow_can_publish_product_identity\(\)/i);
  assert.match(migration, /OWNER_OR_ADMIN_REQUIRED/);
  assert.match(panel, /role === 'owner' \|\| role === 'admin'/);
  assert.match(panel, /if \(!authorized\) return null/);
});

test('only direct physical evidence can seed authority and conflicts fail closed', () => {
  assert.match(migration, /evidence_source is distinct from 'OBSERVED_NOW'/);
  assert.match(migration, /SURVEY_RECONCILIATION_DIRECT_PHYSICAL_EVIDENCE_REQUIRED/);
  assert.match(migration, /SURVEY_RECONCILIATION_PHYSICAL_EVIDENCE_CONFLICT/);
  assert.match(migration, /signature_count, 0\) <> 1/);
  assert.match(migration, /latest never wins/i);
});

test('Commercial SKU resolution is unique across canonical and Ordermentum namespaces', () => {
  assert.match(migration, /s\.sku_code/i);
  assert.match(migration, /m\.provider = 'ORDERMENTUM'/);
  assert.match(migration, /m\.external_product_code/i);
  assert.match(migration, /SURVEY_RECONCILIATION_COMMERCIAL_SKU_AMBIGUOUS/);
  assert.match(migration, /SURVEY_RECONCILIATION_COMMERCIAL_SKU_NOT_FOUND/);
});

test('published barcode ownership cannot be silently reassigned', () => {
  assert.match(migration, /identity_status = 'ACTIVE'/);
  assert.match(migration, /SURVEY_RECONCILIATION_BARCODE_ALREADY_PUBLISHED/);
  assert.match(migration, /already has a published canonical owner/i);
});

test('provenance is immutable and source edits are detected', () => {
  assert.match(migration, /survey_observation_id uuid not null unique/i);
  assert.match(migration, /product_identity_observation_id uuid not null unique/i);
  assert.match(migration, /source_fingerprint text not null/i);
  assert.match(migration, /SURVEY_RECONCILIATION_SOURCE_CHANGED/);
  assert.match(migration, /SURVEY_RECONCILIATION_IDEMPOTENCY_CONFLICT/);
});

test('client exposes bounded queue read and explicit identity confirmation fields', () => {
  assert.match(repository, /ecoflow_read_barcode_survey_reconciliation_queue_v1/);
  assert.match(repository, /Math\.min\(500, Math\.max\(1, limit\)\)/);
  assert.match(repository, /ecoflow_reconcile_barcode_survey_observation_v1/);
  for (const field of [
    'physicalSkuCode',
    'physicalName',
    'familyCode',
    'familyName',
    'packageLevel',
    'unitsInBaseUnit',
    'substitutionPolicy',
  ]) {
    assert.match(repository, new RegExp(field));
  }
});

test('Owner/Admin UI exposes existing Survey evidence without editable barcode authority', () => {
  assert.match(panel, /WAREHOUSE SURVEY → PRODUCT IDENTITY/);
  assert.match(panel, /READY_TO_RECONCILE/);
  assert.match(panel, /NEEDS_IDENTITY_CONFIRMATION/);
  assert.match(panel, /DUPLICATE_CONFLICT/);
  assert.match(panel, /INSUFFICIENT_EVIDENCE/);
  assert.match(panel, /Create Product Identity draft/);
  assert.match(panel, /selected\.cartonBarcode/);
  assert.doesNotMatch(panel, /patch\('cartonBarcode'/);
  assert.doesNotMatch(panel, /patch\('barcode'/);
  for (const explicitField of ['physicalSkuCode', 'familyCode', 'packageLevel', 'unitsInBaseUnit', 'substitutionPolicy']) {
    assert.match(panel, new RegExp(explicitField));
  }
});

test('reconciliation panel is composed with existing Product Identity workspace and mounted on both Product Identity routes', () => {
  assert.match(wrapper, /<BarcodeSurveyReconciliationPanel/);
  assert.match(wrapper, /<ProductIdentityCommissioningWorkspace/);
  assert.match(route, /ProductIdentityCommissioningWithSurvey/);
  const mounts = route.match(/<ProductIdentityCommissioningWithSurvey/g) || [];
  assert.equal(mounts.length, 2, 'standalone Warehouse Product Identity and office Product Identity route must use the same guarded composition');
  assert.doesNotMatch(route, /<ProductIdentityCommissioningWorkspace/);
});

test('bounded carrier preserves the exact one-SKU START invocation without queue expansion', () => {
  const input = buildBoundedStartInput(BPB8_DRAFT_CANARY_DEFAULTS.start);
  assert.deepEqual(input, {
    batchName: '#338 BPB8 Physical Identity production canary',
    commercialSkuIds: ['ec67ca0a-67b5-437f-96a8-81e6268faa44'],
    commandId: 'bb388464-bc36-4546-a875-16ec0e890e66',
  });

  assert.match(productIdentityRepository, /ecoflow_start_bounded_product_identity_batch/);
  assert.match(productIdentityRepository, /p_batch_name:\s*input\.batchName/);
  assert.match(productIdentityRepository, /p_commercial_sku_ids:\s*input\.commercialSkuIds/);
  assert.match(productIdentityRepository, /p_command_id:\s*input\.commandId/);
  assert.match(productIdentityRepository, /scopedSkuCount:\s*safeInteger\(row\.scoped_sku_count\)/);
  assert.match(productIdentityRepository, /const client = input \?\? supabase/);
  assert.match(productIdentityRepository, /activeClient\(client\)\.rpc\(name, args\)/);
  assert.match(repository, /const client = input \?\? supabase/);
  assert.match(repository, /activeClient\(client\)\.rpc\(name, args\)/);
  assert.match(boundedCarrier, /startBoundedProductIdentityBatch\(input\)/);
  assert.doesNotMatch(boundedCarrier, /readBarcodeSurveyReconciliationQueue/);
  assert.doesNotMatch(boundedCarrier, /createProductIdentityCommandId/);
  assert.doesNotMatch(boundedCarrier, /startProductIdentityBatch\(/);
});

test('bounded carrier maps the frozen BPB8 DRAFT reconciliation payload to the actual START batch', () => {
  const input = buildBoundedReconcileInput(
    BPB8_DRAFT_CANARY_DEFAULTS.reconcile,
    'aaaaaaaa-0000-4000-8000-000000000001',
  );
  assert.deepEqual(input, {
    surveyObservationId: '5a5a63e4-2b52-43e0-b96b-6129415585ee',
    batchId: 'aaaaaaaa-0000-4000-8000-000000000001',
    commandId: '2514d56b-4b60-4db1-acba-4ea0ec88d568',
    physicalSkuCode: 'BPB8',
    physicalName: '8oz Kraft Soup Bowl 250ml',
    brand: undefined,
    supplierName: undefined,
    familyCode: 'BPB8',
    familyName: '8oz Kraft Soup Bowl 250ml',
    packageLevel: 'CARTON',
    unitsInBaseUnit: 1,
    substitutionPolicy: 'PROHIBITED',
    isPreferred: true,
    note: '#338 BPB8 production Physical Identity canary; Owner/Admin confirmed payload; carton operational base unit = 1; no inventory authority granted.',
  });
  assert.match(
    boundedCarrier,
    /buildBoundedReconcileInput\(reconcileDraft,\s*startResult\.batchId\)/,
  );
  assert.match(boundedCarrier, /reconcileBarcodeSurveyObservation\(input\)/);
  assert.doesNotMatch(boundedCarrier, /1000pcs/i);
});

test('bounded carrier is Owner/Admin-only and has no generic fallback or quantity authority', () => {
  assert.match(boundedCarrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(boundedCarrier, /if \(!authorized\) return null/);
  assert.match(boundedCarrier, /scopedSkuCount !== 1/);
  assert.match(boundedCarrier, /\['APPLIED', 'REPLAYED'\]\.includes\(startResult\.commandStatus\)/);
  assert.doesNotMatch(boundedCarrier, /startProductIdentityBatch\(/);
  assert.doesNotMatch(boundedCarrier, /\.from\s*\(/);
  assert.doesNotMatch(boundedCarrier, /service[_-]?role|auth\.uid|access[_-]?token/i);
  assert.match(wrapper, /<BoundedProductIdentityExecutionCarrier/);
});

test('bounded P2 submit preserves the exact frozen operator inputs', () => {
  const input = buildBoundedSubmitInput(BPB8_P2_SUBMIT_DEFAULTS);
  assert.deepEqual(input, {
    batchId: '448f401e-0701-4e9f-8426-5dfed67b9f78',
    expectedRevision: 1,
    commandId: '6df22bb2-506e-4be1-a752-c1e2323f431d',
    note: '#338 BPB8 P2 production submit-only canary; P1 DRAFT payload independently verified; no publish or inventory authority granted.',
  });

  assert.throws(
    () => buildBoundedSubmitInput({ ...BPB8_P2_SUBMIT_DEFAULTS, expectedRevision: '2' }),
    /fenced to expected revision 1/i,
  );
  assert.throws(
    () => buildBoundedSubmitInput({ ...BPB8_P2_SUBMIT_DEFAULTS, expectedRevision: '1.5' }),
    /safe non-negative whole number/i,
  );
  assert.throws(
    () => buildBoundedSubmitInput({ ...BPB8_P2_SUBMIT_DEFAULTS, batchId: 'aaaaaaaa-0000-4000-8000-000000000001' }),
    /fenced to the BPB8 P1 batch/i,
  );
  assert.throws(
    () => buildBoundedSubmitInput({ ...BPB8_P2_SUBMIT_DEFAULTS, commandId: 'aaaaaaaa-0000-4000-8000-000000000002' }),
    /frozen P2 command ID/i,
  );
  assert.throws(
    () => buildBoundedSubmitInput({ ...BPB8_P2_SUBMIT_DEFAULTS, note: 'changed note' }),
    /frozen P2 submit note/i,
  );
});

test('bounded P2 submit fails closed unless the authenticated read gate matches DRAFT revision 1 and canSubmit', () => {
  const input = buildBoundedSubmitInput(BPB8_P2_SUBMIT_DEFAULTS);
  const readyBatch = {
    batchId: input.batchId,
    batchStatus: 'DRAFT',
    revision: 1,
    canSubmit: true,
  };
  assert.doesNotThrow(() => assertBoundedSubmitPreflight(readyBatch, input));

  assert.throws(() => assertBoundedSubmitPreflight(null, input), /returned no current batch/i);
  assert.throws(
    () => assertBoundedSubmitPreflight({ ...readyBatch, batchId: 'aaaaaaaa-0000-4000-8000-000000000001' }, input),
    /batch ID mismatch/i,
  );
  assert.throws(() => assertBoundedSubmitPreflight({ ...readyBatch, batchStatus: 'SUBMITTED' }, input), /must be DRAFT/i);
  assert.throws(() => assertBoundedSubmitPreflight({ ...readyBatch, revision: 2 }, input), /revision mismatch/i);
  assert.throws(() => assertBoundedSubmitPreflight({ ...readyBatch, canSubmit: false }, input), /canSubmit=false/i);
});

test('bounded P2 submit accepts only the exact SUBMITTED revision 2 acknowledgement', () => {
  const input = buildBoundedSubmitInput(BPB8_P2_SUBMIT_DEFAULTS);
  for (const commandStatus of ['APPLIED', 'REPLAYED']) {
    assert.doesNotThrow(() => assertBoundedSubmitAcknowledgement({
      batchId: input.batchId,
      batchStatus: 'SUBMITTED',
      revision: 2,
      commandStatus,
    }, input));
  }
  assert.throws(() => assertBoundedSubmitAcknowledgement({
    batchId: input.batchId,
    batchStatus: 'DRAFT',
    revision: 1,
    commandStatus: 'APPLIED',
  }, input), /unexpected acknowledgement/i);
  assert.throws(() => assertBoundedSubmitAcknowledgement({
    batchId: input.batchId,
    batchStatus: 'SUBMITTED',
    revision: 2,
    commandStatus: 'CONFLICT',
  }, input), /unexpected acknowledgement/i);
});

test('bounded P2 submit reads first, calls the authenticated repository exactly, and has no publish fallback', () => {
  const submitPath = boundedCarrier.slice(
    boundedCarrier.indexOf('async function submitBoundedBatch()'),
    boundedCarrier.indexOf('async function publishBoundedBatch()'),
  );
  assert.match(submitPath, /await readCurrentProductIdentityBatch\(\)/);
  assert.match(submitPath, /assertBoundedSubmitPreflight\(currentBatch,\s*input\)/);
  assert.match(submitPath, /await submitProductIdentityBatch\(input\)/);
  assert.match(submitPath, /assertBoundedSubmitAcknowledgement\(result,\s*input\)/);
  const readIndex = submitPath.indexOf('await readCurrentProductIdentityBatch()');
  const gateIndex = submitPath.indexOf('assertBoundedSubmitPreflight(currentBatch, input)');
  const submitIndex = submitPath.indexOf('await submitProductIdentityBatch(input)');
  assert.ok(readIndex >= 0 && gateIndex > readIndex && submitIndex > gateIndex);
  assert.match(productIdentityRepository, /ecoflow_submit_product_identity_batch/);
  assert.match(productIdentityRepository, /p_batch_id:\s*input\.batchId/);
  assert.match(productIdentityRepository, /p_expected_revision:\s*input\.expectedRevision/);
  assert.match(productIdentityRepository, /p_command_id:\s*input\.commandId/);
  assert.match(productIdentityRepository, /p_note:\s*input\.note \|\| null/);
  assert.match(productIdentityRepository, /const client = input \?\? supabase/);
  assert.doesNotMatch(submitPath, /createProductIdentityCommandId|publishProductIdentityBatch|reopenProductIdentityBatch/);
  assert.match(productIdentityWorkspace, /createProductIdentityCommandId/);
  assert.match(productIdentityWorkspace, /submitProductIdentityBatch/);
});

test('bounded P3 publish preserves the exact frozen operator inputs', () => {
  const input = buildBoundedPublishInput(BPB8_P3_PUBLISH_DEFAULTS);
  assert.deepEqual(input, {
    batchId: '448f401e-0701-4e9f-8426-5dfed67b9f78',
    expectedRevision: 2,
    commandId: '973b7007-4fd5-44f6-bd43-f64aa848e299',
    note: '#338 BPB8 P3 production publish canary; P1 DRAFT and P2 SUBMIT independently verified; no inventory authority granted.',
  });

  assert.throws(() => buildBoundedPublishInput({ ...BPB8_P3_PUBLISH_DEFAULTS, batchId: 'aaaaaaaa-0000-4000-8000-000000000001' }), /fenced to the BPB8 batch/i);
  assert.throws(() => buildBoundedPublishInput({ ...BPB8_P3_PUBLISH_DEFAULTS, expectedRevision: '3' }), /fenced to expected revision 2/i);
  assert.throws(() => buildBoundedPublishInput({ ...BPB8_P3_PUBLISH_DEFAULTS, expectedRevision: '2.5' }), /safe non-negative whole number/i);
  assert.throws(() => buildBoundedPublishInput({ ...BPB8_P3_PUBLISH_DEFAULTS, commandId: 'aaaaaaaa-0000-4000-8000-000000000002' }), /frozen P3 command ID/i);
  assert.throws(() => buildBoundedPublishInput({ ...BPB8_P3_PUBLISH_DEFAULTS, note: 'changed note' }), /frozen P3 publish note/i);
});

test('bounded P3 publish fails closed unless the authenticated read gate matches SUBMITTED revision 2 and canPublish', () => {
  const input = buildBoundedPublishInput(BPB8_P3_PUBLISH_DEFAULTS);
  const readyBatch = { batchId: input.batchId, batchStatus: 'SUBMITTED', revision: 2, canPublish: true };
  assert.doesNotThrow(() => assertBoundedPublishPreflight(readyBatch, input));
  assert.throws(() => assertBoundedPublishPreflight(null, input), /returned no current batch/i);
  assert.throws(() => assertBoundedPublishPreflight({ ...readyBatch, batchId: 'aaaaaaaa-0000-4000-8000-000000000001' }, input), /batch ID mismatch/i);
  assert.throws(() => assertBoundedPublishPreflight({ ...readyBatch, batchStatus: 'DRAFT' }, input), /must be SUBMITTED/i);
  assert.throws(() => assertBoundedPublishPreflight({ ...readyBatch, revision: 1 }, input), /revision mismatch/i);
  assert.throws(() => assertBoundedPublishPreflight({ ...readyBatch, canPublish: false }, input), /canPublish=false/i);
});

test('bounded P3 publish accepts only the complete PUBLISHED revision 3 acknowledgement', () => {
  const input = buildBoundedPublishInput(BPB8_P3_PUBLISH_DEFAULTS);
  const accepted = {
    batchId: input.batchId,
    batchStatus: 'PUBLISHED',
    revision: 3,
    commandStatus: 'APPLIED',
    publishedFamilies: 1,
    publishedPhysicalSkus: 1,
    publishedBarcodes: 1,
    publishedLinks: 1,
    publishedAt: '2026-09-08T00:00:00Z',
  };
  assert.doesNotThrow(() => assertBoundedPublishAcknowledgement(accepted, input));
  assert.doesNotThrow(() => assertBoundedPublishAcknowledgement({ ...accepted, commandStatus: 'REPLAYED' }, input));
  for (const invalid of [
    { batchStatus: 'SUBMITTED' },
    { revision: 2 },
    { commandStatus: 'CONFLICT' },
    { publishedFamilies: 0 },
    { publishedPhysicalSkus: 0 },
    { publishedBarcodes: 0 },
    { publishedLinks: 0 },
    { publishedAt: null },
  ]) {
    assert.throws(() => assertBoundedPublishAcknowledgement({ ...accepted, ...invalid }, input), /unexpected acknowledgement/i);
  }
});

test('bounded P3 publish reads first, calls only the incumbent publish repository, and has no fallback authority', () => {
  const publishPath = boundedCarrier.slice(
    boundedCarrier.indexOf('async function publishBoundedBatch()'),
    boundedCarrier.indexOf('const startReady'),
  );
  const readIndex = publishPath.indexOf('await readCurrentProductIdentityBatch()');
  const gateIndex = publishPath.indexOf('assertBoundedPublishPreflight(currentBatch, input)');
  const publishIndex = publishPath.indexOf('await publishProductIdentityBatch(input)');
  const ackIndex = publishPath.indexOf('assertBoundedPublishAcknowledgement(result, input)');
  assert.ok(readIndex >= 0 && gateIndex > readIndex && publishIndex > gateIndex && ackIndex > publishIndex);
  assert.match(productIdentityRepository, /ecoflow_publish_product_identity_batch/);
  assert.match(productIdentityRepository, /p_batch_id:\s*input\.batchId/);
  assert.match(productIdentityRepository, /p_expected_revision:\s*input\.expectedRevision/);
  assert.match(productIdentityRepository, /p_command_id:\s*input\.commandId/);
  assert.match(productIdentityRepository, /p_note:\s*input\.note \|\| null/);
  assert.doesNotMatch(publishPath, /createProductIdentityCommandId|startBoundedProductIdentityBatch|reconcileBarcodeSurveyObservation|submitProductIdentityBatch|reopenProductIdentityBatch/);
  assert.doesNotMatch(publishPath, /\.from\s*\(|service[_-]?role|auth\.uid|access[_-]?token|inventory|SOH|location/i);
  assert.match(productIdentityWorkspace, /createProductIdentityCommandId/);
  assert.match(productIdentityWorkspace, /publishProductIdentityBatch/);
});

test('Batch 2 START is hard-fenced to the frozen ordered two-SKU scope and command', () => {
  const input = buildBatch2StartInput(BATCH2_PRODUCT_IDENTITY_DEFAULTS.start);
  assert.deepEqual(input, {
    batchName: '#338 Physical Identity Batch 2 low-complexity production canary',
    commercialSkuIds: [
      '16be45a8-a98d-4b15-af2e-1846817e8d98',
      '7cb8c724-35cb-4132-9437-db4c15e13fde',
    ],
    commandId: 'b34fa49b-f374-4237-8479-d9af37890de8',
  });
  for (const commercialSkuIdsText of [
    '16be45a8-a98d-4b15-af2e-1846817e8d98',
    '16be45a8-a98d-4b15-af2e-1846817e8d98\n7cb8c724-35cb-4132-9437-db4c15e13fde\naaaaaaaa-0000-4000-8000-000000000002',
    '7cb8c724-35cb-4132-9437-db4c15e13fde\n16be45a8-a98d-4b15-af2e-1846817e8d98',
  ]) {
    assert.throws(
      () => buildBatch2StartInput({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.start, commercialSkuIdsText }),
      /frozen ordered two-SKU scope/i,
    );
  }
  assert.throws(
    () => buildBatch2StartInput({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.start, commandId: 'aaaaaaaa-0000-4000-8000-000000000002' }),
    /frozen START command ID/i,
  );
});

test('Batch 2 START acknowledgement requires DRAFT revision 0, scope 2 and idempotent command status', () => {
  const input = buildBatch2StartInput(BATCH2_PRODUCT_IDENTITY_DEFAULTS.start);
  const accepted = {
    batchId: BATCH2_TEST_BATCH_ID,
    batchName: input.batchName,
    batchStatus: 'DRAFT',
    revision: 0,
    commandStatus: 'APPLIED',
    scopedSkuCount: 2,
  };
  assert.doesNotThrow(() => assertBatch2StartAcknowledgement(accepted, input));
  assert.doesNotThrow(() => assertBatch2StartAcknowledgement({ ...accepted, commandStatus: 'REPLAYED' }, input));
  for (const invalid of [
    { batchStatus: 'SUBMITTED' }, { revision: 1 }, { commandStatus: 'EXISTING' },
    { scopedSkuCount: 1 }, { batchName: 'different' },
  ]) {
    assert.throws(() => assertBatch2StartAcknowledgement({ ...accepted, ...invalid }, input), /unexpected acknowledgement/i);
  }
});

test('Batch 2 reconciliation builders preserve both frozen CARTON x 1 payloads and nullable fields', () => {
  const expected = [
    {
      key: 'FL115PLABOX',
      surveyObservationId: 'f1b087f0-d964-45cf-acb1-6818ab2b418f',
      commandId: '2353d72f-fd48-434e-a4c0-47f8d0d146ee',
      physicalSkuCode: 'FL115PLABOX',
      physicalName: 'PLA Flat Lid 12/16/24oz Soup Bowl',
      familyCode: 'FL115PLABOX',
      familyName: 'PLA Flat Lid 12/16/24oz Soup Bowl',
      barcode: '19348045010188',
      note: '#338 Batch 2 FL115PLABOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.',
    },
    {
      key: 'SB24/32/40LBOX',
      surveyObservationId: '617ad6e4-0860-4189-88e1-781c2d15d6cf',
      commandId: '9d94e547-b6da-4dc4-8829-5046258838da',
      physicalSkuCode: 'SB24/32/40LBOX',
      physicalName: 'RPET Lid Fits 24–40oz Sugarcane Food Bowl',
      familyCode: 'SB24/32/40LBOX',
      familyName: 'RPET Lid Fits 24–40oz Sugarcane Food Bowl',
      barcode: '19348045022914',
      note: '#338 Batch 2 SB24/32/40LBOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.',
    },
  ];

  for (const item of expected) {
    const draft = BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations[item.key];
    const input = buildBatch2ReconcileInput(item.key, draft, BATCH2_TEST_BATCH_ID);
    assert.deepEqual(input, {
      surveyObservationId: item.surveyObservationId,
      batchId: BATCH2_TEST_BATCH_ID,
      commandId: item.commandId,
      physicalSkuCode: item.physicalSkuCode,
      physicalName: item.physicalName,
      brand: undefined,
      supplierName: undefined,
      familyCode: item.familyCode,
      familyName: item.familyName,
      packageLevel: 'CARTON',
      unitsInBaseUnit: 1,
      substitutionPolicy: 'PROHIBITED',
      isPreferred: true,
      note: item.note,
    });
    assert.throws(
      () => buildBatch2ReconcileInput(item.key, { ...draft, unitsInBaseUnit: item.key === 'FL115PLABOX' ? '50' : '125' }, BATCH2_TEST_BATCH_ID),
      /CARTON x 1/i,
    );
    assert.throws(
      () => buildBatch2ReconcileInput(item.key, { ...draft, commandId: 'aaaaaaaa-0000-4000-8000-000000000002' }, BATCH2_TEST_BATCH_ID),
      /frozen reconciliation payload/i,
    );
  }
});

test('Batch 2 reconciliation acknowledgements and DRAFT progression fail closed', () => {
  const startInput = buildBatch2StartInput(BATCH2_PRODUCT_IDENTITY_DEFAULTS.start);
  const startResult = {
    batchId: BATCH2_TEST_BATCH_ID,
    batchName: startInput.batchName,
    batchStatus: 'DRAFT',
    revision: 0,
    commandStatus: 'APPLIED',
    scopedSkuCount: 2,
  };
  const flInput = buildBatch2ReconcileInput('FL115PLABOX', BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations.FL115PLABOX, BATCH2_TEST_BATCH_ID);
  const sbInput = buildBatch2ReconcileInput('SB24/32/40LBOX', BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations['SB24/32/40LBOX'], BATCH2_TEST_BATCH_ID);
  const flResult = { reconciliationStatus: 'DRAFTED', commercialSkuId: startInput.commercialSkuIds[0], barcode: '19348045010188', commandStatus: 'APPLIED' };
  const sbResult = { reconciliationStatus: 'DRAFTED', commercialSkuId: startInput.commercialSkuIds[1], barcode: '19348045022914', commandStatus: 'REPLAYED' };
  assert.doesNotThrow(() => assertBatch2ReconcileAcknowledgement('FL115PLABOX', flResult, flInput));
  assert.doesNotThrow(() => assertBatch2ReconcileAcknowledgement('SB24/32/40LBOX', sbResult, sbInput));
  assert.throws(
    () => assertBatch2ReconcileAcknowledgement('FL115PLABOX', { ...flResult, barcode: '50' }, flInput),
    /unexpected acknowledgement/i,
  );
  assert.doesNotThrow(() => assertBatch2DraftProgress({
    currentBatch: { batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'DRAFT', revision: 1, openTasks: 1, draftReadyTasks: 1, conflictTasks: 0 },
    startResult,
    reconciliationResults: { FL115PLABOX: flResult },
    expectedRevision: 1,
  }));
  assert.doesNotThrow(() => assertBatch2DraftProgress({
    currentBatch: { batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'DRAFT', revision: 2, openTasks: 0, draftReadyTasks: 2, conflictTasks: 0 },
    startResult,
    reconciliationResults: { FL115PLABOX: flResult, 'SB24/32/40LBOX': sbResult },
    expectedRevision: 2,
  }));
  assert.throws(() => assertBatch2DraftProgress({
    currentBatch: { batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'DRAFT', revision: 2, openTasks: 0, draftReadyTasks: 2, conflictTasks: 0 },
    startResult,
    reconciliationResults: { FL115PLABOX: flResult },
    expectedRevision: 2,
  }), /both exact reconciliations/i);
  assert.throws(() => assertBatch2DraftProgress({
    currentBatch: { batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'DRAFT', revision: 2, openTasks: 1, draftReadyTasks: 1, conflictTasks: 0 },
    startResult,
    reconciliationResults: { FL115PLABOX: flResult, 'SB24/32/40LBOX': sbResult },
    expectedRevision: 2,
  }), /task state does not prove 2 exact reconciliation/i);
});

test('Batch 2 SUBMIT is fenced to the actual START batch at revision 2 and acknowledges revision 3', () => {
  const input = buildBatch2SubmitInput(BATCH2_PRODUCT_IDENTITY_DEFAULTS.submit, BATCH2_TEST_BATCH_ID);
  assert.deepEqual(input, {
    batchId: BATCH2_TEST_BATCH_ID,
    expectedRevision: 2,
    commandId: 'bc5538d2-73e0-4aaf-987f-4b53fd8aa75d',
    note: '#338 Batch 2 production submit; two DRAFT Physical Identity payloads independently verified; no inventory authority granted.',
  });
  const preflight = { batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'DRAFT', revision: 2, canSubmit: true };
  assert.doesNotThrow(() => assertBatch2SubmitPreflight(preflight, input));
  assert.throws(() => assertBatch2SubmitPreflight({ ...preflight, revision: 1 }, input), /revision mismatch/i);
  for (const commandStatus of ['APPLIED', 'REPLAYED']) {
    assert.doesNotThrow(() => assertBatch2SubmitAcknowledgement({ batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'SUBMITTED', revision: 3, commandStatus }, input));
  }
  assert.throws(
    () => buildBatch2SubmitInput({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.submit, commandId: 'aaaaaaaa-0000-4000-8000-000000000002' }, BATCH2_TEST_BATCH_ID),
    /frozen SUBMIT command ID/i,
  );
});

test('Batch 2 PUBLISH requires revision 3 and exact 2/2/2/2 revision 4 acknowledgement', () => {
  const input = buildBatch2PublishInput(BATCH2_PRODUCT_IDENTITY_DEFAULTS.publish, BATCH2_TEST_BATCH_ID);
  const preflight = { batchId: BATCH2_TEST_BATCH_ID, batchStatus: 'SUBMITTED', revision: 3, canPublish: true };
  assert.doesNotThrow(() => assertBatch2PublishPreflight(preflight, input));
  assert.throws(() => assertBatch2PublishPreflight({ ...preflight, canPublish: false }, input), /canPublish=false/i);
  const accepted = {
    batchId: BATCH2_TEST_BATCH_ID,
    batchStatus: 'PUBLISHED',
    revision: 4,
    commandStatus: 'APPLIED',
    publishedFamilies: 2,
    publishedPhysicalSkus: 2,
    publishedBarcodes: 2,
    publishedLinks: 2,
    publishedAt: '2026-09-09T00:00:00Z',
  };
  assert.doesNotThrow(() => assertBatch2PublishAcknowledgement(accepted, input));
  assert.doesNotThrow(() => assertBatch2PublishAcknowledgement({ ...accepted, commandStatus: 'REPLAYED' }, input));
  for (const invalid of [
    { revision: 3 }, { publishedFamilies: 1 }, { publishedPhysicalSkus: 1 },
    { publishedBarcodes: 1 }, { publishedLinks: 1 }, { publishedAt: null },
  ]) {
    assert.throws(() => assertBatch2PublishAcknowledgement({ ...accepted, ...invalid }, input), /unexpected acknowledgement/i);
  }
});

test('Batch 2 carrier uses only explicit authenticated incumbent calls in strict lifecycle order', () => {
  assert.match(batch2Carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(batch2Carrier, /if \(!authorized\) return null/);
  assert.match(wrapper, /<Batch2ProductIdentityExecutionCarrier/);
  assert.match(batch2Carrier, /startBoundedProductIdentityBatch\(input\)/);
  assert.equal((batch2Carrier.match(/reconcileBarcodeSurveyObservation\(input\)/g) || []).length, 2);
  assert.equal((batch2Carrier.match(/await readCurrentProductIdentityBatch\(\)/g) || []).length, 4);
  for (const marker of [
    "async function startBatch2()", "async function reconcileFl()", "async function reconcileSb()",
    "async function submitBatch2()", "async function publishBatch2()",
  ]) assert.match(batch2Carrier, new RegExp(marker.replace(/[()]/g, '\\$&')));
  assert.doesNotMatch(batch2Carrier, /createProductIdentityCommandId|startProductIdentityBatch\(|readBarcodeSurveyReconciliationQueue|reopenProductIdentityBatch/);
  assert.doesNotMatch(batch2Carrier, /\.from\s*\(|service[_-]?role|auth\.uid|access[_-]?token/i);
  assert.doesNotMatch(batch2Carrier, /inventory|SOH|opening balance|stocktake|receiving|pick|cutover|#339B/i);
  assert.doesNotMatch(batch2Carrier, /50pcs|125pcs/i);
});

test('Batch 2 carrier keeps actions independent and preserves BPB8 and generic workspace behavior', () => {
  const flPath = batch2Carrier.slice(batch2Carrier.indexOf('async function reconcileFl()'), batch2Carrier.indexOf('async function reconcileSb()'));
  const sbPath = batch2Carrier.slice(batch2Carrier.indexOf('async function reconcileSb()'), batch2Carrier.indexOf('async function submitBatch2()'));
  const submitPath = batch2Carrier.slice(batch2Carrier.indexOf('async function submitBatch2()'), batch2Carrier.indexOf('async function publishBatch2()'));
  const publishPath = batch2Carrier.slice(batch2Carrier.indexOf('async function publishBatch2()'), batch2Carrier.indexOf('const startReady'));
  assert.doesNotMatch(flPath, /reconcileSb|submitProductIdentityBatch|publishProductIdentityBatch/);
  assert.doesNotMatch(sbPath, /submitProductIdentityBatch|publishProductIdentityBatch/);
  assert.doesNotMatch(submitPath, /publishProductIdentityBatch|reconcileBarcodeSurveyObservation/);
  assert.doesNotMatch(publishPath, /submitProductIdentityBatch|reconcileBarcodeSurveyObservation/);
  assert.match(boundedCarrier, /BPB8_DRAFT_CANARY_DEFAULTS/);
  assert.match(boundedCarrier, /scopedSkuCount !== 1/);
  assert.match(productIdentityWorkspace, /createProductIdentityCommandId/);
  assert.match(productIdentityWorkspace, /startProductIdentityBatch/);
});
