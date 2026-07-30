export const attentionSeverities = [
  'critical',
  'high',
  'medium',
  'low',
  'information',
  'unknown',
] as const;
export type AttentionSeverity = (typeof attentionSeverities)[number];

export const attentionStatuses = [
  'open',
  'acknowledged',
  'in_progress',
  'snoozed',
  'resolved',
  'dismissed',
  'unknown',
] as const;
export type AttentionStatus = (typeof attentionStatuses)[number];

export const attentionSourceKinds = [
  'order',
  'inventory',
  'delivery',
  'commercial',
  'data_quality',
  'system',
  'unknown',
] as const;
export type AttentionSourceKind = (typeof attentionSourceKinds)[number];

export const attentionImpactUnitKinds = [
  'currency',
  'count',
  'percentage',
  'duration',
  'unknown',
] as const;
export type AttentionImpactUnitKind = (typeof attentionImpactUnitKinds)[number];

export const attentionHandoffWorkspaces = [
  'orders',
  'inventory',
  'customers',
  'stores',
  'delivery',
  'returns',
  'exceptions',
  'reconciliation',
  'analytics',
] as const;
export type AttentionHandoffWorkspace = (typeof attentionHandoffWorkspaces)[number];

export const attentionEntityKinds = [
  'order',
  'commercial-sku',
  'physical-sku',
  'customer',
  'store',
  'delivery-run',
  'return',
  'exception',
  'dataset',
] as const;
export type AttentionEntityKind = (typeof attentionEntityKinds)[number];

export type AttentionSlaState =
  | 'breached'
  | 'within_sla'
  | 'not_set'
  | 'paused'
  | 'closed'
  | 'unknown';

export type AttentionQueueState = 'ready' | 'partial' | 'empty';

export type AttentionQueueIssueCode =
  | 'INVALID_ITEM'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_SEVERITY'
  | 'UNKNOWN_STATUS'
  | 'UNKNOWN_SOURCE_KIND'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_NOW'
  | 'FUTURE_DETECTED_AT'
  | 'SLA_BEFORE_DETECTION'
  | 'INVALID_IMPACT_UNIT'
  | 'INVALID_IMPACT_VALUE'
  | 'INVALID_AFFECTED_COUNT'
  | 'INVALID_HANDOFF'
  | 'SNOOZE_TIMESTAMP_REQUIRED'
  | 'RESOLUTION_TIMESTAMP_REQUIRED'
  | 'RESOLUTION_FIELDS_SUPPRESSED'
  | 'NOTE_LIMIT_EXCEEDED'
  | 'HISTORY_LIMIT_EXCEEDED'
  | 'INVALID_HISTORY_EVENT'
  | 'ITEM_LIMIT_EXCEEDED';

export type AttentionQueueIssue = {
  code: AttentionQueueIssueCode;
  itemId?: string;
  field?: string;
  value?: string;
};

export type AttentionImpactInput = {
  unitKind?: string | null;
  value?: unknown;
  displayValue?: string | null;
  affectedCount?: unknown;
};

export type AttentionHandoffInput = {
  workspace?: string | null;
  entityKind?: string | null;
  entityId?: string | null;
};

export type AttentionHistoryEventInput = {
  at?: string | null;
  actor?: string | null;
  event?: string | null;
  detail?: string | null;
};

export type AttentionItemInput = {
  id: string;
  sourceKey: string;
  sourceKind: string;
  title: string;
  detail?: string | null;
  severity: string;
  status: string;
  detectedAt: string;
  updatedAt?: string | null;
  dueAt?: string | null;
  ownerTeam?: string | null;
  businessImpact?: AttentionImpactInput | null;
  recommendedAction?: string | null;
  handoff?: AttentionHandoffInput | null;
  snoozeUntil?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  notes?: readonly string[] | null;
  auditHistory?: readonly AttentionHistoryEventInput[] | null;
};

