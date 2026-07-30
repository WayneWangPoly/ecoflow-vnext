import type {
  AnalyticsDataQualityRow,
  AnalyticsHealthRow,
  AnalyticsHealthState,
  AnalyticsMetricCatalogRow,
  AnalyticsRefreshState,
  AnalyticsRefreshStatusRow,
} from '../analyticsRepositoryContract';

export type AnalyticsConsoleTone = 'neutral' | 'success' | 'warning' | 'danger' | 'information';

const REFRESH_PRIORITY: Readonly<Record<AnalyticsRefreshState, number>> = {
  FAILED: 0,
  DEGRADED: 1,
  STALE: 2,
  NEVER: 3,
  REFRESHING: 4,
  UNKNOWN: 5,
  CURRENT: 6,
};

const QUALITY_PRIORITY: Readonly<Record<string, number>> = {
  CRITICAL: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
};

const METRIC_STATUS_PRIORITY: Readonly<Record<string, number>> = {
  ACTIVE: 0,
  DRAFT: 1,
  DEPRECATED: 2,
};

export function analyticsHealthTone(status: AnalyticsHealthState): AnalyticsConsoleTone {
  if (status === 'CURRENT') return 'success';
  if (status === 'REFRESHING') return 'information';
  if (status === 'NOT_READY' || status === 'DEGRADED') return 'warning';
  if (status === 'FAILED') return 'danger';
  return 'neutral';
}

export function analyticsRefreshTone(status: AnalyticsRefreshState): AnalyticsConsoleTone {
  if (status === 'CURRENT') return 'success';
  if (status === 'REFRESHING') return 'information';
  if (status === 'STALE' || status === 'DEGRADED' || status === 'NEVER') return 'warning';
  if (status === 'FAILED') return 'danger';
  return 'neutral';
}

export function analyticsQualityTone(severity: string): AnalyticsConsoleTone {
  const normalised = severity.trim().toUpperCase();
  if (normalised === 'CRITICAL' || normalised === 'ERROR') return 'danger';
  if (normalised === 'WARN') return 'warning';
  if (normalised === 'INFO') return 'information';
  return 'neutral';
}

export function analyticsMetricTone(status: string): AnalyticsConsoleTone {
  const normalised = status.trim().toUpperCase();
  if (normalised === 'ACTIVE') return 'success';
  if (normalised === 'DRAFT') return 'warning';
  if (normalised === 'DEPRECATED') return 'neutral';
  return 'information';
}

export function displayAnalyticsCount(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('en-AU').format(value);
}

export function formatAnalyticsMoment(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

export function sortAnalyticsRefreshRows(
  rows: readonly AnalyticsRefreshStatusRow[],
): AnalyticsRefreshStatusRow[] {
  return [...rows].sort((left, right) => {
    const priority = REFRESH_PRIORITY[left.status] - REFRESH_PRIORITY[right.status];
    if (priority !== 0) return priority;
    return left.datasetKey.localeCompare(right.datasetKey, 'en-AU');
  });
}

export function sortAnalyticsQualityRows(
  rows: readonly AnalyticsDataQualityRow[],
): AnalyticsDataQualityRow[] {
  return [...rows].sort((left, right) => {
    const leftPriority = QUALITY_PRIORITY[left.severity.trim().toUpperCase()] ?? 4;
    const rightPriority = QUALITY_PRIORITY[right.severity.trim().toUpperCase()] ?? 4;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftTime = left.lastDetectedAt ? Date.parse(left.lastDetectedAt) : Number.NEGATIVE_INFINITY;
    const rightTime = right.lastDetectedAt ? Date.parse(right.lastDetectedAt) : Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.issueKey.localeCompare(right.issueKey, 'en-AU');
  });
}

export function sortAnalyticsMetricRows(
  rows: readonly AnalyticsMetricCatalogRow[],
): AnalyticsMetricCatalogRow[] {
  return [...rows].sort((left, right) => {
    const leftPriority = METRIC_STATUS_PRIORITY[left.status.trim().toUpperCase()] ?? 3;
    const rightPriority = METRIC_STATUS_PRIORITY[right.status.trim().toUpperCase()] ?? 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.displayName.localeCompare(right.displayName, 'en-AU');
  });
}

export function analyticsHealthReadout(health: AnalyticsHealthRow | null) {
  return {
    status: health?.overallStatus ?? 'UNKNOWN',
    visibleDatasetCount: health?.visibleDatasetCount ?? null,
    openQualityCount: health?.openQualityCount ?? null,
    neverRefreshedCount: health?.neverRefreshedCount ?? null,
    failedDatasetCount: health?.failedDatasetCount ?? null,
    degradedDatasetCount: health?.degradedDatasetCount ?? null,
    latestAsOfAt: health?.latestAsOfAt ?? null,
    latestStatusAt: health?.latestStatusAt ?? null,
  } as const;
}
