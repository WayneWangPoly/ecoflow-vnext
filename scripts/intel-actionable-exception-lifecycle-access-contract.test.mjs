import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionableExceptionLifecycleAccessFailure,
  normaliseActionableExceptionLifecycleAccess,
} from '../src/features/intelligence/attention/actionableExceptionLifecycleAccessContract.ts';

const allActions = [
  'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE',
  'RESOLVE','REOPEN','ADD_NOTE',
];

function accessRow(overrides = {}) {
  return {
    access_version: 1,
    lifecycle_capability: 'AVAILABLE',
    ownership_capability: 'AVAILABLE',
    action_capability: 'AVAILABLE',
    history_capability: 'AVAILABLE',
    command_actions: allActions,
    command_id_required: true,
    max_read_ids: 300,
    max_read_rows: 300,
    max_history_events: 50,
    max_snooze_days: 30,
    read_at: '2026-07-30T10:00:00Z',
    ...overrides,
  };
}

test('Writer access envelope preserves exact governed command set and limits', () => {
  const result = normaliseActionableExceptionLifecycleAccess([accessRow()]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.access?.actionCapability, 'AVAILABLE');
  assert.deepEqual(result.access?.commandActions, allActions);
  assert.equal(result.access?.commandIdRequired, true);
  assert.equal(result.access?.maxReadIds, 300);
  assert.equal(result.access?.maxReadRows, 300);
  assert.equal(result.access?.maxHistoryEvents, 50);
  assert.equal(result.access?.maxSnoozeDays, 30);
});

test('Viewer READ_ONLY envelope requires zero command actions', () => {
  const result = normaliseActionableExceptionLifecycleAccess([accessRow({
    action_capability: 'READ_ONLY',
    command_actions: [],
  })]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.access?.actionCapability, 'READ_ONLY');
  assert.deepEqual(result.access?.commandActions, []);
  assert.equal(result.access?.lifecycleCapability, 'AVAILABLE');
  assert.equal(result.access?.ownershipCapability, 'AVAILABLE');
  assert.equal(result.access?.historyCapability, 'AVAILABLE');
});

test('Writer missing or reordered commands fails closed', () => {
  const missing = normaliseActionableExceptionLifecycleAccess([accessRow({
    command_actions: allActions.slice(0, 7),
  })]);
  assert.equal(missing.access, null);
  assert.ok(missing.issues.some((issue) => issue.code === 'ACCESS_ACTIONS_MISMATCH'));

  const reordered = normaliseActionableExceptionLifecycleAccess([accessRow({
    command_actions: [...allActions].reverse(),
  })]);
  assert.equal(reordered.access, null);
  assert.ok(reordered.issues.some((issue) => issue.code === 'ACCESS_ACTIONS_MISMATCH'));
});

test('Viewer with any command action fails closed', () => {
  const result = normaliseActionableExceptionLifecycleAccess([accessRow({
    action_capability: 'READ_ONLY',
    command_actions: ['ACKNOWLEDGE'],
  })]);
  assert.equal(result.access, null);
  assert.ok(result.issues.some((issue) => issue.code === 'ACCESS_ACTIONS_MISMATCH'));
});

test('unknown capability and malformed envelope never produce partial access', () => {
  const unknown = normaliseActionableExceptionLifecycleAccess([accessRow({
    action_capability: 'SOME_WRITE',
  })]);
  assert.equal(unknown.access, null);
  assert.ok(unknown.issues.some((issue) => issue.code === 'UNKNOWN_ACCESS_CAPABILITY'));

  assert.equal(normaliseActionableExceptionLifecycleAccess([]).access, null);
  assert.equal(normaliseActionableExceptionLifecycleAccess([accessRow(), accessRow()]).access, null);
  assert.equal(normaliseActionableExceptionLifecycleAccess({}).access, null);
});

test('invalid limits, booleans and timestamps fail closed', () => {
  const result = normaliseActionableExceptionLifecycleAccess([accessRow({
    command_id_required: 'yes',
    max_history_events: 0,
    read_at: 'not-a-time',
  })]);
  assert.equal(result.access, null);
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_ACCESS_BOOLEAN'));
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_ACCESS_LIMIT'));
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_ACCESS_TIMESTAMP'));
});

test('access failures reuse lifecycle forbidden and unavailable classification', () => {
  assert.equal(actionableExceptionLifecycleAccessFailure({
    code: '42501',
    message: 'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
  }).state, 'forbidden');
  assert.equal(actionableExceptionLifecycleAccessFailure({
    code: 'PGRST202',
    message: 'schema cache',
  }).state, 'unavailable');
  assert.equal(actionableExceptionLifecycleAccessFailure({
    code: 'NOT_CONFIGURED',
    message: 'not configured',
  }).state, 'unavailable');
});
