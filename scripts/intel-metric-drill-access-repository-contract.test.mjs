import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metricDrillAccessFailure,
  normaliseMetricDrillAccessRows,
} from '../src/features/intelligence/crossFilter/metricDrillAccessContract.ts';
import {
  operationalPulseMetricKeys,
} from '../src/features/intelligence/operationalPulse/operationalPulseContract.ts';

const READ_AT = '2026-07-31T00:00:00Z';

function rawRow(metricKey, overrides = {}) {
  const shadow = metricKey === 'fill_rate' || metricKey === 'substitution_rate';
  return {
    metric_key: metricKey,
    metric_version: 1,
    display_name: metricKey.replaceAll('_', ' '),
    metric_status: 'DRAFT',
    projection_status: shadow ? 'SHADOW' : 'BLOCKED',
    drill_capability: 'UNAVAILABLE',
    authorised_dimension_keys: [],
    declared_dimension_keys: ['date'],
    blocker_codes: ['NOT_READY'],
    drill_reason_codes: ['METRIC_NOT_ACTIVE', shadow ? 'PROJECTION_SHADOW' : 'PROJECTION_BLOCKED'],
    readiness_updated_at: '2026-07-30T23:00:00Z',
    read_at: READ_AT,
    ...overrides,
  };
}

function fullEnvelope(overridesByMetric = {}) {
  return operationalPulseMetricKeys.map((metricKey) => rawRow(
    metricKey,
    overridesByMetric[metricKey] ?? {},
  ));
}

test('current ten-metric access envelope remains ready but fully unavailable', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope());
  assert.equal(normalised.state, 'ready');
  assert.deepEqual(normalised.issues, []);
  assert.deepEqual(normalised.rows.map((row) => row.metricKey), [...operationalPulseMetricKeys]);
  assert.equal(normalised.rows.every((row) => row.drillCapability === 'UNAVAILABLE'), true);
  assert.equal(normalised.rows.every((row) => row.authorisedDimensionKeys.length === 0), true);
});

test('AVAILABLE survives only with ACTIVE READY governed dimensions and no reason codes', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    revenue: {
      metric_status: 'ACTIVE',
      projection_status: 'READY',
      drill_capability: 'AVAILABLE',
      authorised_dimension_keys: ['date'],
      declared_dimension_keys: ['date', 'customer'],
      blocker_codes: [],
      drill_reason_codes: [],
    },
  }));
  assert.equal(normalised.state, 'ready');
  const revenue = normalised.rows[0];
  assert.equal(revenue?.drillCapability, 'AVAILABLE');
  assert.deepEqual(revenue?.authorisedDimensionKeys, ['date']);
});

test('malformed list arrays never retain AVAILABLE authority', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    revenue: {
      metric_status: 'ACTIVE',
      projection_status: 'READY',
      drill_capability: 'AVAILABLE',
      authorised_dimension_keys: ['date', 'date'],
      declared_dimension_keys: ['date'],
      blocker_codes: [],
      drill_reason_codes: [],
    },
  }));
  const revenue = normalised.rows[0];
  assert.equal(revenue?.drillCapability, 'UNKNOWN');
  assert.deepEqual(revenue?.authorisedDimensionKeys, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'DUPLICATE_STRING_VALUE'), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'AVAILABLE_INVARIANT_MISMATCH'), true);
});

test('server AVAILABLE with non-ready governance fails closed to UNKNOWN', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    revenue: {
      drill_capability: 'AVAILABLE',
      authorised_dimension_keys: ['date'],
      drill_reason_codes: [],
    },
  }));
  const revenue = normalised.rows[0];
  assert.equal(revenue?.drillCapability, 'UNKNOWN');
  assert.deepEqual(revenue?.authorisedDimensionKeys, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'AVAILABLE_INVARIANT_MISMATCH'), true);
  assert.equal(normalised.state, 'partial');
});

