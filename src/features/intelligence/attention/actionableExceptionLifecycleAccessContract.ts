import {
  actionableExceptionLifecycleActions,
  classifyActionableExceptionLifecycleError,
  type ActionableExceptionActionCapability,
  type ActionableExceptionDataCapability,
  type ActionableExceptionLifecycleAction,
  type ActionableExceptionLifecycleRepositoryError,
} from './actionableExceptionLifecycleContract.ts';

export const actionableExceptionLifecycleAccessRpcName = 'get_actionable_exception_lifecycle_access' as const;

export type ActionableExceptionLifecycleAccess = {
  accessVersion: number;
  lifecycleCapability: ActionableExceptionDataCapability;
  ownershipCapability: ActionableExceptionDataCapability;
  actionCapability: ActionableExceptionActionCapability;
  historyCapability: ActionableExceptionDataCapability;
  commandActions: readonly ActionableExceptionLifecycleAction[];
  commandIdRequired: boolean;
  maxReadIds: number;
  maxReadRows: number;
  maxHistoryEvents: number;
  maxSnoozeDays: number;
  readAt: string;
};

export type ActionableExceptionLifecycleAccessIssueCode =
  | 'INVALID_ACCESS_RESULT'
  | 'INVALID_ACCESS_VERSION'
  | 'UNKNOWN_ACCESS_CAPABILITY'
  | 'INVALID_COMMAND_ACTIONS'
  | 'ACCESS_ACTIONS_MISMATCH'
  | 'INVALID_ACCESS_BOOLEAN'
  | 'INVALID_ACCESS_LIMIT'
  | 'INVALID_ACCESS_TIMESTAMP';

export type ActionableExceptionLifecycleAccessIssue = {
  code: ActionableExceptionLifecycleAccessIssueCode;
  field?: string;
  value?: string;
};

export type ActionableExceptionLifecycleAccessNormalisation = {
  access: ActionableExceptionLifecycleAccess | null;
  issues: ActionableExceptionLifecycleAccessIssue[];
};

export type ActionableExceptionLifecycleAccessSuccess = {
  ok: true;
  data: ActionableExceptionLifecycleAccess;
  issues: readonly ActionableExceptionLifecycleAccessIssue[];
};

export type ActionableExceptionLifecycleAccessFailure = {
  ok: false;
  data: null;
  state: ActionableExceptionLifecycleRepositoryError['state'];
  error: ActionableExceptionLifecycleRepositoryError;
};

export type ActionableExceptionLifecycleAccessResult =
  | ActionableExceptionLifecycleAccessSuccess
  | ActionableExceptionLifecycleAccessFailure;

const ACTIONS = new Set<string>(actionableExceptionLifecycleActions);
const EXPECTED_ACTIONS = [...actionableExceptionLifecycleActions];

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dataCapability(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleAccessIssue[],
): ActionableExceptionDataCapability {
  const candidate = text(value).toUpperCase();
  if (candidate === 'AVAILABLE') return 'AVAILABLE';
  issues.push({ code: 'UNKNOWN_ACCESS_CAPABILITY', field, value: candidate || undefined });
  return 'UNKNOWN';
}

function actionCapability(
  value: unknown,
  issues: ActionableExceptionLifecycleAccessIssue[],
): ActionableExceptionActionCapability {
  const candidate = text(value).toUpperCase();
  if (candidate === 'AVAILABLE' || candidate === 'READ_ONLY') return candidate;
  issues.push({ code: 'UNKNOWN_ACCESS_CAPABILITY', field: 'action_capability', value: candidate || undefined });
  return 'UNKNOWN';
}

function positiveInteger(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleAccessIssue[],
): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  issues.push({ code: field === 'access_version' ? 'INVALID_ACCESS_VERSION' : 'INVALID_ACCESS_LIMIT', field, value: String(value).slice(0, 120) });
  return null;
}

function booleanValue(
  value: unknown,
  field: string,
  issues: ActionableExceptionLifecycleAccessIssue[],
): boolean | null {
  if (typeof value === 'boolean') return value;
  issues.push({ code: 'INVALID_ACCESS_BOOLEAN', field, value: String(value).slice(0, 120) });
  return null;
}

