import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const aliasLoader = `
import { pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return {
      url: pathToFileURL(\`${process.cwd()}/src/\${specifier.slice(2)}\`).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(aliasLoader)}`, import.meta.url);

const {
  defaultShadowEvidenceDateRange,
  formatShadowEvidenceMoment,
  shadowEvidenceBlockerLabel,
  shadowEvidenceDimensionLabel,
  shadowEvidenceMetricLabel,
  shadowEvidenceOrderRoute,
  shadowEvidenceStatePresentation,
  shadowEvidenceSummary,
} = await import('../src/features/intelligence/crossFilter/shadowDrillEvidencePresentationContract.ts');

function evidence(overrides = {}) {
  return {
    metricKey: 'fill_rate',
    metricVersion: 1,
    metricStatus: 'DRAFT',
    projectionStatus: 'SHADOW',
    evidenceCapability: 'SHADOW_ONLY',
    dimensionKey: 'date',
    dimensionValueKey: '2026-07-30',
    dimensionValueLabel: '2026-07-30',
    evidenceState: 'SHADOW_READY',
    affectedCount: 2,
    lineCount: 3,
    shadowReadyLineCount: 3,
    unavailableLineCount: 0,
    emptyLineCount: 0,
    excludedLineCount: 0,
    blockerCodes: [],
    entities: [],
    entitiesTruncated: false,
    asOfAt: '2026-07-30T12:00:00Z',
    readAt: '2026-07-30T12:01:00Z',
    ...overrides,
  };
}

test('Shadow review defaults to a bounded thirty-day UTC range', () => {
  assert.deepEqual(defaultShadowEvidenceDateRange(new Date('2026-07-31T08:00:00+09:30')), {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-30',
  });
});

test('Shadow review labels metrics dimensions blockers and states explicitly', () => {
  assert.equal(shadowEvidenceMetricLabel('fill_rate'), 'Fill Rate');
  assert.equal(shadowEvidenceMetricLabel('substitution_rate'), 'Substitution Rate');
  assert.equal(shadowEvidenceDimensionLabel('date'), 'Delivery date');
  assert.equal(shadowEvidenceDimensionLabel('commercial_sku'), 'Commercial SKU');
  assert.equal(shadowEvidenceBlockerLabel([]), 'No blocker code');
  assert.equal(shadowEvidenceBlockerLabel(['ORDER_STATUS_UNCLASSIFIED']), 'ORDER_STATUS_UNCLASSIFIED');
  assert.deepEqual(shadowEvidenceStatePresentation('UNAVAILABLE'), {
    label: 'UNAVAILABLE',
    tone: 'danger',
    description: 'Source quality or policy prevents this evidence from being relied on.',
  });
});

test('Shadow review summary preserves bounded evidence counts without KPI arithmetic', () => {
  const summary = shadowEvidenceSummary([
    evidence(),
    evidence({
      dimensionValueKey: '2026-07-29',
      affectedCount: 1,
      lineCount: 4,
      shadowReadyLineCount: 1,
      unavailableLineCount: 2,
      emptyLineCount: 1,
      readAt: '2026-07-30T12:01:00Z',
    }),
  ], 2);
  assert.deepEqual(summary, {
    breakdowns: 2,
    affectedOrders: 3,
    shadowReadyLines: 4,
    unavailableLines: 2,
    emptyLines: 1,
    issueCount: 2,
    readAt: '2026-07-30T12:01:00Z',
  });
  assert.equal('metricValue' in summary, false);
  assert.equal('numerator' in summary, false);
  assert.equal('denominator' in summary, false);
});

test('Shadow evidence Order handoff uses canonical route and drawer query state', () => {
  const route = shadowEvidenceOrderRoute({
    kind: 'order',
    id: '95000000-0000-4000-8000-000000000001',
    label: 'OMO-001',
    subtitle: 'INV-001',
  });
  assert.equal(route?.workspace, 'orders');
  assert.equal(route?.pathname, '/orders/95000000-0000-4000-8000-000000000001');
  assert.equal(route?.query.selected, '95000000-0000-4000-8000-000000000001');
  assert.equal(route?.query.primaryDrawer, 'order:95000000-0000-4000-8000-000000000001');
  assert.match(route?.href ?? '', /^\/orders\/95000000-0000-4000-8000-000000000001\?/);
});

test('invalid route identity cannot become an operational handoff', () => {
  assert.equal(shadowEvidenceOrderRoute({
    kind: 'order',
    id: 'unsafe/order',
    label: 'Unsafe',
    subtitle: null,
  }), null);
});

test('Shadow evidence moments are explicit and invalid timestamps do not look fresh', () => {
  assert.match(formatShadowEvidenceMoment('2026-07-30T12:00:00Z'), /2026/);
  assert.equal(formatShadowEvidenceMoment(null), 'Not available');
  assert.equal(formatShadowEvidenceMoment('not-a-date'), 'Invalid timestamp');
});
