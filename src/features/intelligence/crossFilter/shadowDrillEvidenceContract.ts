import {
  classifyAnalyticsRepositoryError,
  isAnalyticsShadowMetricKey,
  normaliseAnalyticsDateRange,
  type AnalyticsRepositoryError,
  type AnalyticsShadowMetricKey,
} from '../analytics/analyticsRepositoryContract.ts';

export const shadowDrillEvidenceRpcName = 'get_initial_kpi_shadow_drill_evidence' as const;
export const shadowDrillEvidenceDimensions = ['date', 'commercial_sku'] as const;

export type ShadowDrillEvidenceDimension = (typeof shadowDrillEvidenceDimensions)[number];
export type ShadowDrillEvidenceState =
  | 'SHADOW_READY'
  | 'PARTIAL'
  | 'EMPTY'
  | 'UNAVAILABLE'
  | 'EXCLUDED'
  | 'UNKNOWN';
export type ShadowDrillEvidenceReadState = 'ready' | 'partial' | 'empty';

export type ShadowDrillEvidenceRequestInput = {
  metricKey: string;
  dimensionKey: string;
  dateFrom: string;
  dateTo: string;
  breakdownLimit?: number;
  entityLimit?: number;
};

export type ShadowDrillEvidenceRequest = {
  metricKey: AnalyticsShadowMetricKey;
  dimensionKey: ShadowDrillEvidenceDimension;
  dateFrom: string;
  dateTo: string;
  daySpan: number;
  breakdownLimit: number;
  entityLimit: number;
  requestKey: string;
};

export type ShadowDrillEvidenceEntity = {
  kind: 'order';
  id: string;
  label: string;
  subtitle: string | null;
};

export type ShadowDrillEvidenceRecord = {
  metricKey: AnalyticsShadowMetricKey;
  metricVersion: number;
  metricStatus: 'DRAFT';
  projectionStatus: 'SHADOW';
  evidenceCapability: 'SHADOW_ONLY';
  dimensionKey: ShadowDrillEvidenceDimension;
  dimensionValueKey: string;
  dimensionValueLabel: string;
  evidenceState: ShadowDrillEvidenceState;
  affectedCount: number;
  lineCount: number;
  shadowReadyLineCount: number;
  unavailableLineCount: number;
  emptyLineCount: number;
  excludedLineCount: number;
  blockerCodes: readonly string[];
  entities: readonly ShadowDrillEvidenceEntity[];
  entitiesTruncated: boolean;
  asOfAt: string;
  readAt: string;
};

export type ShadowDrillEvidenceIssueCode =
  | 'INVALID_REQUEST_METRIC'
  | 'INVALID_REQUEST_DIMENSION'
  | 'INVALID_REQUEST_DATE'
  | 'INVALID_REQUEST_DATE_RANGE'
  | 'REQUEST_DATE_RANGE_TOO_LARGE'
  | 'INVALID_BREAKDOWN_LIMIT'
  | 'INVALID_ENTITY_LIMIT'
  | 'INVALID_RESULT'
  | 'INVALID_ROW'
  | 'REQUEST_METRIC_MISMATCH'
  | 'REQUEST_DIMENSION_MISMATCH'
  | 'INVALID_METRIC_VERSION'
  | 'GOVERNANCE_STATE_MISMATCH'
  | 'UNKNOWN_EVIDENCE_STATE'
  | 'INVALID_DIMENSION_VALUE'
  | 'DUPLICATE_BREAKDOWN_VALUE'
  | 'NON_CANONICAL_ORDER'
  | 'INVALID_COUNT'
  | 'COUNT_CONSERVATION_MISMATCH'
  | 'STATE_INVARIANT_MISMATCH'
  | 'INVALID_BLOCKER_CODES'
  | 'DUPLICATE_BLOCKER_CODE'
  | 'INVALID_ENTITY_COLLECTION'
  | 'INVALID_ENTITY'
  | 'DUPLICATE_ENTITY'
  | 'ENTITY_COUNT_MISMATCH'
  | 'INVALID_TIMESTAMP'
  | 'READ_TIMESTAMP_MISMATCH';

