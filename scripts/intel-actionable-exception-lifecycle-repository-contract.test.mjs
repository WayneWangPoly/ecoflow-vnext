import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyActionableExceptionLifecycleError,
  normaliseActionableExceptionLifecycleCommand,
  normaliseActionableExceptionLifecycleCommandResult,
  normaliseActionableExceptionLifecycleReadRequest,
  normaliseActionableExceptionLifecycleRows,
} from '../src/features/intelligence/attention/actionableExceptionLifecycleContract.ts';

const exceptionId = 'ORDERMENTUM_ACTIVE:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const commandId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

function historyEvent(overrides = {}) {
  return {
    event_id: eventId,
    command_id: commandId,
    action: 'ACKNOWLEDGE',
    actor_user_id: actorId,
    actor_role: 'OWNER',
    actor_label: 'owner@example.test',
    previous_status: 'OPEN',
    next_status: 'ACKNOWLEDGED',
    owner_team: null,
    snoozed_until: null,
    resolution_note: null,
    note: null,
    created_at: '2026-07-30T08:00:00Z',
    ...overrides,
  };
}

function lifecycleRow(overrides = {}) {
  return {
    exception_id: exceptionId,
    source_key: exceptionId,
    source_kind: 'order',
    source_status: 'MAPPING_EXCEPTION',
    title: 'MAPPING_EXCEPTION',
    detail: 'Order mapping needs review.',
    detected_at: '2026-07-30T07:00:00Z',
    handoff_workspace: 'orders',
    handoff_entity_kind: 'order',
    handoff_entity_id: 'raw-order-1',
    lifecycle_status: 'ACKNOWLEDGED',
    effective_status: 'ACKNOWLEDGED',
    owner_team: 'Order Operations',
    acknowledged_at: '2026-07-30T08:00:00Z',
    acknowledged_by: 'owner@example.test',
    snoozed_until: null,
    snooze_expired: false,
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    version: 2,
    first_recorded_at: '2026-07-30T08:00:00Z',
    updated_at: '2026-07-30T08:05:00Z',
    last_event_at: '2026-07-30T08:05:00Z',
    audit_history: [historyEvent()],
    lifecycle_capability: 'AVAILABLE',
    ownership_capability: 'AVAILABLE',
    action_capability: 'AVAILABLE',
    history_capability: 'AVAILABLE',
    read_at: '2026-07-30T08:10:00Z',
    ...overrides,
  };
}

test('lifecycle read request canonicalises, deduplicates and bounds IDs', () => {
  const duplicate = normaliseActionableExceptionLifecycleReadRequest([
    exceptionId.toLowerCase(),
    exceptionId.toUpperCase(),
  ], 25);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.deepEqual(duplicate.request.exceptionIds, [exceptionId]);
  assert.equal(duplicate.request.limit, 25);
  assert.ok(duplicate.issues.some((issue) => issue.code === 'DUPLICATE_EXCEPTION_ID'));

  assert.equal(normaliseActionableExceptionLifecycleReadRequest([], 100).ok, true);
  assert.equal(normaliseActionableExceptionLifecycleReadRequest('not-an-array', 100).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleReadRequest(['invalid'], 100).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleReadRequest([exceptionId], 0).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleReadRequest([exceptionId], 301).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleReadRequest(Array(301).fill(exceptionId), 100).ok, false);
});

test('writer lifecycle row preserves governed status, history and order handoff', () => {
  const result = normaliseActionableExceptionLifecycleRows([lifecycleRow()]);
  assert.equal(result.state, 'ready');
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row?.lifecycleStatus, 'ACKNOWLEDGED');
  assert.equal(row?.effectiveStatus, 'ACKNOWLEDGED');
  assert.equal(row?.attentionStatus, 'acknowledged');
  assert.equal(row?.capabilities.action, 'AVAILABLE');
  assert.equal(row?.ownerTeam, 'Order Operations');
  assert.deepEqual(row?.handoff, {
    workspace: 'orders',
    entityKind: 'order',
    entityId: 'raw-order-1',
  });
  assert.equal(row?.auditHistory[0]?.action, 'ACKNOWLEDGE');
  assert.equal(row?.attentionHistory[0]?.actor, 'owner@example.test');
});

test('Viewer READ_ONLY capability remains explicit without hiding governed data', () => {
  const result = normaliseActionableExceptionLifecycleRows([lifecycleRow({
    action_capability: 'READ_ONLY',
  })]);
  assert.equal(result.state, 'ready');
  assert.equal(result.rows[0]?.capabilities.action, 'READ_ONLY');
  assert.equal(result.rows[0]?.lifecycleStatus, 'ACKNOWLEDGED');
  assert.equal(result.rows[0]?.ownerTeam, 'Order Operations');
  assert.equal(result.rows[0]?.auditHistory.length, 1);
});

test('unknown capabilities and lifecycle states fail closed', () => {
  const result = normaliseActionableExceptionLifecycleRows([lifecycleRow({
    effective_status: 'IN_PROGRESS',
    action_capability: 'WRITE_SOME',
    history_capability: 'PARTIAL',
  })]);
  assert.equal(result.state, 'partial');
  assert.equal(result.rows[0]?.effectiveStatus, 'UNKNOWN');
  assert.equal(result.rows[0]?.attentionStatus, 'unknown');
  assert.equal(result.rows[0]?.capabilities.action, 'UNKNOWN');
  assert.equal(result.rows[0]?.capabilities.history, 'UNKNOWN');
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_LIFECYCLE_STATUS'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_CAPABILITY'));
});

