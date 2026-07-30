import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMetricDrillAccessMoment,
  metricDrillAccessCapabilityLabel,
  metricDrillAccessCapabilityTone,
  metricDrillAccessListLabel,
  metricDrillAccessSummary,
} from '../src/features/intelligence/crossFilter/metricDrillAccessPresentationContract.ts';
import { operationalPulseMetricKeys } from '../src/features/intelligence/operationalPulse/operationalPulseContract.ts';

function row(metricKey, overrides = {}) {
  return {
    metricKey,
    metricVersion: 1,
    displayName: metricKey,
    metricStatus: 'DRAFT',
    projectionStatus: 'BLOCKED',
    drillCapability: 'UNAVAILABLE',
    authorisedDimensionKeys: [],
    declaredDimensionKeys: ['date'],
    blockerCodes: ['NOT_READY'],
    drillReasonCodes: ['METRIC_NOT_ACTIVE', 'PROJECTION_BLOCKED'],
    readinessUpdatedAt: '2026-07-31T00:00:00Z',
    readAt: '2026-07-31T00:05:00Z',
    ...overrides,
  };
}

function canonicalRows(overrides = {}) {
  return operationalPulseMetricKeys.map((metricKey) => row(metricKey, overrides[metricKey] ?? {}));
}

test('current ten-metric access summary remains canonical and fully unavailable', () => {
  assert.deepEqual(metricDrillAccessSummary(canonicalRows()), {
    total: 10,
    available: 0,
    unavailable: 10,
    unknown: 0,
    issueCount: 0,
    canonicalCoverage: true,
    readAt: '2026-07-31T00:05:00Z',
  });
});

test('access summary separates available unavailable unknown and issue counts', () => {
  const summary = metricDrillAccessSummary(canonicalRows({
    revenue: { drillCapability: 'AVAILABLE' },
    gross_margin: { drillCapability: 'UNKNOWN' },
  }), 3);
  assert.equal(summary.available, 1);
  assert.equal(summary.unavailable, 8);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.issueCount, 3);
});

test('non-canonical coverage and mixed server timestamps remain explicit', () => {
  const rows = canonicalRows();
  const reordered = [rows[1], rows[0], ...rows.slice(2)];
  reordered[2] = { ...reordered[2], readAt: '2026-07-31T00:05:01Z' };
  const summary = metricDrillAccessSummary(reordered);
  assert.equal(summary.canonicalCoverage, false);
  assert.equal(summary.readAt, null);
});

test('capability labels and tones remain bounded to governance states', () => {
  assert.equal(metricDrillAccessCapabilityLabel('AVAILABLE'), 'AVAILABLE');
  assert.equal(metricDrillAccessCapabilityLabel('UNAVAILABLE'), 'UNAVAILABLE');
  assert.equal(metricDrillAccessCapabilityLabel('UNKNOWN'), 'UNKNOWN');
  assert.equal(metricDrillAccessCapabilityTone('AVAILABLE'), 'success');
  assert.equal(metricDrillAccessCapabilityTone('UNAVAILABLE'), 'neutral');
  assert.equal(metricDrillAccessCapabilityTone('UNKNOWN'), 'warning');
});

test('dimension and reason lists preserve exact server order without invention', () => {
  assert.equal(metricDrillAccessListLabel([]), '—');
  assert.equal(metricDrillAccessListLabel(['date', 'customer']), 'date · customer');
  assert.equal(
    metricDrillAccessListLabel(['METRIC_NOT_ACTIVE', 'PROJECTION_BLOCKED']),
    'METRIC_NOT_ACTIVE · PROJECTION_BLOCKED',
  );
});

test('Adelaide timestamp formatting rejects invalid or missing timestamps', () => {
  assert.equal(formatMetricDrillAccessMoment(null), '—');
  assert.equal(formatMetricDrillAccessMoment('not-a-date'), '—');
  assert.match(
    formatMetricDrillAccessMoment('2026-07-31T00:05:00Z'),
    /31 (?:Jul|July) 2026/,
  );
});
