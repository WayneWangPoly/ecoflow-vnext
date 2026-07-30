import {
  classifyAnalyticsRepositoryError,
  type AnalyticsRepositoryError,
} from '../analytics/analyticsRepositoryContract.ts';
import {
  operationalPulseMetricKeys,
  type OperationalPulseMetricKey,
} from '../operationalPulse/operationalPulseContract.ts';

export const metricDrillAccessRpcName = 'get_metric_drill_access' as const;

export type MetricDrillAccessCapability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type MetricDrillProjectionStatus = 'SHADOW' | 'BLOCKED' | 'READY' | 'UNKNOWN';
export type MetricDrillAccessReadState = 'ready' | 'partial' | 'empty';

export type MetricDrillAccessRecord = {
  metricKey: OperationalPulseMetricKey;
  metricVersion: number;
  displayName: string;
  metricStatus: string;
  projectionStatus: MetricDrillProjectionStatus;
  drillCapability: MetricDrillAccessCapability;
  authorisedDimensionKeys: readonly string[];
  declaredDimensionKeys: readonly string[];
  blockerCodes: readonly string[];
  drillReasonCodes: readonly string[];
  readinessUpdatedAt: string | null;
  readAt: string;
};

export type MetricDrillAccessIssueCode =
  | 'INVALID_ACCESS_RESULT'
  | 'INVALID_ACCESS_ROW'
  | 'UNKNOWN_METRIC_KEY'
  | 'DUPLICATE_METRIC_KEY'
  | 'MISSING_METRIC_KEY'
  | 'NON_CANONICAL_ORDER'
  | 'INVALID_METRIC_VERSION'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_METRIC_STATUS'
  | 'UNKNOWN_PROJECTION_STATUS'
  | 'UNKNOWN_DRILL_CAPABILITY'
  | 'INVALID_STRING_LIST'
  | 'DUPLICATE_STRING_VALUE'
  | 'AUTHORISED_DIMENSION_MISMATCH'
  | 'AVAILABLE_INVARIANT_MISMATCH'
  | 'UNAVAILABLE_DIMENSION_LEAK'
  | 'INVALID_TIMESTAMP'
  | 'READ_TIMESTAMP_MISMATCH';

export type MetricDrillAccessIssue = {
  code: MetricDrillAccessIssueCode;
  metricKey?: string;
  field?: string;
  value?: string;
};

export type NormalisedMetricDrillAccess = {
  rows: MetricDrillAccessRecord[];
  state: MetricDrillAccessReadState;
  issues: MetricDrillAccessIssue[];
};

export type MetricDrillAccessSuccess = {
  ok: true;
  state: MetricDrillAccessReadState;
  data: readonly MetricDrillAccessRecord[];
  issues: readonly MetricDrillAccessIssue[];
};

export type MetricDrillAccessFailure = {
  ok: false;
  state: AnalyticsRepositoryError['state'];
  data: null;
  error: AnalyticsRepositoryError;
};

export type MetricDrillAccessResult = MetricDrillAccessSuccess | MetricDrillAccessFailure;

const METRIC_KEYS = new Set<string>(operationalPulseMetricKeys);
const PROJECTION_STATUSES = new Set<MetricDrillProjectionStatus>([
  'SHADOW',
  'BLOCKED',
  'READY',
  'UNKNOWN',
]);
const METRIC_ORDER = new Map(
  operationalPulseMetricKeys.map((metricKey, index) => [metricKey, index]),
);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(
  value: unknown,
  field: string,
  issues: MetricDrillAccessIssue[],
  metricKey?: string,
): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  issues.push({
    code: 'INVALID_METRIC_VERSION',
    metricKey,
    field,
    value: String(value).slice(0, 120),
  });
  return null;
}

function timestamp(
  value: unknown,
  field: string,
  issues: MetricDrillAccessIssue[],
  metricKey?: string,
  nullable = false,
): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const candidate = text(value);
  if (candidate && !Number.isNaN(Date.parse(candidate))) return candidate;
  issues.push({ code: 'INVALID_TIMESTAMP', metricKey, field, value: candidate || undefined });
  return null;
}

