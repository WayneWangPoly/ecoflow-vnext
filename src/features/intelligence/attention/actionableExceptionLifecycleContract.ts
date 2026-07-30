import type { AttentionHistoryEventInput, AttentionStatus } from './attentionQueueContract';

export const actionableExceptionLifecycleReadRpcName = 'get_actionable_exception_lifecycle' as const;
export const actionableExceptionLifecycleCommandRpcName = 'apply_actionable_exception_lifecycle_command' as const;
export const actionableExceptionLifecycleDefaultLimit = 100;
export const actionableExceptionLifecycleMaximumLimit = 300;
export const actionableExceptionLifecycleMaximumHistory = 50;

export const actionableExceptionLifecycleActions = [
  'ACKNOWLEDGE',
  'ASSIGN',
  'UNASSIGN',
  'SNOOZE',
  'UNSNOOZE',
  'RESOLVE',
  'REOPEN',
  'ADD_NOTE',
] as const;
export type ActionableExceptionLifecycleAction = (typeof actionableExceptionLifecycleActions)[number];

export type ActionableExceptionLifecycleState = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED' | 'UNKNOWN';
export type ActionableExceptionDataCapability = 'AVAILABLE' | 'UNKNOWN';
export type ActionableExceptionActionCapability = 'AVAILABLE' | 'READ_ONLY' | 'UNKNOWN';
export type ActionableExceptionLifecycleReadState = 'ready' | 'partial' | 'empty';
export type ActionableExceptionLifecycleFailureState =
  | 'forbidden'
  | 'invalid'
  | 'conflict'
  | 'unavailable'
  | 'failed';

export type ActionableExceptionLifecycleIssueCode =
  | 'INVALID_ID_LIST'
  | 'INVALID_EXCEPTION_ID'
  | 'DUPLICATE_EXCEPTION_ID'
  | 'ID_LIMIT_EXCEEDED'
  | 'INVALID_LIMIT'
  | 'INVALID_ROW'
  | 'DUPLICATE_ROW'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_VERSION'
  | 'INVALID_BOOLEAN'
  | 'UNKNOWN_LIFECYCLE_STATUS'
  | 'UNKNOWN_CAPABILITY'
  | 'INVALID_HISTORY'
  | 'HISTORY_LIMIT_EXCEEDED'
  | 'INVALID_HISTORY_EVENT'
  | 'UNKNOWN_HISTORY_ACTION'
  | 'UNKNOWN_ACTOR_ROLE'
  | 'INVALID_COMMAND'
  | 'INVALID_COMMAND_ID'
  | 'INVALID_ACTION'
  | 'OWNER_TEAM_REQUIRED'
  | 'OWNER_TEAM_NOT_ALLOWED'
  | 'OWNER_TEAM_TOO_LONG'
  | 'SNOOZE_REQUIRED'
  | 'SNOOZE_NOT_ALLOWED'
  | 'SNOOZE_WINDOW_INVALID'
  | 'RESOLUTION_NOTE_REQUIRED'
  | 'RESOLUTION_NOTE_NOT_ALLOWED'
  | 'RESOLUTION_NOTE_TOO_LONG'
  | 'NOTE_REQUIRED'
  | 'NOTE_NOT_ALLOWED'
  | 'NOTE_TOO_LONG'
  | 'INVALID_COMMAND_RESULT';

export type ActionableExceptionLifecycleIssue = {
  code: ActionableExceptionLifecycleIssueCode;
  row?: number;
  itemId?: string;
  field?: string;
  value?: string;
};

export type ActionableExceptionLifecycleReadRequest = {
  exceptionIds: readonly string[];
  limit: number;
  requestKey: string;
};

export type ActionableExceptionLifecycleReadRequestResult =
  | { ok: true; request: ActionableExceptionLifecycleReadRequest; issues: readonly ActionableExceptionLifecycleIssue[] }
  | { ok: false; issue: ActionableExceptionLifecycleIssue };

