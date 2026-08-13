import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const repository = fs.readFileSync('src/data/repositories/accountHoldAuthority.ts','utf8');
const panel = fs.readFileSync('src/features/operationalRecords/AccountHoldCommandPanel.tsx','utf8');
const workspace = fs.readFileSync('src/features/operationalRecords/OperationalRecordsWorkspace.tsx','utf8');
const device = fs.readFileSync('src/operational/operationalDeviceIdentity.ts','utf8');

test('repository serializes the bounded authoritative command contract', () => {
  for (const field of [
    'p_store_id: cleanStoreId',
    'p_target_active: input.targetActive',
    'p_expected_revision: input.expectedRevision',
    'p_idempotency_key: cleanKey',
    'p_device_id: cleanDeviceId',
    'p_reason: cleanReason',
  ]) assert.match(repository, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(repository, /rows\.length !== 1/);
  assert.match(repository, /mismatched command id/);
  assert.match(repository, /status !== 'APPLIED' && status !== 'REPLAYED' && status !== 'CONFLICT'/);
  assert.doesNotMatch(repository, /\.from\(['"]ecoflow_account_release_holds['"]\)/);
});

test('transport uncertainty is recovered without creating a second intent', () => {
  const mutation = repository.indexOf("rpc('ecoflow_set_account_release_hold_v1'");
  const recovery = repository.indexOf('recoverAccountHoldCommand(cleanKey, clientValue)');
  assert.ok(mutation >= 0 && recovery > mutation, 'recovery must occur only after the original RPC attempt');
  assert.match(repository, /if \(recovered\) return recovered/);
});

test('Accounts command surface is server-acknowledged rather than optimistic', () => {
  const command = panel.indexOf('await setAccountReleaseHold({');
  const readback = panel.indexOf('await readAccountHoldState(storeId)', command);
  const stateWrite = panel.indexOf('setState(authoritative)', command);
  assert.ok(command >= 0 && readback > command && stateWrite > readback, 'state must update only after command and authoritative readback');
  assert.match(panel, /expectedRevision: intent\.expectedRevision/);
  assert.match(panel, /if \(result\.status === 'CONFLICT'\)/);
  assert.match(panel, /A reason is required for every hold or release command/);
  assert.match(panel, /authoritative\.sourceActionId === intent\.idempotencyKey/);
});

test('unresolved acknowledgement retains the exact command intent for retry', () => {
  assert.match(panel, /const reusableIntent = retryIntent/);
  assert.match(panel, /idempotencyKey: intent\.idempotencyKey/);
  assert.match(panel, /setRetryIntent\(intent\)/);
  assert.match(panel, /Retry same command/);
  assert.match(panel, /Server acknowledgement is unresolved/);
});

test('device context stays stable even when localStorage is unavailable', () => {
  assert.match(device, /let memoryDeviceId: string \| null = null/);
  assert.match(device, /if \(valid\(memoryDeviceId\)\) return memoryDeviceId\.trim\(\)/);
  assert.match(device, /memoryDeviceId = freshDeviceId\(\)/);
});

test('007B remains bounded to Accounts after independent 007C release', () => {
  assert.match(workspace, /workspace==='accounts' \? <AccountHoldCommandPanel/);
  assert.match(workspace, /workspace==='returns' \? <ReturnCommandPanel/);
  assert.doesNotMatch(workspace, /workspace==='returns' \? <AccountHoldCommandPanel/);
  assert.doesNotMatch(repository, /ecoflow_(?:read|recover|record|close)_return/);
  assert.doesNotMatch(panel, /ReturnCommandPanel/);
});
