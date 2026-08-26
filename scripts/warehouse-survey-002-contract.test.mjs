import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260826093000_warehouse_survey_002_product_identity_reconciliation.sql';
const repositoryPath = 'src/data/repositories/barcodeSurveyReconciliation.ts';

const [migration, repository] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
]);

test('reconciliation is a draft-only provenance bridge, not a second barcode authority', () => {
  assert.match(migration, /existing Product Identity DRAFT commissioning data/i);
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
