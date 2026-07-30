import type {
  AnalyticsReadState,
  AnalyticsRepositoryIssue,
} from './analyticsRepositoryContract';

export type AnalyticsMetricProjectionStatus = 'SHADOW' | 'BLOCKED' | 'READY' | 'UNKNOWN';

export type AnalyticsMetricReadinessRow = {
  metricKey: string;
  metricVersion: number | null;
  displayName: string;
  unitKind: string;
  metricStatus: string;
  projectionStatus: AnalyticsMetricProjectionStatus;
  exactGrain: string;
  requiredDatasetKeys: readonly string[];
  supportedDimensionKeys: readonly string[];
  blockedDimensionKeys: readonly string[];
  blockerCodes: readonly string[];
  reconciliationTolerance: number | null;
  dataOwner: string;
  qualityPolicy: string;
  readinessUpdatedAt: string | null;
};

export type NormalisedMetricReadinessRows = {
  rows: AnalyticsMetricReadinessRow[];
  issues: AnalyticsRepositoryIssue[];
};

const PROJECTION_STATUS_SET = new Set<AnalyticsMetricProjectionStatus>([
  'SHADOW',
  'BLOCKED',
  'READY',
  'UNKNOWN',
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(nullableText).filter((item): item is string => Boolean(item)))];
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

function projectionStatus(
  value: unknown,
  field: string,
  issues: AnalyticsRepositoryIssue[],
): AnalyticsMetricProjectionStatus {
  const candidate = text(value).toUpperCase() as AnalyticsMetricProjectionStatus;
  if (PROJECTION_STATUS_SET.has(candidate)) return candidate;
  issues.push({
    code: 'INVALID_ROW',
    field,
    value: nullableText(value) ?? undefined,
  });
  return 'UNKNOWN';
}

export function normaliseMetricReadinessRows(input: unknown): NormalisedMetricReadinessRows {
  const rows: AnalyticsMetricReadinessRow[] = [];
  const issues: AnalyticsRepositoryIssue[] = [];
  const source = Array.isArray(input) ? input : [];

  source.forEach((value, index) => {
    const row = recordOf(value);
    if (!row) {
      issues.push({ code: 'INVALID_ROW', field: `readiness[${index}]` });
      return;
    }

    const metricKey = text(row.metric_key);
    const displayName = text(row.display_name);
    const unitKind = text(row.unit_kind).toUpperCase();
    const exactGrain = text(row.exact_grain);
    if (!metricKey || !displayName || !unitKind || !exactGrain) {
      issues.push({
        code: 'INVALID_ROW',
        field: `readiness[${index}]`,
        value: metricKey || displayName || unitKind || exactGrain || undefined,
      });
      return;
    }

    const status = projectionStatus(
      row.projection_status,
      `readiness[${index}].projection_status`,
      issues,
    );
    const blockerCodes = stringList(row.blocker_codes);
    if ((status === 'SHADOW' || status === 'BLOCKED') && blockerCodes.length === 0) {
      issues.push({
        code: 'INVALID_ROW',
        field: `readiness[${index}].blocker_codes`,
        value: status,
      });
    }

    rows.push({
      metricKey,
      metricVersion: nullableNumber(
        row.metric_version,
        `readiness[${index}].metric_version`,
        issues,
      ),
      displayName,
      unitKind,
      metricStatus: text(row.metric_status).toUpperCase(),
      projectionStatus: status,
      exactGrain,
      requiredDatasetKeys: stringList(row.required_dataset_keys),
      supportedDimensionKeys: stringList(row.supported_dimension_keys),
      blockedDimensionKeys: stringList(row.blocked_dimension_keys),
      blockerCodes,
      reconciliationTolerance: nullableNumber(
        row.reconciliation_tolerance,
        `readiness[${index}].reconciliation_tolerance`,
        issues,
      ),
      dataOwner: text(row.data_owner),
      qualityPolicy: text(row.quality_policy).toUpperCase(),
      readinessUpdatedAt: nullableText(row.readiness_updated_at),
    });
  });

  return { rows, issues };
}

export function metricReadinessReadState(
  rows: readonly AnalyticsMetricReadinessRow[],
  issues: readonly AnalyticsRepositoryIssue[],
): AnalyticsReadState {
  if (rows.length === 0) return 'empty';
  return issues.length === 0 ? 'ready' : 'partial';
}
