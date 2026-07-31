import assert from 'node:assert/strict';
import test from 'node:test';
import {
  intelligenceCanonicalSmokeRoutes,
  intelligenceFinalCompletionOutcomes,
  intelligencePerformanceBudgets,
  intelligenceProgramCompletionSummary,
  intelligenceProgramQualityEvidence,
  intelligenceProgramQualityPillars,
  validateIntelligenceProgramAssurance,
} from '../src/features/intelligence/analytics/programAssurance/programAssuranceContract.ts';

function releaseFlag(key, rolloutState) {
  return {
    key,
    rolloutState,
    deliveryMode: rolloutState === 'ON'
      ? 'INTELLIGENCE_PRIMARY'
      : rolloutState === 'SHADOW'
        ? 'LEGACY_PRIMARY_SHADOW_READ'
        : 'LEGACY_ONLY',
    version: 1,
    reason: 'Contract fixture',
    updatedAt: '2026-07-31T00:00:00.000Z',
    canManage: false,
    readAt: '2026-07-31T00:01:00.000Z',
    checks: [],
  };
}

const keys = [
  'control_room_v2',
  'analytics_inventory_v1',
  'analytics_customer_v1',
  'analytics_delivery_v1',
  'overlay_navigation_v1',
];

test('publishes twelve unique final completion outcomes in roadmap order', () => {
  assert.equal(intelligenceFinalCompletionOutcomes.length, 12);
  assert.equal(new Set(intelligenceFinalCompletionOutcomes.map((outcome) => outcome.key)).size, 12);
  assert.deepEqual(intelligenceFinalCompletionOutcomes.map((outcome) => outcome.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(intelligenceFinalCompletionOutcomes.every((outcome) => outcome.engineeringState === 'COMPLETE'));
});

test('covers all six permanent quality pillars', () => {
  assert.equal(intelligenceProgramQualityPillars.length, 6);
  assert.equal(intelligenceProgramQualityEvidence.length, 6);
  assert.deepEqual(
    intelligenceProgramQualityEvidence.map((pillar) => pillar.key),
    [...intelligenceProgramQualityPillars],
  );
});

test('programme assurance registry validates without scope drift', () => {
  assert.deepEqual(validateIntelligenceProgramAssurance(), []);
});

test('engineering completion is independent from unavailable production evidence', () => {
  const summary = intelligenceProgramCompletionSummary([]);
  assert.equal(summary.engineeringComplete, 12);
  assert.equal(summary.engineeringTotal, 12);
  assert.equal(summary.productionState, 'NOT_AVAILABLE');
  assert.equal(summary.releaseFlagsAvailable, 0);
});

test('all shadow flags preserve legacy-primary production state', () => {
  const summary = intelligenceProgramCompletionSummary(keys.map((key) => releaseFlag(key, 'SHADOW')));
  assert.equal(summary.productionState, 'SHADOW');
  assert.equal(summary.shadow, 5);
  assert.equal(summary.on, 0);
});

test('partial and full cutover remain explicit', () => {
  const partial = intelligenceProgramCompletionSummary([
    releaseFlag(keys[0], 'ON'),
    ...keys.slice(1).map((key) => releaseFlag(key, 'SHADOW')),
  ]);
  assert.equal(partial.productionState, 'PARTIAL_CUTOVER');
  assert.equal(partial.on, 1);

  const full = intelligenceProgramCompletionSummary(keys.map((key) => releaseFlag(key, 'ON')));
  assert.equal(full.productionState, 'FULL_CUTOVER');
  assert.equal(full.on, 5);
});

test('canonical deep routes and performance budgets are bounded', () => {
  assert.deepEqual(intelligenceCanonicalSmokeRoutes, [
    '/control-room',
    '/orders',
    '/inventory',
    '/customers',
    '/delivery',
    '/returns',
    '/exceptions',
    '/analytics',
    '/settings',
  ]);
  assert.ok(intelligencePerformanceBudgets.largestJavaScriptBytes <= 750_000);
  assert.ok(intelligencePerformanceBudgets.totalJavaScriptBytes <= 1_600_000);
  assert.ok(intelligencePerformanceBudgets.largestCssBytes <= 320_000);
  assert.ok(intelligencePerformanceBudgets.totalCssBytes <= 800_000);
  assert.ok(intelligencePerformanceBudgets.totalAssetCount <= 160);
  assert.ok(intelligencePerformanceBudgets.indexHtmlBytes <= 6_000);
});
