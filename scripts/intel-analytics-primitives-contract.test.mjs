import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsPath,
  buildAnalyticsBarGeometry,
  buildAnalyticsLineGeometry,
  buildAnalyticsNumericTicks,
  normaliseAnalyticsSeries,
  selectAnalyticsLabelTicks,
} from '../src/features/intelligence/analytics/primitives/analyticsPrimitiveContract.ts';

test('analytics series preserves confirmed zero and converts invalid values to missing issues', () => {
  const series = normaliseAnalyticsSeries([
    { key: 'zero', label: 'Confirmed zero', value: 0 },
    { key: 'missing', label: 'Missing', value: null },
    { key: 'invalid', label: 'Invalid', value: 'not-a-number' },
  ]);
  assert.equal(series.data[0].value, 0);
  assert.equal(series.data[1].value, null);
  assert.equal(series.data[2].value, null);
  assert.equal(series.issues.some((issue) => issue.code === 'INVALID_VALUE'), true);
  assert.deepEqual(series.domain, { min: -1, max: 1 });
});

test('line geometry creates real gaps instead of bridging missing values', () => {
  const geometry = buildAnalyticsLineGeometry([
    { key: 'a', label: 'A', value: 10 },
    { key: 'b', label: 'B', value: 12 },
    { key: 'c', label: 'C', value: null },
    { key: 'd', label: 'D', value: 14 },
    { key: 'e', label: 'E', value: 16 },
  ], { width: 500, height: 200, padding: 20 });

  assert.equal(geometry.segments.length, 2);
  assert.deepEqual(geometry.segments.map((segment) => segment.points.map((point) => point.key)), [
    ['a', 'b'],
    ['d', 'e'],
  ]);
  assert.equal(geometry.points[2].y, null);
  assert.equal(analyticsPath(geometry.segments[0].points).startsWith('M '), true);
});

test('equal line values receive a non-zero plotting domain', () => {
  const geometry = buildAnalyticsLineGeometry([
    { key: 'a', label: 'A', value: 5 },
    { key: 'b', label: 'B', value: 5 },
  ]);
  assert.deepEqual(geometry.domain, { min: 4.5, max: 5.5 });
  assert.equal(geometry.points.every((point) => point.y !== null), true);
});

test('bar geometry shares a signed zero baseline and retains zero width', () => {
  const geometry = buildAnalyticsBarGeometry([
    { key: 'negative', label: 'Negative', value: -20 },
    { key: 'zero', label: 'Zero', value: 0 },
    { key: 'positive', label: 'Positive', value: 80 },
    { key: 'missing', label: 'Missing', value: null },
  ]);
  assert.deepEqual(geometry.domain, { min: -20, max: 80 });
  assert.equal(geometry.zeroPercent, 20);
  assert.equal(geometry.rows[0].direction, 'negative');
  assert.equal(geometry.rows[1].direction, 'zero');
  assert.equal(geometry.rows[1].widthPercent, 0);
  assert.equal(geometry.rows[2].direction, 'positive');
  assert.equal(geometry.rows[3].direction, 'missing');
  assert.equal(geometry.rows[3].widthPercent, null);
});

test('all-missing bar data has no fabricated numeric domain', () => {
  const geometry = buildAnalyticsBarGeometry([
    { key: 'a', label: 'A', value: null },
    { key: 'b', label: 'B', value: undefined },
  ]);
  assert.equal(geometry.domain, null);
  assert.equal(geometry.rows.every((row) => row.direction === 'missing'), true);
});

test('numeric and label ticks remain bounded and deterministic', () => {
  assert.deepEqual(buildAnalyticsNumericTicks({ min: 0, max: 100 }, 3), [0, 50, 100]);
  assert.equal(buildAnalyticsNumericTicks({ min: 0, max: 100 }, 50).length, 8);
  assert.deepEqual(selectAnalyticsLabelTicks(3, 6), [0, 1, 2]);
  assert.deepEqual(selectAnalyticsLabelTicks(10, 4), [0, 3, 6, 9]);
  assert.deepEqual(selectAnalyticsLabelTicks(0, 4), []);
});
