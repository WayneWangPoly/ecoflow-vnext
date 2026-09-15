import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edgePath = 'supabase/functions/stage-unleashed-inventory-reference/index.ts';
const clientPath = 'src/features/team/unleashedInventoryReferenceStage.ts';
const panelPath = 'src/features/settings/InventoryReferenceStagePanel.tsx';
const hostPanelPath = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';

const [edge, client, panel, hostPanel] = [edgePath, clientPath, panelPath, hostPanelPath]
  .map((path) => fs.readFileSync(path, 'utf8'));

const sourceRun = '5cd0e73b-956d-4c80-9e70-6d841d27b163';
const recoveryOf = '53c8bf37-ff65-473a-ae9f-ec899acc1770';
const commandId = '653bcfcc-7e3e-488c-bfb0-2f3a163a79cb';
const asAt = '2026-09-15T02:13:08.019Z';

test('R5-003 is frozen to the independently verified R5-002-R2 source set', () => {
  assert.match(edge, /const REQUEST_KEY = 'ECOFLOW-R5-003'/);
  assert.ok(edge.includes(`const SOURCE_RUN_ID = '${sourceRun}'`));
  assert.ok(edge.includes(`const RECOVERY_OF_RUN_ID = '${recoveryOf}'`));
  assert.ok(edge.includes(`const STAGE_COMMAND_ID = '${commandId}'`));
  assert.ok(edge.includes(`const AS_AT = '${asAt}'`));
  assert.match(edge, /const EXPECTED_SOURCE_ROWS = 427/);
  assert.match(edge, /ECOFLOW-R5-003 stage immutable ADL1 StockOnHand reference from R5-002-R2/);
  assert.match(edge, /new Date\(String\(sourceRun\.completed_at\)\)\.toISOString\(\) === AS_AT/);
  assert.match(edge, /metadata\.request_key === 'ECOFLOW-R5-002-R2'/);
  assert.match(edge, /metadata\.recovery_of === RECOVERY_OF_RUN_ID/);
  assert.match(edge, /target\.warehouseCode === 'ADL1'/);
  assert.match(edge, /window\?\.start_page === 1/);
  assert.match(edge, /window\?\.last_page === 3/);
  assert.match(edge, /window\?\.number_of_pages === 3/);
  assert.match(edge, /window\?\.window_complete === true/);
  assert.match(edge, /window\?\.next_page === null/);
});

test('R5-003 carrier derives actor from a real authenticated Owner/Admin session', () => {
  assert.match(edge, /userClient\.auth\.getUser\(\)/);
  assert.match(edge, /\.from\('app_user_profiles'\)/);
  assert.match(edge, /actor\.is_active/);
  assert.match(edge, /actor\.team_status !== 'ACTIVE'/);
  assert.match(edge, /!\['OWNER', 'ADMIN'\]\.includes\(actor\.app_role\)/);
  assert.match(edge, /p_requested_by: userData\.user\.id/);
  assert.doesNotMatch(edge, /p_requested_by:\s*['"][0-9a-f-]{36}['"]/i);
});

test('R5-003 request surface is exact and browser cannot choose source, actor, command or timestamp', () => {
  assert.match(edge, /keys\.length === 2/);
  assert.match(edge, /keys\[0\] === 'confirm'/);
  assert.match(edge, /keys\[1\] === 'requestKey'/);
  assert.match(edge, /body\.requestKey === REQUEST_KEY/);
  assert.match(edge, /body\.confirm === true/);

  const requestBlock = client.match(/export const R5_003_STAGE_REQUEST = \{[\s\S]*?\} as const;/)?.[0];
  assert.ok(requestBlock, 'R5-003 request block must exist');
  assert.match(requestBlock, /requestKey: 'ECOFLOW-R5-003'/);
  assert.match(requestBlock, /confirm: true/);
  assert.doesNotMatch(requestBlock, /sourceRunId\s*:/);
  assert.doesNotMatch(requestBlock, /commandId\s*:/);
  assert.doesNotMatch(requestBlock, /requestedBy\s*:/i);
  assert.doesNotMatch(requestBlock, /asAt\s*:/);
});

test('R5-003 re-proves the 427-row ADL1 fence before invoking the existing stage RPC', () => {
  assert.match(edge, /allSnapshots\.count !== EXPECTED_SOURCE_ROWS/);
  assert.match(edge, /adl1Snapshots\.count !== EXPECTED_SOURCE_ROWS/);
  assert.match(edge, /warehouseAllSnapshots\.count !== 0/);
  assert.match(edge, /\.contains\('payload', \{ WarehouseCode: 'ADL1' \}\)/);
  assert.match(edge, /\.ilike\('external_key', '%warehouse:all%'\)/);
  assert.match(edge, /R5_003_SOURCE_RUN_ALREADY_STAGED/);
  assert.match(edge, /R5_003_COMMAND_ALREADY_USED/);
  assert.match(edge, /adminClient\.rpc\('ecoflow_stage_unleashed_inventory_reference'/);
});

test('R5-003 accepts only immutable-reference STAGED result with authority NONE', () => {
  assert.match(edge, /result\.batchStatus !== 'STAGED'/);
  assert.match(edge, /result\.revision !== 0/);
  assert.match(edge, /result\.sourceRowCount !== EXPECTED_SOURCE_ROWS/);
  assert.match(edge, /result\.authorityEffect !== 'NONE'/);
  assert.match(edge, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(client, /batchStatus: 'STAGED'/);
  assert.match(client, /sourceRowCount: 427/);
  assert.match(client, /authorityEffect: 'NONE'/);
});

test('R5-003 Edge carrier contains no Unleashed provider transport or provider credential path', () => {
  assert.doesNotMatch(edge, /UNLEASHED_API_ID/);
  assert.doesNotMatch(edge, /UNLEASHED_API_KEY/);
  assert.doesNotMatch(edge, /api\.unleashedsoftware\.com/);
  assert.doesNotMatch(edge, /fetch\(/);
  assert.doesNotMatch(edge, /StockOnHand\//);
});

test('R5-003 UI is an explicit one-attempt Owner/Admin-hosted control', () => {
  assert.match(panel, /R5-003 ADL1 inventory reference stage/);
  assert.match(panel, /427 source rows/);
  assert.match(panel, /no inventory authority/i);
  assert.match(panel, /I confirm R5-003 may create immutable reference evidence only/);
  assert.match(panel, /Stage R5-003 reference once/);
  assert.match(panel, /setAttempted\(true\)/);
  assert.match(panel, /disabled=\{!acknowledged \|\| running \|\| attempted\}/);
  assert.match(panel, /Do not retry blindly/);
  assert.match(hostPanel, /import \{ InventoryReferenceStagePanel \} from '\.\/InventoryReferenceStagePanel'/);
  assert.match(hostPanel, /<InventoryReferenceStagePanel supabase=\{supabase\} \/>/);
});
