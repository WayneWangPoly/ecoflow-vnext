export const analyticsShadowMetricKeys = ['fill_rate', 'substitution_rate'] as const;
export type AnalyticsShadowMetricKey = (typeof analyticsShadowMetricKeys)[number];

export const analyticsPublicViews = [
  'v_ecoflow_analytics_metric_catalog',
  'v_ecoflow_analytics_refresh_status',
  'v_ecoflow_analytics_data_quality',
  'v_ecoflow_analytics_health',
] as const;

export const analyticsShadowRpcNames = [
  'get_initial_kpi_shadow_projection',
  'get_initial_kpi_reconciliation',
] as const;

export type AnalyticsRefreshState =
  | 'NEVER'
  | 'REFRESHING'
  | 'CURRENT'
  | 'STALE'
  | 'DEGRADED'
  | 'FAILED'
  | 'UNKNOWN';

export type AnalyticsHealthState =
  | 'CURRENT'
  | 'NOT_READY'
  | 'REFRESHING'
  | 'DEGRADED'
  | 'FAILED'
  | 'UNKNOWN';

export type AnalyticsReadState = 'ready' | 'partial' | 'empty';
export type AnalyticsFailureState = 'forbidden' | 'invalid' | 'unavailable' | 'failed';

export type AnalyticsRepositoryIssueCode =
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'DATE_RANGE_TOO_LARGE'
  | 'METRIC_NOT_AVAILABLE'
  | 'INVALID_NUMBER'
  | 'INVALID_ROW'
  | 'UNKNOWN_REFRESH_STATE'
  | 'UNKNOWN_HEALTH_STATE';

export type AnalyticsRepositoryIssue = {
  code: AnalyticsRepositoryIssueCode;
  field?: string;
  value?: string;
};

export type AnalyticsRepositoryError = {
  state: AnalyticsFailureState;
  code: string;
  message: string;
};

export type AnalyticsReadSuccess<T> = {
  ok: true;
  state: AnalyticsReadState;
  data: T;
  issues: readonly AnalyticsRepositoryIssue[];
};

export type AnalyticsReadFailure = {
  ok: false;
  state: AnalyticsFailureState;
  data: null;
  error: AnalyticsRepositoryError;
};

export type AnalyticsReadResult<T> = AnalyticsReadSuccess<T> | AnalyticsReadFailure;

export type AnalyticsDateRange = {
  dateFrom: string;
  dateTo: string;
  daySpan: number;
  requestKey: string;
};

export type AnalyticsDateRangeResult =
  | { ok: true; range: AnalyticsDateRange }
  | { ok: false; issue: AnalyticsRepositoryIssue };

export type AnalyticsShadowRequest = {
  metricKey: AnalyticsShadowMetricKey;
  dateFrom: string;
  dateTo: string;
};

export type NormalisedAnalyticsShadowRequest = AnalyticsShadowRequest & {
  daySpan: number;
  requestKey: string;
};

export type AnalyticsMetricCatalogRow = {
  metricKey: string;
  metricVersion: number | null;
  displayName: string;
  businessDefinition: string;
  formulaDescription: string;
  grainKey: string;
  dateBasis: string;
  unitKind: string;
  dimensionKeys: readonly string[];
  exclusions: readonly string[];
  sourceObjects: readonly string[];
  freshnessSla: string | null;
  dataOwner: string;
  qualityPolicy: string;
  displayFormat: string | null;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string | null;
};

export type AnalyticsRefreshStatusRow = {
  datasetKey: string;
  sourceSystem: string;
  sourceObject: string;
  status: AnalyticsRefreshState;
  asOfAt: string | null;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  freshnessSla: string | null;
  rowCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  details: unknown;
  updatedAt: string | null;
};

