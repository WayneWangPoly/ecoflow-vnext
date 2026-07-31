import {
  matchIntelligenceRoute,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract.ts';
import {
  withWorkspaceQuery,
  type WorkspaceQueryState,
} from '@/features/intelligence/navigation/queryState.ts';
import type {
  PriorityWorkLifecycleStatus,
  PriorityWorkRecord,
} from './priorityWorkContract.ts';

export type PriorityWorkSummary = {
  total: number;
  unassigned: number;
  policyCount: number;
  oldestAgeSeconds: number;
  readAt: string | null;
};

export type PriorityWorkOrderRoute = {
  workspace: IntelligenceWorkspaceId;
  pathname: string;
  href: string;
  query: WorkspaceQueryState;
};

const lifecycleLabels: Record<PriorityWorkLifecycleStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  SNOOZED: 'Snooze elapsed',
};

export function priorityWorkSummary(
  rows: readonly PriorityWorkRecord[],
): PriorityWorkSummary {
  return {
    total: rows.length,
    unassigned: rows.filter((row) => !row.ownerTeam).length,
    policyCount: new Set(rows.map((row) => row.policyKey)).size,
    oldestAgeSeconds: rows.reduce(
      (oldest, row) => Math.max(oldest, row.ageSeconds),
      0,
    ),
    readAt: rows[0]?.readAt ?? null,
  };
}

export function formatPriorityWorkAge(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 'Unknown';
  if (ageSeconds < 60) return '<1 min';
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

export function formatPriorityWorkMoment(value: string | null): string {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid timestamp';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function priorityWorkOwnerLabel(ownerTeam: string | null): string {
  return ownerTeam ?? 'Unassigned';
}

export function priorityWorkLifecycleLabel(
  lifecycleStatus: PriorityWorkLifecycleStatus,
): string {
  return lifecycleLabels[lifecycleStatus];
}

export function priorityWorkOrderRoute(
  record: Pick<PriorityWorkRecord, 'orderEntityId'>,
): PriorityWorkOrderRoute | null {
  if (!record.orderEntityId || record.orderEntityId.includes('/')) return null;
  const pathname = `/orders/${encodeURIComponent(record.orderEntityId)}`;
  const matched = matchIntelligenceRoute(pathname);
  if (matched.status !== 'READY'
    || matched.route.workspace !== 'orders'
    || matched.route.entityKind !== 'order'
    || matched.route.entityId !== record.orderEntityId) {
    return null;
  }
  const query: WorkspaceQueryState = {
    filters: [],
    selected: record.orderEntityId,
    primaryDrawer: `order:${record.orderEntityId}`,
  };
  return {
    workspace: matched.route.workspace,
    pathname,
    href: withWorkspaceQuery(pathname, query),
    query,
  };
}