export type ShadowDrillEvidenceIssue = {
  code: ShadowDrillEvidenceIssueCode;
  field?: string;
  value?: string;
  row?: number;
};

export type NormalisedShadowDrillEvidence = {
  rows: ShadowDrillEvidenceRecord[];
  state: ShadowDrillEvidenceReadState;
  issues: ShadowDrillEvidenceIssue[];
};

export type ShadowDrillEvidenceSuccess = {
  ok: true;
  state: ShadowDrillEvidenceReadState;
  data: readonly ShadowDrillEvidenceRecord[];
  issues: readonly ShadowDrillEvidenceIssue[];
  request: ShadowDrillEvidenceRequest;
};

export type ShadowDrillEvidenceFailure = {
  ok: false;
  state: AnalyticsRepositoryError['state'];
  data: null;
  error: AnalyticsRepositoryError;
};

export type ShadowDrillEvidenceResult = ShadowDrillEvidenceSuccess | ShadowDrillEvidenceFailure;

const EVIDENCE_STATES = new Set<ShadowDrillEvidenceState>([
  'SHADOW_READY',
  'PARTIAL',
  'EMPTY',
  'UNAVAILABLE',
  'EXCLUDED',
  'UNKNOWN',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-z0-9][a-z0-9_.:-]*$/i;
const DEFAULT_BREAKDOWN_LIMIT = 25;
const DEFAULT_ENTITY_LIMIT = 25;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function timestamp(
  value: unknown,
  field: string,
  issues: ShadowDrillEvidenceIssue[],
  row?: number,
): string | null {
  const candidate = text(value);
  if (candidate && !Number.isNaN(Date.parse(candidate))) return candidate;
  issues.push({ code: 'INVALID_TIMESTAMP', field, value: candidate || undefined, row });
  return null;
}

function codeList(
  value: unknown,
  field: string,
  issues: ShadowDrillEvidenceIssue[],
  row: number,
): string[] | null {
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_BLOCKER_CODES', field, row });
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  let valid = true;
  value.forEach((item) => {
    const candidate = text(item);
    if (!candidate) {
      issues.push({ code: 'INVALID_BLOCKER_CODES', field, row });
      valid = false;
      return;
    }
    if (seen.has(candidate)) {
      issues.push({ code: 'DUPLICATE_BLOCKER_CODE', field, value: candidate, row });
      valid = false;
      return;
    }
    seen.add(candidate);
    output.push(candidate);
  });
  return valid ? output : null;
}

function count(
  value: unknown,
  field: string,
  issues: ShadowDrillEvidenceIssue[],
  row: number,
): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  issues.push({ code: 'INVALID_COUNT', field, value: String(value).slice(0, 120), row });
  return null;
}

function evidenceState(
  value: unknown,
  issues: ShadowDrillEvidenceIssue[],
  row: number,
): ShadowDrillEvidenceState {
  const candidate = text(value).toUpperCase() as ShadowDrillEvidenceState;
  if (EVIDENCE_STATES.has(candidate)) return candidate;
  issues.push({ code: 'UNKNOWN_EVIDENCE_STATE', field: 'evidence_state', value: candidate || undefined, row });
  return 'UNKNOWN';
}

function entities(
  value: unknown,
  maximum: number,
  issues: ShadowDrillEvidenceIssue[],
  row: number,
): ShadowDrillEvidenceEntity[] | null {
  if (!Array.isArray(value) || value.length > maximum) {
    issues.push({ code: 'INVALID_ENTITY_COLLECTION', field: 'entities', value: String(Array.isArray(value) ? value.length : ''), row });
    return null;
  }
  const output: ShadowDrillEvidenceEntity[] = [];
  const seen = new Set<string>();
  let valid = true;
  value.forEach((item, entityRow) => {
    const raw = recordOf(item);
    const kind = raw ? text(raw.kind).toLowerCase() : '';
    const id = raw ? text(raw.id) : '';
    const label = raw ? text(raw.label) : '';
    const subtitle = raw && raw.subtitle !== null && raw.subtitle !== undefined
      ? text(raw.subtitle) || null
      : null;
    if (!raw || kind !== 'order' || !UUID.test(id) || !label) {
      issues.push({ code: 'INVALID_ENTITY', field: `entities[${entityRow}]`, value: id || kind || undefined, row });
      valid = false;
      return;
    }
    if (seen.has(id)) {
      issues.push({ code: 'DUPLICATE_ENTITY', field: `entities[${entityRow}]`, value: id, row });
      valid = false;
      return;
    }
    seen.add(id);
    output.push({ kind: 'order', id, label, subtitle });
  });
  return valid ? output : null;
}

