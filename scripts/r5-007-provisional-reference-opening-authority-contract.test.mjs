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

test('R5-007 never claims frozen reference quantity is physical count or active pickable stock', () => {
  assert.match(sql, /'HOLD'/);
  assert.match(sql, /PROVISIONAL_REFERENCE_ONLY — not physically counted/);
  assert.match(sql, /'UNLEASHED_REFERENCE_BASELINE'/);
  assert.match(sql, /'physicalCountClaimed',false/);
  assert.match(sql, /'operationalInventoryAuthorityCreated',false/);
  assert.match(panel, /这不是 physical stocktake/);
  assert.match(panel, /状态为 HOLD，不能正常拣货/);
  assert.doesNotMatch(sql, /status\s*=\s*'ACTIVE'[\s\S]{0,120}PROVISIONAL_REFERENCE_ONLY/);
});

test('R5-007 preserves exactly-once opening semantics and rejects prior quantity/movement state', () => {
  assert.match(sql, /command_id uuid not null unique/);
  assert.match(sql, /commissioning_id uuid not null unique/);
  assert.match(sql, /R5_007_COMMAND_REPLAY_MISMATCH/);
  assert.match(sql, /R5_007_EXISTING_WAREHOUSE_QUANTITY_BLOCKS_OPENING/);
  assert.match(sql, /R5_007_EXISTING_INVENTORY_MOVEMENT_BLOCKS_OPENING/);
  assert.match(client, /before\.existingNonZeroLocationRows !== 0/);
  assert.match(client, /before\.existingInventoryMovements !== 0/);
  assert.match(panel, /重试同一 provisional command/);
});

test('R5-007 binds exact immutable reference and physical identity evidence', () => {
  assert.match(sql, /4cdb85d3-06d8-44bf-96bb-93660e10c3c9/);
  assert.match(sql, /5cd0e73b-956d-4c80-9e70-6d841d27b163/);
  assert.match(sql, /215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d/);
  assert.match(sql, /v_set\.status='DRAFT'/);
  assert.match(sql, /v_set\.revision=0/);
  assert.match(sql, /v_ref\.batch_status='SEALED'/);
  assert.match(sql, /v_ref\.readiness_status='READY_FOR_LOCATION_EVIDENCE'/);
  assert.match(sql, /v_phys\.identity_status='ACTIVE'/);
  assert.match(sql, /v_pkg\.identity_status='ACTIVE'/);
  assert.match(client, /R5_007_FROZEN_BINDING_MISMATCH/);
});

test('R5-007 forces later physical stocktake to include the provisional location before finalization', () => {
  assert.match(sql, /ecoflow_guard_provisional_opening_finalization/);
  assert.match(sql, /old\.status='DRAFT' and new\.status='FINALIZED'/i);
  assert.match(sql, /l\.location_id=v_opening\.location_id/);
  assert.match(sql, /R5_007_PROVISIONAL_LOCATION_MUST_BE_INCLUDED_IN_PHYSICAL_STOCKTAKE/);
  assert.match(panel, /真实 stocktake 必须包含 provisional location/);
});

test('R5-007 marks provisional evidence reconciled only after a later stocktake reaches APPROVED', () => {
  assert.match(sql, /ecoflow_mark_provisional_opening_reconciled/);
  assert.match(sql, /new\.session_status='APPROVED'/i);
  assert.match(sql, /status='RECONCILED'/);
  assert.match(sql, /reconciled_stocktake_session_id=new\.id/);
  assert.match(panel, /provisional baseline 已标记 RECONCILED/);
});

test('R5-007 authority is authenticated-only and adds no stocktake approval call', () => {
  assert.match(sql, /revoke all on function public\.ecoflow_apply_provisional_reference_opening_balance\(uuid,uuid,text\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.ecoflow_apply_provisional_reference_opening_balance\(uuid,uuid,text\)[\s\S]*to authenticated/);
  assert.match(sql, /ecoflow_require_warehouse_control_role\(true\)/);
  assert.doesNotMatch(sql, /ecoflow_approve_stocktake_session\s*\(/);
  assert.doesNotMatch(client, /ecoflow_approve_stocktake_session/);
  assert.doesNotMatch(panel, /APPROVE stocktake/i);
});

test('R5-007 remains lazy-wired to preserve the existing frontend bundle boundary', () => {
  assert.match(host, /const ProvisionalReferenceOpeningPanel = lazy\(async \(\) =>/);
  assert.match(host, /import\('\.\/ProvisionalReferenceOpeningPanel'\)/);
  assert.match(host, /<ProvisionalReferenceOpeningPanel supabase=\{supabase\} \/>/);
});
