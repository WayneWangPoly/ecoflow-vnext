import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryPath = new URL('../src/data/repositories/returnCommandAuthority.ts', import.meta.url);
const panelPath = new URL('../src/features/operationalRecords/ReturnCommandPanel.tsx', import.meta.url);
const workspacePath = new URL('../src/features/operationalRecords/OperationalRecordsWorkspace.tsx', import.meta.url);

const [repository, panel, workspace] = await Promise.all([
  readFile(repositoryPath, 'utf8'),
  readFile(panelPath, 'utf8'),
  readFile(workspacePath, 'utf8'),
]);

const joined = `${repository}\n${panel}`;

function includesAll(source, values) {
  for (const value of values) assert.ok(source.includes(value), `Expected source to include ${value}`);
}

function excludesAll(source, values) {
  for (const value of values) assert.ok(!source.includes(value), `Source must not include ${value}`);
}

test('007C frontend uses only authoritative return command RPCs', () => {
  includesAll(repository, [
    "rpc('ecoflow_read_return_state_v1'",
    "rpc('ecoflow_recover_return_command_v1'",
    "rpc('ecoflow_record_return_disposition_v1'",
    "rpc('ecoflow_close_return_v1'",
    'p_expected_revision',
    'p_idempotency_key',
    'p_device_id',
    'p_note',
    'p_evidence',
  ]);
  excludesAll(joined, [
    ".from('ecoflow_delivery_exceptions')",
    ".from('ecoflow_delivery_return_inspection_lines')",
    ".from('ecoflow_inventory_movements')",
    'ecoflow_record_return_inspection_item',
    'ecoflow_complete_return_inspection',
  ]);
});

test('007C UI preserves command identity under transport uncertainty', () => {
  includesAll(panel, [
    "const COMMAND_ROLES = new Set<EcoFlowAppRole>(['OWNER', 'ADMIN', 'WAREHOUSE'])",
    'getOperationalDeviceId()',
    'idempotencyKey: commandId()',
    'expectedRevision: state.revision',
    'const reusable = retryMatchesDisposition',
    'const reusable = retryMatchesClose',
    'setRetryIntent(intent)',
    'readReturnAuthorityState(returnId)',
    "result.status === 'CONFLICT'",
    "status === 'REPLAYED'",
  ]);
  assert.match(panel, /reusable \?\? \{[\s\S]*?idempotencyKey: commandId\(\),[\s\S]*?expectedRevision: state\.revision/);
  assert.match(panel, /recordReturnDisposition\(\{[\s\S]*?expectedRevision: intent\.expectedRevision,[\s\S]*?idempotencyKey: intent\.idempotencyKey/);
  assert.match(panel, /closeReturn\(\{[\s\S]*?expectedRevision: intent\.expectedRevision,[\s\S]*?idempotencyKey: intent\.idempotencyKey/);
});

test('007C UI exposes explicit disposition and close evidence without optimistic closure', () => {
  includesAll(panel, [
    "type ReturnDisposition",
    "value=\"RESTOCK\"",
    "value=\"SUPPLIER_CLAIM\"",
    "value=\"DISPOSE\"",
    'Disposition note *',
    'Evidence *',
    'Close note *',
    'Closure evidence *',
    "inventoryConsequenceStatus === 'EXPLICIT'",
    "state.lifecycleStage !== 'CLOSED'",
    'No local success is shown before authoritative readback.',
  ]);
  excludesAll(panel, [
    "setState({ lifecycleStage: 'CLOSED'",
    "returnStatus: 'CLOSED'",
    'optimistic',
  ]);
});

test('native Returns drawer mounts the 007C command panel and removes the withheld gate', () => {
  includesAll(workspace, [
    "import { ReturnCommandPanel } from './ReturnCommandPanel';",
    "workspace==='returns' ? <ReturnCommandPanel",
    'returnId={recordId}',
    'role={profile.app_role}',
    'onAuthorityChanged={refreshAfterCommand}',
    '007C Returns disposition/close uses server-owned revision, idempotency, inventory consequence and audit authority.',
  ]);
  excludesAll(workspace, [
    'Commands remain withheld until the 007C CAS gate passes.',
    '007A Returns remains deliberately read-only.',
    'Return disposition commands stay unavailable until the separate 007C gate passes.',
  ]);
});