test('authorised dimensions outside declared governance fail closed', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    revenue: {
      metric_status: 'ACTIVE',
      projection_status: 'READY',
      drill_capability: 'AVAILABLE',
      authorised_dimension_keys: ['store'],
      declared_dimension_keys: ['date'],
      blocker_codes: [],
      drill_reason_codes: [],
    },
  }));
  const revenue = normalised.rows[0];
  assert.equal(revenue?.drillCapability, 'UNKNOWN');
  assert.deepEqual(revenue?.authorisedDimensionKeys, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'AUTHORISED_DIMENSION_MISMATCH'), true);
});

test('UNAVAILABLE rows cannot leak authorised dimensions', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    gross_margin: { authorised_dimension_keys: ['date'] },
  }));
  const row = normalised.rows.find((item) => item.metricKey === 'gross_margin');
  assert.equal(row?.drillCapability, 'UNAVAILABLE');
  assert.deepEqual(row?.authorisedDimensionKeys, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'UNAVAILABLE_DIMENSION_LEAK'), true);
});

test('unknown capability and projection states never gain authority', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    fill_rate: {
      projection_status: 'EXPERIMENTAL',
      drill_capability: 'PILOT',
      authorised_dimension_keys: ['date'],
    },
  }));
  const row = normalised.rows.find((item) => item.metricKey === 'fill_rate');
  assert.equal(row?.projectionStatus, 'UNKNOWN');
  assert.equal(row?.drillCapability, 'UNKNOWN');
  assert.deepEqual(row?.authorisedDimensionKeys, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'UNKNOWN_PROJECTION_STATUS'), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'UNKNOWN_DRILL_CAPABILITY'), true);
});

test('missing duplicate and non-canonical metric rows remain partial and canonicalised', () => {
  const source = fullEnvelope();
  const reordered = [source[1], source[0], ...source.slice(2, -1), source[0]];
  const normalised = normaliseMetricDrillAccessRows(reordered);
  assert.equal(normalised.state, 'partial');
  assert.deepEqual(normalised.rows.map((row) => row.metricKey), operationalPulseMetricKeys.slice(0, -1));
  assert.equal(normalised.issues.some((issue) => issue.code === 'DUPLICATE_METRIC_KEY'), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'MISSING_METRIC_KEY'), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'NON_CANONICAL_ORDER'), true);
});

test('cross-row server timestamp mismatch removes all drill authority', () => {
  const normalised = normaliseMetricDrillAccessRows(fullEnvelope({
    revenue: {
      metric_status: 'ACTIVE',
      projection_status: 'READY',
      drill_capability: 'AVAILABLE',
      authorised_dimension_keys: ['date'],
      blocker_codes: [],
      drill_reason_codes: [],
    },
    gross_margin: { read_at: '2026-07-31T00:00:01Z' },
  }));
  assert.equal(normalised.state, 'partial');
  assert.equal(normalised.rows.every((row) => row.drillCapability === 'UNKNOWN'), true);
  assert.equal(normalised.rows.every((row) => row.authorisedDimensionKeys.length === 0), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'READ_TIMESTAMP_MISMATCH'), true);
});

test('invalid access rows are omitted and never replaced with invented metrics', () => {
  const normalised = normaliseMetricDrillAccessRows([null, rawRow('not_a_metric')]);
  assert.equal(normalised.state, 'empty');
  assert.deepEqual(normalised.rows, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'INVALID_ACCESS_ROW'), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'UNKNOWN_METRIC_KEY'), true);
  assert.equal(normalised.issues.filter((issue) => issue.code === 'MISSING_METRIC_KEY').length, 10);
});

test('metric drill permission errors classify as forbidden and never empty', () => {
  assert.deepEqual(metricDrillAccessFailure({
    code: '42501',
    message: 'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED',
  }), {
    ok: false,
    state: 'forbidden',
    data: null,
    error: {
      state: 'forbidden',
      code: '42501',
      message: 'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED',
    },
  });
});
