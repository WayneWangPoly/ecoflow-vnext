import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260909171000_ordermentum_sku_normalization.sql';
const workflowPath = '.github/workflows/ordermentum-sku-normalization-check.yml';
const [migration, workflow] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(workflowPath, 'utf8'),
]);

test('canonical Ordermentum SKU identity is exactly upper(btrim), not fuzzy matching', () => {
  assert.match(migration, /create or replace function public\.ecoflow_canonical_ordermentum_sku_code/i);
  assert.match(migration, /nullif\(upper\(btrim\(p_code\)\),''\)/i);
  assert.doesNotMatch(migration, /levenshtein|similarity\s*\(|soundex|metaphone|fuzzy/i);
});

test('normalized collisions are visible and fail closed across all three reviewed namespaces', () => {
  assert.match(migration, /v_ecoflow_ordermentum_sku_normalization_collisions/i);
  for (const source of ['EXTERNAL_PRODUCT_MAPPING', 'BARCODE_CONFIRMATION', 'RAW_ORDER_LINE']) {
    assert.match(migration, new RegExp(`'${source}'`));
  }
  assert.match(migration, /having count\(distinct raw_code\)>1[\s\S]*or count\(distinct authority_target\)>1/i);
  assert.match(migration, /not exists\([\s\S]*v_ecoflow_ordermentum_sku_normalization_collisions/i);
});

test('release gate, barcode workbench and internalisation use the same comparator', () => {
  assert.match(migration, /create or replace view public\.v_ecoflow_ordermentum_barcode_confirmation_workbench/i);
  assert.match(migration, /create or replace view public\.v_ecoflow_ordermentum_release_gate_v3/i);
  assert.match(migration, /create or replace function public\.ecoflow_internalise_ordermentum_orders/i);
  assert.ok((migration.match(/ecoflow_canonical_ordermentum_sku_code\(/g) || []).length >= 20);
  assert.doesNotMatch(migration, /m\.external_product_code\s*=\s*l\.external_sku_code/i);
  assert.doesNotMatch(migration, /bc\.external_sku_code\s*=\s*l\.external_sku_code/i);
  assert.match(migration, /on conflict on constraint ecoflow_ordermentum_internal_orders_raw_order_id_key/i);
  assert.match(migration, /returning public\.ecoflow_ordermentum_internal_order_lines\.internal_order_id/i);
  assert.equal((migration.match(/m\.is_active=true/g) || []).length, 4);
});

test('migration preserves raw evidence and contains no production data rewrite', () => {
  assert.doesNotMatch(migration, /update\s+public\.(?:external_product_mappings|ecoflow_sku_barcode_confirmations)/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.v_ecoflow_ordermentum_order_lines/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.(?:external_product_mappings|ecoflow_sku_barcode_confirmations)/i);
  assert.match(migration, /l\.external_sku_code/);
});

test('dedicated exact-head workflow runs static, database, type and build gates', () => {
  assert.match(workflow, /scripts\/ordermentum-sku-normalization-contract\.test\.mjs/);
  assert.match(workflow, /scripts\/ordermentum-sku-normalization-fixture\.sql/);
  assert.match(workflow, /scripts\/ordermentum-sku-normalization-db-contract-test\.sql/);
  assert.match(workflow, /20260909171000_ordermentum_sku_normalization\.sql/);
  assert.match(workflow, /tsc -b --pretty false/);
  assert.match(workflow, /vite\.js build/);
});
