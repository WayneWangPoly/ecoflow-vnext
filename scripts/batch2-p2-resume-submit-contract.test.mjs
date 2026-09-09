import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BATCH2_P2_RESUME_TARGET,
  assertBatch2P2ResumeEvidence,
  assertBatch2P2SubmitAcknowledgement,
  buildBatch2P2SubmitInput,
  formatBatch2P2ResumeFailure,
} from '../src/features/productIdentity/batch2P2ResumeSubmitContract.ts';

const carrierPath = 'src/features/productIdentity/Batch2P2ResumeSubmitCarrier.tsx';
const evidenceRepositoryPath = 'src/data/repositories/batch2P2ResumeEvidence.ts';
const wrapperPath = 'src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx';
const unchangedPaths = new Map([
  ['src/features/productIdentity/Batch2ProductIdentityExecutionCarrier.tsx', 'b87b658d98c69aa9c8469d7d145c460ace00c955'],
  ['src/features/productIdentity/batch2ProductIdentityCarrierContract.ts', '5002e2a6cc6734463fbc0032402eb80d062592da'],
  ['src/features/productIdentity/BoundedProductIdentityExecutionCarrier.tsx', '49d6216bdafea0e71c542e89e36e099e62cbcd6d'],
  ['src/features/productIdentity/boundedProductIdentityCarrierContract.ts', 'bfcede1c46b84a8181571e661e38136746b18a30'],
  ['src/features/productIdentity/ProductIdentityCommissioningWorkspace.tsx', '4037bcab1b76baa2e30af0f19f5c7c52ce3e1b79'],
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

function expectedNote(target) {
  const item = BATCH2_P2_RESUME_TARGET.identities[target];
  return `SURVEY_OBSERVATION=${item.surveyObservationId} | ${item.note}`;
}

function payload(target) {
  const item = BATCH2_P2_RESUME_TARGET.identities[target];
  return {
    batchId: BATCH2_P2_RESUME_TARGET.batchId,
    commercialSkuId: item.commercialSkuId,
    physicalSkuCode: item.physicalSkuCode,
    physicalName: item.physicalName,
    brand: null,
    supplier: null,
    familyCode: item.familyCode,
    familyName: item.familyName,
    barcode: item.barcode,
    packageLevel: 'CARTON',
    units: 1,
    policy: 'PROHIBITED',
    preferred: true,
    note: expectedNote(target),
  };
}

function fixture() {
  const target = BATCH2_P2_RESUME_TARGET;
  const fl = target.identities.FL115PLABOX;
  const sb = target.identities['SB24/32/40LBOX'];
  return {
    currentBatch: {
      batchId: target.batchId,
      batchName: target.batchName,
      batchStatus: 'DRAFT',
      revision: 2,
      openTasks: 0,
      draftReadyTasks: 2,
      conflictTasks: 0,
      canSubmit: true,
    },
    evidence: {
      batches: [{
        id: target.batchId,
        batch_name: target.batchName,
        batch_status: 'DRAFT',
        revision: 2,
        start_command_id: target.startCommandId,
        submit_command_id: null,
        publish_command_id: null,
        submitted_at: null,
        published_at: null,
      }],
      scopeItems: [
        { batch_id: target.batchId, commercial_sku_id: fl.commercialSkuId, start_command_id: target.startCommandId },
        { batch_id: target.batchId, commercial_sku_id: sb.commercialSkuId, start_command_id: target.startCommandId },
      ],
      reconciliations: [
        {
          survey_observation_id: fl.surveyObservationId,
          batch_id: target.batchId,
          product_identity_observation_id: ids.flObservation,
          command_id: fl.reconciliationCommandId,
          commercial_sku_id: fl.commercialSkuId,
          carton_barcode: fl.barcode,
          reconciliation_status: 'DRAFTED',
        },
        {
          survey_observation_id: sb.surveyObservationId,
          batch_id: target.batchId,
          product_identity_observation_id: ids.sbObservation,
          command_id: sb.reconciliationCommandId,
          commercial_sku_id: sb.commercialSkuId,
          carton_barcode: sb.barcode,
          reconciliation_status: 'DRAFTED',
        },
      ],
      observations: [
        {
          id: ids.flObservation,
          batch_id: target.batchId,
          command_id: fl.reconciliationCommandId,
          commercial_sku_id: fl.commercialSkuId,
          physical_sku_id: ids.flPhysical,
          family_id: ids.flFamily,
          barcode: fl.barcode,
          package_level: 'CARTON',
          units_in_base_unit: 1,
          substitution_policy: 'PROHIBITED',
          is_preferred: true,
          observation_status: 'DRAFTED',
          payload: payload('FL115PLABOX'),
        },
        {
          id: ids.sbObservation,
          batch_id: target.batchId,
          command_id: sb.reconciliationCommandId,
          commercial_sku_id: sb.commercialSkuId,
          physical_sku_id: ids.sbPhysical,
          family_id: ids.sbFamily,
          barcode: sb.barcode,
          package_level: 'CARTON',
          units_in_base_unit: 1,
          substitution_policy: 'PROHIBITED',
          is_preferred: true,
          observation_status: 'DRAFTED',
          payload: payload('SB24/32/40LBOX'),
        },
      ],
      families: [
        { id: ids.flFamily, family_code: fl.familyCode, family_name: fl.familyName, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
        { id: ids.sbFamily, family_code: sb.familyCode, family_name: sb.familyName, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
      ],
      physicalSkus: [
        { id: ids.flPhysical, physical_sku_code: fl.physicalSkuCode, display_name: fl.physicalName, brand: null, supplier_name: null, family_id: ids.flFamily, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
        { id: ids.sbPhysical, physical_sku_code: sb.physicalSkuCode, display_name: sb.physicalName, brand: null, supplier_name: null, family_id: ids.sbFamily, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
      ],
      packages: [
        { id: ids.flPackage, physical_sku_id: ids.flPhysical, package_level: 'CARTON', units_in_base_unit: 1, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
        { id: ids.sbPackage, physical_sku_id: ids.sbPhysical, package_level: 'CARTON', units_in_base_unit: 1, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
      ],
      barcodeBindings: [
        { barcode: fl.barcode, physical_sku_id: ids.flPhysical, package_id: ids.flPackage, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
        { barcode: sb.barcode, physical_sku_id: ids.sbPhysical, package_id: ids.sbPackage, identity_status: 'DRAFT', created_in_batch_id: target.batchId },
      ],
      commercialFamilyLinks: [
        { commercial_sku_id: fl.commercialSkuId, family_id: ids.flFamily, preferred_physical_sku_id: ids.flPhysical, substitution_policy: 'PROHIBITED', identity_status: 'DRAFT', created_in_batch_id: target.batchId },
        { commercial_sku_id: sb.commercialSkuId, family_id: ids.sbFamily, preferred_physical_sku_id: ids.sbPhysical, substitution_policy: 'PROHIBITED', identity_status: 'DRAFT', created_in_batch_id: target.batchId },
      ],
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

function rejects(mutator, pattern = /HOLD/) {
  const value = fixture();
  mutator(value);
  assert.throws(() => assertBatch2P2ResumeEvidence(value.currentBatch, value.evidence), pattern);
}

test('fresh-session gate accepts only the exact current DRAFT rev2 authority state', () => {
  const value = fixture();
  assert.doesNotThrow(() => assertBatch2P2ResumeEvidence(value.currentBatch, value.evidence));
  for (const [field, replacement] of [
    ['batchId', 'aaaaaaaa-0000-4000-8000-000000000999'],
    ['batchStatus', 'SUBMITTED'],
    ['revision', 1],
    ['openTasks', 1],
    ['draftReadyTasks', 1],
    ['conflictTasks', 1],
    ['canSubmit', false],
  ]) rejects((draft) => { draft.currentBatch[field] = replacement; });
});

test('batch row and exact two-SKU scope are fail-closed', () => {
  for (const [field, replacement] of [
    ['id', 'aaaaaaaa-0000-4000-8000-000000000999'], ['batch_name', 'changed'], ['batch_status', 'SUBMITTED'], ['revision', 3],
    ['start_command_id', 'aaaaaaaa-0000-4000-8000-000000000999'],
    ['submit_command_id', 'aaaaaaaa-0000-4000-8000-000000000998'],
    ['publish_command_id', 'aaaaaaaa-0000-4000-8000-000000000997'],
    ['submitted_at', '2026-09-09T00:00:00Z'], ['published_at', '2026-09-09T00:00:00Z'],
  ]) rejects((draft) => { draft.evidence.batches[0][field] = replacement; });
  rejects((draft) => { draft.evidence.batches.push(clone(draft.evidence.batches[0])); });
  rejects((draft) => { draft.evidence.scopeItems.pop(); }, /HOLD.*scope/i);
  rejects((draft) => { draft.evidence.scopeItems.shift(); }, /HOLD.*scope/i);
  rejects((draft) => { draft.evidence.scopeItems.push({ ...draft.evidence.scopeItems[0], commercial_sku_id: 'aaaaaaaa-0000-4000-8000-000000000999' }); }, /HOLD.*scope/i);
  rejects((draft) => { draft.evidence.scopeItems[0].batch_id = 'aaaaaaaa-0000-4000-8000-000000000999'; }, /HOLD.*scope/i);
  rejects((draft) => { draft.evidence.scopeItems[0].start_command_id = 'aaaaaaaa-0000-4000-8000-000000000998'; }, /HOLD.*scope/i);
});

test('both exact reconciliation records and observation mappings are required', () => {
  rejects((draft) => { draft.evidence.reconciliations.pop(); }, /HOLD.*reconciliation/i);
  for (const field of ['survey_observation_id', 'command_id', 'commercial_sku_id', 'carton_barcode']) {
    rejects((draft) => { draft.evidence.reconciliations[0][field] = 'aaaaaaaa-0000-4000-8000-000000000999'; }, /HOLD.*reconciliation/i);
  }
  rejects((draft) => { draft.evidence.reconciliations[1].command_id = '9d94e547-b6da-4dc1-8829-5046258838da'; }, /HOLD.*reconciliation/i);
  rejects((draft) => { draft.evidence.reconciliations[0].reconciliation_status = 'CONFLICT'; }, /HOLD.*reconciliation/i);
  rejects((draft) => { draft.evidence.observations.pop(); }, /HOLD.*observation/i);
  for (const field of ['command_id', 'commercial_sku_id', 'barcode', 'package_level', 'units_in_base_unit', 'substitution_policy', 'is_preferred', 'observation_status']) {
    rejects((draft) => { draft.evidence.observations[0][field] = field === 'is_preferred' ? false : 'changed'; }, /HOLD.*observation/i);
  }
});

test('stored observation payloads require exact names, CARTON x 1, null parties, policy, preferred and provenance note', () => {
  for (const [field, replacement] of [
    ['physicalSkuCode', 'changed'], ['physicalName', 'changed'], ['familyCode', 'changed'], ['familyName', 'changed'],
    ['barcode', 'changed'], ['packageLevel', 'SLEEVE'], ['units', 50], ['policy', 'ALLOWED'], ['preferred', false],
    ['brand', 'Brand'], ['supplier', 'Supplier'], ['note', 'missing provenance'],
  ]) rejects((draft) => { draft.evidence.observations[0].payload[field] = replacement; }, /HOLD.*payload/i);
  rejects((draft) => { draft.evidence.observations[1].payload.units = 125; }, /HOLD.*payload/i);
});

test('exact DRAFT families and Physical SKUs preserve both frozen identities', () => {
  rejects((draft) => { draft.evidence.families.pop(); }, /HOLD.*family/i);
  rejects((draft) => { draft.evidence.families[0].family_code = 'changed'; }, /HOLD.*family/i);
  rejects((draft) => { draft.evidence.families[1].family_name = 'changed'; }, /HOLD.*family/i);
  rejects((draft) => { draft.evidence.families[0].identity_status = 'ACTIVE'; }, /HOLD.*family/i);
  rejects((draft) => { draft.evidence.physicalSkus.pop(); }, /HOLD.*Physical/i);
  for (const [field, replacement] of [
    ['physical_sku_code', 'changed'], ['display_name', 'changed'], ['brand', 'Brand'],
    ['supplier_name', 'Supplier'], ['family_id', ids.sbFamily], ['identity_status', 'ACTIVE'],
  ]) rejects((draft) => { draft.evidence.physicalSkus[0][field] = replacement; }, /HOLD.*Physical/i);
});

test('exact DRAFT package, barcode and Commercial-family link graphs are required', () => {
  rejects((draft) => { draft.evidence.packages.pop(); }, /HOLD.*package/i);
  for (const [field, replacement] of [['package_level', 'SLEEVE'], ['units_in_base_unit', 50], ['identity_status', 'ACTIVE']]) {
    rejects((draft) => { draft.evidence.packages[0][field] = replacement; }, /HOLD.*package/i);
  }
  rejects((draft) => { draft.evidence.packages[1].units_in_base_unit = 125; }, /HOLD.*package/i);
  rejects((draft) => { draft.evidence.barcodeBindings.pop(); }, /HOLD.*barcode/i);
  for (const field of ['barcode', 'physical_sku_id', 'package_id', 'identity_status']) {
    rejects((draft) => { draft.evidence.barcodeBindings[0][field] = 'changed'; }, /HOLD.*barcode/i);
  }
  rejects((draft) => { draft.evidence.commercialFamilyLinks.pop(); }, /HOLD.*link/i);
  for (const [field, replacement] of [
    ['commercial_sku_id', 'changed'], ['family_id', 'changed'], ['preferred_physical_sku_id', 'changed'],
    ['substitution_policy', 'ALLOWED'], ['identity_status', 'ACTIVE'],
  ]) rejects((draft) => { draft.evidence.commercialFamilyLinks[0][field] = replacement; }, /HOLD.*link/i);
});

test('SUBMIT input and acknowledgement are frozen to one revisioned command', () => {
  assert.deepEqual(buildBatch2P2SubmitInput(), {
    batchId: '97fd2036-d0ff-492d-8ae7-1c9c0e09e526',
    expectedRevision: 2,
    commandId: 'bc5538d2-73e0-4aaf-987f-4b53fd8aa75d',
    note: '#338 Batch 2 production submit; two DRAFT Physical Identity payloads independently verified; no inventory authority granted.',
  });
  for (const commandStatus of ['APPLIED', 'REPLAYED']) {
    assert.doesNotThrow(() => assertBatch2P2SubmitAcknowledgement({
      batchId: BATCH2_P2_RESUME_TARGET.batchId,
      batchStatus: 'SUBMITTED',
      revision: 3,
      commandStatus,
    }));
  }
  for (const invalid of [
    { batchId: 'changed' }, { batchStatus: 'DRAFT' }, { revision: 2 },
    { commandStatus: 'EXISTING' }, { commandStatus: 'CONFLICT' },
  ]) assert.throws(() => assertBatch2P2SubmitAcknowledgement({ batchId: BATCH2_P2_RESUME_TARGET.batchId, batchStatus: 'SUBMITTED', revision: 3, commandStatus: 'APPLIED', ...invalid }), /acknowledgement/i);
});

test('pre-command read failures and post-command uncertainty have truthful terminal messages', () => {
  for (const failure of [new Error('current batch read failed'), new Error('evidence read failed')]) {
    const message = formatBatch2P2ResumeFailure(failure, false);
    assert.match(message, /^HOLD —/);
    assert.match(message, /SUBMIT was not called\.$/);
    assert.doesNotMatch(message, /may have been called/);
  }

  const transport = formatBatch2P2ResumeFailure(new Error('network response unavailable'), true);
  assert.match(transport, /^HOLD — SUBMIT may have been called\./);
  assert.match(transport, /Do not retry/);
  assert.match(transport, /read-only server verification is required/i);
  assert.doesNotMatch(transport, /SUBMIT was not called/);

  let invalidAcknowledgement;
  try {
    assertBatch2P2SubmitAcknowledgement({
      batchId: BATCH2_P2_RESUME_TARGET.batchId,
      batchStatus: 'SUBMITTED',
      revision: 2,
      commandStatus: 'APPLIED',
    });
  } catch (error) {
    invalidAcknowledgement = formatBatch2P2ResumeFailure(error, true);
  }
  assert.match(invalidAcknowledgement, /^HOLD — SUBMIT may have been called\./);
  assert.match(invalidAcknowledgement, /acknowledgement/i);
  assert.match(invalidAcknowledgement, /Do not retry/);
});

test('fresh-session carrier reads canonical server evidence before the one incumbent SUBMIT call', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(carrier, /if \(!authorized\) return null/);
  assert.match(carrier, /Read exact server gate, then submit Batch 2 P2/);
  assert.doesNotMatch(carrier, /startResult|flResult|sbResult|draftBatchAfterFl|draftBatchAfterSb/);
  assert.equal((carrier.match(/submitProductIdentityBatch\(input\)/g) || []).length, 1);
  const currentRead = carrier.indexOf('await readCurrentProductIdentityBatch()');
  const evidenceRead = carrier.indexOf('await readBatch2P2ResumeEvidence()');
  const assertion = carrier.indexOf('assertBatch2P2ResumeEvidence(currentBatch, serverEvidence)');
  const attempted = carrier.indexOf('setCommandAttempted(true)');
  const submit = carrier.indexOf('await submitProductIdentityBatch(input)');
  assert.ok(currentRead >= 0 && currentRead < evidenceRead && evidenceRead < assertion && assertion < attempted && attempted < submit);
  assert.match(carrier, /const \[commandAttempted, setCommandAttempted\] = useState\(false\)/);
  assert.match(carrier, /disabled=\{busy \|\| commandAttempted \|\| result !== null\}/);
  assert.match(carrier, /formatBatch2P2ResumeFailure\(error, commandCrossedBoundary\)/);
  assert.match(carrier, /SUBMITTED rev3 — STOP\. PUBLISH requires separate execution\./);
  assert.doesNotMatch(carrier, /<(?:input|textarea|select)\b/);
  assert.doesNotMatch(carrier, /publishProductIdentityBatch|startBoundedProductIdentityBatch|startProductIdentityBatch|reconcileBarcodeSurveyObservation|createProductIdentityCommandId|reopenProductIdentityBatch/);
  assert.doesNotMatch(carrier, /onClick[^\n]*(publish|start|reconcile)/i);
  assert.doesNotMatch(carrier, /service[_-]?role|access[_-]?token|jwt|inventory|stocktake|receiving|opening balance|SOH|cutover|#339B/i);
  assert.match(wrapper, /<Batch2P2ResumeSubmitCarrier/);
});

test('evidence repository hydrates the nine exact RLS read paths with SELECT only', () => {
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
  ]) assert.match(evidenceRepository, new RegExp(`\\.from\\('${table}'\\)`));
  assert.equal((evidenceRepository.match(/\.select\(/g) || []).length, 9);
  assert.doesNotMatch(evidenceRepository, /\.(?:insert|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(evidenceRepository, /\.rpc\s*\(|service[_-]?role|access[_-]?token|jwt/i);
});

test('original Batch 2, BPB8 and generic Product Identity carriers remain byte-identical to base', async () => {
  for (const [path, expected] of unchangedPaths) {
    const content = await readFile(path);
    const header = Buffer.from(`blob ${content.length}\0`);
    assert.equal(createHash('sha1').update(header).update(content).digest('hex'), expected, path);
  }
});