export type AttentionImpact = {
  unitKind: AttentionImpactUnitKind;
  value: number | null;
  displayValue: string | null;
  affectedCount: number | null;
};

export type AttentionHandoff = {
  workspace: AttentionHandoffWorkspace;
  entityKind: AttentionEntityKind | null;
  entityId: string | null;
};

export type AttentionHistoryEvent = {
  at: string;
  actor: string | null;
  event: string;
  detail: string | null;
};

export type AttentionItem = {
  id: string;
  sourceKey: string;
  sourceKind: AttentionSourceKind;
  title: string;
  detail: string | null;
  severity: AttentionSeverity;
  status: AttentionStatus;
  detectedAt: string;
  updatedAt: string | null;
  dueAt: string | null;
  ownerTeam: string | null;
  businessImpact: AttentionImpact;
  recommendedAction: string | null;
  handoff: AttentionHandoff | null;
  snoozeUntil: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  notes: readonly string[];
  auditHistory: readonly AttentionHistoryEvent[];
};

export type AttentionQueueItem = AttentionItem & {
  ageMinutes: number | null;
  slaState: AttentionSlaState;
  overdueMinutes: number | null;
};

export type AttentionQueueSummary = {
  total: number;
  active: number;
  closed: number;
  other: number;
  breached: number;
  unassigned: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  information: number;
  unknownSeverity: number;
};

export type AttentionQueue = {
  state: AttentionQueueState;
  nowAt: string | null;
  items: readonly AttentionQueueItem[];
  activeItems: readonly AttentionQueueItem[];
  closedItems: readonly AttentionQueueItem[];
  otherItems: readonly AttentionQueueItem[];
  summary: AttentionQueueSummary;
  issues: readonly AttentionQueueIssue[];
};

const MAX_ITEMS = 500;
const MAX_NOTES = 8;
const MAX_HISTORY_EVENTS = 20;
const MAX_ID_LENGTH = 180;
const MAX_SOURCE_KEY_LENGTH = 160;
const MAX_TITLE_LENGTH = 180;
const MAX_DETAIL_LENGTH = 900;
const MAX_SHORT_TEXT_LENGTH = 240;

const SEVERITY_SET = new Set<string>(attentionSeverities);
const STATUS_SET = new Set<string>(attentionStatuses);
const SOURCE_KIND_SET = new Set<string>(attentionSourceKinds);
const IMPACT_UNIT_SET = new Set<string>(attentionImpactUnitKinds);
const HANDOFF_WORKSPACE_SET = new Set<string>(attentionHandoffWorkspaces);
const ENTITY_KIND_SET = new Set<string>(attentionEntityKinds);
const ACTIVE_STATUS_SET = new Set<AttentionStatus>(['open', 'acknowledged', 'in_progress', 'snoozed']);
const CLOSED_STATUS_SET = new Set<AttentionStatus>(['resolved', 'dismissed']);

const ENTITY_WORKSPACE: Readonly<Record<AttentionEntityKind, AttentionHandoffWorkspace>> = {
  order: 'orders',
  'commercial-sku': 'inventory',
  'physical-sku': 'inventory',
  customer: 'customers',
  store: 'stores',
  'delivery-run': 'delivery',
  return: 'returns',
  exception: 'exceptions',
  dataset: 'analytics',
};

const SEVERITY_PRIORITY: Readonly<Record<AttentionSeverity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  information: 1,
  unknown: 0,
};

const STATUS_PRIORITY: Readonly<Record<AttentionStatus, number>> = {
  open: 5,
  acknowledged: 4,
  in_progress: 3,
  snoozed: 1,
  resolved: 0,
  dismissed: 0,
  unknown: 0,
};