function stringList(
  value: unknown,
  field: string,
  issues: MetricDrillAccessIssue[],
  metricKey?: string,
): string[] | null {
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_STRING_LIST', metricKey, field });
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  let valid = true;
  value.forEach((item) => {
    const candidate = text(item);
    if (!candidate) {
      issues.push({ code: 'INVALID_STRING_LIST', metricKey, field });
      valid = false;
      return;
    }
    if (seen.has(candidate)) {
      issues.push({ code: 'DUPLICATE_STRING_VALUE', metricKey, field, value: candidate });
      valid = false;
      return;
    }
    seen.add(candidate);
    output.push(candidate);
  });
  return valid ? output : null;
}

function projectionStatus(
  value: unknown,
  issues: MetricDrillAccessIssue[],
  metricKey: string,
): MetricDrillProjectionStatus {
  const candidate = text(value).toUpperCase() as MetricDrillProjectionStatus;
  if (PROJECTION_STATUSES.has(candidate)) return candidate;
  issues.push({
    code: 'UNKNOWN_PROJECTION_STATUS',
    metricKey,
    field: 'projection_status',
    value: candidate || undefined,
  });
  return 'UNKNOWN';
}

function drillCapability(
  value: unknown,
  issues: MetricDrillAccessIssue[],
  metricKey: string,
): MetricDrillAccessCapability {
  const candidate = text(value).toUpperCase();
  if (candidate === 'AVAILABLE' || candidate === 'UNAVAILABLE') return candidate;
  issues.push({
    code: 'UNKNOWN_DRILL_CAPABILITY',
    metricKey,
    field: 'drill_capability',
    value: candidate || undefined,
  });
  return 'UNKNOWN';
}

function metricReadState(
  rows: readonly MetricDrillAccessRecord[],
  issues: readonly MetricDrillAccessIssue[],
): MetricDrillAccessReadState {
  if (rows.length === 0) return 'empty';
  return rows.length === operationalPulseMetricKeys.length && issues.length === 0
    ? 'ready'
    : 'partial';
}

