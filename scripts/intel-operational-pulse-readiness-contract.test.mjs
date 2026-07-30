import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCanonicalOperationalPulseCoverage,
  operationalPulseReadinessSummary,
  readinessRowsToOperationalPulse,
} from '../src/features/intelligence/analytics/operationalPulseReadinessContract.ts';

const keys = [
  'revenue','gross_margin','fill_rate','on_time_delivery_rate','stockout_risk_count',
  'dead_stock_value','substitution_rate','lines_picked_per_hour','inventory_days_of_cover','customer_concentration',
];

function row(metricKey, projectionStatus) {
  return {
    metricKey,
    metricVersion: 1,
    displayName: metricKey.replaceAll('_', ' '),
    unitKind: 'PERCENT',
    metricStatus: 'DRAFT',
    projectionStatus,
    exactGrain: 'governed grain',
    requiredDatasetKeys: [],
    supportedDimensionKeys: [],
    blockedDimensionKeys: [],
    blockerCodes: projectionStatus === 'READY' ? [] : ['NOT_READY'],
    reconciliationTolerance: 0,
    dataOwner: 'Operations',
    qualityPolicy: 'FAIL_CLOSED',
    readinessUpdatedAt: '2026-07-30T00:00:00Z',
  };
}

test('readiness mapping preserves two shadow and eight blocked metrics without values', () => {
  const deck = readinessRowsToOperationalPulse(keys.map((key, index) => row(key, index === 2 || index === 6 ? 'SHADOW' : 'BLOCKED')));
  const summary = operationalPulseReadinessSummary(deck);
  assert.equal(summary.total, 10);
  assert.equal(summary.shadow, 2);
  assert.equal(summary.blocked, 8);
  assert.equal(summary.ready, 0);
  assert.ok(deck.metrics.every((metric) => metric.value === null && metric.displayValue === null));
});

test('readiness mapping keeps canonical metric order regardless of RPC row order', () => {
  const deck = readinessRowsToOperationalPulse([...keys].reverse().map((key) => row(key, 'BLOCKED')));
  assert.deepEqual(deck.metrics.map((metric) => metric.metricKey), keys);
  assert.equal(hasCanonicalOperationalPulseCoverage(deck), true);
});

test('unknown readiness state fails closed as unavailable', () => {
  const deck = readinessRowsToOperationalPulse([row('revenue', 'UNKNOWN')]);
  assert.equal(deck.metrics[0]?.availability, 'UNAVAILABLE');
  assert.equal(deck.metrics[0]?.value, null);
});

test('ready readiness metadata cannot manufacture a KPI value', () => {
  const deck = readinessRowsToOperationalPulse([row('fill_rate', 'READY')]);
  assert.equal(deck.metrics[0]?.availability, 'EMPTY');
  assert.equal(deck.metrics[0]?.value, null);
  assert.ok(deck.issues.some((issue) => issue.code === 'READY_VALUE_INVALID'));
});
