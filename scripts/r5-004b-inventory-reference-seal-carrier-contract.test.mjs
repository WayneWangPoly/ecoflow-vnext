import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const clientPath = 'src/features/team/unleashedInventoryReferenceSeal.ts';
const panelPath = 'src/features/settings/InventoryReferenceSealPanel.tsx';
const stagePanelPath = 'src/features/settings/InventoryReferenceStagePanel.tsx';

const client = readFileSync(clientPath, 'utf8');
const panel = readFileSync(panelPath, 'utf8');
const stagePanel = readFileSync(stagePanelPath, 'utf8');

const batchId = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9';
const rowId = '7156d372-b12f-419e-b05e-2f12571ca525';
const sourceRun = '5cd0e73b-956d-4c80-9e70-6d841d27b163';
const sourceHash = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d';
const commandId = 'a11f638c-0738-4d16-a3fb-3ed29bf079b7';

test('R5-004B is frozen to exact R5-003 evidence and BPB8 canary context', () => {
  for (const value of [batchId, rowId, sourceRun, sourceHash, commandId]) {
    assert.ok(client.includes(value));
  }
  assert.match(client, /source_product_code !== 'BPB8'/);
  assert.match(client, /source_warehouse_code !== 'ADL1'/);
  assert.match(client, /Number\(row\.qty_on_hand\) !== 3/);
  assert.match(client, /row\.readiness_status !== 'READY_FOR_LOCATION_EVIDENCE'/);
});

test('R5-004B calls only the governed authenticated SEAL RPC', () => {
  assert.match(client, /supabase\.rpc\('ecoflow_seal_unleashed_inventory_reference_batch'/);
  assert.match(client, /p_expected_revision: 0/);
  assert.match(client, /p_command_id: R5_004B_SEAL_COMMAND_ID/);
  assert.doesNotMatch(client, /service[_-]?role/i);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /\.update\(/);
  assert.doesNotMatch(client, /\.insert\(/);
  assert.doesNotMatch(client, /\.delete\(/);
});

test('R5-004B fail-closes before and after mutation', () => {
  assert.match(client, /R5_004B_REFERENCE_BATCH_PREFLIGHT_MISMATCH/);
  assert.match(client, /R5_004B_BPB8_PREFLIGHT_MISMATCH/);
  assert.match(client, /R5_004B_SEAL_RESULT_REJECTED/);
  assert.match(client, /R5_004B_SEAL_POSTFLIGHT_MISMATCH/);
  assert.match(client, /value\.batchStatus !== 'SEALED'/);
  assert.match(client, /value\.revision !== 1/);
  assert.match(client, /value\.authorityEffect !== 'NONE'/);
});

test('R5-004B UI requires explicit acknowledgement and one-attempt lock', () => {
  assert.match(panel, /acknowledged/);
  assert.match(panel, /attempted/);
  assert.match(panel, /Do not retry blindly/);
  assert.match(panel, /Inventory authority remains unchanged/);
  assert.match(panel, /Seal R5-004B reference once/);
  assert.match(stagePanel, /import \{ InventoryReferenceSealPanel \} from '\.\/InventoryReferenceSealPanel'/);
  assert.match(stagePanel, /<InventoryReferenceSealPanel supabase=\{supabase\} \/>/);
});
