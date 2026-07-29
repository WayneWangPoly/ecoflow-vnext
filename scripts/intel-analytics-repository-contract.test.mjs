import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAnalyticsRepositoryError,
  normaliseAnalyticsDateRange,
  normaliseAnalyticsHealthRow,
  normaliseAnalyticsReconciliationRows,
  normaliseAnalyticsShadowProjectionRows,
  normaliseAnalyticsShadowRequest,
  projectionReadState,
  reconciliationReadState,
} from '../src/features/intelligence/analytics/analyticsRepositoryContract.ts';

test('analytics date ranges are Adelaide-date safe and bounded to the database contract', () => {
  const valid = normaliseAnalyticsDateRange('2025-07-30', '2026-07-30');
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.range.daySpan, 365);
    assert.equal(valid.range.requestKey, '2025-07-30:2026-07-30');
  }

  assert.deepEqual(
    normaliseAnalyticsDateRange('2026-02-30', '2026-03-01'),
    { ok: false, issue: { code: 'INVALID_DATE', field: 'dateFrom', value: '2026-02-30' } },
  );
  assert.equal(normaliseAnalyticsDateRange('2026-07-31', '2026-07-30').ok, false);
  const tooLarge = normaliseAnalyticsDateRange('2025-07-29', '2026-07-31');
  assert.equal(tooLarge.ok, false);
});

test('only governed Shadow metrics can create repository requests', () => {
  const fill = normaliseAnalyticsShadowRequest({
    metricKey: ' FILL_RATE ',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-30',
  });
  assert.equal(fill.ok, true);
  if (fill.ok) {
    assert.equal(fill.request.metricKey, 'fill_rate');
    assert.equal(fill.request.requestKey, 'fill_rate:2026-07-01:2026-07-30');
  }

  assert.deepEqual(
    normaliseAnalyticsShadowRequest({
      metricKey: 'revenue',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-30',
    }),
    {
      ok: false,
      issue: { code: 'METRIC_NOT_AVAILABLE', field: 'metricKey', value: 'revenue' },
    },
  );
});

test('Shadow projection normalisation preserves real zero and never converts null to zero', () => {
  const normalised = normaliseAnalyticsShadowProjectionRows([
    {
      metric_key: 'fill_rate',
      metric_version: 1,
      projection_grain: 'one current eligible stock order line',
      source_order_key: 'order-1',
      source_order_line_key: 'line-1',
      metric_date: '2026-07-30',
      commercial_sku_code: 'CUP-12W',
      unit_key: 'CARTON',
      numerator_quantity: 0,
      denominator_quantity: 10,
      metric_value_percent: 0,
      projection_state: 'SHADOW_READY',
      blocker_code: null,
      source_status_key: 'ACCEPTED',
      order_as_of_at: '2026-07-30T00:00:00Z',
      fulfilment_as_of_at: '2026-07-30T00:00:00Z',
      order_refresh_status: 'CURRENT',
      fulfilment_refresh_status: 'CURRENT',
    },
    {
      metric_key: 'substitution_rate',
      metric_version: 1,
      projection_grain: 'one current eligible stock order line with active fulfilment allocations',
      source_order_key: 'order-2',
      source_order_line_key: 'line-2',
      metric_date: '2026-07-30',
      commercial_sku_code: 'GLOVE-M',
      unit_key: 'CARTON',
      numerator_quantity: null,
      denominator_quantity: null,
      metric_value_percent: null,
      projection_state: 'EMPTY',
      blocker_code: 'ZERO_FULFILLED_DENOMINATOR',
      source_status_key: 'ACCEPTED',
      order_as_of_at: '2026-07-30T00:00:00Z',
      fulfilment_as_of_at: null,
      order_refresh_status: 'CURRENT',
      fulfilment_refresh_status: 'CURRENT',
    },
  ]);

  assert.equal(normalised.rows[0].numeratorQuantity, 0);
  assert.equal(normalised.rows[0].metricValuePercent, 0);
  assert.equal(normalised.rows[1].numeratorQuantity, null);
  assert.equal(normalised.rows[1].metricValuePercent, null);
  assert.equal(projectionReadState(normalised.rows, normalised.issues), 'partial');
});

