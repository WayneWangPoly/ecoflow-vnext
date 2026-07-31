import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inlineActionKeys,
  normaliseExceptionLifecycleOutcome,
  safeInlineActionRegistry,
  validateSafeInlineActionRegistry,
} from '../src/features/intelligence/analytics/actionIntegration/safeInlineActionContract.ts';

test('Safe Inline Actions publishes all command families with exactly one migrated family', () => {
  assert.deepEqual(inlineActionKeys, [
    'EXCEPTION_LIFECYCLE',
    'ORDER_RELEASE',
    'INVENTORY_MUTATION',
    'CUSTOMER_MUTATION',
    'ROUTE_CONTROL',
    'RETURN_DISPOSITION',
  ]);
  assert.deepEqual(validateSafeInlineActionRegistry(), []);
  const available = safeInlineActionRegistry.filter((action) => action.eligibility === 'AVAILABLE');
  assert.equal(available.length, 1);
  assert.equal(available[0].key, 'EXCEPTION_LIFECYCLE');
});

test('available inline action requires server command revision idempotency permission and five outcomes', () => {
  const action = safeInlineActionRegistry.find((candidate) => candidate.key === 'EXCEPTION_LIFECYCLE');
  assert.ok(action);
  assert.equal(action.serverCommand, 'apply_actionable_exception_lifecycle_command');
  assert.ok(action.revisionContract);
  assert.ok(action.idempotencyContract);
  assert.ok(action.permissionContract);
  assert.deepEqual(action.outcomeContract, [
    'accepted',
    'conflict',
    'rejected',
    'replay',
    'network-unknown',
  ]);
});

test('non-migrated business actions remain blocked and expose no command authority', () => {
  for (const action of safeInlineActionRegistry.filter((candidate) => candidate.key !== 'EXCEPTION_LIFECYCLE')) {
    assert.equal(action.eligibility, 'BLOCKED');
    assert.equal(action.serverCommand, null);
    assert.equal(action.revisionContract, null);
    assert.equal(action.idempotencyContract, null);
    assert.equal(action.permissionContract, null);
    assert.deepEqual(action.outcomeContract, []);
    assert.ok(action.blocker);
  }
});

test('exception lifecycle command results normalise into the ARCH-002 outcome contract', () => {
  assert.equal(normaliseExceptionLifecycleOutcome({
    ok: true,
    data: { commandStatus: 'APPLIED' },
    issues: [],
  }), 'accepted');
  assert.equal(normaliseExceptionLifecycleOutcome({
    ok: true,
    data: { commandStatus: 'REPLAYED' },
    issues: [],
  }), 'replay');
  assert.equal(normaliseExceptionLifecycleOutcome({
    ok: false,
    data: null,
    state: 'conflict',
    error: { state: 'conflict', code: 'REVISION_CONFLICT', message: 'changed' },
  }), 'conflict');
  assert.equal(normaliseExceptionLifecycleOutcome({
    ok: false,
    data: null,
    state: 'forbidden',
    error: { state: 'forbidden', code: 'FORBIDDEN', message: 'denied' },
  }), 'rejected');
  assert.equal(normaliseExceptionLifecycleOutcome({
    ok: false,
    data: null,
    state: 'failed',
    error: { state: 'failed', code: 'NETWORK', message: 'unknown outcome' },
  }), 'network-unknown');
});
