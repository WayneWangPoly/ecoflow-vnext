import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260820104500_warehouse_survey_001_smart_packaging_evidence.sql';
const repositoryPath = 'src/data/repositories/barcodeSurvey.ts';
const uiPath = 'src/features/operationalStability/BarcodeSurveyWorkspace.tsx';

const [migration, repository, ui] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(uiPath, 'utf8'),
]);

test('smart evidence remains non-authoritative staging evidence', () => {
  assert.match(migration, /staging-only physical evidence/i);
  assert.match(migration, /does not publish barcode mappings/i);
  for (const forbiddenTarget of [
    'ecoflow_commercial_skus',
    'ecoflow_product_identity',
    'ecoflow_inventory_movements',
    'ecoflow_inventory_balances',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${forbiddenTarget}`, 'i'));
  }
});

test('history is reusable only for exact SKU + exact carton direct physical evidence', () => {
  assert.match(migration, /o\.sku_context = v_sku_context/);
  assert.match(migration, /o\.carton_barcode = v_carton_barcode/);
  assert.match(migration, /o\.evidence_source = 'OBSERVED_NOW'/);
  assert.match(migration, /o\.sleeve_status in \('SCANNED', 'NO_SEPARATE_BARCODE'\)/);
  assert.match(migration, /count\(distinct case/i);
  assert.match(migration, /'CONFLICT'::text/);
  assert.match(migration, /v_signature_count <> 1/);
});

test('reused evidence is provenance-linked and server-derived, never presented as a new scan', () => {
  assert.match(migration, /REUSED_EXACT_PACKAGE/);
  assert.match(migration, /source_observation_id/);
  assert.match(migration, /v_source\.evidence_source <> 'OBSERVED_NOW'/);
  assert.match(migration, /v_source\.sku_context is distinct from v_sku_context/);
  assert.match(migration, /v_source\.carton_barcode is distinct from v_carton_barcode/);
  assert.match(migration, /BARCODE_SURVEY_REUSE_DERIVES_SLEEVE/);
  assert.match(migration, /BARCODE_SURVEY_EVIDENCE_CONFLICT/);
  assert.match(migration, /v_sleeve_status := v_source\.sleeve_status/);
  assert.match(migration, /v_sleeve_barcode := v_source\.sleeve_barcode/);
});

test('deferred cartons are explicit non-verifying observations', () => {
  assert.match(migration, /DEFERRED_INACCESSIBLE/);
  assert.match(migration, /DEFERRED_OPENING_REQUIRED/);
  assert.match(migration, /v_sleeve_status := 'NOT_CHECKED'/);
  assert.match(migration, /DEFER_DERIVES_SLEEVE/);
  assert.doesNotMatch(migration, /evidence_source = 'DEFERRED_INACCESSIBLE'[\s\S]{0,300}VERIFIED_/i);
});

test('repository uses bounded smart lookup and v3 append command while keeping v2 compatibility', () => {
  assert.match(repository, /ecoflow_get_barcode_survey_packaging_evidence_v1/);
  assert.match(repository, /ecoflow_record_barcode_survey_observation_v3/);
  assert.match(repository, /ecoflow_record_barcode_survey_observation_v2/);
  assert.match(repository, /REUSED_EXACT_PACKAGE/);
  assert.match(repository, /DEFERRED_INACCESSIBLE/);
  assert.match(repository, /DEFERRED_OPENING_REQUIRED/);
  assert.match(repository, /sourceObservationId/);
});

test('field UI defaults verified exact packages to reuse and offers safe opportunity deferral', () => {
  assert.match(ui, /Packaging already verified/);
  assert.match(ui, /No need to open this carton/);
  assert.match(ui, /Use verified evidence/);
  assert.match(ui, /New \/ unverified packaging/);
  assert.match(ui, /Defer — high rack \/ inaccessible/);
  assert.match(ui, /Cannot check without opening stock/);
  assert.match(ui, /Conflicting physical evidence/);
  assert.match(ui, /never guess or use “latest wins”/);
  assert.match(ui, /setCaptureMode\('REUSED_EXACT_PACKAGE'\)/);
  assert.match(ui, /Not checked is recorded as a defer reason, not as verified packaging evidence/);
});

test('camera scanning contract remains mounted and targets the same stable inputs', () => {
  assert.match(ui, /<WarehouseCameraScanner \/>/);
  assert.match(ui, /ecoflow:warehouse-camera-scan/);
  assert.match(ui, /barcode-survey-carton-input/);
  assert.match(ui, /barcode-survey-sleeve-input/);
  assert.match(ui, /requestCameraScan\(CARTON_INPUT_ID\)/);
  assert.match(ui, /requestCameraScan\(SLEEVE_INPUT_ID\)/);
});
