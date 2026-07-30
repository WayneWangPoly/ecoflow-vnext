import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsHealthReadout,
  analyticsHealthTone,
  analyticsMetricTone,
  analyticsQualityTone,
  analyticsRefreshTone,
  displayAnalyticsCount,
  formatAnalyticsMoment,
  sortAnalyticsMetricRows,
  sortAnalyticsQualityRows,
  sortAnalyticsRefreshRows,
} from '../src/features/intelligence/analytics/healthConsole/analyticsHealthConsoleContract.ts';

test('analytics health readout preserves confirmed zero and missing null', () => {
  const readout = analyticsHealthReadout({
    overallStatus: 'CURRENT',
    visibleDatasetCount: 4,
    failedDatasetCount: 0,
    degradedDatasetCount: 0,
    refreshingDatasetCount: 0,
    neverRefreshedCount: null,
    openQualityCount: 0,
    criticalQualityCount: 0,
    errorQualityCount: 0,
    latestAsOfAt: null,
    latestStatusAt: '2026-07-30T00:00:00Z',
  });

  assert.equal(readout.failedDatasetCount, 0);
  assert.equal(displayAnalyticsCount(readout.failedDatasetCount), '0');
  assert.equal(readout.neverRefreshedCount, null);
  assert.equal(displayAnalyticsCount(readout.neverRefreshedCount), '—');
});

test('analytics health and source states map to restrained semantic tones', () => {
  assert.equal(analyticsHealthTone('CURRENT'), 'success');
  assert.equal(analyticsHealthTone('NOT_READY'), 'warning');
  assert.equal(analyticsHealthTone('FAILED'), 'danger');
  assert.equal(analyticsRefreshTone('REFRESHING'), 'information');
  assert.equal(analyticsRefreshTone('STALE'), 'warning');
  assert.equal(analyticsRefreshTone('UNKNOWN'), 'neutral');
  assert.equal(analyticsQualityTone('critical'), 'danger');
  assert.equal(analyticsMetricTone('DRAFT'), 'warning');
});

test('dataset refresh rows sort failed and degraded states before current rows', () => {
  const rows = sortAnalyticsRefreshRows([
    { datasetKey: 'current', sourceSystem: 'ECOFLOW', sourceObject: 'a', status: 'CURRENT', asOfAt: null, lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null, freshnessSla: null, rowCount: 0, errorCode: null, errorMessage: null, details: null, updatedAt: null },
    { datasetKey: 'failed', sourceSystem: 'ECOFLOW', sourceObject: 'b', status: 'FAILED', asOfAt: null, lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null, freshnessSla: null, rowCount: null, errorCode: 'X', errorMessage: null, details: null, updatedAt: null },
    { datasetKey: 'degraded', sourceSystem: 'ECOFLOW', sourceObject: 'c', status: 'DEGRADED', asOfAt: null, lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null, freshnessSla: null, rowCount: null, errorCode: null, errorMessage: null, details: null, updatedAt: null },
  ]);
  assert.deepEqual(rows.map((row) => row.datasetKey), ['failed', 'degraded', 'current']);
});

test('quality findings sort by severity then most recent detection', () => {
  const base = {
    issueId: '1', issueKey: 'a', datasetKey: 'd', status: 'OPEN', issueType: 'TYPE', entityType: null, entityKey: null,
    title: 'Issue', detail: null, businessImpact: null, recommendedAction: null, ownerTeam: null,
    firstDetectedAt: null, occurrenceCount: 1, snoozedUntil: null, resolvedAt: null, resolutionCode: null, details: null, updatedAt: null,
  };
  const rows = sortAnalyticsQualityRows([
    { ...base, issueId: '1', issueKey: 'warn', severity: 'WARN', lastDetectedAt: '2026-07-30T01:00:00Z' },
    { ...base, issueId: '2', issueKey: 'error-old', severity: 'ERROR', lastDetectedAt: '2026-07-29T01:00:00Z' },
    { ...base, issueId: '3', issueKey: 'error-new', severity: 'ERROR', lastDetectedAt: '2026-07-30T02:00:00Z' },
  ]);
  assert.deepEqual(rows.map((row) => row.issueKey), ['error-new', 'error-old', 'warn']);
});

test('metric catalog sorts active before draft without inventing readiness', () => {
  const metric = {
    metricKey: 'metric', metricVersion: 1, displayName: 'Metric', businessDefinition: '', formulaDescription: '', grainKey: 'row', dateBasis: 'date',
    unitKind: 'COUNT', dimensionKeys: [], exclusions: [], sourceObjects: [], freshnessSla: null, dataOwner: 'Operations', qualityPolicy: '', displayFormat: null,
    effectiveFrom: null, effectiveTo: null, updatedAt: null,
  };
  const rows = sortAnalyticsMetricRows([
    { ...metric, metricKey: 'draft', displayName: 'Draft', status: 'DRAFT' },
    { ...metric, metricKey: 'active', displayName: 'Active', status: 'ACTIVE' },
  ]);
  assert.deepEqual(rows.map((row) => row.metricKey), ['active', 'draft']);
});

test('analytics timestamps use Adelaide presentation and invalid values remain missing', () => {
  assert.equal(formatAnalyticsMoment(null), '—');
  assert.equal(formatAnalyticsMoment('not-a-date'), '—');
  assert.match(formatAnalyticsMoment('2026-07-30T00:00:00Z'), /30 Jul 2026/);
});