export type ActionableExceptionLifecycleCapabilities = {
  lifecycle: ActionableExceptionDataCapability;
  ownership: ActionableExceptionDataCapability;
  action: ActionableExceptionActionCapability;
  history: ActionableExceptionDataCapability;
};

export type ActionableExceptionLifecycleHistoryEvent = {
  eventId: string;
  commandId: string;
  action: ActionableExceptionLifecycleAction | 'UNKNOWN';
  actorUserId: string | null;
  actorRole: 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'UNKNOWN';
  actorLabel: string;
  previousStatus: ActionableExceptionLifecycleState;
  nextStatus: ActionableExceptionLifecycleState;
  ownerTeam: string | null;
  snoozedUntil: string | null;
  resolutionNote: string | null;
  note: string | null;
  createdAt: string;
};

export type ActionableExceptionLifecycleRecord = {
  exceptionId: string;
  sourceKey: string;
  sourceKind: 'order' | 'unknown';
  sourceStatus: string | null;
  title: string | null;
  detail: string | null;
  detectedAt: string | null;
  handoff: {
    workspace: 'orders';
    entityKind: 'order' | null;
    entityId: string | null;
  } | null;
  lifecycleStatus: ActionableExceptionLifecycleState;
  effectiveStatus: ActionableExceptionLifecycleState;
  attentionStatus: AttentionStatus;
  ownerTeam: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  snoozedUntil: string | null;
  snoozeExpired: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  version: number;
  firstRecordedAt: string;
  updatedAt: string;
  lastEventAt: string;
  auditHistory: readonly ActionableExceptionLifecycleHistoryEvent[];
  attentionHistory: readonly AttentionHistoryEventInput[];
  capabilities: ActionableExceptionLifecycleCapabilities;
  readAt: string;
};

export type NormalisedActionableExceptionLifecycleRows = {
  rows: ActionableExceptionLifecycleRecord[];
  state: ActionableExceptionLifecycleReadState;
  issues: ActionableExceptionLifecycleIssue[];
};

export type ActionableExceptionLifecycleRepositoryError = {
  state: ActionableExceptionLifecycleFailureState;
  code: string;
  message: string;
};

export type ActionableExceptionLifecycleReadSuccess<T> = {
  ok: true;
  state: ActionableExceptionLifecycleReadState;
  data: T;
  issues: readonly ActionableExceptionLifecycleIssue[];
};

export type ActionableExceptionLifecycleReadFailure = {
  ok: false;
  state: ActionableExceptionLifecycleFailureState;
  data: null;
  error: ActionableExceptionLifecycleRepositoryError;
};

export type ActionableExceptionLifecycleReadResult<T> =
  | ActionableExceptionLifecycleReadSuccess<T>
  | ActionableExceptionLifecycleReadFailure;

export type ActionableExceptionLifecycleCommandInput = {
  commandId: unknown;
  exceptionId: unknown;
  action: unknown;
  ownerTeam?: unknown;
  snoozedUntil?: unknown;
  resolutionNote?: unknown;
  note?: unknown;
};

export type NormalisedActionableExceptionLifecycleCommand = {
  commandId: string;
  exceptionId: string;
  action: ActionableExceptionLifecycleAction;
  ownerTeam: string | null;
  snoozedUntil: string | null;
  resolutionNote: string | null;
  note: string | null;
  requestKey: string;
};

export type ActionableExceptionLifecycleCommandRequestResult =
  | { ok: true; command: NormalisedActionableExceptionLifecycleCommand }
  | { ok: false; issue: ActionableExceptionLifecycleIssue };

export type ActionableExceptionLifecycleCommandRecord = {
  exceptionId: string;
  lifecycleStatus: ActionableExceptionLifecycleState;
  attentionStatus: AttentionStatus;
  ownerTeam: string | null;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  version: number;
  eventId: string;
  commandId: string;
  commandStatus: 'APPLIED' | 'REPLAYED' | 'UNKNOWN';
  eventAt: string;
};