test('history is bounded and malformed events are reported rather than trusted', () => {
  const longHistory = Array.from({ length: 52 }, (_, index) => historyEvent({
    event_id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
  }));
  const result = normaliseActionableExceptionLifecycleRows([lifecycleRow({
    audit_history: [...longHistory, { action: 'ACKNOWLEDGE' }],
  })]);
  assert.equal(result.rows[0]?.auditHistory.length, 50);
  assert.equal(result.state, 'partial');
  assert.ok(result.issues.some((issue) => issue.code === 'HISTORY_LIMIT_EXCEEDED'));
});

test('command normalisation enforces action-specific payloads', () => {
  const nowAt = '2026-07-30T09:00:00Z';
  const acknowledge = normaliseActionableExceptionLifecycleCommand({
    commandId,
    exceptionId,
    action: 'acknowledge',
  }, nowAt);
  assert.equal(acknowledge.ok, true);

  const assign = normaliseActionableExceptionLifecycleCommand({
    commandId,
    exceptionId,
    action: 'ASSIGN',
    ownerTeam: 'Order Operations',
  }, nowAt);
  assert.equal(assign.ok, true);
  if (assign.ok) assert.equal(assign.command.ownerTeam, 'Order Operations');

  const snooze = normaliseActionableExceptionLifecycleCommand({
    commandId,
    exceptionId,
    action: 'SNOOZE',
    snoozedUntil: '2026-07-31T09:00:00Z',
  }, nowAt);
  assert.equal(snooze.ok, true);

  const resolve = normaliseActionableExceptionLifecycleCommand({
    commandId,
    exceptionId,
    action: 'RESOLVE',
    resolutionNote: 'Validated and closed.',
  }, nowAt);
  assert.equal(resolve.ok, true);

  const addNote = normaliseActionableExceptionLifecycleCommand({
    commandId,
    exceptionId,
    action: 'ADD_NOTE',
    note: 'Checked with the warehouse.',
  }, nowAt);
  assert.equal(addNote.ok, true);

  assert.equal(normaliseActionableExceptionLifecycleCommand({
    commandId, exceptionId, action: 'ASSIGN',
  }, nowAt).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleCommand({
    commandId, exceptionId, action: 'ACKNOWLEDGE', ownerTeam: 'Ops',
  }, nowAt).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleCommand({
    commandId, exceptionId, action: 'SNOOZE', snoozedUntil: '2026-07-30T08:00:00Z',
  }, nowAt).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleCommand({
    commandId, exceptionId, action: 'SNOOZE', snoozedUntil: '2026-09-01T09:00:00Z',
  }, nowAt).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleCommand({
    commandId, exceptionId, action: 'RESOLVE',
  }, nowAt).ok, false);
  assert.equal(normaliseActionableExceptionLifecycleCommand({
    commandId, exceptionId, action: 'ADD_NOTE',
  }, nowAt).ok, false);
});

test('command result preserves APPLIED and REPLAYED snapshots', () => {
  const applied = normaliseActionableExceptionLifecycleCommandResult([{
    exception_id: exceptionId,
    lifecycle_status: 'ACKNOWLEDGED',
    owner_team: null,
    acknowledged_at: '2026-07-30T08:00:00Z',
    snoozed_until: null,
    resolved_at: null,
    version: 1,
    event_id: eventId,
    command_id: commandId,
    command_status: 'APPLIED',
    event_at: '2026-07-30T08:00:00Z',
  }]);
  assert.equal(applied.record?.commandStatus, 'APPLIED');
  assert.equal(applied.record?.version, 1);

  const replayed = normaliseActionableExceptionLifecycleCommandResult([{
    exception_id: exceptionId,
    lifecycle_status: 'ACKNOWLEDGED',
    owner_team: null,
    acknowledged_at: '2026-07-30T08:00:00Z',
    snoozed_until: null,
    resolved_at: null,
    version: 1,
    event_id: eventId,
    command_id: commandId,
    command_status: 'REPLAYED',
    event_at: '2026-07-30T08:00:00Z',
  }]);
  assert.equal(replayed.record?.commandStatus, 'REPLAYED');
  assert.equal(replayed.record?.attentionStatus, 'acknowledged');

  assert.equal(normaliseActionableExceptionLifecycleCommandResult([]).record, null);
  assert.equal(normaliseActionableExceptionLifecycleCommandResult([{}, {}]).record, null);
});

test('lifecycle errors distinguish forbidden, invalid, conflict, unavailable and failed', () => {
  assert.equal(classifyActionableExceptionLifecycleError({ code: '42501', message: 'denied' }).state, 'forbidden');
  assert.equal(classifyActionableExceptionLifecycleError({ code: '22023', message: 'limit invalid' }).state, 'invalid');
  assert.equal(classifyActionableExceptionLifecycleError({ code: '23505', message: 'command id conflict' }).state, 'conflict');
  assert.equal(classifyActionableExceptionLifecycleError({ code: 'P0002', message: 'ACTIONABLE_EXCEPTION_SOURCE_NOT_ACTIVE' }).state, 'conflict');
  assert.equal(classifyActionableExceptionLifecycleError({ code: 'PGRST202', message: 'schema cache' }).state, 'unavailable');
  assert.equal(classifyActionableExceptionLifecycleError({ code: 'NOT_CONFIGURED', message: 'not configured' }).state, 'unavailable');
  assert.equal(classifyActionableExceptionLifecycleError({ code: 'XX000', message: 'unexpected' }).state, 'failed');
});

test('empty lifecycle source remains explicit empty data', () => {
  const result = normaliseActionableExceptionLifecycleRows([]);
  assert.equal(result.state, 'empty');
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, []);
});
