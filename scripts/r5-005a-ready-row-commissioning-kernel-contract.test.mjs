import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260917073000_unleashed_inventory_r5_005a_ready_row_commissioning_kernel.sql';
const sql = readFileSync(migrationPath, 'utf8');

const functions = [
  'ecoflow_read_ready_inventory_commissioning_gate',
  'ecoflow_start_ready_inventory_commissioning',
  'ecoflow_record_ready_inventory_commissioning_location',
  'ecoflow_finalize_ready_inventory_commissioning',
  'ecoflow_materialize_ready_initial_stocktake',
];

test('R5-005A exposes a generic READY-row commissioning kernel only', () => {
  for (const fn of functions) assert.ok(sql.includes(fn), `missing function ${fn}`);
  assert.doesNotMatch(sql, /FL115PLABOX|R-360Y|SB24\/32\/40LBOX/);
  assert.doesNotMatch(sql, /5b280f2f-cb47-41eb-8934-1b527324c193|2a710fa3-0467-4c05-9317-033fb863815e|44aca94f-bb82-457d-9998-c397b687140a/);
  assert.doesNotMatch(sql, /create\s+table/i);
});

test('R5-005A START fail-closes on latest sealed ADL1 READY identity', () => {
  assert.match(sql, /batch_status='SEALED'/);
  assert.match(sql, /R5_005A_LATEST_SEALED_REFERENCE_BATCH_REQUIRED/);
  assert.match(sql, /source_warehouse_code<>'ADL1'/);
  assert.match(sql, /upper\(coalesce\(v_ref\.warehouse_code,''\)\)<>'MAIN'/);
  assert.match(sql, /reference_quantity_scope<>'UNLEASHED_WAREHOUSE_TOTAL'/);
  assert.match(sql, /product_mapping_count<>1/);
  assert.match(sql, /warehouse_mapping_count<>1/);
  assert.match(sql, /physical_identity_link_count<>1/);
  assert.match(sql, /substitution_policy<>'PROHIBITED'/);
  assert.match(sql, /readiness_status<>'READY_FOR_LOCATION_EVIDENCE'/);
  assert.match(sql, /quantity_assigned_physical_sku_id is not null/);
  assert.match(sql, /quantity_assigned_location_id is not null/);
  assert.match(sql, /qty_on_hand<>trunc\(v_ref\.qty_on_hand\)/);
});

test('R5-005A freezes one active preferred physical SKU, CARTON package and package barcode', () => {
  assert.match(sql, /R5_005A_ACTIVE_PREFERRED_PHYSICAL_SKU_REQUIRED/);
  assert.match(sql, /R5_005A_UNIQUE_COMMERCIAL_FAMILY_LINK_REQUIRED/);
  assert.match(sql, /upper\(p\.package_level\)='CARTON'/);
  assert.match(sql, /R5_005A_UNIQUE_ACTIVE_CARTON_PACKAGE_REQUIRED/);
  assert.match(sql, /R5_005A_UNIQUE_ACTIVE_PACKAGE_BARCODE_REQUIRED/);
  assert.match(sql, /operational_barcode,units_per_package,created_by/);
});

test('R5-005A location/count evidence is real, bounded and reconciled', () => {
  assert.match(sql, /R5_005A_PHYSICAL_LOCATION_REQUIRED/);
  assert.match(sql, /R5_005A_LOCATION_EVIDENCE_NOTE_REQUIRED/);
  assert.match(sql, /R5_005A_UNIQUE_ACTIVE_PHYSICAL_LOCATION_REQUIRED/);
  assert.match(sql, /R5_005A_REFERENCE_ALLOCATION_EXCEEDS_SOURCE/);
  assert.match(sql, /R5_005A_REFERENCE_ALLOCATION_MUST_RECONCILE/);
  assert.match(sql, /R5_005A_EXPLICIT_COUNT_VARIANCE_ACCEPTANCE_REQUIRED/);
  assert.match(sql, /R5_005A_COUNT_VARIANCE_REASON_REQUIRED/);
});

test('R5-005A materializes to REVIEW only and exposes no approval or direct inventory mutation', () => {
  assert.match(sql, /ecoflow_start_stocktake_session/);
  assert.match(sql, /ecoflow_record_stocktake_observation/);
  assert.match(sql, /ecoflow_complete_stocktake_location/);
  assert.match(sql, /ecoflow_submit_stocktake_session/);
  assert.match(sql, /v_session_status<>'REVIEW'/);
  assert.match(sql, /'approvalRequired',true/);
  assert.match(sql, /'inventoryAuthorityCreated',false/);
  assert.doesNotMatch(sql, /ecoflow_approve_stocktake_session/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.ecoflow_warehouse_movements/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.ecoflow_inventory_movements/i);
  assert.doesNotMatch(sql, /update\s+public\.ecoflow_inventory_(?:balances|movements)/i);
});

test('R5-005A invalidates stale reference batches before materialization', () => {
  assert.match(sql, /R5_005A_STALE_REFERENCE_BATCH/);
  assert.match(sql, /R5_005A_FROZEN_REFERENCE_BINDING_MISMATCH/);
  assert.match(sql, /R5_005A_FROZEN_PACKAGE_BINDING_MISMATCH/);
  assert.match(sql, /R5_005A_FROZEN_BARCODE_BINDING_MISMATCH/);
});

test('R5-005A replay is payload-bound and RPC access remains authenticated-only', () => {
  assert.match(sql, /R5_005A_COMMAND_REPLAY_MISMATCH/);
  assert.match(sql, /ecoflow_r5_004a_payload_sha256/);
  for (const fn of functions) {
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke all on function public\\.${escaped}`));
  }
  assert.doesNotMatch(sql, /grant\s+execute[\s\S]{0,160}\bto\s+(?:anon|service_role|public)\s*;/i);
});

test('R5-005A read gate reports actual downstream approval state instead of hard-coding false', () => {
  assert.match(sql, /select s\.session_status into v_session_status/);
  assert.match(sql, /'inventoryAuthorityCreated',coalesce\(v_session_status='APPROVED',false\)/);
});
