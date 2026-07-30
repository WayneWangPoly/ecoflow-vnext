import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseShadowDrillEvidenceRequest,
  normaliseShadowDrillEvidenceRows,
  shadowDrillEvidenceFailure,
} from '../src/features/intelligence/crossFilter/shadowDrillEvidenceContract.ts';

const READ_AT = '2026-07-31T00:00:00Z';

function request(overrides = {}) {
  const result = normaliseShadowDrillEvidenceRequest({
    metricKey: 'fill_rate',
    dimensionKey: 'date',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    ...overrides,
  });
  assert.equal(result.ok, true);
  return result.request;
}

function entity(id = '96100000-0000-4000-8000-000000000001', overrides = {}) {
  return {
    kind: 'order',
    id,
    label: 'OMO-1001',
    subtitle: 'INV-1001',
    ...overrides,
  };
}

function rawRow(valueKey, overrides = {}) {
  return {
    metric_key: 'fill_rate',
    metric_version: 1,
    metric_status: 'DRAFT',
    projection_status: 'SHADOW',
    evidence_capability: 'SHADOW_ONLY',
    dimension_key: 'date',
    dimension_value_key: valueKey,
    dimension_value_label: valueKey,
    evidence_state: 'SHADOW_READY',
    affected_count: 1,
    line_count: 1,
    shadow_ready_line_count: 1,
    unavailable_line_count: 0,
    empty_line_count: 0,
    excluded_line_count: 0,
    blocker_codes: [],
    entities: [entity()],
    entities_truncated: false,
    as_of_at: '2026-07-31T00:00:00Z',
    read_at: READ_AT,
    ...overrides,
  };
}

test('Shadow evidence request canonicalises metric dimension range and bounded defaults', () => {
  const result = normaliseShadowDrillEvidenceRequest({
    metricKey: ' Fill_Rate ',
    dimensionKey: ' DATE ',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.request, {
    metricKey: 'fill_rate',
    dimensionKey: 'date',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    daySpan: 30,
    breakdownLimit: 25,
    entityLimit: 25,
    requestKey: 'fill_rate:date:2026-07-01:2026-07-31:25:25',
  });
});

test('invalid metric dimension date range and limits fail locally', () => {
  const cases = [
    [{ metricKey: 'revenue', dimensionKey: 'date', dateFrom: '2026-07-01', dateTo: '2026-07-31' }, 'INVALID_REQUEST_METRIC'],
    [{ metricKey: 'fill_rate', dimensionKey: 'physical_sku', dateFrom: '2026-07-01', dateTo: '2026-07-31' }, 'INVALID_REQUEST_DIMENSION'],
    [{ metricKey: 'fill_rate', dimensionKey: 'date', dateFrom: '2026-02-30', dateTo: '2026-07-31' }, 'INVALID_REQUEST_DATE'],
    [{ metricKey: 'fill_rate', dimensionKey: 'date', dateFrom: '2026-08-01', dateTo: '2026-07-31' }, 'INVALID_REQUEST_DATE_RANGE'],
    [{ metricKey: 'fill_rate', dimensionKey: 'date', dateFrom: '2025-01-01', dateTo: '2026-07-31' }, 'REQUEST_DATE_RANGE_TOO_LARGE'],
    [{ metricKey: 'fill_rate', dimensionKey: 'date', dateFrom: '2026-07-01', dateTo: '2026-07-31', breakdownLimit: 51 }, 'INVALID_BREAKDOWN_LIMIT'],
    [{ metricKey: 'fill_rate', dimensionKey: 'date', dateFrom: '2026-07-01', dateTo: '2026-07-31', entityLimit: 101 }, 'INVALID_ENTITY_LIMIT'],
  ];
  cases.forEach(([input, code]) => {
    const result = normaliseShadowDrillEvidenceRequest(input);
    assert.equal(result.ok, false);
    assert.equal(result.issue.code, code);
  });
});

test('valid Shadow evidence preserves counts blockers and bounded Order entities', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-30', {
      affected_count: 2,
      line_count: 2,
      shadow_ready_line_count: 2,
      entities: [
        entity('96100000-0000-4000-8000-000000000001'),
        entity('96100000-0000-4000-8000-000000000002', { label: 'OMO-1002' }),
      ],
      blocker_codes: ['SOURCE_REVIEW_REQUIRED'],
    }),
  ], request());
  assert.equal(normalised.state, 'ready');
  assert.deepEqual(normalised.issues, []);
  assert.equal(normalised.rows[0]?.evidenceCapability, 'SHADOW_ONLY');
  assert.equal(normalised.rows[0]?.affectedCount, 2);
  assert.deepEqual(normalised.rows[0]?.blockerCodes, ['SOURCE_REVIEW_REQUIRED']);
  assert.equal(normalised.rows[0]?.entities.length, 2);
  assert.equal(normalised.rows[0]?.entities[0]?.kind, 'order');
});

