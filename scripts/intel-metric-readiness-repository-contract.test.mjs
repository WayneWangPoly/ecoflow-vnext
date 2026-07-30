import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAnalyticsRepositoryError,
} from '../src/features/intelligence/analytics/analyticsRepositoryContract.ts';
import {
  metricReadinessReadState,
  normaliseMetricReadinessRows,
} from '../src/features/intelligence/analytics/metricReadinessContract.ts';

test('metric readiness rows preserve zero tolerance and governed metadata arrays', () => {
  const normalised = normaliseMetricReadinessRows([
    {
      metric_key: 'fill_rate',
      metric_version: 1,
      display_name: 'Fill Rate',
      unit_kind: 'PERCENT',
      metric_status: 'DRAFT',
      projection_status: 'SHADOW',
      exact_grain: 'one current eligible stock order line',
      required_dataset_keys: ['analytics.order_lines', 'analytics.fulfilment_lines'],
      supported_dimension_keys: ['date', 'commercial_sku'],
      blocked_dimension_keys: ['customer', 'store'],
      blocker_codes: ['FULFILMENT_CAPTURE_COVERAGE_NOT_ESTABLISHED'],
      reconciliation_tolerance: 0,
      data_owner: 'Operations',
      quality_policy: 'FAIL_CLOSED',
      readiness_updated_at: '2026-07-30T00:00:00Z',
    },
  ]);

  assert.equal(normalised.rows.length, 1);
  assert.equal(normalised.rows[0]?.projectionStatus, 'SHADOW');
  assert.equal(normalised.rows[0]?.reconciliationTolerance, 0);
  assert.deepEqual(normalised.rows[0]?.supportedDimensionKeys, ['date', 'commercial_sku']);
  assert.deepEqual(normalised.rows[0]?.blockerCodes, ['FULFILMENT_CAPTURE_COVERAGE_NOT_ESTABLISHED']);
  assert.deepEqual(normalised.issues, []);
  assert.equal(metricReadinessReadState(normalised.rows, normalised.issues), 'ready');
});

test('unknown projection status fails closed as UNKNOWN and partial', () => {
  const normalised = normaliseMetricReadinessRows([
    {
      metric_key: 'revenue',
      metric_version: 1,
      display_name: 'Revenue',
      unit_kind: 'CURRENCY',
      metric_status: 'DRAFT',
      projection_status: 'EXPERIMENTAL',
      exact_grain: 'one accepted order line',
      required_dataset_keys: ['analytics.order_lines'],
      supported_dimension_keys: ['date'],
      blocked_dimension_keys: ['customer'],
      blocker_codes: ['ORDER_CURRENCY_NOT_CAPTURED'],
      reconciliation_tolerance: null,
      data_owner: 'Commercial',
      quality_policy: 'FAIL_CLOSED',
      readiness_updated_at: null,
    },
  ]);

  assert.equal(normalised.rows[0]?.projectionStatus, 'UNKNOWN');
  assert.equal(normalised.issues.some((issue) => issue.field?.endsWith('projection_status')), true);
  assert.equal(metricReadinessReadState(normalised.rows, normalised.issues), 'partial');
});

test('shadow and blocked readiness without blockers remain visible but partial', () => {
  const normalised = normaliseMetricReadinessRows([
    {
      metric_key: 'substitution_rate',
      metric_version: 1,
      display_name: 'Substitution Rate',
      unit_kind: 'PERCENT',
      metric_status: 'DRAFT',
      projection_status: 'SHADOW',
      exact_grain: 'one fulfilled allocation',
      required_dataset_keys: [],
      supported_dimension_keys: [],
      blocked_dimension_keys: [],
      blocker_codes: [],
      reconciliation_tolerance: 0.0001,
      data_owner: 'Operations',
      quality_policy: 'FAIL_CLOSED',
      readiness_updated_at: null,
    },
  ]);

  assert.equal(normalised.rows.length, 1);
  assert.equal(normalised.rows[0]?.projectionStatus, 'SHADOW');
  assert.equal(normalised.issues.some((issue) => issue.field?.endsWith('blocker_codes')), true);
  assert.equal(metricReadinessReadState(normalised.rows, normalised.issues), 'partial');
});

test('invalid readiness rows are omitted rather than populated with invented fields', () => {
  const normalised = normaliseMetricReadinessRows([
    null,
    {
      metric_key: '',
      display_name: 'Missing key',
      unit_kind: 'COUNT',
      exact_grain: 'row',
    },
  ]);

  assert.deepEqual(normalised.rows, []);
  assert.equal(normalised.issues.length, 2);
  assert.equal(metricReadinessReadState(normalised.rows, normalised.issues), 'empty');
});

test('metric readiness owner-role errors classify as forbidden, never empty', () => {
  assert.deepEqual(
    classifyAnalyticsRepositoryError({
      code: '42501',
      message: 'METRIC_READINESS_OWNER_ROLE_REQUIRED',
    }),
    {
      state: 'forbidden',
      code: '42501',
      message: 'METRIC_READINESS_OWNER_ROLE_REQUIRED',
    },
  );
});
