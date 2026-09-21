import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260921143711_r5_009_fresh_reference_membership_bridge.sql',
  'utf8',
);
const acquisitionEdge = fs.readFileSync(
  'supabase/functions/trigger-unleashed-readonly-sync/index.ts',
  'utf8',
);
const stageEdge = fs.readFileSync(
  'supabase/functions/stage-unleashed-inventory-reference/index.ts',
  'utf8',
);
const panel = fs.readFileSync(
  'src/features/settings/FreshInventoryReferenceBridgePanel.tsx',
  'utf8',
);
const host = fs.readFileSync(
  'src/features/settings/InventoryReferenceStagePanel.tsx',
  'utf8',
);
const canonicalDeploy = fs.readFileSync(
  '.github/workflows/deploy-supabase-migrations.yml',
  'utf8',
);
const legacyStageDeploy = fs.readFileSync(
  '.github/workflows/deploy-r5-003-inventory-reference-stage.yml',
  'utf8',
);

test('R5-009 records complete run membership without rewriting unchanged semantic versions', () => {
  assert.match(migration, /create table if not exists public\.unleashed_snapshot_run_membership/);
  assert.match(migration, /primary key \(run_id,resource,external_key\)/);
  assert.match(migration, /IMMUTABLE_UNLEASHED_SNAPSHOT_RUN_MEMBERSHIP/);
  assert.match(migration, /p_seen_rows jsonb/);
  assert.match(migration, /membershipProvenance','LIVE_ACQUISITION'/);
  assert.match(acquisitionEdge, /p_seen_rows: snapshotRows\.map/);
  assert.match(acquisitionEdge, /external_key: row\.external_key/);
  assert.match(acquisitionEdge, /payload_sha256: row\.payload_sha256/);
  assert.doesNotMatch(acquisitionEdge, /recordsStaged \+= snapshotRows\.length/);
});

test('R5-008 reconstruction is frozen to the proven 349 + 79 + 1 = 428 source set', () => {
  assert.match(migration, /bdca8012-8f78-4dff-b20c-5f5a7d0f8cce/);
  assert.match(migration, /5cd0e73b-956d-4c80-9e70-6d841d27b163/);
  assert.match(migration, /4cdb85d3-06d8-44bf-96bb-93660e10c3c9/);
  assert.match(migration, /v_source\.records_seen<>428/);
  assert.match(migration, /v_source\.records_staged<>349/);
  assert.match(migration, /v_source\.records_changed<>348/);
  assert.match(migration, /records_inserted.*<>1/s);
  assert.match(migration, /records_unchanged.*<>79/s);
  assert.match(migration, /v_total<>428/);
  assert.match(migration, /v_new_seen<>349/);
  assert.match(migration, /v_prior_seen<>79/);
  assert.match(migration, /v_old_snapshot_members<>427/);
  assert.match(migration, /v_new_only<>1/);
  assert.match(migration, /R5_008_RECONSTRUCTED/);
});

test('fresh reference staging consumes immutable membership rather than last_seen_run_id', () => {
  const v2Start = migration.indexOf('create or replace function public.ecoflow_stage_unleashed_inventory_reference_v2');
  assert.ok(v2Start >= 0);
  const v2 = migration.slice(v2Start);
  assert.match(v2, /from public\.unleashed_snapshot_run_membership m/);
  assert.match(v2, /s\.payload_sha256=m\.payload_sha256/);
  assert.match(v2, /v_membership_count<>v_run\.records_seen/);
  assert.match(v2, /membershipBacked',true/);
  assert.match(v2, /authorityEffect','NONE'/);
  assert.doesNotMatch(v2, /where s\.last_seen_run_id=p_source_run_id/);
});

test('R5-009 Edge carrier has no provider transport and separates reconstruction/stage from activation', () => {
  assert.match(stageEdge, /const R5_009_REQUEST_KEY = 'ECOFLOW-R5-009A'/);
  assert.match(stageEdge, /R5_009_EXPECTED_SOURCE_ROWS = 428/);
  assert.match(stageEdge, /ecoflow_reconstruct_r5_008_stock_membership/);
  assert.match(stageEdge, /ecoflow_stage_unleashed_inventory_reference_v2/);
  assert.match(stageEdge, /membershipCount !== R5_009_EXPECTED_SOURCE_ROWS/);
  assert.doesNotMatch(stageEdge, /api\.unleashedsoftware\.com/);
  assert.doesNotMatch(stageEdge, /fetch\(/);
  assert.doesNotMatch(stageEdge, /ecoflow_activate_r5_009_fresh_reference_bridge/);
});

test('activation is exact-scope reference lifecycle supersession with no inventory authority', () => {
  assert.match(migration, /create or replace function public\.ecoflow_activate_r5_009_fresh_reference_bridge/);
  assert.match(migration, /v_fresh\.source_row_count<>428/);
  assert.match(migration, /p\.source_product_code='R-360Y'[\s\S]*p\.source_qty_on_hand=3[\s\S]*A2-03-02A/);
  assert.match(migration, /p\.source_product_code='SB24\/32\/40LBOX'[\s\S]*p\.source_qty_on_hand=5[\s\S]*A2-03-03A/);
  assert.match(migration, /v\.qty_on_hand=1/);
  assert.match(migration, /ecoflow_seal_unleashed_inventory_reference_batch/);
  assert.match(migration, /ecoflow_supersede_unleashed_inventory_reference_batch/);
  assert.match(migration, /set status='SUPERSEDED'/);
  assert.match(migration, /set status='SUPERSEDED_REFERENCE'/);
  assert.match(migration, /physicalStocktakeRequired',true/);
  assert.match(migration, /inventoryAuthorityCreated',false/);
  assert.match(migration, /authorityEffect','NONE'/);
  assert.doesNotMatch(migration, /insert into public\.ecoflow_warehouse_location_items/i);
  assert.doesNotMatch(migration, /insert into public\.ecoflow_warehouse_movements/i);
  assert.doesNotMatch(migration, /insert into public\.ecoflow_inventory_movements/i);
  assert.doesNotMatch(migration, /ecoflow_approve_stocktake_session\s*\(/i);
  assert.doesNotMatch(migration, /ecoflow_record_stocktake_observation\s*\(/i);
});

test('browser surface freezes Phase A and keeps Phase B separately acknowledged', () => {
  assert.match(panel, /requestKey: 'ECOFLOW-R5-009A'/);
  assert.match(panel, /sourceRowCount !== 428/);
  assert.match(panel, /ecoflow_activate_r5_009_fresh_reference_bridge/);
  assert.match(panel, /Phase A · stage fresh reference once/);
  assert.match(panel, /Phase B · activate fresh reference once/);
  assert.match(panel, /stage 428-row evidence only; no inventory authority/);
  assert.match(panel, /stocktake still required/);
  assert.match(panel, /stage !== 'NOT RUN'/);
  assert.match(panel, /activate !== 'READY'/);
  assert.match(panel, /safeToActivate === true/);
  assert.match(panel, /useEffect\(\(\) =>/);
  assert.match(panel, /useState\('CHECKING'\)/);
  assert.match(panel, /freshBatchStatus/);
  assert.match(panel, /status === 'STAGED' \|\| status === 'SEALED'/);
  assert.match(panel, /setStage\('UNKNOWN'\)/);
  assert.match(host, /FreshInventoryReferenceBridgePanel/);
  assert.match(host, /Loading R5-009 fresh reference bridge/);
});


test('stage carrier production deployment is canonical exact-main gated only', () => {
  assert.match(
    canonicalDeploy,
    /supabase functions deploy stage-unleashed-inventory-reference --project-ref "\$SUPABASE_PROJECT_REF"/,
  );
  assert.match(canonicalDeploy, /expected_main_sha/);
  assert.match(canonicalDeploy, /DEPLOY_SUPABASE_PRODUCTION/);
  assert.doesNotMatch(legacyStageDeploy, /\n\s*push:\s*\n/);
  assert.match(legacyStageDeploy, /workflow_dispatch:/);
  assert.match(legacyStageDeploy, /Canonical production deployment is/);
});
