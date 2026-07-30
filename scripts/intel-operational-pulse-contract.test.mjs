import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOperationalPulseDeck,
  formatOperationalPulseMoment,
  normaliseOperationalPulseMetric,
  operationalPulseMetricKeys,
  operationalPulseSignalTone,
} from '../src/features/intelligence/operationalPulse/operationalPulseContract.ts';

test('operational pulse registry contains the ten governed initial metric identities', () => {
  assert.deepEqual(operationalPulseMetricKeys, [
    'revenue',
    'gross_margin',
    'fill_rate',
    'on_time_delivery_rate',
    'stockout_risk_count',
    'dead_stock_value',
    'substitution_rate',
    'lines_picked_per_hour',
    'inventory_days_of_cover',
    'customer_concentration',
  ]);
});

test('ready metrics preserve confirmed numeric zero and supplied display value', () => {
  const result = normaliseOperationalPulseMetric({
    metricKey: 'fill_rate',
    displayName: 'Fill Rate',
    unitKind: 'PERCENT',
    availability: 'READY',
    value: 0,
    displayValue: '0%',
    freshness: 'CURRENT',
    quality: 'TRUSTED',
    asOfAt: '2026-07-30T00:00:00Z',
  });

  assert.equal(result.metric?.availability, 'READY');
  assert.equal(result.metric?.value, 0);
  assert.equal(result.metric?.displayValue, '0%');
  assert.deepEqual(result.issues, []);
});

test('non-ready metrics suppress supplied values instead of presenting shadow data', () => {
  const result = normaliseOperationalPulseMetric({
    metricKey: 'substitution_rate',
    displayName: 'Substitution Rate',
    unitKind: 'PERCENT',
    availability: 'SHADOW',
    value: 12.5,
    displayValue: '12.5%',
    freshness: 'CURRENT',
    quality: 'WARNING',
    blockerCodes: ['FULFILMENT_CAPTURE_COVERAGE_NOT_ESTABLISHED'],
  });

  assert.equal(result.metric?.availability, 'SHADOW');
  assert.equal(result.metric?.value, null);
  assert.equal(result.metric?.displayValue, null);
  assert.equal(result.issues.some((issue) => issue.code === 'NON_READY_VALUE_SUPPRESSED'), true);
});

test('ready metrics with invalid, null or undisplayable values fail closed as empty', () => {
  const invalidValue = normaliseOperationalPulseMetric({
    metricKey: 'revenue',
    displayName: 'Revenue',
    unitKind: 'CURRENCY',
    availability: 'READY',
    value: 'not-a-number',
    displayValue: '$0',
  });
  assert.equal(invalidValue.metric?.availability, 'EMPTY');
  assert.equal(invalidValue.metric?.value, null);
  assert.equal(invalidValue.issues[0]?.code, 'READY_VALUE_INVALID');

  const nullValue = normaliseOperationalPulseMetric({
    metricKey: 'fill_rate',
    displayName: 'Fill Rate',
    unitKind: 'PERCENT',
    availability: 'READY',
    value: null,
    displayValue: '0%',
  });
  assert.equal(nullValue.metric?.availability, 'EMPTY');
  assert.equal(nullValue.metric?.value, null);
  assert.equal(nullValue.issues[0]?.code, 'READY_VALUE_INVALID');

  const missingDisplay = normaliseOperationalPulseMetric({
    metricKey: 'gross_margin',
    displayName: 'Gross Margin',
    unitKind: 'CURRENCY',
    availability: 'READY',
    value: 1200,
    displayValue: '',
  });
  assert.equal(missingDisplay.metric?.availability, 'EMPTY');
  assert.equal(missingDisplay.metric?.value, null);
  assert.equal(missingDisplay.issues[0]?.code, 'READY_DISPLAY_VALUE_REQUIRED');
});

test('operational pulse deck orders metrics canonically and rejects duplicate identity', () => {
  const deck = buildOperationalPulseDeck([
    {
      metricKey: 'substitution_rate',
      displayName: 'Substitution Rate',
      unitKind: 'PERCENT',
      availability: 'BLOCKED',
      freshness: 'NEVER',
      quality: 'UNKNOWN',
    },
    {
      metricKey: 'revenue',
      displayName: 'Revenue',
      unitKind: 'CURRENCY',
      availability: 'BLOCKED',
      freshness: 'NEVER',
      quality: 'UNKNOWN',
    },
    {
      metricKey: 'revenue',
      displayName: 'Duplicate Revenue',
      unitKind: 'CURRENCY',
      availability: 'READY',
      value: 1,
      displayValue: '$1',
    },
    {
      metricKey: 'made_up_metric',
      displayName: 'Made Up',
      unitKind: 'COUNT',
      availability: 'READY',
      value: 1,
      displayValue: '1',
    },
  ]);

  assert.equal(deck.state, 'partial');
  assert.deepEqual(deck.metrics.map((metric) => metric.metricKey), ['revenue', 'substitution_rate']);
  assert.equal(deck.metrics[0]?.displayName, 'Revenue');
  assert.equal(deck.issues.some((issue) => issue.code === 'DUPLICATE_METRIC_KEY'), true);
  assert.equal(deck.issues.some((issue) => issue.code === 'UNKNOWN_METRIC_KEY'), true);
});

test('operational pulse signal tone prioritises invalid quality and stale sources', () => {
  const invalid = normaliseOperationalPulseMetric({
    metricKey: 'fill_rate',
    displayName: 'Fill Rate',
    unitKind: 'PERCENT',
    availability: 'READY',
    value: 99,
    displayValue: '99%',
    freshness: 'CURRENT',
    quality: 'INVALID',
  }).metric;
  assert.ok(invalid);
  assert.equal(operationalPulseSignalTone(invalid), 'danger');

  const stale = normaliseOperationalPulseMetric({
    metricKey: 'inventory_days_of_cover',
    displayName: 'Inventory Days of Cover',
    unitKind: 'DURATION',
    availability: 'READY',
    value: 4,
    displayValue: '4 days',
    freshness: 'STALE',
    quality: 'TRUSTED',
  }).metric;
  assert.ok(stale);
  assert.equal(operationalPulseSignalTone(stale), 'warning');
});

test('operational pulse timestamps use Adelaide presentation and invalid values stay missing', () => {
  assert.equal(formatOperationalPulseMoment(null), '—');
  assert.equal(formatOperationalPulseMoment('not-a-date'), '—');
  assert.match(formatOperationalPulseMoment('2026-07-30T00:00:00Z'), /30 (?:Jul|July), 09:30/);
});