export type ActionableExceptionLifecycleCommandSuccess = {
  ok: true;
  data: ActionableExceptionLifecycleCommandRecord;
  issues: readonly ActionableExceptionLifecycleIssue[];
};

export type ActionableExceptionLifecycleCommandFailure = {
  ok: false;
  data: null;
  state: ActionableExceptionLifecycleFailureState;
  error: ActionableExceptionLifecycleRepositoryError;
};

export type ActionableExceptionLifecycleCommandResult =
  | ActionableExceptionLifecycleCommandSuccess
  | ActionableExceptionLifecycleCommandFailure;

const EXCEPTION_ID = /^ORDERMENTUM_ACTIVE:[a-f0-9]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<string>(actionableExceptionLifecycleActions);
const STATES = new Set<ActionableExceptionLifecycleState>([
  'OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED', 'UNKNOWN',
]);
const WRITER_ROLES = new Set(['OWNER', 'ADMIN', 'ACCOUNT']);
const MAX_OWNER_TEAM = 80;
const MAX_LONG_TEXT = 2_000;
const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1_000;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum = 2_000): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function nullableText(value: unknown, maximum = 2_000): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, maximum);
  return text || null;
}

function canonicalExceptionId(value: unknown): string | null {
  const text = cleanText(value, 180);
  if (!EXCEPTION_ID.test(text)) return null;
  const [, digest = ''] = text.split(':');
  return `ORDERMENTUM_ACTIVE:${digest.toLowerCase()}`;
}

function timestamp(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleIssue[],
  context: { row?: number; itemId?: string },
  required = false,
): string | null {
  const text = nullableText(value, 120);
  if (!text || Number.isNaN(Date.parse(text))) {
    if (required || text) issues.push({ code: 'INVALID_TIMESTAMP', field, value: text ?? undefined, ...context });
    return null;
  }
  return text;
}

function positiveInteger(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleIssue[],
  context: { row?: number; itemId?: string },
): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  issues.push({ code: 'INVALID_VERSION', field, value: String(value).slice(0, 120), ...context });
  return null;
}

function booleanValue(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleIssue[],
  context: { row?: number; itemId?: string },
): boolean {
  if (typeof value === 'boolean') return value;
  issues.push({ code: 'INVALID_BOOLEAN', field, value: String(value).slice(0, 120), ...context });
  return false;
}

function lifecycleState(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleIssue[],
  context: { row?: number; itemId?: string },
): ActionableExceptionLifecycleState {
  const candidate = cleanText(value, 40).toUpperCase() as ActionableExceptionLifecycleState;
  if (STATES.has(candidate) && candidate !== 'UNKNOWN') return candidate;
  issues.push({ code: 'UNKNOWN_LIFECYCLE_STATUS', field, value: candidate || undefined, ...context });
  return 'UNKNOWN';
}

function dataCapability(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleIssue[],
  context: { row?: number; itemId?: string },
): ActionableExceptionDataCapability {
  const candidate = cleanText(value, 40).toUpperCase();
  if (candidate === 'AVAILABLE') return 'AVAILABLE';
  issues.push({ code: 'UNKNOWN_CAPABILITY', field, value: candidate || undefined, ...context });
  return 'UNKNOWN';
}

function actionCapability(
  value: unknown,
  issues: ActionableExceptionLifecycleIssue[],
  context: { row?: number; itemId?: string },
): ActionableExceptionActionCapability {
  const candidate = cleanText(value, 40).toUpperCase();
  if (candidate === 'AVAILABLE' || candidate === 'READ_ONLY') return candidate;
  issues.push({ code: 'UNKNOWN_CAPABILITY', field: 'action_capability', value: candidate || undefined, ...context });
  return 'UNKNOWN';
}