export type AnalyticsDataQualityRow = {
  issueId: string;
  issueKey: string;
  datasetKey: string;
  severity: string;
  status: string;
  issueType: string;
  entityType: string | null;
  entityKey: string | null;
  title: string;
  detail: string | null;
  businessImpact: string | null;
  recommendedAction: string | null;
  ownerTeam: string | null;
  firstDetectedAt: string | null;
  lastDetectedAt: string | null;
  occurrenceCount: number | null;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  resolutionCode: string | null;
  details: unknown;
  updatedAt: string | null;
};

export type AnalyticsHealthRow = {
  overallStatus: AnalyticsHealthState;
  visibleDatasetCount: number | null;
  failedDatasetCount: number | null;
  degradedDatasetCount: number | null;
  refreshingDatasetCount: number | null;
  neverRefreshedCount: number | null;
  openQualityCount: number | null;
  criticalQualityCount: number | null;
  errorQualityCount: number | null;
  latestAsOfAt: string | null;
  latestStatusAt: string | null;
};

export type AnalyticsShadowProjectionRow = {
  metricKey: AnalyticsShadowMetricKey;
  metricVersion: number | null;
  projectionGrain: string;
  sourceOrderKey: string;
  sourceOrderLineKey: string;
  metricDate: string;
  commercialSkuCode: string | null;
  unitKey: string | null;
  numeratorQuantity: number | null;
  denominatorQuantity: number | null;
  metricValuePercent: number | null;
  projectionState: string;
  blockerCode: string | null;
  sourceStatusKey: string | null;
  orderAsOfAt: string | null;
  fulfilmentAsOfAt: string | null;
  orderRefreshStatus: AnalyticsRefreshState;
  fulfilmentRefreshStatus: AnalyticsRefreshState;
};

export type AnalyticsReconciliationRow = {
  metricKey: AnalyticsShadowMetricKey;
  metricVersion: number | null;
  sourceOrderKey: string;
  sourceOrderLineKey: string;
  metricDate: string;
  unitKey: string | null;
  projectionState: string;
  projectedNumerator: number | null;
  projectedDenominator: number | null;
  directNumerator: number | null;
  directDenominator: number | null;
  reconciliationState: string;
  reconciliationDetail: string | null;
  asOfAt: string | null;
};

type NormalisedRows<Row> = {
  rows: Row[];
  issues: AnalyticsRepositoryIssue[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ANALYTICS_DAY_SPAN = 366;
const REFRESH_STATES = new Set<AnalyticsRefreshState>([
  'NEVER', 'REFRESHING', 'CURRENT', 'STALE', 'DEGRADED', 'FAILED', 'UNKNOWN',
]);
const HEALTH_STATES = new Set<AnalyticsHealthState>([
  'CURRENT', 'NOT_READY', 'REFRESHING', 'DEGRADED', 'FAILED', 'UNKNOWN',
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => nullableText(item)).filter((item): item is string => Boolean(item));
}

function nullableNumber(
  value: unknown,
  field: string,
  issues: AnalyticsRepositoryIssue[],
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(parsed)) return parsed;
  issues.push({ code: 'INVALID_NUMBER', field, value: String(value).slice(0, 120) });
  return null;
}

function parseUtcDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return timestamp;
}

export function isAnalyticsShadowMetricKey(value: string): value is AnalyticsShadowMetricKey {
  return analyticsShadowMetricKeys.includes(value as AnalyticsShadowMetricKey);
}

export function normaliseAnalyticsDateRange(dateFrom: string, dateTo: string): AnalyticsDateRangeResult {
  const from = dateFrom.trim();
  const to = dateTo.trim();
  const fromTimestamp = parseUtcDate(from);
  const toTimestamp = parseUtcDate(to);
  if (fromTimestamp === null) return { ok: false, issue: { code: 'INVALID_DATE', field: 'dateFrom', value: from } };
  if (toTimestamp === null) return { ok: false, issue: { code: 'INVALID_DATE', field: 'dateTo', value: to } };
  if (toTimestamp < fromTimestamp) {
    return { ok: false, issue: { code: 'INVALID_DATE_RANGE', value: `${from},${to}` } };
  }
  const daySpan = Math.floor((toTimestamp - fromTimestamp) / 86_400_000);
  if (daySpan > MAX_ANALYTICS_DAY_SPAN) {
    return { ok: false, issue: { code: 'DATE_RANGE_TOO_LARGE', value: String(daySpan) } };
  }
  return {
    ok: true,
    range: {
      dateFrom: from,
      dateTo: to,
      daySpan,
      requestKey: `${from}:${to}`,
    },
  };
}

