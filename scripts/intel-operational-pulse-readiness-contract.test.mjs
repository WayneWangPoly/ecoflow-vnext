import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOperationalPulseDeck,
  operationalPulseMetricKeys,
} from '../src/features/intelligence/operationalPulse/operationalPulseContract.ts';
import {
  readinessRowsToOperationalPulse,
} from '../src/features/intelligence/analytics/operationalPulseReadinessContract.ts';

const keys = [...operationalPulseMetricKeys];

function input(metricKey, availability) {
  return {
    metricKey,
    displayName: metricKey.replaceAll('_', ' '),
    unitKind: 'PERCENT',
    availability,
    value: null,
    displayValue: null,
    freshness: 'UNKNOWN',
    quality: 'UNKNOWN',
    asOfAt: '2026-07-30T00:00:00Z',
    blockerCodes: availability === 'READY' ? [] : ['NOT_READY'],
  };
}

test('readiness mapping preserves two shadow and eight blocked metrics without values', () => {
  const deck = buildOperationalPulseDeck(keys.map((key, index) => input(key, index === 2 || index === 6 ? 'SHADOW' : 'BLOCKED')));
  assert.equal(deck.metrics.filter((metric) => metric.availability === 'SHADOW').length, 2);
  assert.equal(deck.metrics.filter((metric) => metric.availability === 'BLOCKED').length, 8);
  assert.ok(deck.metrics.every((metric) => metric.value === null && metric.displayValue === null));
});

test('readiness mapping keeps canonical metric order regardless of RPC row order', () => {
  const deck = buildOperationalPulseDeck([...keys].reverse().map((key) => input(key, 'BLOCKED')));
  assert.deepEqual(deck.metrics.map((metric) => metric.metricKey), keys);
});

test('unknown readiness state fails closed as unavailable', () => {
  const deck = buildOperationalPulseDeck([input('revenue', 'UNKNOWN')]);
  assert.equal(deck.metrics[0]?.availability, 'UNAVAILABLE');
  assert.equal(deck.metrics[0]?.value, null);
});

test('ready readiness metadata cannot manufacture a KPI value', () => {
  const deck = buildOperationalPulseDeck([input('fill_rate', 'READY')]);
  assert.equal(deck.metrics[0]?.availability, 'EMPTY');
  assert.equal(deck.metrics[0]?.value, null);
  assert.ok(deck.issues.some((issue) => issue.code === 'READY_VALUE_INVALID'));
});


test('transaction-only readiness identities are excluded from the ten-metric Operational Pulse deck', () => {
  const rows = [
    ...keys.map((key) => ({
      metricKey: key,
      metricVersion: 1,
      displayName: key.replaceAll('_', ' '),
      unitKind: 'COUNT',
      metricStatus: 'DRAFT',
      projectionStatus: 'BLOCKED',
      exactGrain: 'fixture',
      requiredDatasetKeys: [],
      supportedDimensionKeys: ['date'],
      blockedDimensionKeys: [],
      blockerCodes: ['NOT_READY'],
      reconciliationTolerance: 0,
      dataOwner: 'Commercial',
      qualityPolicy: 'FAIL_CLOSED',
      readinessUpdatedAt: '2026-07-30T00:00:00Z',
    })),
    {
      metricKey: 'sales_orders',
      metricVersion: 1,
      displayName: 'Sales Orders',
      unitKind: 'COUNT',
      metricStatus: 'ACTIVE',
      projectionStatus: 'READY',
      exactGrain: 'period',
      requiredDatasetKeys: ['analytics.sales_transaction_documents'],
      supportedDimensionKeys: ['date'],
      blockedDimensionKeys: [],
      blockerCodes: [],
      reconciliationTolerance: 0,
      dataOwner: 'Commercial',
      qualityPolicy: 'FAIL_CLOSED',
      readinessUpdatedAt: '2026-07-30T00:00:00Z',
    },
    {
      metricKey: 'average_revenue_per_order',
      metricVersion: 1,
      displayName: 'Average Revenue per Order',
      unitKind: 'CURRENCY',
      metricStatus: 'ACTIVE',
      projectionStatus: 'READY',
      exactGrain: 'period',
      requiredDatasetKeys: ['analytics.sales_transaction_documents'],
      supportedDimensionKeys: ['date'],
      blockedDimensionKeys: [],
      blockerCodes: [],
      reconciliationTolerance: 0.000001,
      dataOwner: 'Commercial',
      qualityPolicy: 'FAIL_CLOSED',
      readinessUpdatedAt: '2026-07-30T00:00:00Z',
    },
  ];

  const deck = readinessRowsToOperationalPulse(rows);
  assert.deepEqual(deck.metrics.map((metric) => metric.metricKey), keys);
  assert.equal(deck.issues.some((issue) => issue.code === 'UNKNOWN_METRIC_KEY'), false);
});
