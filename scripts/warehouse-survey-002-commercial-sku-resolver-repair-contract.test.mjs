import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260918135648_warehouse_survey_002_commercial_sku_resolver_repair.sql',
  'utf8',
);

test('repair prefers Commercial authority without breaking Survey-first inventory fallback', () => {
  assert.match(
    migration,
    /create or replace function public\.ecoflow_get_barcode_survey_packaging_evidence_v1/,
  );
  assert.match(migration, /from public\.skus s/);
  assert.match(migration, /from public\.external_product_mappings m/);
  assert.match(migration, /m\.provider = 'ORDERMENTUM'/);
  assert.match(migration, /m\.is_active/);
  assert.match(
    migration,
    /if v_match_count = 0 then[\s\S]*from public\.v_ecoflow_inventory_sku_control s/,
  );
  assert.ok(
    migration.indexOf('from public.skus s')
      < migration.indexOf('from public.v_ecoflow_inventory_sku_control s'),
  );
  assert.match(migration, /BARCODE_SURVEY_SKU_UNKNOWN/);
  assert.match(migration, /BARCODE_SURVEY_SKU_AMBIGUOUS/);
});

test('repair preserves exact direct physical evidence and conflict semantics', () => {
  assert.match(migration, /o\.sku_context = v_sku_context/);
  assert.match(migration, /o\.carton_barcode = v_carton_barcode/);
  assert.match(migration, /o\.evidence_source = 'OBSERVED_NOW'/);
  assert.match(migration, /o\.sleeve_status in \('SCANNED', 'NO_SEPARATE_BARCODE'\)/);
  assert.match(migration, /v_signature_count <> 1/);
  assert.match(migration, /'CONFLICT'::text/);
});

test('repair is function-only and cannot mutate operational or Product Identity business data', () => {
  assert.doesNotMatch(
    migration,
    /^\s*(?:insert\s+into|update|delete\s+from)\s+public\.(?:ecoflow_inventory|ecoflow_stocktake|ecoflow_warehouse|ecoflow_product_identity|ecoflow_physical|ecoflow_commercial_family)/im,
  );
  assert.doesNotMatch(migration, /ecoflow_submit_product_identity_batch\s*\(/i);
  assert.doesNotMatch(migration, /ecoflow_publish_product_identity_batch\s*\(/i);
});