function cleanText(value: unknown, maximum = MAX_SHORT_TEXT_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function nullableText(value: unknown, maximum = MAX_SHORT_TEXT_LENGTH): string | null {
  const cleaned = cleanText(value, maximum);
  return cleaned || null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(
  value: unknown,
  itemId: string,
  field: string,
  issues: AttentionQueueIssue[],
  required = false,
): string | null {
  const cleaned = cleanText(value, 120);
  if (!cleaned) {
    if (required) issues.push({ code: 'INVALID_TIMESTAMP', itemId, field });
    return null;
  }
  if (Number.isNaN(Date.parse(cleaned))) {
    issues.push({ code: 'INVALID_TIMESTAMP', itemId, field, value: cleaned });
    return null;
  }
  return cleaned;
}

function normaliseSeverity(value: unknown, itemId: string, issues: AttentionQueueIssue[]): AttentionSeverity {
  const candidate = cleanText(value, 40).toLowerCase();
  if (SEVERITY_SET.has(candidate)) return candidate as AttentionSeverity;
  issues.push({ code: 'UNKNOWN_SEVERITY', itemId, field: 'severity', value: candidate || undefined });
  return 'unknown';
}

function normaliseStatus(value: unknown, itemId: string, issues: AttentionQueueIssue[]): AttentionStatus {
  const candidate = cleanText(value, 40).toLowerCase();
  if (STATUS_SET.has(candidate)) return candidate as AttentionStatus;
  issues.push({ code: 'UNKNOWN_STATUS', itemId, field: 'status', value: candidate || undefined });
  return 'unknown';
}

function normaliseSourceKind(value: unknown, itemId: string, issues: AttentionQueueIssue[]): AttentionSourceKind {
  const candidate = cleanText(value, 40).toLowerCase();
  if (SOURCE_KIND_SET.has(candidate)) return candidate as AttentionSourceKind;
  issues.push({ code: 'UNKNOWN_SOURCE_KIND', itemId, field: 'sourceKind', value: candidate || undefined });
  return 'unknown';
}

function normaliseImpact(
  input: AttentionImpactInput | null | undefined,
  itemId: string,
  issues: AttentionQueueIssue[],
): AttentionImpact {
  const unitCandidate = cleanText(input?.unitKind, 40).toLowerCase();
  const unitKind = IMPACT_UNIT_SET.has(unitCandidate)
    ? unitCandidate as AttentionImpactUnitKind
    : 'unknown';
  if (unitCandidate && unitKind === 'unknown') {
    issues.push({ code: 'INVALID_IMPACT_UNIT', itemId, field: 'businessImpact.unitKind', value: unitCandidate });
  }

  const parsedValue = finiteNumber(input?.value);
  let value = parsedValue;
  if (input?.value !== null && input?.value !== undefined && input?.value !== '' && parsedValue === null) {
    issues.push({
      code: 'INVALID_IMPACT_VALUE',
      itemId,
      field: 'businessImpact.value',
      value: String(input.value).slice(0, 120),
    });
  }
  if (unitKind === 'unknown' && value !== null) {
    issues.push({ code: 'INVALID_IMPACT_UNIT', itemId, field: 'businessImpact.value' });
    value = null;
  }

  const parsedAffectedCount = finiteNumber(input?.affectedCount);
  let affectedCount = parsedAffectedCount;
  if (
    input?.affectedCount !== null
    && input?.affectedCount !== undefined
    && input?.affectedCount !== ''
    && (parsedAffectedCount === null || parsedAffectedCount < 0 || !Number.isInteger(parsedAffectedCount))
  ) {
    issues.push({
      code: 'INVALID_AFFECTED_COUNT',
      itemId,
      field: 'businessImpact.affectedCount',
      value: String(input.affectedCount).slice(0, 120),
    });
    affectedCount = null;
  }

  return {
    unitKind,
    value,
    displayValue: nullableText(input?.displayValue, 120),
    affectedCount,
  };
}

function normaliseHandoff(
  input: AttentionHandoffInput | null | undefined,
  itemId: string,
  issues: AttentionQueueIssue[],
): AttentionHandoff | null {
  if (!input) return null;
  const workspaceCandidate = cleanText(input.workspace, 60).toLowerCase();
  if (!HANDOFF_WORKSPACE_SET.has(workspaceCandidate)) {
    issues.push({ code: 'INVALID_HANDOFF', itemId, field: 'handoff.workspace', value: workspaceCandidate || undefined });
    return null;
  }
  const workspace = workspaceCandidate as AttentionHandoffWorkspace;
  const entityKindCandidate = cleanText(input.entityKind, 60).toLowerCase();
  const entityId = nullableText(input.entityId, MAX_ID_LENGTH);
  if (!entityKindCandidate && !entityId) return { workspace, entityKind: null, entityId: null };
  if (!ENTITY_KIND_SET.has(entityKindCandidate) || !entityId) {
    issues.push({ code: 'INVALID_HANDOFF', itemId, field: 'handoff.entity', value: entityKindCandidate || entityId || undefined });
    return { workspace, entityKind: null, entityId: null };
  }
  const entityKind = entityKindCandidate as AttentionEntityKind;
  if (ENTITY_WORKSPACE[entityKind] !== workspace) {
    issues.push({
      code: 'INVALID_HANDOFF',
      itemId,
      field: 'handoff.workspace',
      value: `${entityKind}:${workspace}`,
    });
    return { workspace, entityKind: null, entityId: null };
  }
  return { workspace, entityKind, entityId };
}

function normaliseNotes(
  input: readonly string[] | null | undefined,
  itemId: string,
  issues: AttentionQueueIssue[],
): readonly string[] {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_NOTES) issues.push({ code: 'NOTE_LIMIT_EXCEEDED', itemId, field: 'notes' });
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_NOTES)) {
    const note = cleanText(raw, MAX_DETAIL_LENGTH);
    if (!note || seen.has(note)) continue;
    seen.add(note);
    values.push(note);
  }
  return values;
}