function stateInvariant(
  state: ShadowDrillEvidenceState,
  ready: number,
  unavailable: number,
  empty: number,
  excluded: number,
): boolean {
  if (state === 'SHADOW_READY') return ready > 0 && unavailable === 0 && empty === 0;
  if (state === 'UNAVAILABLE') return unavailable > 0 && ready === 0 && empty === 0;
  if (state === 'EMPTY') return empty > 0 && ready === 0 && unavailable === 0;
  if (state === 'EXCLUDED') return excluded > 0 && ready === 0 && unavailable === 0 && empty === 0;
  if (state === 'PARTIAL') {
    return (unavailable > 0 && (ready > 0 || empty > 0))
      || (unavailable === 0 && ready > 0 && empty > 0);
  }
  return false;
}

function readState(
  rows: readonly ShadowDrillEvidenceRecord[],
  issues: readonly ShadowDrillEvidenceIssue[],
): ShadowDrillEvidenceReadState {
  if (rows.length === 0) return 'empty';
  return issues.length === 0 ? 'ready' : 'partial';
}

export function normaliseShadowDrillEvidenceRequest(
  input: ShadowDrillEvidenceRequestInput,
): { ok: true; request: ShadowDrillEvidenceRequest } | { ok: false; issue: ShadowDrillEvidenceIssue } {
  const metricKey = input.metricKey.trim().toLowerCase();
  if (!isAnalyticsShadowMetricKey(metricKey)) {
    return { ok: false, issue: { code: 'INVALID_REQUEST_METRIC', field: 'metricKey', value: metricKey } };
  }
  const dimensionKey = input.dimensionKey.trim().toLowerCase();
  if (!shadowDrillEvidenceDimensions.includes(dimensionKey as ShadowDrillEvidenceDimension)) {
    return { ok: false, issue: { code: 'INVALID_REQUEST_DIMENSION', field: 'dimensionKey', value: dimensionKey } };
  }
  const range = normaliseAnalyticsDateRange(input.dateFrom, input.dateTo);
  if (!range.ok) {
    const code = range.issue.code === 'INVALID_DATE'
      ? 'INVALID_REQUEST_DATE'
      : range.issue.code === 'INVALID_DATE_RANGE'
        ? 'INVALID_REQUEST_DATE_RANGE'
        : 'REQUEST_DATE_RANGE_TOO_LARGE';
    return { ok: false, issue: { code, field: range.issue.field, value: range.issue.value } };
  }
  const breakdownLimit = boundedInteger(
    input.breakdownLimit ?? DEFAULT_BREAKDOWN_LIMIT,
    1,
    50,
  );
  if (breakdownLimit === null) {
    return {
      ok: false,
      issue: {
        code: 'INVALID_BREAKDOWN_LIMIT',
        field: 'breakdownLimit',
        value: String(input.breakdownLimit),
      },
    };
  }
  const entityLimit = boundedInteger(input.entityLimit ?? DEFAULT_ENTITY_LIMIT, 1, 100);
  if (entityLimit === null) {
    return {
      ok: false,
      issue: {
        code: 'INVALID_ENTITY_LIMIT',
        field: 'entityLimit',
        value: String(input.entityLimit),
      },
    };
  }
  const request: ShadowDrillEvidenceRequest = {
    metricKey,
    dimensionKey: dimensionKey as ShadowDrillEvidenceDimension,
    dateFrom: range.range.dateFrom,
    dateTo: range.range.dateTo,
    daySpan: range.range.daySpan,
    breakdownLimit,
    entityLimit,
    requestKey: [
      metricKey,
      dimensionKey,
      range.range.requestKey,
      breakdownLimit,
      entityLimit,
    ].join(':'),
  };
  return { ok: true, request };
}

