import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('scripts/r5-007-provisional-reference-opening-authority.sql', 'utf8');
const client = readFileSync('src/features/team/provisionalReferenceOpening.ts', 'utf8');
const panel = readFileSync('src/features/settings/ProvisionalReferenceOpeningPanel.tsx', 'utf8');
const host = readFileSync('src/features/settings/InventoryReferenceStagePanel.tsx', 'utf8');

test('R5-007 scope is frozen to the two already-started DRAFT commissionings and planned locations', () => {
  assert.match(sql, /44f09191-85f6-4682-8934-98c459cc4d88/);
  assert.match(sql, /2124ea46-765f-488a-8442-baf9dbd268d0/);
  assert.match(sql, /R-360Y/);
  assert.match(sql, /A2-03-02A/);
  assert.match(sql, /SB24\/32\/40LBOX/);
  assert.match(sql, /A2-03-03A/);
  assert.match(sql, /v_expected_qty:=3/);
  assert.match(sql, /v_expected_qty:=5/);
  assert.match(client, /sourceQtyOnHand:\s*3/);
  assert.match(client, /sourceQtyOnHand:\s*5/);
  assert.match(client, /plannedLocationCode:\s*'A2-03-02A'/);
  assert.match(client, /plannedLocationCode:\s*'A2-03-03A'/);
});

test('R5-007 records reference planning evidence only and creates zero quantity mutation', () => {
  assert.match(sql, /status text not null default 'PROVISIONAL_REFERENCE'/);
  assert.match(sql, /'inventoryMutationCreated',false/);
  assert.match(sql, /'operationalInventoryAuthorityCreated',false/);
  assert.match(sql, /'physicalCountClaimed',false/);
  assert.match(sql, /'requiresLaterPhysicalStocktake',true/);
  assert.match(panel, /不会创建 warehouse quantity、inventory movement 或可用库存/);
  assert.match(panel, /Inventory mutation <strong>NONE<\/strong>/);
  assert.match(client, /after\.inventoryMutationCreated/);

  const applyStart = sql.indexOf('create or replace function public.ecoflow_record_provisional_inventory_reference');
  const applyEnd = sql.indexOf('revoke all on function public.ecoflow_record_provisional_inventory_reference', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const applyBody = sql.slice(applyStart, applyEnd);
  assert.doesNotMatch(applyBody, /insert\s+into\s+public\.ecoflow_warehouse_location_items/i);
  assert.doesNotMatch(applyBody, /update\s+public\.ecoflow_warehouse_location_items/i);
  assert.doesNotMatch(applyBody, /insert\s+into\s+public\.ecoflow_warehouse_movements/i);
  assert.doesNotMatch(applyBody, /insert\s+into\s+public\.ecoflow_inventory_movements/i);
  assert.doesNotMatch(applyBody, /ecoflow_approve_stocktake_session\s*\(/i);
});

test('R5-007 preserves exactly-once evidence semantics and rejects pre-existing quantity state', () => {
  assert.match(sql, /command_id uuid not null unique/);
  assert.match(sql, /commissioning_id uuid not null unique/);
  assert.match(sql, /R5_007_COMMAND_REPLAY_MISMATCH/);
  assert.match(sql, /R5_007_EXISTING_WAREHOUSE_QUANTITY_BLOCKS_REFERENCE/);
  assert.match(sql, /R5_007_EXISTING_INVENTORY_MOVEMENT_BLOCKS_REFERENCE/);
  assert.match(client, /before\.existingNonZeroLocationRows !== 0/);
  assert.match(client, /before\.existingInventoryMovements !== 0/);
  assert.match(panel, /重试同一 provisional command/);
});

test('R5-007 binds exact immutable reference and physical identity evidence', () => {
  assert.match(sql, /4cdb85d3-06d8-44bf-96bb-93660e10c3c9/);
  assert.match(sql, /5cd0e73b-956d-4c80-9e70-6d841d27b163/);
  assert.match(sql, /215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d/);
  assert.match(sql, /bf95d275d9419dae66a29e10a2a1e4e4f4b57d83a1ae872f4626260cb1592e0d/);
  assert.match(sql, /afbf51ee85d8785036a4532f9ab5ba4f9334ceee6c87998ba09762ed82e9afb6/);
  assert.match(client, /value\.sourceRowSha256 !== frozen\.sourceRowSha256/);
  assert.match(sql, /v_set\.status='DRAFT'/);
  assert.match(sql, /v_set\.revision=0/);
  assert.match(sql, /v_ref\.batch_status='SEALED'/);
  assert.match(sql, /v_ref\.readiness_status='READY_FOR_LOCATION_EVIDENCE'/);
  assert.match(sql, /v_phys\.identity_status='ACTIVE'/);
  assert.match(sql, /v_pkg\.identity_status='ACTIVE'/);
  assert.match(client, /R5_007_FROZEN_BINDING_MISMATCH/);
});

test('R5-007 leaves the incumbent physical-count path untouched', () => {
  assert.doesNotMatch(sql, /insert\s+into\s+public\.ecoflow_unleashed_inventory_commissioning_locations/i);
  assert.doesNotMatch(sql, /update\s+public\.ecoflow_unleashed_inventory_commissioning_sets\s+set\s+status/i);
  assert.doesNotMatch(sql, /ecoflow_record_ready_inventory_commissioning_location\s*\(/i);
  assert.doesNotMatch(sql, /ecoflow_finalize_ready_inventory_commissioning\s*\(/i);
  assert.doesNotMatch(sql, /ecoflow_materialize_ready_initial_stocktake\s*\(/i);
  assert.doesNotMatch(sql, /ecoflow_approve_stocktake_session\s*\(/i);
  assert.match(panel, /后续真实 stocktake 必须重新提供真实 location 与 counted cartons/);
});

test('R5-007 marks planning evidence reconciled only after a linked later stocktake reaches APPROVED', () => {
  assert.match(sql, /ecoflow_mark_provisional_opening_reconciled/);
  assert.match(sql, /new\.session_status='APPROVED'/i);
  assert.match(sql, /status='RECONCILED'/);
  assert.match(sql, /reconciled_stocktake_session_id=new\.id/);
  assert.match(sql, /p\.commissioning_id=c\.id/);
  assert.match(panel, /provisional baseline 已标记 RECONCILED/);
});

test('R5-007 authority is authenticated-only, role-gated and trigger helper is not callable', () => {
  assert.match(sql, /ecoflow_require_warehouse_control_role\(true\)/);
  assert.match(sql, /revoke all on function public\.ecoflow_record_provisional_inventory_reference\(uuid,uuid,text\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.ecoflow_record_provisional_inventory_reference\(uuid,uuid,text\)[\s\S]*to authenticated/);
  assert.match(sql, /revoke all on function public\.ecoflow_mark_provisional_opening_reconciled\(\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.doesNotMatch(client, /service[_-]?role|access[_-]?token|refresh[_-]?token|jwt/i);
});

test('R5-007 remains lazy-wired to preserve the existing frontend bundle boundary', () => {
  assert.match(host, /const ProvisionalReferenceOpeningPanel = lazy\(async \(\) =>/);
  assert.match(host, /import\('\.\/ProvisionalReferenceOpeningPanel'\)/);
  assert.match(host, /<ProvisionalReferenceOpeningPanel supabase=\{supabase\} \/>/);
});
