import type { AttentionQueueItem } from './attentionQueueContract';
import type {
  ActionableExceptionFieldCapability,
  ActionableExceptionRecord,
} from './actionableExceptionReadContract';

export type ActionableExceptionSurfaceTone = 'neutral' | 'information' | 'warning';

export type ActionableExceptionDisplayRow = {
  record: ActionableExceptionRecord;
  item: AttentionQueueItem;
  detectedLabel: string;
  ageLabel: string;
  severityLabel: string;
  slaLabel: string;
  ownerLabel: string;
  impactLabel: string;
  actionLabel: string;
  lifecycleLabel: string;
  handoffLabel: string;
  tone: ActionableExceptionSurfaceTone;
};

export type ActionableExceptionSurfaceSummary = {
  total: number;
  displayed: number;
  active: number;
  unknownLifecycle: number;
  partialIssueCount: number;
};

function validEpoch(value: string | null): number | null {
  if (!value) return null;
  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? null : epoch;
}

export function latestActionableExceptionReadAt(
  records: readonly ActionableExceptionRecord[],
): string | null {
  let latest: { value: string; epoch: number } | null = null;
  for (const record of records) {
    const epoch = validEpoch(record.readAt);
    if (epoch === null) continue;
    if (!latest || epoch > latest.epoch) latest = { value: record.readAt!, epoch };
  }
  return latest?.value ?? null;
}

export function formatActionableExceptionMoment(value: string | null): string {
  const epoch = validEpoch(value);
  if (epoch === null) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(epoch);
}

export function formatActionableExceptionAge(minutes: number | null): string {
  if (minutes === null || minutes < 0 || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function actionableExceptionCapabilityLabel(
  capability: ActionableExceptionFieldCapability,
): string {
  return capability === 'UNAVAILABLE' ? 'Unavailable' : 'Unknown';
}

export function actionableExceptionOrderReference(record: ActionableExceptionRecord): string {
  return record.sourceIdentity.orderNumber
    ?? record.sourceIdentity.externalOrderNumber
    ?? record.sourceIdentity.invoiceNumber
    ?? record.sourceIdentity.externalInvoiceNumber
    ?? record.sourceIdentity.rawOrderId
    ?? record.sourceIdentity.externalOrderId
    ?? 'Order reference';
}

export function actionableExceptionSurfaceTone(
  record: ActionableExceptionRecord,
): ActionableExceptionSurfaceTone {
  return record.capabilities.lifecycle === 'CURRENT_ACTIVE_ONLY' ? 'information' : 'warning';
}

export function buildActionableExceptionDisplayRows(
  records: readonly ActionableExceptionRecord[],
  orderedItems: readonly AttentionQueueItem[],
  limit = 12,
): readonly ActionableExceptionDisplayRow[] {
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 12;
  const byId = new Map(records.map((record) => [record.input.id, record] as const));
  const rows: ActionableExceptionDisplayRow[] = [];

  for (const item of orderedItems) {
    if (rows.length >= boundedLimit) break;
    const record = byId.get(item.id);
    if (!record) continue;
    rows.push({
      record,
      item,
      detectedLabel: formatActionableExceptionMoment(item.detectedAt),
      ageLabel: formatActionableExceptionAge(item.ageMinutes),
      severityLabel: item.severity === 'unknown' ? 'Unknown' : item.severity.replace(/_/g, ' '),
      slaLabel: actionableExceptionCapabilityLabel(record.capabilities.sla),
      ownerLabel: actionableExceptionCapabilityLabel(record.capabilities.ownership),
      impactLabel: actionableExceptionCapabilityLabel(record.capabilities.impact),
      actionLabel: actionableExceptionCapabilityLabel(record.capabilities.action),
      lifecycleLabel: record.capabilities.lifecycle === 'CURRENT_ACTIVE_ONLY'
        ? 'Current active only'
        : 'Unknown',
      handoffLabel: item.handoff?.entityKind === 'order' && item.handoff.entityId
        ? actionableExceptionOrderReference(record)
        : item.handoff?.workspace === 'orders'
          ? 'Orders workspace'
          : 'Unavailable',
      tone: actionableExceptionSurfaceTone(record),
    });
  }

  return rows;
}

export function actionableExceptionSurfaceSummary(
  records: readonly ActionableExceptionRecord[],
  rows: readonly ActionableExceptionDisplayRow[],
  activeCount: number,
  partialIssueCount: number,
): ActionableExceptionSurfaceSummary {
  let unknownLifecycle = 0;
  for (const record of records) {
    if (record.capabilities.lifecycle === 'UNKNOWN') unknownLifecycle += 1;
  }
  return {
    total: records.length,
    displayed: rows.length,
    active: activeCount,
    unknownLifecycle,
    partialIssueCount,
  };
}
