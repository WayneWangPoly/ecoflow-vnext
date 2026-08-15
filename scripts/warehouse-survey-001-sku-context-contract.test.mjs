import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260816061000_warehouse_survey_001_sku_context.sql';
const repositoryPath = 'src/data/repositories/barcodeSurvey.ts';
const uiPath = 'src/features/operationalStability/BarcodeSurveyWorkspace.tsx';

const [migration, repository, ui] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(uiPath, 'utf8'),
]);

test('SKU context is server-validated read-only evidence, not a master-data mapping', () => {
  assert.match(migration, /descriptive evidence only/i);
  assert.match(migration, /v_ecoflow_inventory_sku_control/);
  assert.match(migration, /BARCODE_SURVEY_SKU_UNKNOWN/);
  assert.match(migration, /skuContext/);
  assert.doesNotMatch(migration, /update\s+public\.v_ecoflow_inventory_sku_control/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.v_ecoflow_inventory_sku_control/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.v_ecoflow_inventory_sku_control/i);
  for (const forbiddenTarget of [
    'ecoflow_commercial_skus',
    'ecoflow_product_identity',
    'ecoflow_inventory_movements',
    'ecoflow_inventory_balances',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${forbiddenTarget}`, 'i'));
  }
});

test('SKU lookup is prefix-based, role-gated and bounded', () => {
  assert.match(migration, /ecoflow_search_barcode_survey_skus_v1/);
  assert.match(migration, /left\(lower\(trim\(s\.sku\)\), char_length\(v_query\)\) = lower\(v_query\)/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit, 12\), 1\), 20\)/);
  assert.match(migration, /not in \('OWNER', 'ADMIN', 'WAREHOUSE'\)/);
  assert.match(repository, /p_limit: 12/);
});

test('field flow requires explicit existing SKU selection and progressively searches while typing', () => {
  assert.match(ui, /Find existing SKU/);
  assert.match(ui, /Type the first characters of the SKU/);
  assert.match(ui, /searchBarcodeSurveySkus\(query\)/);
  assert.match(ui, /setTimeout\(\(\) => \{/);
  assert.match(ui, /120\)/);
  assert.match(ui, /No existing SKU match/);
  assert.match(ui, /Select an existing SKU from the suggestions before saving/);
  assert.match(ui, /setSelectedSku\(null\)/);
  assert.match(ui, /skuContext: selectedSku\.sku/);
});

test('Save & Next resets to SKU entry while preserving barcode-survey safety semantics', () => {
  assert.match(ui, /resetForNext\(\)/);
  assert.match(ui, /skuRef\.current\?\.focus\(\)/);
  assert.match(ui, /does not change inventory, Commercial SKU mapping, or published Product Identity/i);
  assert.match(repository, /ecoflow_record_barcode_survey_observation_v2/);
  assert.match(repository, /p_sku_context: normalized\.skuContext/);
});