function timestamp(
  value: unknown,
  issues: ActionableExceptionLifecycleAccessIssue[],
): string | null {
  const candidate = text(value);
  if (candidate && !Number.isNaN(Date.parse(candidate))) return candidate;
  issues.push({ code: 'INVALID_ACCESS_TIMESTAMP', field: 'read_at', value: candidate || undefined });
  return null;
}

function commandActions(
  value: unknown,
  issues: ActionableExceptionLifecycleAccessIssue[],
): ActionableExceptionLifecycleAction[] {
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_COMMAND_ACTIONS', field: 'command_actions' });
    return [];
  }
  const actions: ActionableExceptionLifecycleAction[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const candidate = text(item).toUpperCase();
    if (!ACTIONS.has(candidate) || seen.has(candidate)) {
      issues.push({ code: 'INVALID_COMMAND_ACTIONS', field: 'command_actions', value: candidate || undefined });
      return;
    }
    seen.add(candidate);
    actions.push(candidate as ActionableExceptionLifecycleAction);
  });
  return actions;
}

export function normaliseActionableExceptionLifecycleAccess(
  input: unknown,
): ActionableExceptionLifecycleAccessNormalisation {
  const issues: ActionableExceptionLifecycleAccessIssue[] = [];
  const source = Array.isArray(input) ? input : [];
  const raw = source.length === 1 ? recordOf(source[0]) : null;
  if (!raw) return { access: null, issues: [{ code: 'INVALID_ACCESS_RESULT' }] };

  const accessVersion = positiveInteger(raw.access_version, 'access_version', issues);
  const lifecycleCapability = dataCapability(raw.lifecycle_capability, 'lifecycle_capability', issues);
  const ownershipCapability = dataCapability(raw.ownership_capability, 'ownership_capability', issues);
  const capability = actionCapability(raw.action_capability, issues);
  const historyCapability = dataCapability(raw.history_capability, 'history_capability', issues);
  const actions = commandActions(raw.command_actions, issues);
  const commandIdRequired = booleanValue(raw.command_id_required, 'command_id_required', issues);
  const maxReadIds = positiveInteger(raw.max_read_ids, 'max_read_ids', issues);
  const maxReadRows = positiveInteger(raw.max_read_rows, 'max_read_rows', issues);
  const maxHistoryEvents = positiveInteger(raw.max_history_events, 'max_history_events', issues);
  const maxSnoozeDays = positiveInteger(raw.max_snooze_days, 'max_snooze_days', issues);
  const readAt = timestamp(raw.read_at, issues);

  if (capability === 'AVAILABLE') {
    const exactActions = actions.length === EXPECTED_ACTIONS.length
      && EXPECTED_ACTIONS.every((action, index) => actions[index] === action);
    if (!exactActions) issues.push({ code: 'ACCESS_ACTIONS_MISMATCH', field: 'command_actions' });
  } else if (actions.length !== 0) {
    issues.push({ code: 'ACCESS_ACTIONS_MISMATCH', field: 'command_actions' });
  }

  if (!accessVersion || commandIdRequired === null || !maxReadIds || !maxReadRows
    || !maxHistoryEvents || !maxSnoozeDays || !readAt
    || lifecycleCapability === 'UNKNOWN' || ownershipCapability === 'UNKNOWN'
    || capability === 'UNKNOWN' || historyCapability === 'UNKNOWN'
    || issues.some((issue) => issue.code === 'ACCESS_ACTIONS_MISMATCH')) {
    return { access: null, issues };
  }

  return {
    access: {
      accessVersion,
      lifecycleCapability,
      ownershipCapability,
      actionCapability: capability,
      historyCapability,
      commandActions: actions,
      commandIdRequired,
      maxReadIds,
      maxReadRows,
      maxHistoryEvents,
      maxSnoozeDays,
      readAt,
    },
    issues,
  };
}

export function actionableExceptionLifecycleAccessFailure(
  error: unknown,
): ActionableExceptionLifecycleAccessFailure {
  const classified = classifyActionableExceptionLifecycleError(error);
  return { ok: false, data: null, state: classified.state, error: classified };
}
