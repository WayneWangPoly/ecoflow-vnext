import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260927014711_r5_010_fresh_batch_bulk_opening_bridge.sql','utf8');
const adapter = fs.readFileSync('src/features/team/freshBatchBulkOpening.ts','utf8');
const panel = fs.readFileSync('src/features/settings/FreshBatchBulkOpeningPanel.tsx','utf8');
const host = fs.readFileSync('src/features/settings/InventoryReferenceStagePanel.tsx','utf8');

const previewStart = migration.indexOf('create or replace function public.ecoflow_preview_r5_010_bulk_opening');
const applyStart = migration.indexOf('create or replace function public.ecoflow_apply_r5_010_bulk_opening');
const previewSql = migration.slice(previewStart, applyStart);
const applySql = migration.slice(applyStart);

test('R5-010 is pinned to the fresh 428-row SEALED reference, never the superseded 3/5 batch', () => {
  assert.match(migration, /9a1b323c-46fb-4478-87d0-94573819fe1c/);
  assert.match(migration, /source_row_count<>428/);
  assert.match(adapter, /9a1b323c-46fb-4478-87d0-94573819fe1c/);
  assert.doesNotMatch(adapter, /4cdb85d3-06d8-44bf-96bb-93660e10c3c9/);
  assert.doesNotMatch(adapter, /sourceQtyOnHand:\s*[35]/);
});

test('PREVIEW is read-only and exposes deterministic cohort, unresolved census and manifest', () => {
  assert.ok(previewStart >= 0 && applyStart > previewStart);
  assert.match(previewSql, /batch_status='SEALED'/);
  assert.match(previewSql, /READY_FOR_LOCATION_EVIDENCE/);
  assert.match(previewSql, /pendingProductMappingCount/);
  assert.match(previewSql, /ambiguousProductMappingCount/);
  assert.match(previewSql, /pendingWarehouseMappingCount/);
  assert.match(previewSql, /ambiguousWarehouseMappingCount/);
  assert.match(previewSql, /pendingPhysicalIdentityCount/);
  assert.match(previewSql, /manifestSha256/);
  assert.match(previewSql, /authorityEffect','NONE'/);
  assert.doesNotMatch(previewSql, /insert\s+into\s+public\.ecoflow_(warehouse_location_items|warehouse_movements|inventory_movements)/i);
  assert.doesNotMatch(previewSql, /update\s+public\.ecoflow_(warehouse_location_items|stocktake_sessions)/i);
});

test('APPLY is manifest-bound, exactly-once, locked, and revalidates after SKU locks', () => {
  assert.match(applySql, /R5_010_EXPLICIT_ACKNOWLEDGEMENT_REQUIRED/);
  assert.match(applySql, /R5_010_REASON_REQUIRED/);
  assert.match(applySql, /R5_010_VALID_MANIFEST_REQUIRED/);
  assert.match(applySql, /r5-010-command:/);
  assert.match(applySql, /r5-010-batch:/);
  assert.match(applySql, /warehouse-sku-write:/);
  assert.match(applySql, /v_preview_after_lock := public\.ecoflow_preview_r5_010_bulk_opening/);
  assert.match(applySql, /R5_010_STATE_CHANGED_AFTER_PREVIEW/);
  assert.match(migration, /command_id uuid primary key/);
  assert.match(migration, /ecoflow_stocktake_migration_reference_row_once/);
});

test('migration evidence is not mislabeled as a physical count and reuses governed INITIAL approval', () => {
  assert.match(migration, /evidence_type in \('PHYSICAL_COUNT','UNLEASHED_MIGRATION_REFERENCE'\)/);
  assert.match(applySql, /'UNLEASHED_MIGRATION_REFERENCE'/);
  assert.match(applySql, /no physical count asserted/);
  assert.match(applySql, /ecoflow_start_stocktake_session\(/);
  assert.match(applySql, /'INITIAL'/);
  assert.match(applySql, /ecoflow_submit_stocktake_session\(/);
  assert.match(applySql, /ecoflow_approve_stocktake_session\(/);
  assert.match(applySql, /v_adjustment_count<>v_positive/);
});

test('positive rows open inventory while zero rows are initialized without non-zero movement', () => {
  assert.match(applySql, /if \(v_row->>'sourceQtyOnHand'\)::numeric>0 then/);
  assert.match(applySql, /v_zero := v_zero\+1/);
  assert.match(applySql, /openingMovementCount/);
  assert.match(applySql, /R5_010_OPENING_MOVEMENT_COUNT_MISMATCH/);
  assert.match(applySql, /quantity_packages/);
});

test('movement provenance is structured and immutable', () => {
  assert.match(migration, /ecoflow_r5_010_inventory_movement_provenance/);
  assert.match(migration, /ecoflow_r5_010_warehouse_movement_provenance/);
  assert.match(migration, /R5_010_AUDIT_IMMUTABLE/);
  assert.match(migration, /R5_010_INVENTORY_PROVENANCE_COUNT_MISMATCH/);
  assert.match(migration, /R5_010_WAREHOUSE_PROVENANCE_COUNT_MISMATCH/);
});

test('MIGRATION-UNASSIGNED is explicitly non-physical and normal transfer authority remains incumbent', () => {
  assert.match(migration, /'MIGRATION-UNASSIGNED'/);
  assert.match(migration, /'MIGRATION_HOLDING'/);
  assert.match(migration, /R5_010_MIGRATION_HOLDING_LOCATION_REQUIRED/);
  assert.match(migration, /batch_physical_sku_count=1/);
  assert.match(migration, /live_balance_row_count=0/);
  assert.match(migration, /location_semantics in \('PHYSICAL','MIGRATION_HOLDING'\)/);
  assert.doesNotMatch(migration, /create or replace function public\.ecoflow_move_warehouse_sku/);
});

test('browser uses only PREVIEW/APPLY RPCs, canaries are selectors rather than the whole cohort', () => {
  assert.match(adapter, /ecoflow_preview_r5_010_bulk_opening/);
  assert.match(adapter, /ecoflow_apply_r5_010_bulk_opening/);
  assert.match(adapter, /8e483068-c086-4e19-bbb3-2c5baf7d0d82/);
  assert.match(adapter, /c2536c8c-d559-41ae-99a0-c487cead9675/);
  assert.doesNotMatch(adapter, /\.from\([^\n]+\)\.(insert|update|delete)/);
  assert.match(panel, /All uninitialized READY candidates/);
  assert.match(panel, /Custom reference-row wave/);
  assert.match(panel, /Canary · R-360Y/);
  assert.match(panel, /Canary · SB24\/32\/40LBOX/);
  assert.match(panel, /positive QtyOnHand/);
  assert.match(panel, /manifestSha256/);
  assert.match(panel, /UNLEASHED_MIGRATION_REFERENCE/);
  assert.doesNotMatch(panel, /setLocationCode/);
  assert.match(panel, /Opening location/);
  assert.match(host, /FreshBatchBulkOpeningPanel/);
  assert.doesNotMatch(host, /<ReadyPositiveStockCommissioningPanel/);
});