export function normaliseAnalyticsShadowRequest(
  input: { metricKey: string; dateFrom: string; dateTo: string },
): { ok: true; request: NormalisedAnalyticsShadowRequest } | { ok: false; issue: AnalyticsRepositoryIssue } {
  const metricKey = input.metricKey.trim().toLowerCase();
  if (!isAnalyticsShadowMetricKey(metricKey)) {
    return { ok: false, issue: { code: 'METRIC_NOT_AVAILABLE', field: 'metricKey', value: metricKey } };
  }
  const range = normaliseAnalyticsDateRange(input.dateFrom, input.dateTo);
  if (!range.ok) return range;
  return {
    ok: true,
    request: {
      metricKey,
      dateFrom: range.range.dateFrom,
      dateTo: range.range.dateTo,
      daySpan: range.range.daySpan,
      requestKey: `${metricKey}:${range.range.requestKey}`,
    },
  };
}

function refreshState(value: unknown, field: string, issues: AnalyticsRepositoryIssue[]): AnalyticsRefreshState {
  const candidate = requiredText(value).toUpperCase() as AnalyticsRefreshState;
  if (REFRESH_STATES.has(candidate)) return candidate;
  issues.push({ code: 'UNKNOWN_REFRESH_STATE', field, value: nullableText(value) ?? undefined });
  return 'UNKNOWN';
}

function healthState(value: unknown, issues: AnalyticsRepositoryIssue[]): AnalyticsHealthState {
  const candidate = requiredText(value).toUpperCase() as AnalyticsHealthState;
  if (HEALTH_STATES.has(candidate)) return candidate;
  issues.push({ code: 'UNKNOWN_HEALTH_STATE', field: 'overall_status', value: nullableText(value) ?? undefined });
  return 'UNKNOWN';
}

function rowIssue(issues: AnalyticsRepositoryIssue[], field: string, value?: unknown) {
  issues.push({ code: 'INVALID_ROW', field, value: value === undefined ? undefined : String(value).slice(0, 120) });
}

export function normaliseAnalyticsMetricCatalogRows(input: unknown): NormalisedRows<AnalyticsMetricCatalogRow> {
  const rows: AnalyticsMetricCatalogRow[] = [];
  const issues: AnalyticsRepositoryIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  source.forEach((value, index) => {
    const row = recordOf(value);
    if (!row) { rowIssue(issues, `catalog[${index}]`); return; }
    const metricKey = requiredText(row.metric_key);
    const displayName = requiredText(row.display_name);
    if (!metricKey || !displayName) { rowIssue(issues, `catalog[${index}]`, metricKey || displayName); return; }
    rows.push({
      metricKey,
      metricVersion: nullableNumber(row.metric_version, `catalog[${index}].metric_version`, issues),
      displayName,
      businessDefinition: requiredText(row.business_definition),
      formulaDescription: requiredText(row.formula_description),
      grainKey: requiredText(row.grain_key),
      dateBasis: requiredText(row.date_basis),
      unitKind: requiredText(row.unit_kind),
      dimensionKeys: stringArray(row.dimension_keys),
      exclusions: stringArray(row.exclusions),
      sourceObjects: stringArray(row.source_objects),
      freshnessSla: nullableText(row.freshness_sla),
      dataOwner: requiredText(row.data_owner),
      qualityPolicy: requiredText(row.quality_policy),
      displayFormat: nullableText(row.display_format),
      status: requiredText(row.status),
      effectiveFrom: nullableText(row.effective_from),
      effectiveTo: nullableText(row.effective_to),
      updatedAt: nullableText(row.updated_at),
    });
  });
  return { rows, issues };
}

