import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BPB8_DRAFT_CANARY_DEFAULTS,
  BPB8_P2_SUBMIT_DEFAULTS,
  assertBoundedSubmitAcknowledgement,
  assertBoundedSubmitPreflight,
  buildBoundedReconcileInput,
  buildBoundedStartInput,
  buildBoundedSubmitInput,
} from '../src/features/productIdentity/boundedProductIdentityCarrierContract.ts';

const migrationPath = 'supabase/migrations/20260826093000_warehouse_survey_002_product_identity_reconciliation.sql';
const repositoryPath = 'src/data/repositories/barcodeSurveyReconciliation.ts';
const panelPath = 'src/features/productIdentity/BarcodeSurveyReconciliationPanel.tsx';
const wrapperPath = 'src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx';
const boundedCarrierPath = 'src/features/productIdentity/BoundedProductIdentityExecutionCarrier.tsx';
const boundedContractPath = 'src/features/productIdentity/boundedProductIdentityCarrierContract.ts';
const productIdentityRepositoryPath = 'src/data/repositories/productIdentity.ts';
const productIdentityWorkspacePath = 'src/features/productIdentity/ProductIdentityCommissioningWorkspace.tsx';
const routePath = 'src/features/operationalRoutes/UnifiedOperationalRoutes.tsx';

const [migration, repository, panel, wrapper, boundedCarrier, boundedContract, productIdentityRepository, productIdentityWorkspace, route] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(panelPath, 'utf8'),
  readFile(wrapperPath, 'utf8'),
  readFile(boundedCarrierPath, 'utf8'),
  readFile(boundedContractPath, 'utf8'),
  readFile(productIdentityRepositoryPath, 'utf8'),
  readFile(productIdentityWorkspacePath, 'utf8'),
  readFile(routePath, 'utf8'),
]);

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

test('bounded carrier is Owner/Admin-only and has no generic fallback, publish or quantity authority', () => {
  assert.match(boundedCarrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(boundedCarrier, /if \(!authorized\) return null/);
  assert.match(boundedCarrier, /scopedSkuCount !== 1/);
  assert.match(boundedCarrier, /\['APPLIED', 'REPLAYED'\]\.includes\(startResult\.commandStatus\)/);
  assert.doesNotMatch(boundedCarrier, /startProductIdentityBatch\(|publishProductIdentityBatch/);
  assert.doesNotMatch(boundedCarrier, /973b7007-4fd5-44f6-bd43-f64aa848e299/);
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

test('bounded P2 submit reads first, calls the authenticated repository exactly, and cannot publish', () => {
  assert.match(boundedCarrier, /await readCurrentProductIdentityBatch\(\)/);
  assert.match(boundedCarrier, /assertBoundedSubmitPreflight\(currentBatch,\s*input\)/);
  assert.match(boundedCarrier, /await submitProductIdentityBatch\(input\)/);
  assert.match(boundedCarrier, /assertBoundedSubmitAcknowledgement\(result,\s*input\)/);
  const readIndex = boundedCarrier.indexOf('await readCurrentProductIdentityBatch()');
  const gateIndex = boundedCarrier.indexOf('assertBoundedSubmitPreflight(currentBatch, input)');
  const submitIndex = boundedCarrier.indexOf('await submitProductIdentityBatch(input)');
  assert.ok(readIndex >= 0 && gateIndex > readIndex && submitIndex > gateIndex);
  assert.match(productIdentityRepository, /ecoflow_submit_product_identity_batch/);
  assert.match(productIdentityRepository, /p_batch_id:\s*input\.batchId/);
  assert.match(productIdentityRepository, /p_expected_revision:\s*input\.expectedRevision/);
  assert.match(productIdentityRepository, /p_command_id:\s*input\.commandId/);
  assert.match(productIdentityRepository, /p_note:\s*input\.note \|\| null/);
  assert.match(productIdentityRepository, /const client = input \?\? supabase/);
  assert.doesNotMatch(boundedCarrier, /createProductIdentityCommandId/);
  assert.doesNotMatch(boundedCarrier, /publishProductIdentityBatch|ecoflow_publish_product_identity_batch/);
  assert.doesNotMatch(boundedCarrier, /973b7007-4fd5-44f6-bd43-f64aa848e299/);
  assert.doesNotMatch(boundedContract, /973b7007-4fd5-44f6-bd43-f64aa848e299/);
  assert.match(productIdentityWorkspace, /createProductIdentityCommandId/);
  assert.match(productIdentityWorkspace, /submitProductIdentityBatch/);
});
