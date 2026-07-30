import {
  actionableExceptionLifecycleActions,
  type ActionableExceptionLifecycleAction,
  type ActionableExceptionLifecycleRecord,
  type ActionableExceptionLifecycleState,
} from './actionableExceptionLifecycleContract.ts';
import type { ActionableExceptionLifecycleAccess } from './actionableExceptionLifecycleAccessContract';

export type ActionableExceptionLifecycleFieldKind =
  | 'none'
  | 'ownerTeam'
  | 'snoozedUntil'
  | 'resolutionNote'
  | 'note';

export type ActionableExceptionLifecycleActionTone = 'default' | 'warning' | 'danger';

export type ActionableExceptionLifecycleActionOption = {
  action: ActionableExceptionLifecycleAction;
  label: string;
  commitLabel: string;
  description: string;
  confirmation: string;
  fieldKind: ActionableExceptionLifecycleFieldKind;
  fieldLabel: string | null;
  fieldPlaceholder: string | null;
  tone: ActionableExceptionLifecycleActionTone;
};

const ACTION_ORDER = new Map(
  actionableExceptionLifecycleActions.map((action, index) => [action, index]),
);

const ACTION_OPTIONS: Record<
  ActionableExceptionLifecycleAction,
  Omit<ActionableExceptionLifecycleActionOption, 'action'>
> = {
  ACKNOWLEDGE: {
    label: 'Acknowledge',
    commitLabel: 'Commit acknowledgement',
    description: 'Record that an authorised operator has reviewed this exception.',
    confirmation: 'The lifecycle status will become acknowledged. The Ordermentum order will not be changed.',
    fieldKind: 'none',
    fieldLabel: null,
    fieldPlaceholder: null,
    tone: 'default',
  },
  ASSIGN: {
    label: 'Assign team',
    commitLabel: 'Commit assignment',
    description: 'Assign the lifecycle record to an accountable operating team.',
    confirmation: 'The owner/team field will be replaced with the value entered below.',
    fieldKind: 'ownerTeam',
    fieldLabel: 'Owner / team',
    fieldPlaceholder: 'e.g. Order Operations',
    tone: 'default',
  },
  UNASSIGN: {
    label: 'Remove assignment',
    commitLabel: 'Commit unassignment',
    description: 'Remove the current owner/team from the lifecycle record.',
    confirmation: 'The exception will remain in its current lifecycle state without an assigned team.',
    fieldKind: 'none',
    fieldLabel: null,
    fieldPlaceholder: null,
    tone: 'warning',
  },
  SNOOZE: {
    label: 'Snooze',
    commitLabel: 'Commit snooze',
    description: 'Pause this lifecycle item until a specific future time.',
    confirmation: 'The item will remain auditable and will resume its prior open or acknowledged state after the snooze expires.',
    fieldKind: 'snoozedUntil',
    fieldLabel: 'Snooze until',
    fieldPlaceholder: null,
    tone: 'warning',
  },
  UNSNOOZE: {
    label: 'End snooze',
    commitLabel: 'Commit unsnooze',
    description: 'Return the item to its recorded pre-snooze lifecycle state.',
    confirmation: 'The snooze deadline will be cleared. No source order state will change.',
    fieldKind: 'none',
    fieldLabel: null,
    fieldPlaceholder: null,
    tone: 'default',
  },
  RESOLVE: {
    label: 'Resolve',
    commitLabel: 'Commit resolution',
    description: 'Close the lifecycle record with a mandatory resolution note.',
    confirmation: 'The lifecycle record will be marked resolved. The active source exception is not deleted or dismissed.',
    fieldKind: 'resolutionNote',
    fieldLabel: 'Resolution note',
    fieldPlaceholder: 'State what was verified and why the lifecycle item can be closed.',
    tone: 'danger',
  },
  REOPEN: {
    label: 'Reopen',
    commitLabel: 'Commit reopen',
    description: 'Return a resolved lifecycle record to open review.',
    confirmation: 'Reopen succeeds only while the verified source exception remains active.',
    fieldKind: 'none',
    fieldLabel: null,
    fieldPlaceholder: null,
    tone: 'warning',
  },
  ADD_NOTE: {
    label: 'Add note',
    commitLabel: 'Commit note',
    description: 'Append an immutable operator note without changing lifecycle status.',
    confirmation: 'The note will be added to audit history with the current operator and timestamp.',
    fieldKind: 'note',
    fieldLabel: 'Operator note',
    fieldPlaceholder: 'Record a concise, factual update.',
    tone: 'default',
  },
};

