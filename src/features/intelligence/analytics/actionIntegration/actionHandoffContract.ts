import type { Phase4DomainId } from '../domainIntelligence/domainIntelligenceContract';

export const actionHandoffKeys = [
  'OPEN_ORDER',
  'OPEN_INVENTORY',
  'OPEN_CUSTOMER',
  'OPEN_ROUTE',
  'OPEN_EXCEPTION',
] as const;

export type ActionHandoffKey = (typeof actionHandoffKeys)[number];
export type ActionHandoffWorkspace = 'orders' | 'inventory' | 'customers' | 'delivery' | 'analytics';

export type ActionHandoffDefinition = {
  key: ActionHandoffKey;
  label: string;
  workspace: ActionHandoffWorkspace;
  basePath: '/orders' | '/inventory' | '/customers' | '/delivery' | '/analytics';
  description: string;
};

export type ActionHandoffContext = {
  domainId: Phase4DomainId;
  breakdownKey?: string | null;
  entityId?: string | null;
  exceptionId?: string | null;
  sourceAsOfAt?: string | null;
};

export type ActionHandoff = ActionHandoffDefinition & {
  href: string;
  context: Readonly<{
    source: 'domain-intelligence';
    domain: Phase4DomainId;
    handoff: ActionHandoffKey;
    breakdown: string | null;
    selected: string | null;
    exception: string | null;
    asOf: string | null;
  }>;
};

export type ActionHandoffIssue = {
  code:
    | 'UNKNOWN_HANDOFF'
    | 'INVALID_DOMAIN'
    | 'INVALID_BREAKDOWN_KEY'
    | 'INVALID_ENTITY_ID'
    | 'INVALID_EXCEPTION_ID'
    | 'INVALID_SOURCE_TIMESTAMP'
    | 'DUPLICATE_HANDOFF'
    | 'INVALID_BASE_PATH';
  key?: string;
};

export type ActionHandoffResult =
  | { ok: true; handoff: ActionHandoff; issues: readonly ActionHandoffIssue[] }
  | { ok: false; handoff: null; issues: readonly ActionHandoffIssue[] };

export const actionHandoffDefinitions: readonly ActionHandoffDefinition[] = [
  {
    key: 'OPEN_ORDER',
    label: 'Open order',
    workspace: 'orders',
    basePath: '/orders',
    description: 'Carry analysis context into Orders. Order commands remain owned by the Orders domain.',
  },
  {
    key: 'OPEN_INVENTORY',
    label: 'Open inventory',
    workspace: 'inventory',
    basePath: '/inventory',
    description: 'Carry analysis context into Inventory without changing stock or substitution state.',
  },
  {
    key: 'OPEN_CUSTOMER',
    label: 'Open customer',
    workspace: 'customers',
    basePath: '/customers',
    description: 'Carry analysis context into Customers. Commercial writes remain outside Analytics.',
  },
  {
    key: 'OPEN_ROUTE',
    label: 'Open route',
    workspace: 'delivery',
    basePath: '/delivery',
    description: 'Carry analysis context into Delivery without approving, locking or departing a route.',
  },
  {
    key: 'OPEN_EXCEPTION',
    label: 'Open exception',
    workspace: 'analytics',
    basePath: '/analytics',
    description: 'Open the governed exception workspace. Lifecycle commands remain server-authorised.',
  },
];

const DOMAINS = new Set<Phase4DomainId>([
  'inventory',
  'orders',
  'customers',
  'delivery',
  'returns',
  'data-quality',
]);
const HANDOFFS = new Set<ActionHandoffKey>(actionHandoffKeys);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const SAFE_EXCEPTION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,219}$/;

function cleanToken(value: string | null | undefined, maximum: number): string | null {
  const text = typeof value === 'string' ? value.trim().slice(0, maximum) : '';
  return text || null;
}

function validTimestamp(value: string | null): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function queryString(context: ActionHandoff['context']): string {
  const query = new URLSearchParams();
  query.set('source', context.source);
  query.set('domain', context.domain);
  query.set('handoff', context.handoff);
  if (context.breakdown) query.set('breakdown', context.breakdown);
  if (context.selected) query.set('selected', context.selected);
  if (context.exception) query.set('exception', context.exception);
  if (context.asOf) query.set('asOf', context.asOf);
  return query.toString();
}

export function validateActionHandoffRegistry(
  definitions: readonly ActionHandoffDefinition[] = actionHandoffDefinitions,
): readonly ActionHandoffIssue[] {
  const issues: ActionHandoffIssue[] = [];
  const seen = new Set<ActionHandoffKey>();
  for (const definition of definitions) {
    if (seen.has(definition.key)) issues.push({ code: 'DUPLICATE_HANDOFF', key: definition.key });
    seen.add(definition.key);
    if (!definition.basePath.startsWith('/') || definition.basePath.includes('?') || definition.basePath.includes('#')) {
      issues.push({ code: 'INVALID_BASE_PATH', key: definition.key });
    }
  }
  for (const key of actionHandoffKeys) {
    if (!seen.has(key)) issues.push({ code: 'UNKNOWN_HANDOFF', key });
  }
  return issues;
}

export function buildActionHandoff(
  key: ActionHandoffKey,
  input: ActionHandoffContext,
): ActionHandoffResult {
  const issues: ActionHandoffIssue[] = [];
  if (!HANDOFFS.has(key)) issues.push({ code: 'UNKNOWN_HANDOFF', key: String(key) });
  if (!DOMAINS.has(input.domainId)) issues.push({ code: 'INVALID_DOMAIN', key: String(input.domainId) });

  const breakdown = cleanToken(input.breakdownKey, 120);
  if (breakdown && !SAFE_TOKEN.test(breakdown)) issues.push({ code: 'INVALID_BREAKDOWN_KEY', key: breakdown });

  const selected = cleanToken(input.entityId, 180);
  if (selected && !SAFE_TOKEN.test(selected)) issues.push({ code: 'INVALID_ENTITY_ID', key: selected });

  const exception = cleanToken(input.exceptionId, 220);
  if (exception && !SAFE_EXCEPTION.test(exception)) issues.push({ code: 'INVALID_EXCEPTION_ID', key: exception });

  const suppliedAsOf = cleanToken(input.sourceAsOfAt, 120);
  const asOf = validTimestamp(suppliedAsOf);
  if (suppliedAsOf && !asOf) issues.push({ code: 'INVALID_SOURCE_TIMESTAMP', key: suppliedAsOf });

  const definition = actionHandoffDefinitions.find((candidate) => candidate.key === key) ?? null;
  if (!definition || issues.length > 0) return { ok: false, handoff: null, issues };

  const context: ActionHandoff['context'] = {
    source: 'domain-intelligence',
    domain: input.domainId,
    handoff: key,
    breakdown,
    selected,
    exception,
    asOf,
  };

  return {
    ok: true,
    handoff: {
      ...definition,
      href: `${definition.basePath}?${queryString(context)}`,
      context,
    },
    issues,
  };
}