export function normaliseShadowDrillEvidenceRows(
  input: unknown,
  request: ShadowDrillEvidenceRequest,
): NormalisedShadowDrillEvidence {
  const issues: ShadowDrillEvidenceIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  if (!Array.isArray(input)) issues.push({ code: 'INVALID_RESULT' });
  const rows: ShadowDrillEvidenceRecord[] = [];
  const seenBreakdowns = new Set<string>();
  const receivedOrder: Array<{ affectedCount: number; valueKey: string }> = [];

  source.forEach((value, rowIndex) => {
    const raw = recordOf(value);
    if (!raw) {
      issues.push({ code: 'INVALID_ROW', field: `evidence[${rowIndex}]`, row: rowIndex });
      return;
    }
    const metricKey = text(raw.metric_key).toLowerCase();
    const dimensionKey = text(raw.dimension_key).toLowerCase();
    if (metricKey !== request.metricKey) {
      issues.push({ code: 'REQUEST_METRIC_MISMATCH', field: 'metric_key', value: metricKey, row: rowIndex });
      return;
    }
    if (dimensionKey !== request.dimensionKey) {
      issues.push({ code: 'REQUEST_DIMENSION_MISMATCH', field: 'dimension_key', value: dimensionKey, row: rowIndex });
      return;
    }
    const metricVersion = boundedInteger(raw.metric_version, 1, Number.MAX_SAFE_INTEGER);
    if (metricVersion === null) {
      issues.push({ code: 'INVALID_METRIC_VERSION', field: 'metric_version', value: String(raw.metric_version), row: rowIndex });
      return;
    }
    const metricStatus = text(raw.metric_status).toUpperCase();
    const projectionStatus = text(raw.projection_status).toUpperCase();
    const capability = text(raw.evidence_capability).toUpperCase();
    if (metricStatus !== 'DRAFT' || projectionStatus !== 'SHADOW' || capability !== 'SHADOW_ONLY') {
      issues.push({
        code: 'GOVERNANCE_STATE_MISMATCH',
        field: 'governance',
        value: `${metricStatus}:${projectionStatus}:${capability}`,
        row: rowIndex,
      });
      return;
    }
    const valueKey = text(raw.dimension_value_key);
    const valueLabel = text(raw.dimension_value_label);
    if (!valueKey || !TOKEN.test(valueKey) || !valueLabel) {
      issues.push({ code: 'INVALID_DIMENSION_VALUE', field: 'dimension_value_key', value: valueKey || undefined, row: rowIndex });
      return;
    }
    if (seenBreakdowns.has(valueKey)) {
      issues.push({ code: 'DUPLICATE_BREAKDOWN_VALUE', field: 'dimension_value_key', value: valueKey, row: rowIndex });
      return;
    }

    const affectedCount = count(raw.affected_count, 'affected_count', issues, rowIndex);
    const lineCount = count(raw.line_count, 'line_count', issues, rowIndex);
    const readyCount = count(raw.shadow_ready_line_count, 'shadow_ready_line_count', issues, rowIndex);
    const unavailableCount = count(raw.unavailable_line_count, 'unavailable_line_count', issues, rowIndex);
    const emptyCount = count(raw.empty_line_count, 'empty_line_count', issues, rowIndex);
    const excludedCount = count(raw.excluded_line_count, 'excluded_line_count', issues, rowIndex);
    const asOfAt = timestamp(raw.as_of_at, 'as_of_at', issues, rowIndex);
    const readAt = timestamp(raw.read_at, 'read_at', issues, rowIndex);
    const blockers = codeList(raw.blocker_codes, 'blocker_codes', issues, rowIndex);
    const safeEntities = entities(raw.entities, request.entityLimit, issues, rowIndex);
    if (
      affectedCount === null
      || lineCount === null
      || readyCount === null
      || unavailableCount === null
      || emptyCount === null
      || excludedCount === null
      || !asOfAt
      || !readAt
      || blockers === null
      || safeEntities === null
    ) return;
    if (affectedCount > lineCount || lineCount === 0) {
      issues.push({ code: 'COUNT_CONSERVATION_MISMATCH', field: 'affected_count', value: `${affectedCount}:${lineCount}`, row: rowIndex });
      return;
    }
    if (lineCount !== readyCount + unavailableCount + emptyCount + excludedCount) {
      issues.push({ code: 'COUNT_CONSERVATION_MISMATCH', field: 'line_count', value: String(lineCount), row: rowIndex });
      return;
    }

    let state = evidenceState(raw.evidence_state, issues, rowIndex);
    let safeRouteEntities = safeEntities;
    let entitiesTruncated = raw.entities_truncated === true;
    const entityCountValid = entitiesTruncated
      ? safeEntities.length < affectedCount
      : safeEntities.length === affectedCount;
    if (!entityCountValid) {
      issues.push({
        code: 'ENTITY_COUNT_MISMATCH',
        field: 'entities_truncated',
        value: `${affectedCount}:${safeEntities.length}:${String(raw.entities_truncated)}`,
        row: rowIndex,
      });
      state = 'UNKNOWN';
      safeRouteEntities = [];
      entitiesTruncated = false;
    }
    if (!stateInvariant(state, readyCount, unavailableCount, emptyCount, excludedCount)) {
      issues.push({ code: 'STATE_INVARIANT_MISMATCH', field: 'evidence_state', value: state, row: rowIndex });
      state = 'UNKNOWN';
      safeRouteEntities = [];
      entitiesTruncated = false;
    }

    seenBreakdowns.add(valueKey);
    receivedOrder.push({ affectedCount, valueKey });
    rows.push({
      metricKey: request.metricKey,
      metricVersion,
      metricStatus: 'DRAFT',
      projectionStatus: 'SHADOW',
      evidenceCapability: 'SHADOW_ONLY',
      dimensionKey: request.dimensionKey,
      dimensionValueKey: valueKey,
      dimensionValueLabel: valueLabel,
      evidenceState: state,
      affectedCount,
      lineCount,
      shadowReadyLineCount: readyCount,
      unavailableLineCount: unavailableCount,
      emptyLineCount: emptyCount,
      excludedLineCount: excludedCount,
      blockerCodes: blockers,
      entities: safeRouteEntities,
      entitiesTruncated,
      asOfAt,
      readAt,
    });
  });

  const expectedOrder = [...receivedOrder].sort(
    (left, right) => right.affectedCount - left.affectedCount
      || left.valueKey.localeCompare(right.valueKey),
  );
  if (receivedOrder.some((item, index) => item !== expectedOrder[index])) {
    issues.push({ code: 'NON_CANONICAL_ORDER' });
  }
  rows.sort(
    (left, right) => right.affectedCount - left.affectedCount
      || left.dimensionValueKey.localeCompare(right.dimensionValueKey),
  );

  const readTimestamps = new Set(rows.map((row) => row.readAt));
  if (readTimestamps.size > 1) {
    issues.push({ code: 'READ_TIMESTAMP_MISMATCH', field: 'read_at' });
    rows.forEach((row) => {
      row.evidenceState = 'UNKNOWN';
      row.entities = [];
      row.entitiesTruncated = false;
    });
  }

  return { rows, issues, state: readState(rows, issues) };
}

export function shadowDrillEvidenceSuccess(
  request: ShadowDrillEvidenceRequest,
  normalised: NormalisedShadowDrillEvidence,
): ShadowDrillEvidenceSuccess {
  return {
    ok: true,
    state: normalised.state,
    data: normalised.rows,
    issues: normalised.issues,
    request,
  };
}

export function shadowDrillEvidenceInvalid(
  issue: ShadowDrillEvidenceIssue,
): ShadowDrillEvidenceFailure {
  return {
    ok: false,
    state: 'invalid',
    data: null,
    error: {
      state: 'invalid',
      code: issue.code,
      message: `${issue.code}${issue.field ? `: ${issue.field}` : ''}`,
    },
  };
}

export function shadowDrillEvidenceFailure(error: unknown): ShadowDrillEvidenceFailure {
  const classified = classifyAnalyticsRepositoryError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}