function stateActions(
  state: ActionableExceptionLifecycleState,
  hasOwner: boolean,
): ActionableExceptionLifecycleAction[] {
  if (state === 'RESOLVED') return ['REOPEN', 'ADD_NOTE'];
  if (state === 'SNOOZED') {
    return [
      'ACKNOWLEDGE',
      'ASSIGN',
      ...(hasOwner ? ['UNASSIGN' as const] : []),
      'UNSNOOZE',
      'RESOLVE',
      'ADD_NOTE',
    ];
  }
  if (state === 'ACKNOWLEDGED') {
    return [
      'ASSIGN',
      ...(hasOwner ? ['UNASSIGN' as const] : []),
      'SNOOZE',
      'RESOLVE',
      'ADD_NOTE',
    ];
  }
  if (state === 'OPEN') {
    return [
      'ACKNOWLEDGE',
      'ASSIGN',
      ...(hasOwner ? ['UNASSIGN' as const] : []),
      'SNOOZE',
      'RESOLVE',
      'ADD_NOTE',
    ];
  }
  return [];
}

export function actionableExceptionLifecycleActionOptions(
  access: ActionableExceptionLifecycleAccess | null,
  lifecycle: ActionableExceptionLifecycleRecord | null,
): ActionableExceptionLifecycleActionOption[] {
  if (!access || access.actionCapability !== 'AVAILABLE') return [];
  const permitted = new Set(access.commandActions);
  const state = lifecycle?.effectiveStatus ?? 'OPEN';
  const actions = stateActions(state, Boolean(lifecycle?.ownerTeam));
  return actions
    .filter((action) => permitted.has(action))
    .sort((left, right) => (ACTION_ORDER.get(left) ?? 99) - (ACTION_ORDER.get(right) ?? 99))
    .map((action) => ({ action, ...ACTION_OPTIONS[action] }));
}

export function actionableExceptionLifecycleStatusLabel(
  lifecycle: ActionableExceptionLifecycleRecord | null,
  lifecycleReadAvailable: boolean,
): string {
  if (!lifecycleReadAvailable) return 'Unavailable';
  if (!lifecycle) return 'Not started';
  if (lifecycle.effectiveStatus === 'ACKNOWLEDGED') return 'Acknowledged';
  if (lifecycle.effectiveStatus === 'SNOOZED') return lifecycle.snoozeExpired ? 'Snooze expired' : 'Snoozed';
  if (lifecycle.effectiveStatus === 'RESOLVED') return 'Resolved';
  if (lifecycle.effectiveStatus === 'OPEN') return 'Open';
  return 'Unknown';
}

export function actionableExceptionLifecycleOwnerLabel(
  lifecycle: ActionableExceptionLifecycleRecord | null,
  lifecycleReadAvailable: boolean,
): string {
  if (!lifecycleReadAvailable) return 'Unavailable';
  return lifecycle?.ownerTeam ?? 'Unassigned';
}

export function actionableExceptionLifecycleAccessLabel(
  access: ActionableExceptionLifecycleAccess | null,
): string {
  if (!access) return 'LIFECYCLE UNAVAILABLE';
  if (access.actionCapability === 'AVAILABLE') return 'LIFECYCLE WRITER';
  if (access.actionCapability === 'READ_ONLY') return 'LIFECYCLE READ ONLY';
  return 'LIFECYCLE UNKNOWN';
}

export function actionableExceptionLifecycleActionOption(
  action: ActionableExceptionLifecycleAction,
): ActionableExceptionLifecycleActionOption {
  return { action, ...ACTION_OPTIONS[action] };
}

export function actionableExceptionLifecycleCurrentState(
  lifecycle: ActionableExceptionLifecycleRecord | null,
): string {
  if (!lifecycle) return 'Not started';
  return actionableExceptionLifecycleStatusLabel(lifecycle, true);
}