function attentionStatus(value: ActionableExceptionLifecycleState): AttentionStatus {
  if (value === 'OPEN') return 'open';
  if (value === 'ACKNOWLEDGED') return 'acknowledged';
  if (value === 'SNOOZED') return 'snoozed';
  if (value === 'RESOLVED') return 'resolved';
  return 'unknown';
}

function normaliseHistory(
  value: unknown,
  row: number,
  itemId: string,
): { history: ActionableExceptionLifecycleHistoryEvent[]; issues: ActionableExceptionLifecycleIssue[] } {
  const issues: ActionableExceptionLifecycleIssue[] = [];
  if (!Array.isArray(value)) {
    if (value !== null && value !== undefined) {
      issues.push({ code: 'INVALID_HISTORY', row, itemId, field: 'audit_history' });
    }
    return { history: [], issues };
  }
  if (value.length > actionableExceptionLifecycleMaximumHistory) {
    issues.push({
      code: 'HISTORY_LIMIT_EXCEEDED',
      row,
      itemId,
      field: 'audit_history',
      value: String(value.length),
    });
  }
  const history: ActionableExceptionLifecycleHistoryEvent[] = [];
  value.slice(0, actionableExceptionLifecycleMaximumHistory).forEach((candidate, index) => {
    const raw = recordOf(candidate);
    if (!raw) {
      issues.push({ code: 'INVALID_HISTORY_EVENT', row, itemId, field: `audit_history[${index}]` });
      return;
    }
    const eventId = cleanText(raw.event_id, 80);
    const commandId = cleanText(raw.command_id, 80);
    const actorLabel = cleanText(raw.actor_label, 240);
    const createdAt = timestamp(raw.created_at, `audit_history[${index}].created_at`, issues, { row, itemId }, true);
    if (!UUID.test(eventId) || !UUID.test(commandId) || !actorLabel || !createdAt) {
      issues.push({ code: 'INVALID_HISTORY_EVENT', row, itemId, field: `audit_history[${index}]` });
      return;
    }
    const actionCandidate = cleanText(raw.action, 40).toUpperCase();
    const action = ACTIONS.has(actionCandidate)
      ? actionCandidate as ActionableExceptionLifecycleAction
      : 'UNKNOWN';
    if (action === 'UNKNOWN') {
      issues.push({ code: 'UNKNOWN_HISTORY_ACTION', row, itemId, field: `audit_history[${index}].action`, value: actionCandidate });
    }
    const roleCandidate = cleanText(raw.actor_role, 40).toUpperCase();
    const actorRole = WRITER_ROLES.has(roleCandidate)
      ? roleCandidate as 'OWNER' | 'ADMIN' | 'ACCOUNT'
      : 'UNKNOWN';
    if (actorRole === 'UNKNOWN') {
      issues.push({ code: 'UNKNOWN_ACTOR_ROLE', row, itemId, field: `audit_history[${index}].actor_role`, value: roleCandidate });
    }
    history.push({
      eventId,
      commandId,
      action,
      actorUserId: UUID.test(cleanText(raw.actor_user_id, 80)) ? cleanText(raw.actor_user_id, 80) : null,
      actorRole,
      actorLabel,
      previousStatus: lifecycleState(raw.previous_status, `audit_history[${index}].previous_status`, issues, { row, itemId }),
      nextStatus: lifecycleState(raw.next_status, `audit_history[${index}].next_status`, issues, { row, itemId }),
      ownerTeam: nullableText(raw.owner_team, MAX_OWNER_TEAM),
      snoozedUntil: timestamp(raw.snoozed_until, `audit_history[${index}].snoozed_until`, issues, { row, itemId }),
      resolutionNote: nullableText(raw.resolution_note, MAX_LONG_TEXT),
      note: nullableText(raw.note, MAX_LONG_TEXT),
      createdAt,
    });
  });
  return { history, issues };
}

