import {
  matchIntelligenceRoute,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract.ts';
import {
  withWorkspaceQuery,
  type WorkspaceQueryState,
} from '@/features/intelligence/navigation/queryState.ts';
import type {
  ShadowDrillEvidenceDimension,
  ShadowDrillEvidenceEntity,
  ShadowDrillEvidenceRecord,
  ShadowDrillEvidenceState,
} from './shadowDrillEvidenceContract.ts';
import type { AnalyticsShadowMetricKey } from '../analytics/analyticsRepositoryContract.ts';

export type ShadowEvidenceTone = 'success' | 'warning' | 'danger' | 'information' | 'neutral';

export type ShadowEvidenceStatePresentation = {
  label: string;
  tone: ShadowEvidenceTone;
  description: string;
};

export type ShadowEvidenceSummary = {
  breakdowns: number;
  affectedOrders: number;
  shadowReadyLines: number;
  unavailableLines: number;
  emptyLines: number;
  issueCount: number;
  readAt: string | null;
};

export type ShadowEvidenceOperationalRoute = {
  workspace: IntelligenceWorkspaceId;
  pathname: string;
  href: string;
  query: WorkspaceQueryState;
};

const DAY_MS = 86_400_000;

const metricLabels: Record<AnalyticsShadowMetricKey, string> = {
  fill_rate: 'Fill Rate',
  substitution_rate: 'Substitution Rate',
};

const dimensionLabels: Record<ShadowDrillEvidenceDimension, string> = {
  date: 'Delivery date',
  commercial_sku: 'Commercial SKU',
};

const statePresentations: Record<ShadowDrillEvidenceState, ShadowEvidenceStatePresentation> = {
  SHADOW_READY: {
    label: 'SHADOW READY',
    tone: 'information',
    description: 'Evidence is internally consistent but remains non-production Shadow data.',
  },
  PARTIAL: {
    label: 'PARTIAL',
    tone: 'warning',
    description: 'The breakdown contains both reviewable and unavailable evidence.',
  },
  EMPTY: {
    label: 'EMPTY',
    tone: 'neutral',
    description: 'The governed denominator is empty for this breakdown.',
  },
  UNAVAILABLE: {
    label: 'UNAVAILABLE',
    tone: 'danger',
    description: 'Source quality or policy prevents this evidence from being relied on.',
  },
  EXCLUDED: {
    label: 'EXCLUDED',
    tone: 'neutral',
    description: 'The breakdown is excluded by the governed metric policy.',
  },
  UNKNOWN: {
    label: 'UNKNOWN',
    tone: 'warning',
    description: 'The client rejected inconsistent evidence metadata.',
  },
};

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function defaultShadowEvidenceDateRange(now: Date = new Date()): {
  dateFrom: string;
  dateTo: string;
} {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    dateFrom: isoDate(end - (29 * DAY_MS)),
    dateTo: isoDate(end),
  };
}

export function shadowEvidenceMetricLabel(metricKey: AnalyticsShadowMetricKey): string {
  return metricLabels[metricKey];
}

export function shadowEvidenceDimensionLabel(dimensionKey: ShadowDrillEvidenceDimension): string {
  return dimensionLabels[dimensionKey];
}

export function shadowEvidenceStatePresentation(
  state: ShadowDrillEvidenceState,
): ShadowEvidenceStatePresentation {
  return statePresentations[state];
}

export function shadowEvidenceSummary(
  rows: readonly ShadowDrillEvidenceRecord[],
  issueCount = 0,
): ShadowEvidenceSummary {
  return {
    breakdowns: rows.length,
    affectedOrders: rows.reduce((total, row) => total + row.affectedCount, 0),
    shadowReadyLines: rows.reduce((total, row) => total + row.shadowReadyLineCount, 0),
    unavailableLines: rows.reduce((total, row) => total + row.unavailableLineCount, 0),
    emptyLines: rows.reduce((total, row) => total + row.emptyLineCount, 0),
    issueCount,
    readAt: rows[0]?.readAt ?? null,
  };
}

export function formatShadowEvidenceMoment(value: string | null): string {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid timestamp';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function shadowEvidenceBlockerLabel(codes: readonly string[]): string {
  return codes.length > 0 ? codes.join(' · ') : 'No blocker code';
}

export function shadowEvidenceOrderRoute(
  entity: ShadowDrillEvidenceEntity,
): ShadowEvidenceOperationalRoute | null {
  const pathname = `/orders/${encodeURIComponent(entity.id)}`;
  const matched = matchIntelligenceRoute(pathname);
  if (matched.status !== 'READY'
    || matched.route.workspace !== 'orders'
    || matched.route.entityKind !== 'order'
    || matched.route.entityId !== entity.id) {
    return null;
  }
  const query: WorkspaceQueryState = {
    filters: [],
    selected: entity.id,
    primaryDrawer: `order:${entity.id}`,
  };
  return {
    workspace: matched.route.workspace,
    pathname,
    href: withWorkspaceQuery(pathname, query),
    query,
  };
}
