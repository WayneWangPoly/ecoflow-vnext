import type { ActionableExceptionLifecycleCommandResult } from '../../attention/actionableExceptionLifecycleContract';

export const inlineActionKeys = [
  'EXCEPTION_LIFECYCLE',
  'ORDER_RELEASE',
  'INVENTORY_MUTATION',
  'CUSTOMER_MUTATION',
  'ROUTE_CONTROL',
  'RETURN_DISPOSITION',
] as const;

export type InlineActionKey = (typeof inlineActionKeys)[number];
export type InlineActionEligibility = 'AVAILABLE' | 'BLOCKED';
export type InlineCommandOutcome = 'accepted' | 'conflict' | 'rejected' | 'replay' | 'network-unknown';

export type SafeInlineActionDefinition = {
  key: InlineActionKey;
  label: string;
  eligibility: InlineActionEligibility;
  serverCommand: string | null;
  revisionContract: string | null;
  idempotencyContract: string | null;
  permissionContract: string | null;
  outcomeContract: readonly InlineCommandOutcome[];
  evidence: string;
  blocker: string | null;
  operationalPath: string;
};

export type SafeInlineActionIssue = {
  code:
    | 'DUPLICATE_ACTION'
    | 'MISSING_ACTION'
    | 'AVAILABLE_WITHOUT_SERVER_COMMAND'
    | 'AVAILABLE_WITHOUT_REVISION'
    | 'AVAILABLE_WITHOUT_IDEMPOTENCY'
    | 'AVAILABLE_WITHOUT_PERMISSION'
    | 'AVAILABLE_WITHOUT_OUTCOMES'
    | 'BLOCKED_WITH_COMMAND_AUTHORITY'
    | 'INVALID_OPERATIONAL_PATH';
  key: InlineActionKey;
};

const canonicalOutcomes: readonly InlineCommandOutcome[] = [
  'accepted',
  'conflict',
  'rejected',
  'replay',
  'network-unknown',
];

export const safeInlineActionRegistry: readonly SafeInlineActionDefinition[] = [
  {
    key: 'EXCEPTION_LIFECYCLE',
    label: 'Exception lifecycle',
    eligibility: 'AVAILABLE',
    serverCommand: 'apply_actionable_exception_lifecycle_command',
    revisionContract: 'server lifecycle version and transition checks',
    idempotencyContract: 'commandId UUID with APPLIED or REPLAYED result',
    permissionContract: 'server lifecycle access envelope and per-row action capability',
    outcomeContract: canonicalOutcomes,
    evidence: 'The existing Attention Queue commit modal calls one typed repository command and never changes the Ordermentum order.',
    blocker: null,
    operationalPath: '/analytics',
  },
  {
    key: 'ORDER_RELEASE',
    label: 'Order release',
    eligibility: 'BLOCKED',
    serverCommand: null,
    revisionContract: null,
    idempotencyContract: null,
    permissionContract: null,
    outcomeContract: [],
    evidence: 'Analytics may open the Order, but release remains in the Orders operational domain.',
    blocker: 'No approved analytics-inline release command migration.',
    operationalPath: '/orders',
  },
  {
    key: 'INVENTORY_MUTATION',
    label: 'Inventory mutation',
    eligibility: 'BLOCKED',
    serverCommand: null,
    revisionContract: null,
    idempotencyContract: null,
    permissionContract: null,
    outcomeContract: [],
    evidence: 'Analytics may open Inventory, but stock movements and substitutions remain operational commands.',
    blocker: 'No approved analytics-inline inventory command migration.',
    operationalPath: '/inventory',
  },
  {
    key: 'CUSTOMER_MUTATION',
    label: 'Customer mutation',
    eligibility: 'BLOCKED',
    serverCommand: null,
    revisionContract: null,
    idempotencyContract: null,
    permissionContract: null,
    outcomeContract: [],
    evidence: 'Analytics may open the Customer workspace without changing commercial records.',
    blocker: 'No approved analytics-inline customer command migration.',
    operationalPath: '/customers',
  },
  {
    key: 'ROUTE_CONTROL',
    label: 'Route control',
    eligibility: 'BLOCKED',
    serverCommand: null,
    revisionContract: null,
    idempotencyContract: null,
    permissionContract: null,
    outcomeContract: [],
    evidence: 'Analytics may open Delivery, but route approval, lock and departure remain operational commands.',
    blocker: 'No approved analytics-inline route command migration.',
    operationalPath: '/delivery',
  },
  {
    key: 'RETURN_DISPOSITION',
    label: 'Return disposition',
    eligibility: 'BLOCKED',
    serverCommand: null,
    revisionContract: null,
    idempotencyContract: null,
    permissionContract: null,
    outcomeContract: [],
    evidence: 'Return intelligence is read-only and cannot resell, scrap or close a return.',
    blocker: 'No approved analytics-inline return disposition command migration.',
    operationalPath: '/returns',
  },
];

export function validateSafeInlineActionRegistry(
  registry: readonly SafeInlineActionDefinition[] = safeInlineActionRegistry,
): readonly SafeInlineActionIssue[] {
  const issues: SafeInlineActionIssue[] = [];
  const seen = new Set<InlineActionKey>();
  for (const action of registry) {
    if (seen.has(action.key)) issues.push({ code: 'DUPLICATE_ACTION', key: action.key });
    seen.add(action.key);
    if (!action.operationalPath.startsWith('/') || action.operationalPath.includes('?') || action.operationalPath.includes('#')) {
      issues.push({ code: 'INVALID_OPERATIONAL_PATH', key: action.key });
    }
    if (action.eligibility === 'AVAILABLE') {
      if (!action.serverCommand) issues.push({ code: 'AVAILABLE_WITHOUT_SERVER_COMMAND', key: action.key });
      if (!action.revisionContract) issues.push({ code: 'AVAILABLE_WITHOUT_REVISION', key: action.key });
      if (!action.idempotencyContract) issues.push({ code: 'AVAILABLE_WITHOUT_IDEMPOTENCY', key: action.key });
      if (!action.permissionContract) issues.push({ code: 'AVAILABLE_WITHOUT_PERMISSION', key: action.key });
      if (canonicalOutcomes.some((outcome) => !action.outcomeContract.includes(outcome))) {
        issues.push({ code: 'AVAILABLE_WITHOUT_OUTCOMES', key: action.key });
      }
    } else if (action.serverCommand || action.revisionContract || action.idempotencyContract || action.permissionContract) {
      issues.push({ code: 'BLOCKED_WITH_COMMAND_AUTHORITY', key: action.key });
    }
  }
  for (const key of inlineActionKeys) {
    if (!seen.has(key)) issues.push({ code: 'MISSING_ACTION', key });
  }
  return issues;
}

export function safeInlineActionDefinition(key: InlineActionKey): SafeInlineActionDefinition | null {
  return safeInlineActionRegistry.find((action) => action.key === key) ?? null;
}

export function normaliseExceptionLifecycleOutcome(
  result: ActionableExceptionLifecycleCommandResult,
): InlineCommandOutcome {
  if (result.ok) {
    if (result.data.commandStatus === 'APPLIED') return 'accepted';
    if (result.data.commandStatus === 'REPLAYED') return 'replay';
    return 'network-unknown';
  }
  if (result.state === 'conflict') return 'conflict';
  if (result.state === 'failed') return 'network-unknown';
  return 'rejected';
}