test('line-state count conservation failures omit unsafe rows', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-30', { line_count: 2 }),
  ], request());
  assert.equal(normalised.state, 'empty');
  assert.deepEqual(normalised.rows, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'COUNT_CONSERVATION_MISMATCH'), true);
});

test('state invariant mismatch clears entities and becomes UNKNOWN', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-30', {
      evidence_state: 'EMPTY',
      shadow_ready_line_count: 1,
      empty_line_count: 0,
    }),
  ], request());
  assert.equal(normalised.state, 'partial');
  assert.equal(normalised.rows[0]?.evidenceState, 'UNKNOWN');
  assert.deepEqual(normalised.rows[0]?.entities, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'STATE_INVARIANT_MISMATCH'), true);
});

test('affected entity truncation must match affected count', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-30', {
      affected_count: 2,
      line_count: 2,
      shadow_ready_line_count: 2,
      entities: [entity()],
      entities_truncated: false,
    }),
  ], request());
  assert.equal(normalised.rows[0]?.evidenceState, 'UNKNOWN');
  assert.deepEqual(normalised.rows[0]?.entities, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'ENTITY_COUNT_MISMATCH'), true);
});

test('duplicate and non-canonical breakdowns remain partial and canonicalised', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-31'),
    rawRow('2026-07-30', { affected_count: 2, line_count: 2, shadow_ready_line_count: 2, entities: [
      entity('96100000-0000-4000-8000-000000000001'),
      entity('96100000-0000-4000-8000-000000000002'),
    ] }),
    rawRow('2026-07-31'),
  ], request());
  assert.equal(normalised.state, 'partial');
  assert.deepEqual(normalised.rows.map((row) => row.dimensionValueKey), ['2026-07-30', '2026-07-31']);
  assert.equal(normalised.issues.some((issue) => issue.code === 'DUPLICATE_BREAKDOWN_VALUE'), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'NON_CANONICAL_ORDER'), true);
});

test('cross-row read timestamp mismatch removes all routeable evidence', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-30'),
    rawRow('2026-07-31', { read_at: '2026-07-31T00:00:01Z' }),
  ], request());
  assert.equal(normalised.state, 'partial');
  assert.equal(normalised.rows.every((row) => row.evidenceState === 'UNKNOWN'), true);
  assert.equal(normalised.rows.every((row) => row.entities.length === 0), true);
  assert.equal(normalised.issues.some((issue) => issue.code === 'READ_TIMESTAMP_MISMATCH'), true);
});

test('server governance mismatch is omitted rather than promoted', () => {
  const normalised = normaliseShadowDrillEvidenceRows([
    rawRow('2026-07-30', { metric_status: 'ACTIVE', projection_status: 'READY' }),
  ], request());
  assert.equal(normalised.state, 'empty');
  assert.deepEqual(normalised.rows, []);
  assert.equal(normalised.issues.some((issue) => issue.code === 'GOVERNANCE_STATE_MISMATCH'), true);
});

test('Shadow evidence permission errors classify as forbidden and never empty', () => {
  assert.deepEqual(shadowDrillEvidenceFailure({
    code: '42501',
    message: 'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED',
  }), {
    ok: false,
    state: 'forbidden',
    data: null,
    error: {
      state: 'forbidden',
      code: '42501',
      message: 'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED',
    },
  });
});