function normaliseHandoff(raw: Record<string, unknown>): ActionableExceptionLifecycleRecord['handoff'] {
  const workspace = cleanText(raw.handoff_workspace, 40).toLowerCase();
  const entityKind = nullableText(raw.handoff_entity_kind, 40)?.toLowerCase() ?? null;
  const entityId = nullableText(raw.handoff_entity_id, 180);
  if (!workspace && !entityKind && !entityId) return null;
  if (workspace !== 'orders') return null;
  if (!entityKind && !entityId) return { workspace: 'orders', entityKind: null, entityId: null };
  if (entityKind !== 'order' || !entityId) return { workspace: 'orders', entityKind: null, entityId: null };
  return { workspace: 'orders', entityKind: 'order', entityId };
}

export function normaliseActionableExceptionLifecycleReadRequest(
  exceptionIds: unknown,
  limit: unknown = actionableExceptionLifecycleDefaultLimit,
): ActionableExceptionLifecycleReadRequestResult {
  if (!Array.isArray(exceptionIds)) {
    return { ok: false, issue: { code: 'INVALID_ID_LIST', field: 'exceptionIds' } };
  }
  if (!Number.isInteger(limit)
    || typeof limit !== 'number'
    || limit < 1
    || limit > actionableExceptionLifecycleMaximumLimit) {
    return { ok: false, issue: { code: 'INVALID_LIMIT', field: 'limit', value: String(limit) } };
  }
  if (exceptionIds.length > actionableExceptionLifecycleMaximumLimit) {
    return {
      ok: false,
      issue: { code: 'ID_LIMIT_EXCEEDED', field: 'exceptionIds', value: String(exceptionIds.length) },
    };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const issues: ActionableExceptionLifecycleIssue[] = [];
  exceptionIds.forEach((value, index) => {
    const id = canonicalExceptionId(value);
    if (!id) {
      issues.push({ code: 'INVALID_EXCEPTION_ID', field: `exceptionIds[${index}]`, value: String(value).slice(0, 180) });
      return;
    }
    if (seen.has(id)) {
      issues.push({ code: 'DUPLICATE_EXCEPTION_ID', itemId: id, field: `exceptionIds[${index}]` });
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  if (issues.some((issue) => issue.code === 'INVALID_EXCEPTION_ID')) {
    return { ok: false, issue: issues.find((issue) => issue.code === 'INVALID_EXCEPTION_ID')! };
  }
  return {
    ok: true,
    request: {
      exceptionIds: ids,
      limit,
      requestKey: `${ids.join(',')}|limit:${limit}`,
    },
    issues,
  };
}

export function normaliseActionableExceptionLifecycleRows(input: unknown): NormalisedActionableExceptionLifecycleRows {
  const source = Array.isArray(input) ? input : [];
  const rows: ActionableExceptionLifecycleRecord[] = [];
  const issues: ActionableExceptionLifecycleIssue[] = [];
  const seen = new Set<string>();

  source.forEach((candidate, rowIndex) => {
    const raw = recordOf(candidate);
    if (!raw) {
      issues.push({ code: 'INVALID_ROW', row: rowIndex });
      return;
    }
    const exceptionId = canonicalExceptionId(raw.exception_id);
    const sourceKey = cleanText(raw.source_key, 180);
    if (!exceptionId || !sourceKey) {
      issues.push({ code: 'INVALID_ROW', row: rowIndex, field: 'identity' });
      return;
    }
    if (seen.has(exceptionId)) {
      issues.push({ code: 'DUPLICATE_ROW', row: rowIndex, itemId: exceptionId });
      return;
    }
    seen.add(exceptionId);
    const context = { row: rowIndex, itemId: exceptionId };
    const lifecycleStatus = lifecycleState(raw.lifecycle_status, 'lifecycle_status', issues, context);
    const effectiveStatus = lifecycleState(raw.effective_status, 'effective_status', issues, context);
    const version = positiveInteger(raw.version, 'version', issues, context);
    const firstRecordedAt = timestamp(raw.first_recorded_at, 'first_recorded_at', issues, context, true);
    const updatedAt = timestamp(raw.updated_at, 'updated_at', issues, context, true);
    const lastEventAt = timestamp(raw.last_event_at, 'last_event_at', issues, context, true);
    const readAt = timestamp(raw.read_at, 'read_at', issues, context, true);
    if (!version || !firstRecordedAt || !updatedAt || !lastEventAt || !readAt) {
      issues.push({ code: 'INVALID_ROW', row: rowIndex, itemId: exceptionId });
      return;
    }
    const history = normaliseHistory(raw.audit_history, rowIndex, exceptionId);
    issues.push(...history.issues);
    const sourceKind = cleanText(raw.source_kind, 40).toLowerCase() === 'order' ? 'order' : 'unknown';
    if (sourceKind === 'unknown') {
      issues.push({ code: 'INVALID_ROW', row: rowIndex, itemId: exceptionId, field: 'source_kind' });
    }
    rows.push({
      exceptionId,
      sourceKey,
      sourceKind,
      sourceStatus: nullableText(raw.source_status, 120),
      title: nullableText(raw.title, 180),
      detail: nullableText(raw.detail, 900),
      detectedAt: timestamp(raw.detected_at, 'detected_at', issues, context),
      handoff: normaliseHandoff(raw),
      lifecycleStatus,
      effectiveStatus,
      attentionStatus: attentionStatus(effectiveStatus),
      ownerTeam: nullableText(raw.owner_team, MAX_OWNER_TEAM),
      acknowledgedAt: timestamp(raw.acknowledged_at, 'acknowledged_at', issues, context),
      acknowledgedBy: nullableText(raw.acknowledged_by, 240),
      snoozedUntil: timestamp(raw.snoozed_until, 'snoozed_until', issues, context),
      snoozeExpired: booleanValue(raw.snooze_expired, 'snooze_expired', issues, context),
      resolvedAt: timestamp(raw.resolved_at, 'resolved_at', issues, context),
      resolvedBy: nullableText(raw.resolved_by, 240),
      resolutionNote: nullableText(raw.resolution_note, MAX_LONG_TEXT),
      version,
      firstRecordedAt,
      updatedAt,
      lastEventAt,
      auditHistory: history.history,
      attentionHistory: history.history.map((event) => ({
        at: event.createdAt,
        actor: event.actorLabel,
        event: event.action === 'UNKNOWN' ? 'Unknown lifecycle event' : event.action,
        detail: event.note ?? event.resolutionNote,
      })),
      capabilities: {
        lifecycle: dataCapability(raw.lifecycle_capability, 'lifecycle_capability', issues, context),
        ownership: dataCapability(raw.ownership_capability, 'ownership_capability', issues, context),
        action: actionCapability(raw.action_capability, issues, context),
        history: dataCapability(raw.history_capability, 'history_capability', issues, context),
      },
      readAt,
    });
  });

  return {
    rows,
    state: rows.length === 0 ? 'empty' : issues.length ? 'partial' : 'ready',
    issues,
  };
}

function commandIssue(code: ActionableExceptionLifecycleIssueCode, field: string, value?: unknown) {
  return { code, field, value: value === undefined ? undefined : String(value).slice(0, 180) } as ActionableExceptionLifecycleIssue;
}

export function normaliseActionableExceptionLifecycleCommand(
  input: unknown,
  nowAt: string,
): ActionableExceptionLifecycleCommandRequestResult {
  const raw = recordOf(input);
  if (!raw) return { ok: false, issue: { code: 'INVALID_COMMAND' } };
  const commandId = cleanText(raw.commandId, 80).toLowerCase();
  if (!UUID.test(commandId)) return { ok: false, issue: commandIssue('INVALID_COMMAND_ID', 'commandId', raw.commandId) };
  const exceptionId = canonicalExceptionId(raw.exceptionId);
  if (!exceptionId) return { ok: false, issue: commandIssue('INVALID_EXCEPTION_ID', 'exceptionId', raw.exceptionId) };
  const actionCandidate = cleanText(raw.action, 40).toUpperCase();
  if (!ACTIONS.has(actionCandidate)) return { ok: false, issue: commandIssue('INVALID_ACTION', 'action', raw.action) };
  const action = actionCandidate as ActionableExceptionLifecycleAction;
  const ownerTeam = nullableText(raw.ownerTeam, MAX_OWNER_TEAM + 1);
  const snoozedUntil = nullableText(raw.snoozedUntil, 120);
  const resolutionNote = nullableText(raw.resolutionNote, MAX_LONG_TEXT + 1);
  const note = nullableText(raw.note, MAX_LONG_TEXT + 1);

  if (ownerTeam && ownerTeam.length > MAX_OWNER_TEAM) {
    return { ok: false, issue: commandIssue('OWNER_TEAM_TOO_LONG', 'ownerTeam', ownerTeam.length) };
  }
  if (action === 'ASSIGN' && !ownerTeam) return { ok: false, issue: commandIssue('OWNER_TEAM_REQUIRED', 'ownerTeam') };
  if (action !== 'ASSIGN' && ownerTeam) return { ok: false, issue: commandIssue('OWNER_TEAM_NOT_ALLOWED', 'ownerTeam') };

  if (action === 'SNOOZE') {
    const now = Date.parse(nowAt);
    const until = snoozedUntil ? Date.parse(snoozedUntil) : Number.NaN;
    if (Number.isNaN(now) || Number.isNaN(until) || until <= now || until > now + MAX_SNOOZE_MS) {
      return { ok: false, issue: commandIssue('SNOOZE_WINDOW_INVALID', 'snoozedUntil', snoozedUntil) };
    }
  } else if (snoozedUntil) {
    return { ok: false, issue: commandIssue('SNOOZE_NOT_ALLOWED', 'snoozedUntil') };
  }
  if (action === 'SNOOZE' && !snoozedUntil) return { ok: false, issue: commandIssue('SNOOZE_REQUIRED', 'snoozedUntil') };

  if (resolutionNote && resolutionNote.length > MAX_LONG_TEXT) {
    return { ok: false, issue: commandIssue('RESOLUTION_NOTE_TOO_LONG', 'resolutionNote', resolutionNote.length) };
  }
  if (action === 'RESOLVE' && !resolutionNote) {
    return { ok: false, issue: commandIssue('RESOLUTION_NOTE_REQUIRED', 'resolutionNote') };
  }
  if (action !== 'RESOLVE' && resolutionNote) {
    return { ok: false, issue: commandIssue('RESOLUTION_NOTE_NOT_ALLOWED', 'resolutionNote') };
  }

  if (note && note.length > MAX_LONG_TEXT) {
    return { ok: false, issue: commandIssue('NOTE_TOO_LONG', 'note', note.length) };
  }
  if (action === 'ADD_NOTE' && !note) return { ok: false, issue: commandIssue('NOTE_REQUIRED', 'note') };
  if (action !== 'ADD_NOTE' && note) return { ok: false, issue: commandIssue('NOTE_NOT_ALLOWED', 'note') };

  return {
    ok: true,
    command: {
      commandId,
      exceptionId,
      action,
      ownerTeam: action === 'ASSIGN' ? ownerTeam : null,
      snoozedUntil: action === 'SNOOZE' ? snoozedUntil : null,
      resolutionNote: action === 'RESOLVE' ? resolutionNote : null,
      note: action === 'ADD_NOTE' ? note : null,
      requestKey: [commandId, exceptionId, action, ownerTeam ?? '', snoozedUntil ?? '', resolutionNote ?? '', note ?? ''].join('|'),
    },
  };
}

export function normaliseActionableExceptionLifecycleCommandResult(
  input: unknown,
): { record: ActionableExceptionLifecycleCommandRecord | null; issues: ActionableExceptionLifecycleIssue[] } {
  const issues: ActionableExceptionLifecycleIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  const raw = recordOf(source[0]);
  if (!raw || source.length !== 1) {
    return { record: null, issues: [{ code: 'INVALID_COMMAND_RESULT' }] };
  }
  const exceptionId = canonicalExceptionId(raw.exception_id);
  const commandId = cleanText(raw.command_id, 80).toLowerCase();
  const eventId = cleanText(raw.event_id, 80).toLowerCase();
  const lifecycleStatus = lifecycleState(raw.lifecycle_status, 'lifecycle_status', issues, {});
  const version = positiveInteger(raw.version, 'version', issues, {});
  const eventAt = timestamp(raw.event_at, 'event_at', issues, {}, true);
  const commandCandidate = cleanText(raw.command_status, 40).toUpperCase();
  const commandStatus = commandCandidate === 'APPLIED' || commandCandidate === 'REPLAYED'
    ? commandCandidate
    : 'UNKNOWN';
  if (!exceptionId || !UUID.test(commandId) || !UUID.test(eventId) || !version || !eventAt || commandStatus === 'UNKNOWN') {
    issues.push({ code: 'INVALID_COMMAND_RESULT' });
    return { record: null, issues };
  }
  return {
    record: {
      exceptionId,
      lifecycleStatus,
      attentionStatus: attentionStatus(lifecycleStatus),
      ownerTeam: nullableText(raw.owner_team, MAX_OWNER_TEAM),
      acknowledgedAt: timestamp(raw.acknowledged_at, 'acknowledged_at', issues, {}),
      snoozedUntil: timestamp(raw.snoozed_until, 'snoozed_until', issues, {}),
      resolvedAt: timestamp(raw.resolved_at, 'resolved_at', issues, {}),
      version,
      eventId,
      commandId,
      commandStatus,
      eventAt,
    },
    issues,
  };
}

function errorParts(error: unknown): { code: string; message: string } {
  if (error instanceof Error) return { code: error.name || 'ERROR', message: error.message };
  if (error && typeof error === 'object') {
    const raw = error as Record<string, unknown>;
    const code = nullableText(raw.code, 80) ?? 'UNKNOWN';
    const message = [raw.message, raw.details, raw.hint].map((value) => nullableText(value, 600)).filter(Boolean).join(' · ');
    return { code, message: message || code };
  }
  return { code: 'UNKNOWN', message: String(error) };
}

export function classifyActionableExceptionLifecycleError(error: unknown): ActionableExceptionLifecycleRepositoryError {
  const parts = errorParts(error);
  const text = `${parts.code} ${parts.message}`.toLowerCase();
  if (parts.code === '42501' || text.includes('role_required') || text.includes('permission denied')) {
    return { state: 'forbidden', code: parts.code, message: parts.message };
  }
  if (
    parts.code === '23505'
    || text.includes('command_id_conflict')
    || text.includes('transition_invalid')
    || text.includes('source_not_active')
  ) {
    return { state: 'conflict', code: parts.code, message: parts.message };
  }
  if (parts.code === '22023' || text.includes('_invalid') || text.includes('_required') || text.includes('_not_allowed')) {
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

export function actionableExceptionLifecycleReadSuccess<T>(
  data: T,
  state: ActionableExceptionLifecycleReadState,
  issues: readonly ActionableExceptionLifecycleIssue[] = [],
): ActionableExceptionLifecycleReadSuccess<T> {
  return { ok: true, state, data, issues };
}

export function actionableExceptionLifecycleReadFailure(error: unknown): ActionableExceptionLifecycleReadFailure {
  const classified = classifyActionableExceptionLifecycleError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}

export function actionableExceptionLifecycleCommandFailure(error: unknown): ActionableExceptionLifecycleCommandFailure {
  const classified = classifyActionableExceptionLifecycleError(error);
  return { ok: false, state: classified.state, data: null, error: classified };
}