function normaliseHistory(
  input: readonly AttentionHistoryEventInput[] | null | undefined,
  itemId: string,
  issues: AttentionQueueIssue[],
): readonly AttentionHistoryEvent[] {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_HISTORY_EVENTS) {
    issues.push({ code: 'HISTORY_LIMIT_EXCEEDED', itemId, field: 'auditHistory' });
  }
  const values: AttentionHistoryEvent[] = [];
  for (const raw of input.slice(0, MAX_HISTORY_EVENTS)) {
    const at = timestamp(raw.at, itemId, 'auditHistory.at', issues, true);
    const event = cleanText(raw.event, 120);
    if (!at || !event) {
      issues.push({ code: 'INVALID_HISTORY_EVENT', itemId, field: 'auditHistory' });
      continue;
    }
    values.push({
      at,
      actor: nullableText(raw.actor, 120),
      event,
      detail: nullableText(raw.detail, MAX_DETAIL_LENGTH),
    });
  }
  values.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.event.localeCompare(right.event));
  return values;
}

export function isAttentionActive(status: AttentionStatus): boolean {
  return ACTIVE_STATUS_SET.has(status);
}

export function isAttentionClosed(status: AttentionStatus): boolean {
  return CLOSED_STATUS_SET.has(status);
}

export function normaliseAttentionItem(
  input: AttentionItemInput,
): { item: AttentionItem | null; issues: readonly AttentionQueueIssue[] } {
  const issues: AttentionQueueIssue[] = [];
  const id = cleanText(input.id, MAX_ID_LENGTH);
  const sourceKey = cleanText(input.sourceKey, MAX_SOURCE_KEY_LENGTH);
  const title = cleanText(input.title, MAX_TITLE_LENGTH);
  const detectedAt = timestamp(input.detectedAt, id, 'detectedAt', issues, true);
  if (!id || !sourceKey || !title || !detectedAt) {
    issues.push({ code: 'INVALID_ITEM', itemId: id || undefined });
    return { item: null, issues };
  }

  const status = normaliseStatus(input.status, id, issues);
  const dueAtCandidate = timestamp(input.dueAt, id, 'dueAt', issues);
  let dueAt = dueAtCandidate;
  if (dueAt && Date.parse(dueAt) < Date.parse(detectedAt)) {
    issues.push({ code: 'SLA_BEFORE_DETECTION', itemId: id, field: 'dueAt', value: dueAt });
    dueAt = null;
  }

  const snoozeUntil = timestamp(input.snoozeUntil, id, 'snoozeUntil', issues);
  if (status === 'snoozed' && !snoozeUntil) {
    issues.push({ code: 'SNOOZE_TIMESTAMP_REQUIRED', itemId: id, field: 'snoozeUntil' });
  }

  let resolvedAt = timestamp(input.resolvedAt, id, 'resolvedAt', issues);
  let resolvedBy = nullableText(input.resolvedBy, 120);
  let resolutionNote = nullableText(input.resolutionNote, MAX_DETAIL_LENGTH);
  if (status === 'resolved' && !resolvedAt) {
    issues.push({ code: 'RESOLUTION_TIMESTAMP_REQUIRED', itemId: id, field: 'resolvedAt' });
  }
  if (!isAttentionClosed(status) && (resolvedAt || resolvedBy || resolutionNote)) {
    issues.push({ code: 'RESOLUTION_FIELDS_SUPPRESSED', itemId: id, field: 'resolution' });
    resolvedAt = null;
    resolvedBy = null;
    resolutionNote = null;
  }

  return {
    item: {
      id,
      sourceKey,
      sourceKind: normaliseSourceKind(input.sourceKind, id, issues),
      title,
      detail: nullableText(input.detail, MAX_DETAIL_LENGTH),
      severity: normaliseSeverity(input.severity, id, issues),
      status,
      detectedAt,
      updatedAt: timestamp(input.updatedAt, id, 'updatedAt', issues),
      dueAt,
      ownerTeam: nullableText(input.ownerTeam, 120),
      businessImpact: normaliseImpact(input.businessImpact, id, issues),
      recommendedAction: nullableText(input.recommendedAction, MAX_DETAIL_LENGTH),
      handoff: normaliseHandoff(input.handoff, id, issues),
      snoozeUntil,
      resolvedAt,
      resolvedBy,
      resolutionNote,
      notes: normaliseNotes(input.notes, id, issues),
      auditHistory: normaliseHistory(input.auditHistory, id, issues),
    },
    issues,
  };
}

