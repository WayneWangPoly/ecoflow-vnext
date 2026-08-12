import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260812210000_warehouse_survey_001_barcode_evidence.sql';
const repositoryPath = 'src/data/repositories/barcodeSurvey.ts';
const uiPath = 'src/features/operationalStability/BarcodeSurveyWorkspace.tsx';
const shellPath = 'src/features/operationalStability/WarehouseControlWorkspaceV3.tsx';

const [migration, repository, ui, shell] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(uiPath, 'utf8'),
  readFile(shellPath, 'utf8'),
]);

test('survey authority is staging-only and direct browser DML is closed', () => {
  assert.match(migration, /evidence, not inventory authority and not Product Identity/i);
  assert.match(migration, /revoke all on table public\.ecoflow_barcode_survey_observations\s+from public, anon, authenticated/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /ecoflow_active_app_role\(\)/);
  assert.match(migration, /not in \('OWNER', 'ADMIN', 'WAREHOUSE'\)/);
});

test('survey command is append-only idempotent evidence', () => {
  assert.match(migration, /command_id uuid not null unique/i);
  assert.match(migration, /BARCODE_SURVEY_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /'REPLAYED'::text/);
  assert.match(migration, /'APPLIED'::text/);
  assert.doesNotMatch(migration, /update public\.ecoflow_barcode_survey_observations/i);
  assert.doesNotMatch(migration, /delete from public\.ecoflow_barcode_survey_observations/i);
});

test('sleeve evidence has three explicit states and never invents a same barcode', () => {
  for (const status of ['SCANNED', 'NO_SEPARATE_BARCODE', 'NOT_CHECKED']) {
    assert.match(migration, new RegExp(status));
    assert.match(repository, new RegExp(status));
  }
  assert.match(migration, /sleeve_barcode <> carton_barcode/);
  assert.match(repository, /Sleeve barcode must differ from the carton barcode/);
  assert.match(repository, /Sleeve barcode must be empty unless Sleeve status is Scanned/);
});

test('field UI excludes inventory and commercial master-data decisions', () => {
  assert.match(ui, /Scan carton barcode/);
  assert.match(ui, /Scan sleeve/);
  assert.match(ui, /No separate barcode/);
  assert.match(ui, /Not checked/);
  assert.match(ui, /Save & Next/);
  assert.match(ui, /does not change inventory, Commercial SKU mapping, or published Product Identity/i);

  for (const forbidden of [
    'quantityPackages',
    'unitsPerPackage',
    'locationCode',
    'commercialSkuId',
    'familyCode',
    'substitutionPolicy',
  ]) {
    assert.doesNotMatch(ui, new RegExp(forbidden));
  }
});

test('network-unknown retry retains command id until the draft changes or server acknowledges', () => {
  assert.match(ui, /pendingCommandId \?\? createBarcodeSurveyCommandId\(\)/);
  assert.match(ui, /setPendingCommandId\(commandId\)/);
  assert.match(ui, /resetForNext\(\)/);
  assert.match(repository, /ecoflow_recover_barcode_survey_observation_v1/);
});

test('Warehouse Control keeps existing stocktake and move surface reachable', () => {
  assert.match(shell, /Barcode Survey/);
  assert.match(shell, /Stocktake \/ Move/);
  assert.match(shell, /InventoryWarehouseControlWorkspace role=\{role\}/);
});