test('invalid numeric source values become explicit partial issues', () => {
  const normalised = normaliseAnalyticsShadowProjectionRows([
    {
      metric_key: 'fill_rate',
      metric_version: 1,
      projection_grain: 'order line',
      source_order_key: 'order-1',
      source_order_line_key: 'line-1',
      metric_date: '2026-07-30',
      commercial_sku_code: 'CUP-12W',
      unit_key: 'CARTON',
      numerator_quantity: 'not-a-number',
      denominator_quantity: 10,
      metric_value_percent: 'not-a-number',
      projection_state: 'SHADOW_READY',
      blocker_code: null,
      source_status_key: 'ACCEPTED',
      order_as_of_at: null,
      fulfilment_as_of_at: null,
      order_refresh_status: 'CURRENT',
      fulfilment_refresh_status: 'CURRENT',
    },
  ]);

  assert.equal(normalised.rows[0].metricValuePercent, null);
  assert.equal(normalised.issues.some((issue) => issue.code === 'INVALID_NUMBER'), true);
  assert.equal(projectionReadState(normalised.rows, normalised.issues), 'empty');
});

test('analytics health retains unknown source state instead of claiming current', () => {
  const normalised = normaliseAnalyticsHealthRow({
    overall_status: 'SURPRISE',
    visible_dataset_count: 5,
    failed_dataset_count: 0,
    degraded_dataset_count: 0,
    refreshing_dataset_count: 0,
    never_refreshed_count: 0,
    open_quality_count: 0,
    critical_quality_count: 0,
    error_quality_count: 0,
    latest_as_of_at: null,
    latest_status_at: null,
  });
  assert.equal(normalised.row?.overallStatus, 'UNKNOWN');
  assert.equal(normalised.issues[0]?.code, 'UNKNOWN_HEALTH_STATE');
});

test('reconciliation mismatch remains partial and not comparable remains explicit', () => {
  const normalised = normaliseAnalyticsReconciliationRows([
    {
      metric_key: 'fill_rate',
      metric_version: 1,
      source_order_key: 'order-1',
      source_order_line_key: 'line-1',
      metric_date: '2026-07-30',
      unit_key: 'CARTON',
      projection_state: 'SHADOW_READY',
      projected_numerator: 8,
      projected_denominator: 10,
      direct_numerator: 7,
      direct_denominator: 10,
      reconciliation_state: 'MISMATCH',
      reconciliation_detail: 'NUMERATOR_OR_DENOMINATOR_MISMATCH',
      as_of_at: '2026-07-30T00:00:00Z',
    },
    {
      metric_key: 'substitution_rate',
      metric_version: 1,
      source_order_key: 'order-2',
      source_order_line_key: 'line-2',
      metric_date: '2026-07-30',
      unit_key: 'CARTON',
      projection_state: 'EMPTY',
      projected_numerator: null,
      projected_denominator: null,
      direct_numerator: null,
      direct_denominator: null,
      reconciliation_state: 'NOT_COMPARABLE',
      reconciliation_detail: null,
      as_of_at: null,
    },
  ]);
  assert.equal(reconciliationReadState(normalised.rows, normalised.issues), 'partial');
  assert.equal(normalised.rows[1].reconciliationState, 'NOT_COMPARABLE');
});

test('repository errors separate role denial, invalid requests and unavailable schemas', () => {
  assert.equal(classifyAnalyticsRepositoryError({ code: '42501', message: 'permission denied' }).state, 'forbidden');
  assert.equal(classifyAnalyticsRepositoryError({ message: 'INITIAL_KPI_DATE_RANGE_TOO_LARGE' }).state, 'invalid');
  assert.equal(classifyAnalyticsRepositoryError({ code: 'PGRST205', message: 'schema cache missing' }).state, 'unavailable');
  assert.equal(classifyAnalyticsRepositoryError(new Error('unexpected parser failure')).state, 'failed');
});
