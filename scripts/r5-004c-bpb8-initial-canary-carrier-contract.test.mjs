import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync('src/features/team/bpb8InitialOpeningBalanceCanary.ts', 'utf8');
const panel = readFileSync('src/features/settings/Bpb8InitialOpeningBalanceCanaryPanel.tsx', 'utf8');
const host = readFileSync('src/features/settings/InventoryReferenceStagePanel.tsx', 'utf8');

const frozen = [
  '4cdb85d3-06d8-44bf-96bb-93660e10c3c9',
  '5cd0e73b-956d-4c80-9e70-6d841d27b163',
  '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d',
  'ec67ca0a-67b5-437f-96a8-81e6268faa44',
  '1ff1f446-6e97-4ce6-bf6c-ef063265783a',
  '7dcaa2ed-a7db-4722-b91a-e8f17ffe2281',
  '521dfafc-fd01-4897-a3ac-4e272d8f6ba5',
  '19348045005009',
];

test('R5-004C freezes the exact BPB8 canary identity and reference', () => {
  for (const value of frozen) assert.ok(client.includes(value), `missing frozen value ${value}`);
  assert.match(client, /sourceProductCode !== 'BPB8'/);
  assert.match(client, /asNumber\(value\.sourceQtyOnHand\) !== 3/);
  assert.match(client, /value\.inventoryAuthorityCreated !== false/);
});

test('R5-004C uses only the governed commissioning and stocktake-review bridge RPCs', () => {
  for (const rpc of [
    'ecoflow_read_bpb8_inventory_commissioning_gate',
    'ecoflow_start_bpb8_inventory_commissioning',
    'ecoflow_record_bpb8_inventory_commissioning_location',
    'ecoflow_finalize_bpb8_inventory_commissioning',
    'ecoflow_materialize_bpb8_initial_stocktake',
  ]) assert.ok(client.includes(`'${rpc}'`), `missing RPC ${rpc}`);
  assert.doesNotMatch(client, /service[_-]?role/i);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /\.from\(/);
  assert.doesNotMatch(client, /\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(client, /approve[_a-z]*stocktake|stocktake[_a-z]*approve/i);
});

test('R5-004C fail-closes until real location/count evidence reconciles', () => {
  assert.match(client, /R5_004C_EXACT_SEALED_REFERENCE_REQUIRED/);
  assert.match(client, /R5_004C_REAL_LOCATION_CODE_REQUIRED/);
  assert.match(client, /R5_004C_PHYSICAL_EVIDENCE_NOTE_REQUIRED/);
  assert.match(client, /R5_004C_REAL_LOCATION_EVIDENCE_REQUIRED/);
  assert.match(client, /R5_004C_REFERENCE_ALLOCATION_MUST_EQUAL_THREE/);
  assert.match(client, /R5_004C_EXPLICIT_VARIANCE_ACCEPTANCE_REQUIRED/);
  assert.match(client, /R5_004C_VARIANCE_REASON_REQUIRED/);
  assert.match(panel, /never infer a rack or bin from Unleashed/i);
  assert.match(panel, /Physical counted cartons/);
  assert.match(panel, /Physical evidence note/);
});

test('R5-004C materializes to REVIEW only and deliberately exposes no approval action', () => {
  assert.match(client, /data\.stocktakeSessionStatus !== 'REVIEW'/);
  assert.match(client, /data\.approvalRequired !== true/);
  assert.match(client, /data\.inventoryAuthorityCreated !== false/);
  assert.match(panel, /Materialize BPB8 INITIAL to REVIEW/);
  assert.match(panel, /STOP BEFORE APPROVAL/);
  assert.match(panel, /No approval control is provided here/);
  assert.doesNotMatch(panel, /onClick=.*approve/i);
});

test('R5-004C is wired under the existing Owner\/Admin Unleashed settings boundary', () => {
  assert.match(host, /import \{ Bpb8InitialOpeningBalanceCanaryPanel \} from '\.\/Bpb8InitialOpeningBalanceCanaryPanel'/);
  assert.match(host, /<Bpb8InitialOpeningBalanceCanaryPanel supabase=\{supabase\} \/>/);
});