function normaliseNow(value: string, issues: AttentionQueueIssue[]): { value: string | null; epoch: number | null } {
  const cleaned = cleanText(value, 120);
  const epoch = Date.parse(cleaned);
  if (!cleaned || Number.isNaN(epoch)) {
    issues.push({ code: 'INVALID_NOW', field: 'nowAt', value: cleaned || undefined });
    return { value: null, epoch: null };
  }
  return { value: cleaned, epoch };
}

export function attentionSlaState(item: AttentionItem, nowEpoch: number | null): AttentionSlaState {
  if (isAttentionClosed(item.status)) return 'closed';
  if (!isAttentionActive(item.status)) return 'unknown';
  if (item.status === 'snoozed' && item.snoozeUntil && nowEpoch !== null && Date.parse(item.snoozeUntil) > nowEpoch) {
    return 'paused';
  }
  if (!item.dueAt) return 'not_set';
  if (nowEpoch === null) return 'unknown';
  return Date.parse(item.dueAt) < nowEpoch ? 'breached' : 'within_sla';
}

function enrichAttentionItem(
  item: AttentionItem,
  nowEpoch: number | null,
  issues: AttentionQueueIssue[],
): AttentionQueueItem {
  const detectedEpoch = Date.parse(item.detectedAt);
  let ageMinutes: number | null = null;
  if (nowEpoch !== null) {
    if (detectedEpoch > nowEpoch) {
      issues.push({ code: 'FUTURE_DETECTED_AT', itemId: item.id, field: 'detectedAt', value: item.detectedAt });
    } else {
      ageMinutes = Math.floor((nowEpoch - detectedEpoch) / 60_000);
    }
  }
  const slaState = attentionSlaState(item, nowEpoch);
  const overdueMinutes = slaState === 'breached' && nowEpoch !== null && item.dueAt
    ? Math.floor((nowEpoch - Date.parse(item.dueAt)) / 60_000)
    : null;
  return { ...item, ageMinutes, slaState, overdueMinutes };
}

