import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPriorityWorkError,
  normalisePriorityWorkRequest,
  normalisePriorityWorkRows,
} from '../src/features/intelligence/attention/priorityWorkContract.ts';

const READ_AT = '2026-07-31T00:00:00Z';

function rawRow(overrides = {}) {
  return {
    priority_item_id: 'ORDERMENTUM_ACTIVE:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    exception_id: 'ORDERMENTUM_ACTIVE:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    policy_key: 'invoice_detail_missing',
    priority_rank: 40,
    priority_capability: 'POLICY_GOVERNED',
    order_entity_id: 'PW-1',
    order_display_label: 'OMO-001',
    invoice_display_label: 'INV-001',
    cause_title: 'Invoice detail missing',
    cause_detail: 'Invoice detail missing for the mirrored order header.',
    impact_statement: 'EcoFlow cannot verify the Order from mirrored invoice or line detail.',
    detected_at: '2026-07-30T00:00:00Z',
    age_seconds: 86400,
    owner_team: null,
    lifecycle_status: 'OPEN',
    next_action: 'Open the Order and verify the mirrored invoice or line detail.',
    source_status: 'OPEN',
    read_at: READ_AT,
    ...overrides,
  };
}

test('Priority Work request defaults to 20 and accepts only bounded integer limits', () => {
  assert.deepEqual(normalisePriorityWorkRequest(), {
    ok: true,
    request: { limit: 20, requestKey: 'limit:20' },
  });
  assert.equal(normalisePriorityWorkRequest(1).ok, true);
  assert.equal(normalisePriorityWorkRequest(100).ok, true);
  assert.equal(normalisePriorityWorkRequest(0).ok, false);
  assert.equal(normalisePriorityWorkRequest(101).ok, false);
  assert.equal(normalisePriorityWorkRequest(1.5).ok, false);
  assert.equal(normalisePriorityWorkRequest('all').ok, false);
});

test('valid Priority Work preserves server policy order and complete work fields', () => {
  const second = rawRow({
    priority_item_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    exception_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    order_entity_id: 'PW-2',
    order_display_label: 'OMO-002',
    invoice_display_label: null,
    detected_at: '2026-07-30T12:00:00Z',
    age_seconds: 43200,
    owner_team: 'Operations',
    lifecycle_status: 'ACKNOWLEDGED',
  });
  const result = normalisePriorityWorkRows([rawRow(), second]);
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.rows.map((row) => row.orderEntityId), ['PW-1', 'PW-2']);
  assert.equal(result.rows[0]?.impactStatement, 'EcoFlow cannot verify the Order from mirrored invoice or line detail.');
  assert.equal(result.rows[0]?.nextAction, 'Open the Order and verify the mirrored invoice or line detail.');
  assert.equal(result.rows[0]?.ownerTeam, null);
  assert.equal(result.rows[1]?.ownerTeam, 'Operations');
});

test('client reports server ordering drift without silently re-sorting Priority Work', () => {
  const assigned = rawRow({
    priority_item_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    exception_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    order_entity_id: 'PW-2',
    detected_at: '2026-07-30T12:00:00Z',
    age_seconds: 43200,
    owner_team: 'Operations',
  });
  const result = normalisePriorityWorkRows([assigned, rawRow()]);
  assert.equal(result.state, 'partial');
  assert.deepEqual(result.rows.map((row) => row.orderEntityId), ['PW-2', 'PW-1']);
  assert.equal(result.issues.some((issue) => issue.code === 'ORDERING_MISMATCH'), true);
});

test('duplicate identities are omitted rather than duplicated in Priority Work', () => {
  const result = normalisePriorityWorkRows([rawRow(), rawRow({ order_display_label: 'Duplicate' })]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.state, 'partial');
  assert.equal(result.issues.some((issue) => issue.code === 'DUPLICATE_ITEM_ID'), true);
});

test('identity policy capability and required field drift fail closed', () => {
  const result = normalisePriorityWorkRows([
    rawRow({ exception_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    rawRow({ priority_item_id: 'bad-2', exception_id: 'bad-2', policy_key: 'Bad Policy' }),
    rawRow({
      priority_item_id: 'bad-3',
      exception_id: 'bad-3',
      priority_capability: 'INFERRED',
      impact_statement: '',
    }),
  ]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.state, 'partial');
  assert.equal(result.issues.some((issue) => issue.code === 'IDENTITY_MISMATCH'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_POLICY_KEY'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'UNKNOWN_PRIORITY_CAPABILITY'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_TEXT_FIELD'), true);
});

test('resolved lifecycle and unsafe Order identities never become Priority Work', () => {
  const result = normalisePriorityWorkRows([
    rawRow({ lifecycle_status: 'RESOLVED' }),
    rawRow({
      priority_item_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      exception_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      order_entity_id: 'unsafe/order',
    }),
  ]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.issues.some((issue) => issue.code === 'UNKNOWN_LIFECYCLE_STATUS'), true);
  assert.equal(result.issues.some((issue) => issue.code === 'INVALID_ORDER_ENTITY'), true);
});

test('age must reconcile with the same server snapshot', () => {
  const result = normalisePriorityWorkRows([rawRow({ age_seconds: 60 })]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.state, 'partial');
  assert.equal(result.issues.some((issue) => issue.code === 'AGE_SNAPSHOT_MISMATCH'), true);
});

test('cross-row read timestamp mismatch removes all Priority Work rows', () => {
  const second = rawRow({
    priority_item_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    exception_id: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    order_entity_id: 'PW-2',
    detected_at: '2026-07-30T12:00:00Z',
    age_seconds: 43201,
    owner_team: 'Operations',
    read_at: '2026-07-31T00:00:01Z',
  });
  const result = normalisePriorityWorkRows([rawRow(), second]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.state, 'partial');
  assert.equal(result.issues.some((issue) => issue.code === 'READ_TIMESTAMP_MISMATCH'), true);
});

test('invalid result and empty result remain distinct', () => {
  const invalid = normalisePriorityWorkRows(null);
  assert.equal(invalid.state, 'partial');
  assert.equal(invalid.issues.some((issue) => issue.code === 'INVALID_RESULT'), true);

  const empty = normalisePriorityWorkRows([]);
  assert.equal(empty.state, 'empty');
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.issues, []);
});

test('Priority Work errors classify forbidden invalid unavailable and failed states', () => {
  assert.equal(classifyPriorityWorkError({ code: '42501', message: 'denied' }).state, 'forbidden');
  assert.equal(classifyPriorityWorkError({ code: '22023', message: 'limit' }).state, 'invalid');
  assert.equal(classifyPriorityWorkError({ code: 'PGRST202', message: 'schema cache' }).state, 'unavailable');
  assert.equal(classifyPriorityWorkError({ code: 'NOT_CONFIGURED', message: 'not configured' }).state, 'unavailable');
  assert.equal(classifyPriorityWorkError({ code: 'XX000', message: 'unexpected' }).state, 'failed');
});