export function normaliseAnalyticsRefreshStatusRows(input: unknown): NormalisedRows<AnalyticsRefreshStatusRow> {
  const rows: AnalyticsRefreshStatusRow[] = [];
  const issues: AnalyticsRepositoryIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  source.forEach((value, index) => {
    const row = recordOf(value);
    if (!row) { rowIssue(issues, `refresh[${index}]`); return; }
    const datasetKey = requiredText(row.dataset_key);
    if (!datasetKey) { rowIssue(issues, `refresh[${index}].dataset_key`); return; }
    rows.push({
      datasetKey,
      sourceSystem: requiredText(row.source_system),
      sourceObject: requiredText(row.source_object),
      status: refreshState(row.status, `refresh[${index}].status`, issues),
      asOfAt: nullableText(row.as_of_at),
      lastStartedAt: nullableText(row.last_started_at),
      lastSucceededAt: nullableText(row.last_succeeded_at),
      lastFailedAt: nullableText(row.last_failed_at),
      freshnessSla: nullableText(row.freshness_sla),
      rowCount: nullableNumber(row.row_count, `refresh[${index}].row_count`, issues),
      errorCode: nullableText(row.error_code),
      errorMessage: nullableText(row.error_message),
      details: row.details ?? null,
      updatedAt: nullableText(row.updated_at),
    });
  });
  return { rows, issues };
}

export function normaliseAnalyticsDataQualityRows(input: unknown): NormalisedRows<AnalyticsDataQualityRow> {
  const rows: AnalyticsDataQualityRow[] = [];
  const issues: AnalyticsRepositoryIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  source.forEach((value, index) => {
    const row = recordOf(value);
    if (!row) { rowIssue(issues, `quality[${index}]`); return; }
    const issueId = requiredText(row.issue_id);
    const issueKey = requiredText(row.issue_key);
    if (!issueId || !issueKey) { rowIssue(issues, `quality[${index}]`, issueId || issueKey); return; }
    rows.push({
      issueId,
      issueKey,
      datasetKey: requiredText(row.dataset_key),
      severity: requiredText(row.severity),
      status: requiredText(row.status),
      issueType: requiredText(row.issue_type),
      entityType: nullableText(row.entity_type),
      entityKey: nullableText(row.entity_key),
      title: requiredText(row.title),
      detail: nullableText(row.detail),
      businessImpact: nullableText(row.business_impact),
      recommendedAction: nullableText(row.recommended_action),
      ownerTeam: nullableText(row.owner_team),
      firstDetectedAt: nullableText(row.first_detected_at),
      lastDetectedAt: nullableText(row.last_detected_at),
      occurrenceCount: nullableNumber(row.occurrence_count, `quality[${index}].occurrence_count`, issues),
      snoozedUntil: nullableText(row.snoozed_until),
      resolvedAt: nullableText(row.resolved_at),
      resolutionCode: nullableText(row.resolution_code),
      details: row.details ?? null,
      updatedAt: nullableText(row.updated_at),
    });
  });
  return { rows, issues };
}

