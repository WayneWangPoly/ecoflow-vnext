import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyActionableExceptionError,
  normaliseActionableExceptionRequest,
  normaliseActionableExceptionRows,
} from '../src/features/intelligence/attention/actionableExceptionReadContract.ts';

function sourceRow(overrides = {}) {
  return {
    exception_id: 'ORDERMENTUM_ACTIVE:abc',
    source_key: 'ORDERMENTUM_ACTIVE:abc',
    source_kind: 'order',
    source_status: 'MAPPING_EXCEPTION',
    title: 'MAPPING_EXCEPTION',
    detail: 'The order cannot be released.',
    severity: 'unknown',
    status: 'mapping_exception',
    detected_at: '2026-07-30T03:00:00Z',
    updated_at: null,
    due_at: null,
    owner_team: null,
    impact_unit_kind: 'unknown',
    impact_value: null,
    impact_display_value: null,
    affected_count: null,
    recommended_action: null,
    handoff_workspace: 'orders',
    handoff_entity_kind: 'order',
    handoff_entity_id: 'raw-order-1',
    snooze_until: null,
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    notes: null,
    audit_history: null,
    lifecycle_capability: 'CURRENT_ACTIVE_ONLY',
    sla_capability: 'UNAVAILABLE',
    ownership_capability: 'UNAVAILABLE',
    impact_capability: 'UNAVAILABLE',
    action_capability: 'UNAVAILABLE',
    history_capability: 'UNAVAILABLE',
    read_at: '2026-07-30T04:00:00Z',
    raw_order_id: 'raw-order-1',
    external_order_id: 'external-order-1',
    external_order_number: 'EXT-1',
    external_invoice_number: 'EXT-INV-1',
    order_number: 'ORD-1',
    invoice_number: 'INV-1',
    exception_type: 'MAPPING_EXCEPTION',
    ...overrides,
  };
}

test('request defaults to 100 and accepts only bounded integer limits', () => {
  assert.deepEqual(normaliseActionableExceptionRequest(), {
    ok: true,
    request: { limit: 100, requestKey: 'limit:100' },
  });
  assert.equal(normaliseActionableExceptionRequest(1).ok, true);
  assert.equal(normaliseActionableExceptionRequest(300).ok, true);
  assert.equal(normaliseActionableExceptionRequest(0).ok, false);
  assert.equal(normaliseActionableExceptionRequest(301).ok, false);
  assert.equal(normaliseActionableExceptionRequest(2.5).ok, false);
  assert.equal(normaliseActionableExceptionRequest('all').ok, false);
});

test('current-active capability maps lifecycle to open while preserving source status', () => {
  const result = normaliseActionableExceptionRows([sourceRow()]);
  assert.equal(result.state, 'ready');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.input.status, 'open');
  assert.equal(result.rows[0]?.sourceStatus, 'MAPPING_EXCEPTION');
  assert.equal(result.rows[0]?.input.severity, 'unknown');
  assert.deepEqual(result.rows[0]?.input.handoff, {
    workspace: 'orders',
    entityKind: 'order',
    entityId: 'raw-order-1',
  });
  assert.equal(result.rows[0]?.sourceIdentity.invoiceNumber, 'INV-1');
});

test('unavailable fields remain null and non-null drift is suppressed', () => {
  const result = normaliseActionableExceptionRows([sourceRow({
    due_at: '2026-07-30T06:00:00Z',
    owner_team: 'Operations',
    impact_value: 0,
    impact_display_value: '0',
    affected_count: 0,
    recommended_action: 'Release it',
    resolved_at: '2026-07-30T05:00:00Z',
    notes: ['unexpected'],
    audit_history: [{ event: 'unexpected' }],
  })]);
  const input = result.rows[0]?.input;
  assert.equal(result.state, 'partial');
  assert.equal(input?.dueAt, null);
  assert.equal(input?.ownerTeam, null);
  assert.equal(input?.businessImpact?.value, null);
  assert.equal(input?.businessImpact?.displayValue, null);
  assert.equal(input?.businessImpact?.affectedCount, null);
  assert.equal(input?.recommendedAction, null);
  assert.equal(input?.resolvedAt, null);
  assert.deepEqual(input?.notes, []);
  assert.deepEqual(input?.auditHistory, []);
  assert.ok(result.issues.filter((issue) => issue.code === 'UNAVAILABLE_FIELD_SUPPRESSED').length >= 8);
});

test('unknown lifecycle fails closed instead of promoting a record to active work', () => {
  const result = normaliseActionableExceptionRows([sourceRow({
    lifecycle_capability: 'COMPLETE_LEDGER',
  })]);
  assert.equal(result.rows[0]?.input.status, 'unknown');
  assert.equal(result.rows[0]?.capabilities.lifecycle, 'UNKNOWN');
  assert.equal(result.state, 'partial');
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_LIFECYCLE_CAPABILITY'));
});

test('unknown source and severity states remain explicit', () => {
  const result = normaliseActionableExceptionRows([sourceRow({
    source_kind: 'warehouse',
    severity: 'urgent-plus',
  })]);
  assert.equal(result.rows[0]?.input.sourceKind, 'unknown');
  assert.equal(result.rows[0]?.input.severity, 'unknown');
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_SOURCE_KIND'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_SEVERITY'));
});

test('invalid entity handoff degrades to workspace-only or null', () => {
  const mismatched = normaliseActionableExceptionRows([sourceRow({
    handoff_workspace: 'inventory',
  })]);
  assert.equal(mismatched.rows[0]?.input.handoff, null);
  assert.ok(mismatched.issues.some((issue) => issue.code === 'INVALID_HANDOFF'));

  const missingId = normaliseActionableExceptionRows([sourceRow({
    handoff_entity_kind: 'order',
    handoff_entity_id: null,
  })]);
  assert.deepEqual(missingId.rows[0]?.input.handoff, {
    workspace: 'orders',
    entityKind: null,
    entityId: null,
  });
});

test('invalid rows and duplicate identities are omitted and reported', () => {
  const result = normaliseActionableExceptionRows([
    sourceRow(),
    sourceRow({ title: 'duplicate' }),
    sourceRow({ exception_id: '', source_key: '', detected_at: 'not-a-date' }),
  ]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.state, 'partial');
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_ID'));
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_ROW'));
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_TIMESTAMP'));
});

test('invalid read timestamp does not replace the valid detected timestamp', () => {
  const result = normaliseActionableExceptionRows([sourceRow({ read_at: 'invalid' })]);
  assert.equal(result.rows[0]?.readAt, null);
  assert.equal(result.rows[0]?.input.detectedAt, '2026-07-30T03:00:00Z');
  assert.ok(result.issues.some((issue) => issue.field === 'read_at'));
});

test('repository errors classify forbidden invalid unavailable and failed states', () => {
  assert.equal(classifyActionableExceptionError({ code: '42501', message: 'denied' }).state, 'forbidden');
  assert.equal(classifyActionableExceptionError({ code: '22023', message: 'limit' }).state, 'invalid');
  assert.equal(classifyActionableExceptionError({ code: 'PGRST202', message: 'schema cache' }).state, 'unavailable');
  assert.equal(classifyActionableExceptionError({ code: 'XX000', message: 'unexpected' }).state, 'failed');
});

test('empty source remains empty rather than a failed or fabricated queue', () => {
  const result = normaliseActionableExceptionRows([]);
  assert.equal(result.state, 'empty');
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, []);
});
