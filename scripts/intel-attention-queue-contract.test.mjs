import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionSlaState,
  buildAttentionQueue,
  normaliseAttentionItem,
} from '../src/features/intelligence/attention/attentionQueueContract.ts';

function item(overrides = {}) {
  return {
    id: 'attention-1',
    sourceKey: 'ORDER_BLOCKED',
    sourceKind: 'order',
    title: 'Order requires review',
    detail: 'Verified release controls are blocking progress.',
    severity: 'high',
    status: 'open',
    detectedAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-07-30T01:00:00Z',
    dueAt: '2026-07-30T03:00:00Z',
    ownerTeam: 'Operations',
    businessImpact: {
      unitKind: 'currency',
      value: 250,
      displayValue: '$250',
      affectedCount: 1,
    },
    recommendedAction: null,
    handoff: {
      workspace: 'orders',
      entityKind: 'order',
      entityId: 'order-1',
    },
    ...overrides,
  };
}

test('attention impact preserves confirmed zero and keeps missing values null', () => {
  const zero = normaliseAttentionItem(item({
    businessImpact: { unitKind: 'count', value: 0, displayValue: '0', affectedCount: 0 },
  }));
  assert.equal(zero.item?.businessImpact.value, 0);
  assert.equal(zero.item?.businessImpact.affectedCount, 0);

  const missing = normaliseAttentionItem(item({
    id: 'attention-2',
    businessImpact: { unitKind: 'count', value: null, displayValue: null, affectedCount: null },
  }));
  assert.equal(missing.item?.businessImpact.value, null);
  assert.equal(missing.item?.businessImpact.affectedCount, null);
});

test('unknown severity and status fail closed without becoming an active high-priority item', () => {
  const queue = buildAttentionQueue([
    item({ severity: 'urgent-plus', status: 'waiting-for-someone' }),
  ], '2026-07-30T02:00:00Z');
  assert.equal(queue.items[0]?.severity, 'unknown');
  assert.equal(queue.items[0]?.status, 'unknown');
  assert.equal(queue.activeItems.length, 0);
  assert.equal(queue.otherItems.length, 1);
  assert.equal(queue.state, 'partial');
  assert.ok(queue.issues.some((issue) => issue.code === 'UNKNOWN_SEVERITY'));
  assert.ok(queue.issues.some((issue) => issue.code === 'UNKNOWN_STATUS'));
});

test('active queue ranks breached SLA before severity and remains deterministic', () => {
  const queue = buildAttentionQueue([
    item({
      id: 'critical-within-sla',
      severity: 'critical',
      dueAt: '2026-07-30T05:00:00Z',
    }),
    item({
      id: 'high-breached',
      severity: 'high',
      dueAt: '2026-07-30T01:00:00Z',
    }),
    item({
      id: 'medium-breached',
      severity: 'medium',
      dueAt: '2026-07-30T01:00:00Z',
    }),
  ], '2026-07-30T02:00:00Z');
  assert.deepEqual(queue.activeItems.map((entry) => entry.id), [
    'high-breached',
    'medium-breached',
    'critical-within-sla',
  ]);
  assert.equal(queue.summary.breached, 2);
});

test('closed attention items never report an SLA breach', () => {
  const normalised = normaliseAttentionItem(item({
    status: 'resolved',
    resolvedAt: '2026-07-30T01:30:00Z',
    dueAt: '2026-07-30T01:00:00Z',
  }));
  assert.ok(normalised.item);
  assert.equal(attentionSlaState(normalised.item, Date.parse('2026-07-30T02:00:00Z')), 'closed');

  const queue = buildAttentionQueue([item({
    status: 'resolved',
    resolvedAt: '2026-07-30T01:30:00Z',
    dueAt: '2026-07-30T01:00:00Z',
  })], '2026-07-30T02:00:00Z');
  assert.equal(queue.summary.breached, 0);
  assert.equal(queue.closedItems.length, 1);
});

test('duplicate attention identities are omitted and reported', () => {
  const queue = buildAttentionQueue([
    item(),
    item({ title: 'Duplicate source record' }),
  ], '2026-07-30T02:00:00Z');
  assert.equal(queue.items.length, 1);
  assert.equal(queue.state, 'partial');
  assert.ok(queue.issues.some((issue) => issue.code === 'DUPLICATE_ID'));
});

test('incompatible entity handoff degrades to a workspace-only target', () => {
  const normalised = normaliseAttentionItem(item({
    handoff: {
      workspace: 'inventory',
      entityKind: 'order',
      entityId: 'order-1',
    },
  }));
  assert.deepEqual(normalised.item?.handoff, {
    workspace: 'inventory',
    entityKind: null,
    entityId: null,
  });
  assert.ok(normalised.issues.some((issue) => issue.code === 'INVALID_HANDOFF'));
});

test('resolution fields on active attention are suppressed rather than exposed as resolved facts', () => {
  const normalised = normaliseAttentionItem(item({
    status: 'open',
    resolvedAt: '2026-07-30T01:30:00Z',
    resolvedBy: 'Operator',
    resolutionNote: 'Done',
  }));
  assert.equal(normalised.item?.resolvedAt, null);
  assert.equal(normalised.item?.resolvedBy, null);
  assert.equal(normalised.item?.resolutionNote, null);
  assert.ok(normalised.issues.some((issue) => issue.code === 'RESOLUTION_FIELDS_SUPPRESSED'));
});

test('queue summary counts records without aggregating mixed business-impact units', () => {
  const queue = buildAttentionQueue([
    item({
      id: 'currency-impact',
      businessImpact: { unitKind: 'currency', value: 500, displayValue: '$500', affectedCount: 1 },
    }),
    item({
      id: 'percentage-impact',
      businessImpact: { unitKind: 'percentage', value: 25, displayValue: '25%', affectedCount: 4 },
    }),
  ], '2026-07-30T02:00:00Z');
  assert.equal(queue.summary.total, 2);
  assert.equal(queue.summary.active, 2);
  assert.equal('impactTotal' in queue.summary, false);
  assert.deepEqual(queue.items.map((entry) => entry.businessImpact.value), [500, 25]);
});

test('future detection time remains visible but has no manufactured age', () => {
  const queue = buildAttentionQueue([
    item({ detectedAt: '2026-07-30T03:00:00Z' }),
  ], '2026-07-30T02:00:00Z');
  assert.equal(queue.items[0]?.ageMinutes, null);
  assert.ok(queue.issues.some((issue) => issue.code === 'FUTURE_DETECTED_AT'));
});
