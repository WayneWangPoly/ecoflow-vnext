import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Safe Inline Actions prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const contract = read('src/features/intelligence/analytics/actionIntegration/safeInlineActionContract.ts');
const panel = read('src/features/intelligence/analytics/actionIntegration/ActionIntegrationPanel.tsx');
const lifecycle = read('src/features/intelligence/attention/actionableExceptionLifecycleContract.ts');
const modal = read('src/features/intelligence/attention/ExceptionLifecycleCommitModal.tsx');
const tests = read('scripts/intel-safe-inline-action-contract.test.mjs');

for (const marker of [
  "'EXCEPTION_LIFECYCLE'",
  "'ORDER_RELEASE'",
  "'INVENTORY_MUTATION'",
  "'CUSTOMER_MUTATION'",
  "'ROUTE_CONTROL'",
  "'RETURN_DISPOSITION'",
  "eligibility: 'AVAILABLE'",
  "serverCommand: 'apply_actionable_exception_lifecycle_command'",
  "'accepted'",
  "'conflict'",
  "'rejected'",
  "'replay'",
  "'network-unknown'",
  'validateSafeInlineActionRegistry',
  'normaliseExceptionLifecycleOutcome',
]) {
  assert.ok(contract.includes(marker), `Safe Inline Actions contract marker missing: ${marker}`);
}

assert.equal((contract.match(/eligibility: 'AVAILABLE'/g) ?? []).length, 1, 'Only one inline command family may be available');
assert.equal((contract.match(/eligibility: 'BLOCKED'/g) ?? []).length, 5, 'Five non-migrated command families must remain blocked');

for (const marker of [
  "actionableExceptionLifecycleCommandRpcName = 'apply_actionable_exception_lifecycle_command'",
  "commandStatus: 'APPLIED' | 'REPLAYED' | 'UNKNOWN'",
  "| 'conflict'",
  "| 'forbidden'",
  "| 'invalid'",
  "| 'unavailable'",
  "| 'failed'",
]) {
  assert.ok(lifecycle.includes(marker), `Exception lifecycle command evidence missing: ${marker}`);
}

for (const marker of [
  'globalThis.crypto?.randomUUID?.()',
  'await onCommit({',
  'commandId,',
  'onConflict();',
  'No lifecycle commands available',
  'server access envelope',
]) {
  assert.ok(modal.includes(marker), `Migrated exception lifecycle UI evidence missing: ${marker}`);
}

for (const marker of [
  'SAFE INLINE ACTIONS',
  'Command migration eligibility',
  'NO DIRECT WRITES',
  'Inline action blocked',
  'accepted, conflict, rejected, replay and network-unknown',
]) {
  assert.ok(panel.includes(marker), `Safe Inline Actions presentation marker missing: ${marker}`);
}

for (const forbidden of [
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /fetch\s*\(/,
  /insert\s*\(/i,
  /update\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /supabase/i,
]) {
  assert.ok(!forbidden.test(`${contract}\n${panel}`), `Safe Inline Actions crossed the direct-write boundary: ${forbidden}`);
}

for (const testName of [
  'Safe Inline Actions publishes all command families with exactly one migrated family',
  'available inline action requires server command revision idempotency permission and five outcomes',
  'non-migrated business actions remain blocked and expose no command authority',
  'exception lifecycle command results normalise into the ARCH-002 outcome contract',
]) {
  assert.ok(tests.includes(testName), `Safe Inline Actions test missing: ${testName}`);
}

console.log('INTEL-ACT-002 Safe Inline Actions audit passed.');