export function normaliseAnalyticsHealthRow(input: unknown): { row: AnalyticsHealthRow | null; issues: AnalyticsRepositoryIssue[] } {
  const issues: AnalyticsRepositoryIssue[] = [];
  const row = recordOf(input);
  if (!row) return { row: null, issues };
  return {
    row: {
      overallStatus: healthState(row.overall_status, issues),
      visibleDatasetCount: nullableNumber(row.visible_dataset_count, 'health.visible_dataset_count', issues),
      failedDatasetCount: nullableNumber(row.failed_dataset_count, 'health.failed_dataset_count', issues),
      degradedDatasetCount: nullableNumber(row.degraded_dataset_count, 'health.degraded_dataset_count', issues),
      refreshingDatasetCount: nullableNumber(row.refreshing_dataset_count, 'health.refreshing_dataset_count', issues),
      neverRefreshedCount: nullableNumber(row.never_refreshed_count, 'health.never_refreshed_count', issues),
      openQualityCount: nullableNumber(row.open_quality_count, 'health.open_quality_count', issues),
      criticalQualityCount: nullableNumber(row.critical_quality_count, 'health.critical_quality_count', issues),
      errorQualityCount: nullableNumber(row.error_quality_count, 'health.error_quality_count', issues),
      latestAsOfAt: nullableText(row.latest_as_of_at),
      latestStatusAt: nullableText(row.latest_status_at),
    },
    issues,
  };
}

export function normaliseAnalyticsShadowProjectionRows(input: unknown): NormalisedRows<AnalyticsShadowProjectionRow> {
  const rows: AnalyticsShadowProjectionRow[] = [];
  const issues: AnalyticsRepositoryIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  source.forEach((value, index) => {
    const row = recordOf(value);
    if (!row) { rowIssue(issues, `projection[${index}]`); return; }
    const metricKey = requiredText(row.metric_key).toLowerCase();
    const sourceOrderLineKey = requiredText(row.source_order_line_key);
    if (!isAnalyticsShadowMetricKey(metricKey) || !sourceOrderLineKey) {
      rowIssue(issues, `projection[${index}]`, metricKey || sourceOrderLineKey);
      return;
    }
    rows.push({
      metricKey,
      metricVersion: nullableNumber(row.metric_version, `projection[${index}].metric_version`, issues),
      projectionGrain: requiredText(row.projection_grain),
      sourceOrderKey: requiredText(row.source_order_key),
      sourceOrderLineKey,
      metricDate: requiredText(row.metric_date),
      commercialSkuCode: nullableText(row.commercial_sku_code),
      unitKey: nullableText(row.unit_key),
      numeratorQuantity: nullableNumber(row.numerator_quantity, `projection[${index}].numerator_quantity`, issues),
      denominatorQuantity: nullableNumber(row.denominator_quantity, `projection[${index}].denominator_quantity`, issues),
      metricValuePercent: nullableNumber(row.metric_value_percent, `projection[${index}].metric_value_percent`, issues),
      projectionState: requiredText(row.projection_state),
      blockerCode: nullableText(row.blocker_code),
      sourceStatusKey: nullableText(row.source_status_key),
      orderAsOfAt: nullableText(row.order_as_of_at),
      fulfilmentAsOfAt: nullableText(row.fulfilment_as_of_at),
      orderRefreshStatus: refreshState(row.order_refresh_status, `projection[${index}].order_refresh_status`, issues),
      fulfilmentRefreshStatus: refreshState(row.fulfilment_refresh_status, `projection[${index}].fulfilment_refresh_status`, issues),
    });
  });
  return { rows, issues };
}

