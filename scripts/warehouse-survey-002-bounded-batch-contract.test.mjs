import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260903172543_product_identity_bounded_batch.sql';
const workflowPath = '.github/workflows/warehouse-survey-002-reconciliation-check.yml';
const [migration, workflow] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(workflowPath, 'utf8'),
]);

test('repair adds an immutable scope envelope, not another identity authority', () => {
  assert.match(migration, /create table public\.ecoflow_product_identity_batch_scope_items/i);
  assert.match(migration, /PRODUCT_IDENTITY_BATCH_SCOPE_IMMUTABLE/);
  assert.match(migration, /existing Product Identity authority/i);
  for (const table of [
    'ecoflow_sku_families',
    'ecoflow_physical_skus',
    'ecoflow_physical_sku_packages',
    'ecoflow_physical_barcode_bindings',
    'ecoflow_commercial_family_links',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`insert\\s+into\\s+public\\.${table}`, 'i'));
  }
});

test('bounded start is explicit, Owner/Admin-only, idempotent and concurrency fenced', () => {
  assert.match(migration, /ecoflow_start_bounded_product_identity_batch\s*\(/i);
  assert.match(migration, /p_commercial_sku_ids uuid\[\]/i);
  assert.match(migration, /ecoflow_can_publish_product_identity\(\)/i);
  assert.match(migration, /OWNER_OR_ADMIN_REQUIRED/);
  assert.match(migration, /command_payload_sha256/);
  assert.match(migration, /PRODUCT_IDENTITY_COMMAND_REPLAY_PAYLOAD_MISMATCH/);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /PRODUCT_IDENTITY_OPEN_BATCH_SCOPE_CONFLICT/);
});

test('only selected unresolved Commercial SKU tasks enter the batch', () => {
  assert.match(migration, /from pg_catalog\.unnest\(p_commercial_sku_ids\)/i);
  assert.match(migration, /batch_id=excluded\.batch_id/i);
  assert.match(migration, /PRODUCT_IDENTITY_BOUNDED_SCOPE_NOT_ELIGIBLE/);
  assert.doesNotMatch(migration, /from public\.skus s\s+where exists[\s\S]+automatically pick up/i);
});

test('observation trigger prevents scope escape while legacy batches remain compatible', () => {
  assert.match(migration, /ecoflow_guard_product_identity_observation_scope/i);
  assert.match(migration, /PRODUCT_IDENTITY_COMMERCIAL_SKU_OUT_OF_BATCH_SCOPE/);
  assert.match(migration, /if exists\([\s\S]+batch_scope_items[\s\S]+and not exists/i);
});

test('scope table is RLS protected and browser read-only', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /for select to authenticated/i);
  assert.match(migration, /revoke all on table[\s\S]+public,anon,authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete)/i);
  assert.match(migration, /security definer\s+set search_path=''/i);
});

test('repair cannot write operational quantity authorities', () => {
  for (const table of [
    'ecoflow_inventory_movements',
    'ecoflow_warehouse_movements',
    'ecoflow_warehouse_location_items',
    'ecoflow_stocktake',
    'ecoflow_receiving',
    'ecoflow_pick',
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${table}`, 'i'),
    );
  }
});

test('PostgreSQL contract runs repair before the existing golden-path contract', () => {
  const applyIndex = workflow.indexOf('20260903172543_product_identity_bounded_batch.sql');
  const repairIndex = workflow.indexOf('warehouse-survey-002-bounded-batch-db-contract-test.sql');
  const bridgeIndex = workflow.indexOf('warehouse-survey-002-db-contract-test.sql');
  assert.ok(applyIndex >= 0 && repairIndex > applyIndex);
  assert.ok(bridgeIndex > repairIndex);
  assert.match(workflow, /postgres:17/);
});