export function normaliseMetricDrillAccessRows(input: unknown): NormalisedMetricDrillAccess {
  const issues: MetricDrillAccessIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  if (!Array.isArray(input)) issues.push({ code: 'INVALID_ACCESS_RESULT' });

  const rows: MetricDrillAccessRecord[] = [];
  const seenMetrics = new Set<OperationalPulseMetricKey>();
  const receivedOrder: OperationalPulseMetricKey[] = [];

  source.forEach((value, index) => {
    const raw = recordOf(value);
    if (!raw) {
      issues.push({ code: 'INVALID_ACCESS_ROW', field: `access[${index}]` });
      return;
    }

    const rawMetricKey = text(raw.metric_key);
    if (!METRIC_KEYS.has(rawMetricKey)) {
      issues.push({
        code: 'UNKNOWN_METRIC_KEY',
        metricKey: rawMetricKey || undefined,
        field: `access[${index}].metric_key`,
      });
      return;
    }
    const metricKey = rawMetricKey as OperationalPulseMetricKey;
    if (seenMetrics.has(metricKey)) {
      issues.push({ code: 'DUPLICATE_METRIC_KEY', metricKey });
      return;
    }

    const metricVersion = positiveInteger(
      raw.metric_version,
      `access[${index}].metric_version`,
      issues,
      metricKey,
    );
    const displayName = text(raw.display_name);
    const metricStatus = text(raw.metric_status).toUpperCase();
    const readAt = timestamp(raw.read_at, `access[${index}].read_at`, issues, metricKey);
    if (!displayName) {
      issues.push({ code: 'INVALID_DISPLAY_NAME', metricKey, field: `access[${index}].display_name` });
    }
    if (!metricStatus) {
      issues.push({ code: 'INVALID_METRIC_STATUS', metricKey, field: `access[${index}].metric_status` });
    }
    if (!metricVersion || !displayName || !metricStatus || !readAt) return;

    const declared = stringList(
      raw.declared_dimension_keys,
      `access[${index}].declared_dimension_keys`,
      issues,
      metricKey,
    );
    const authorised = stringList(
      raw.authorised_dimension_keys,
      `access[${index}].authorised_dimension_keys`,
      issues,
      metricKey,
    );
    const blockerCodes = stringList(
      raw.blocker_codes,
      `access[${index}].blocker_codes`,
      issues,
      metricKey,
    );
    const drillReasonCodes = stringList(
      raw.drill_reason_codes,
      `access[${index}].drill_reason_codes`,
      issues,
      metricKey,
    );

    const projection = projectionStatus(raw.projection_status, issues, metricKey);
    let capability = drillCapability(raw.drill_capability, issues, metricKey);
    let safeAuthorised = authorised ?? [];
    const safeDeclared = declared ?? [];
    const safeBlockers = blockerCodes ?? [];
    const safeReasons = drillReasonCodes ?? [];

    const authorisedSubset = safeAuthorised.every((dimension) => safeDeclared.includes(dimension));
    if (!authorisedSubset) {
      issues.push({ code: 'AUTHORISED_DIMENSION_MISMATCH', metricKey, field: 'authorised_dimension_keys' });
      capability = 'UNKNOWN';
      safeAuthorised = [];
    }

    if (capability === 'AVAILABLE') {
      const invariantHolds = metricStatus === 'ACTIVE'
        && projection === 'READY'
        && safeAuthorised.length > 0
        && safeReasons.length === 0
        && declared !== null
        && authorised !== null
        && blockerCodes !== null
        && drillReasonCodes !== null;
      if (!invariantHolds) {
        issues.push({ code: 'AVAILABLE_INVARIANT_MISMATCH', metricKey });
        capability = 'UNKNOWN';
        safeAuthorised = [];
      }
    } else if (safeAuthorised.length > 0) {
      issues.push({ code: 'UNAVAILABLE_DIMENSION_LEAK', metricKey, field: 'authorised_dimension_keys' });
      safeAuthorised = [];
    }

    if (declared === null || authorised === null || blockerCodes === null || drillReasonCodes === null) {
      capability = 'UNKNOWN';
      safeAuthorised = [];
    }

    seenMetrics.add(metricKey);
    receivedOrder.push(metricKey);
    rows.push({
      metricKey,
      metricVersion,
      displayName,
      metricStatus,
      projectionStatus: projection,
      drillCapability: capability,
      authorisedDimensionKeys: safeAuthorised,
      declaredDimensionKeys: safeDeclared,
      blockerCodes: safeBlockers,
      drillReasonCodes: safeReasons,
      readinessUpdatedAt: timestamp(
        raw.readiness_updated_at,
        `access[${index}].readiness_updated_at`,
        issues,
        metricKey,
        true,
      ),
      readAt,
    });
  });

  operationalPulseMetricKeys.forEach((metricKey) => {
    if (!seenMetrics.has(metricKey)) issues.push({ code: 'MISSING_METRIC_KEY', metricKey });
  });

  const receivedCanonical = receivedOrder.every(
    (metricKey, index) => metricKey === operationalPulseMetricKeys[index],
  );
  if (receivedOrder.length > 0 && !receivedCanonical) {
    issues.push({ code: 'NON_CANONICAL_ORDER' });
  }

  rows.sort(
    (left, right) => (METRIC_ORDER.get(left.metricKey) ?? 99) - (METRIC_ORDER.get(right.metricKey) ?? 99),
  );

  const readTimestamps = new Set(rows.map((row) => row.readAt));
  if (readTimestamps.size > 1) {
    issues.push({ code: 'READ_TIMESTAMP_MISMATCH', field: 'read_at' });
    rows.forEach((row) => {
      row.drillCapability = 'UNKNOWN';
      row.authorisedDimensionKeys = [];
    });
  }

  return { rows, issues, state: metricReadState(rows, issues) };
}

export function metricDrillAccessSuccess(
  normalised: NormalisedMetricDrillAccess,
): MetricDrillAccessSuccess {
  return {
    ok: true,
    state: normalised.state,
    data: normalised.rows,
    issues: normalised.issues,
  };
}

export function metricDrillAccessFailure(error: unknown): MetricDrillAccessFailure {
  const classified = classifyAnalyticsRepositoryError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}