export function normaliseAnalyticsReconciliationRows(input: unknown): NormalisedRows<AnalyticsReconciliationRow> {
  const rows: AnalyticsReconciliationRow[] = [];
  const issues: AnalyticsRepositoryIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  source.forEach((value, index) => {
    const row = recordOf(value);
    if (!row) { rowIssue(issues, `reconciliation[${index}]`); return; }
    const metricKey = requiredText(row.metric_key).toLowerCase();
    const sourceOrderLineKey = requiredText(row.source_order_line_key);
    if (!isAnalyticsShadowMetricKey(metricKey) || !sourceOrderLineKey) {
      rowIssue(issues, `reconciliation[${index}]`, metricKey || sourceOrderLineKey);
      return;
    }
    rows.push({
      metricKey,
      metricVersion: nullableNumber(row.metric_version, `reconciliation[${index}].metric_version`, issues),
      sourceOrderKey: requiredText(row.source_order_key),
      sourceOrderLineKey,
      metricDate: requiredText(row.metric_date),
      unitKey: nullableText(row.unit_key),
      projectionState: requiredText(row.projection_state),
      projectedNumerator: nullableNumber(row.projected_numerator, `reconciliation[${index}].projected_numerator`, issues),
      projectedDenominator: nullableNumber(row.projected_denominator, `reconciliation[${index}].projected_denominator`, issues),
      directNumerator: nullableNumber(row.direct_numerator, `reconciliation[${index}].direct_numerator`, issues),
      directDenominator: nullableNumber(row.direct_denominator, `reconciliation[${index}].direct_denominator`, issues),
      reconciliationState: requiredText(row.reconciliation_state),
      reconciliationDetail: nullableText(row.reconciliation_detail),
      asOfAt: nullableText(row.as_of_at),
    });
  });
  return { rows, issues };
}

export function listReadState(rowCount: number, issues: readonly AnalyticsRepositoryIssue[]): AnalyticsReadState {
  if (rowCount === 0) return 'empty';
  return issues.length ? 'partial' : 'ready';
}

export function projectionReadState(
  rows: readonly AnalyticsShadowProjectionRow[],
  issues: readonly AnalyticsRepositoryIssue[],
): AnalyticsReadState {
  if (!rows.length) return 'empty';
  const readyCount = rows.filter((row) => row.projectionState === 'SHADOW_READY' && row.metricValuePercent !== null).length;
  if (readyCount === 0) return 'empty';
  return readyCount === rows.length && issues.length === 0 ? 'ready' : 'partial';
}

export function reconciliationReadState(
  rows: readonly AnalyticsReconciliationRow[],
  issues: readonly AnalyticsRepositoryIssue[],
): AnalyticsReadState {
  if (!rows.length) return 'empty';
  const mismatch = rows.some((row) => row.reconciliationState === 'MISMATCH');
  return mismatch || issues.length ? 'partial' : 'ready';
}

export function analyticsReadSuccess<T>(
  data: T,
  state: AnalyticsReadState,
  issues: readonly AnalyticsRepositoryIssue[] = [],
): AnalyticsReadSuccess<T> {
  return { ok: true, state, data, issues };
}

function errorParts(error: unknown): { code: string; message: string } {
  if (error instanceof Error) return { code: error.name || 'ERROR', message: error.message };
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    const code = nullableText(row.code) ?? 'UNKNOWN';
    const message = [row.message, row.details, row.hint].map(nullableText).filter(Boolean).join(' · ');
    return { code, message: message || code };
  }
  return { code: 'UNKNOWN', message: String(error) };
}

export function classifyAnalyticsRepositoryError(error: unknown): AnalyticsRepositoryError {
  const parts = errorParts(error);
  const text = `${parts.code} ${parts.message}`.toLowerCase();
  if (parts.code === '42501' || text.includes('owner_role_required') || text.includes('permission denied')) {
    return { state: 'forbidden', code: parts.code, message: parts.message };
  }
  if (
    text.includes('metric_not_available')
    || text.includes('date_range_invalid')
    || text.includes('date_range_too_large')
  ) {
    return { state: 'invalid', code: parts.code, message: parts.message };
  }
  if (
    text.includes('pgrst202')
    || text.includes('pgrst205')
    || text.includes('schema cache')
    || text.includes('does not exist')
    || text.includes('not configured')
    || text.includes('failed to fetch')
    || text.includes('network')
  ) {
    return { state: 'unavailable', code: parts.code, message: parts.message };
  }
  return { state: 'failed', code: parts.code, message: parts.message };
}

export function analyticsReadFailure(error: unknown): AnalyticsReadFailure {
  const classified = classifyAnalyticsRepositoryError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}