export function compareAttentionPriority(left: AttentionQueueItem, right: AttentionQueueItem): number {
  const breachDifference = Number(right.slaState === 'breached') - Number(left.slaState === 'breached');
  if (breachDifference) return breachDifference;
  const severityDifference = SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity];
  if (severityDifference) return severityDifference;
  const statusDifference = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status];
  if (statusDifference) return statusDifference;
  const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const ageDifference = (right.ageMinutes ?? -1) - (left.ageMinutes ?? -1);
  if (ageDifference) return ageDifference;
  return left.id.localeCompare(right.id);
}

function emptySummary(): AttentionQueueSummary {
  return {
    total: 0,
    active: 0,
    closed: 0,
    other: 0,
    breached: 0,
    unassigned: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    information: 0,
    unknownSeverity: 0,
  };
}

function addSummary(summary: AttentionQueueSummary, item: AttentionQueueItem): void {
  summary.total += 1;
  if (isAttentionActive(item.status)) summary.active += 1;
  else if (isAttentionClosed(item.status)) summary.closed += 1;
  else summary.other += 1;
  if (item.slaState === 'breached') summary.breached += 1;
  if (isAttentionActive(item.status) && !item.ownerTeam) summary.unassigned += 1;
  if (item.severity === 'critical') summary.critical += 1;
  else if (item.severity === 'high') summary.high += 1;
  else if (item.severity === 'medium') summary.medium += 1;
  else if (item.severity === 'low') summary.low += 1;
  else if (item.severity === 'information') summary.information += 1;
  else summary.unknownSeverity += 1;
}

export function buildAttentionQueue(
  inputs: readonly AttentionItemInput[],
  nowAt: string,
): AttentionQueue {
  const issues: AttentionQueueIssue[] = [];
  const now = normaliseNow(nowAt, issues);
  if (inputs.length > MAX_ITEMS) {
    issues.push({ code: 'ITEM_LIMIT_EXCEEDED', field: 'items', value: String(inputs.length) });
  }

  const seen = new Set<string>();
  const items: AttentionQueueItem[] = [];
  for (const input of inputs.slice(0, MAX_ITEMS)) {
    const normalised = normaliseAttentionItem(input);
    issues.push(...normalised.issues);
    if (!normalised.item) continue;
    if (seen.has(normalised.item.id)) {
      issues.push({ code: 'DUPLICATE_ID', itemId: normalised.item.id });
      continue;
    }
    seen.add(normalised.item.id);
    items.push(enrichAttentionItem(normalised.item, now.epoch, issues));
  }

  const activeItems = items.filter((item) => isAttentionActive(item.status)).sort(compareAttentionPriority);
  const closedItems = items
    .filter((item) => isAttentionClosed(item.status))
    .sort((left, right) => {
      const leftAt = Date.parse(left.resolvedAt ?? left.updatedAt ?? left.detectedAt);
      const rightAt = Date.parse(right.resolvedAt ?? right.updatedAt ?? right.detectedAt);
      return rightAt - leftAt || left.id.localeCompare(right.id);
    });
  const otherItems = items.filter((item) => !isAttentionActive(item.status) && !isAttentionClosed(item.status));

  const summary = emptySummary();
  for (const item of items) addSummary(summary, item);

  return {
    state: items.length === 0 ? 'empty' : issues.length ? 'partial' : 'ready',
    nowAt: now.value,
    items,
    activeItems,
    closedItems,
    otherItems,
    summary,
    issues,
  };
}
