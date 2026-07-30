import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionableExceptionCapabilityLabel,
  actionableExceptionOrderReference,
  actionableExceptionSurfaceSummary,
  actionableExceptionSurfaceTone,
  buildActionableExceptionDisplayRows,
  formatActionableExceptionAge,
  formatActionableExceptionMoment,
  latestActionableExceptionReadAt,
} from '../src/features/intelligence/attention/actionableExceptionPresentationContract.ts';

function record(overrides = {}) {
  return {
    input: {
      id: 'exception-1',
      sourceKey: 'source-1',
      sourceKind: 'order',
      title: 'MAPPING_EXCEPTION',
      detail: 'Mapping requires review.',
      severity: 'unknown',
      status: 'open',
      detectedAt: '2026-07-30T01:00:00Z',
      updatedAt: null,
      dueAt: null,
      ownerTeam: null,
      businessImpact: { unitKind: 'unknown', value: null, displayValue: null, affectedCount: null },
      recommendedAction: null,
      handoff: { workspace: 'orders', entityKind: 'order', entityId: 'order-1' },
      snoozeUntil: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      notes: [],
      auditHistory: [],
    },
    sourceStatus: 'MAPPING_EXCEPTION',
    readAt: '2026-07-30T04:00:00Z',
    capabilities: {
      lifecycle: 'CURRENT_ACTIVE_ONLY',
      sla: 'UNAVAILABLE',
      ownership: 'UNAVAILABLE',
      impact: 'UNAVAILABLE',
      action: 'UNAVAILABLE',
      history: 'UNAVAILABLE',
    },
    sourceIdentity: {
      rawOrderId: 'raw-1',
      externalOrderId: 'external-1',
      externalOrderNumber: 'EXT-1',
      externalInvoiceNumber: 'EXT-INV-1',
      orderNumber: 'ORD-1',
      invoiceNumber: 'INV-1',
      exceptionType: 'MAPPING_EXCEPTION',
    },
    ...overrides,
  };
}

function queueItem(id = 'exception-1', overrides = {}) {
  return {
    ...record().input,
    id,
    ageMinutes: 180,
    slaState: 'not_set',
    overdueMinutes: null,
    ...overrides,
  };
}

test('latest read timestamp uses valid server read time only', () => {
  assert.equal(latestActionableExceptionReadAt([
    record({ readAt: 'invalid' }),
    record({ input: { ...record().input, id: 'exception-2' }, readAt: '2026-07-30T03:00:00Z' }),
    record({ input: { ...record().input, id: 'exception-3' }, readAt: '2026-07-30T05:00:00Z' }),
  ]), '2026-07-30T05:00:00Z');
  assert.equal(latestActionableExceptionReadAt([record({ readAt: null })]), null);
});

test('age formatting remains bounded and never manufactures missing age', () => {
  assert.equal(formatActionableExceptionAge(null), '—');
  assert.equal(formatActionableExceptionAge(-1), '—');
  assert.equal(formatActionableExceptionAge(0), '0m');
  assert.equal(formatActionableExceptionAge(59), '59m');
  assert.equal(formatActionableExceptionAge(60), '1h');
  assert.equal(formatActionableExceptionAge(125), '2h 5m');
  assert.equal(formatActionableExceptionAge(1_500), '1d 1h');
});

test('Adelaide moment formatting rejects invalid timestamps', () => {
  assert.equal(formatActionableExceptionMoment(null), '—');
  assert.equal(formatActionableExceptionMoment('invalid'), '—');
  const formatted = formatActionableExceptionMoment('2026-07-30T04:00:00Z');
  assert.match(formatted, /30 Jul/);
});

test('unavailable capability labels remain explicit', () => {
  assert.equal(actionableExceptionCapabilityLabel('UNAVAILABLE'), 'Unavailable');
  assert.equal(actionableExceptionCapabilityLabel('UNKNOWN'), 'Unknown');
});

test('display rows preserve queue order and enforce a bounded limit', () => {
  const records = [
    record({ input: { ...record().input, id: 'exception-1' } }),
    record({ input: { ...record().input, id: 'exception-2' }, sourceStatus: 'PAYMENT_REVIEW' }),
    record({ input: { ...record().input, id: 'exception-3' }, sourceStatus: 'STOCK_BLOCKED' }),
  ];
  const rows = buildActionableExceptionDisplayRows(records, [
    queueItem('exception-3'),
    queueItem('exception-1'),
    queueItem('exception-2'),
  ], 2);
  assert.deepEqual(rows.map((row) => row.item.id), ['exception-3', 'exception-1']);
  assert.equal(rows.length, 2);
});

test('surface tone never interprets source status as severity', () => {
  const mapping = record({ sourceStatus: 'MAPPING_EXCEPTION' });
  const payment = record({ sourceStatus: 'PAYMENT_REVIEW' });
  assert.equal(actionableExceptionSurfaceTone(mapping), 'information');
  assert.equal(actionableExceptionSurfaceTone(payment), 'information');
  assert.equal(actionableExceptionSurfaceTone(record({
    capabilities: { ...record().capabilities, lifecycle: 'UNKNOWN' },
  })), 'warning');
});

test('order reference follows verified identifier precedence', () => {
  assert.equal(actionableExceptionOrderReference(record()), 'ORD-1');
  assert.equal(actionableExceptionOrderReference(record({
    sourceIdentity: {
      ...record().sourceIdentity,
      orderNumber: null,
    },
  })), 'EXT-1');
  assert.equal(actionableExceptionOrderReference(record({
    sourceIdentity: {
      rawOrderId: null,
      externalOrderId: null,
      externalOrderNumber: null,
      externalInvoiceNumber: null,
      orderNumber: null,
      invoiceNumber: null,
      exceptionType: null,
    },
  })), 'Order reference');
});

test('surface summary counts records and issues without business-impact aggregation', () => {
  const records = [
    record(),
    record({
      input: { ...record().input, id: 'exception-2' },
      capabilities: { ...record().capabilities, lifecycle: 'UNKNOWN' },
    }),
  ];
  const rows = buildActionableExceptionDisplayRows(records, [
    queueItem('exception-1'),
    queueItem('exception-2', { status: 'unknown' }),
  ]);
  assert.deepEqual(actionableExceptionSurfaceSummary(records, rows, 1, 3), {
    total: 2,
    displayed: 2,
    active: 1,
    unknownLifecycle: 1,
    partialIssueCount: 3,
  });
});

test('empty presentation remains zero-count without unknown lifecycle or issues', () => {
  const rows = buildActionableExceptionDisplayRows([], []);
  assert.deepEqual(rows, []);
  assert.deepEqual(actionableExceptionSurfaceSummary([], rows, 0, 0), {
    total: 0,
    displayed: 0,
    active: 0,
    unknownLifecycle: 0,
    partialIssueCount: 0,
  });
});
