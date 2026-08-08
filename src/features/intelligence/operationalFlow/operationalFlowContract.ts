import type { ImportedOrder, OrderStatus, ReleaseGateStatus } from '@/domain/types';

export const operationalFlowStages = [
  { key: 'NEW', label: 'New' },
  { key: 'NEEDS_ACTION', label: 'Needs Action' },
  { key: 'FINANCE_REVIEW', label: 'Finance Review' },
  { key: 'READY', label: 'Ready' },
  { key: 'WAREHOUSE', label: 'Warehouse' },
  { key: 'STAGED', label: 'Staged' },
  { key: 'ROUTE', label: 'Route' },
  { key: 'DELIVERED', label: 'Delivered' },
] as const;

export type OperationalFlowStage = (typeof operationalFlowStages)[number]['key'];
export type OperationalFlowOrderInput = Pick<ImportedOrder, 'id' | 'status' | 'releaseGateStatus'>;
export type OperationalFlowContext = {
  /** False means the first APPROVED INITIAL stocktake has not established quantity authority yet. */
  inventoryQuantityCommissioned?: boolean;
};
export type OperationalFlowState = 'ready' | 'partial' | 'empty' | 'invalid';

export type OperationalFlowIssueCode =
  | 'INVALID_COLLECTION'
  | 'INVALID_ORDER'
  | 'INVALID_ORDER_ID'
  | 'DUPLICATE_ORDER_ID'
  | 'UNKNOWN_STATUS'
  | 'UNKNOWN_RELEASE_GATE'
  | 'STALE_RELEASE_GATE_IGNORED'
  | 'CONFLICTING_PRE_RELEASE_SIGNAL';

export type OperationalFlowIssue = {
  code: OperationalFlowIssueCode;
  row?: number;
  orderId?: string;
  field?: 'id' | 'status' | 'releaseGateStatus';
  value?: string;
};

export type OperationalFlowAssignment = {
  orderId: string;
  stage: OperationalFlowStage;
};

export type OperationalFlowExclusion = {
  orderId: string;
  reason: 'CANCELLED';
};

export type OperationalFlowUnknown = {
  orderId: string;
};

export type OperationalFlowNode = {
  key: OperationalFlowStage;
  label: string;
  count: number;
  orderIds: readonly string[];
};

export type OperationalFlow = {
  state: OperationalFlowState;
  sourceCount: number;
  uniqueOrderCount: number;
  classifiedCount: number;
  excludedCount: number;
  unknownCount: number;
  invalidCount: number;
  duplicateCount: number;
  conservationOk: boolean;
  nodes: readonly OperationalFlowNode[];
  assignments: readonly OperationalFlowAssignment[];
  exclusions: readonly OperationalFlowExclusion[];
  unknownOrders: readonly OperationalFlowUnknown[];
  issues: readonly OperationalFlowIssue[];
};

export type OperationalFlowClassification =
  | {
      kind: 'classified';
      orderId: string;
      stage: OperationalFlowStage;
      issues: readonly OperationalFlowIssue[];
    }
  | {
      kind: 'excluded';
      orderId: string;
      reason: 'CANCELLED';
      issues: readonly OperationalFlowIssue[];
    }
  | {
      kind: 'unknown';
      orderId: string;
      issues: readonly OperationalFlowIssue[];
    };

const ORDER_STATUSES = new Set<OrderStatus>([
  'IMPORTED',
  'MAPPING_EXCEPTION',
  'RELEASE_READY',
  'RELEASED',
  'PICKING',
  'PACKED',
  'STAGED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'CLOSED',
  'CANCELLED',
]);

const RELEASE_GATES = new Set<ReleaseGateStatus>([
  'READY_TO_RELEASE',
  'REVIEW_PAYMENT',
  'BLOCKED_DATA',
  'BLOCKED_MAPPING',
  'BLOCKED_STOCK',
]);

const BLOCKED_GATES = new Set<ReleaseGateStatus>([
  'BLOCKED_DATA',
  'BLOCKED_MAPPING',
  'BLOCKED_STOCK',
]);

const COMMISSIONING_DEFERRED_GATES = new Set<ReleaseGateStatus>([
  'BLOCKED_MAPPING',
  'BLOCKED_STOCK',
]);

const EXECUTION_STAGE_BY_STATUS: Partial<Record<OrderStatus, OperationalFlowStage>> = {
  RELEASED: 'WAREHOUSE',
  PICKING: 'WAREHOUSE',
  PACKED: 'WAREHOUSE',
  STAGED: 'STAGED',
  OUT_FOR_DELIVERY: 'ROUTE',
  DELIVERED: 'DELIVERED',
  CLOSED: 'DELIVERED',
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function knownStatus(value: unknown): OrderStatus | null {
  const candidate = text(value).toUpperCase();
  return ORDER_STATUSES.has(candidate as OrderStatus) ? candidate as OrderStatus : null;
}

function gateSignal(value: unknown):
  | { kind: 'absent'; value: null }
  | { kind: 'known'; value: ReleaseGateStatus }
  | { kind: 'unknown'; value: string } {
  if (value === null || value === undefined || text(value) === '') return { kind: 'absent', value: null };
  const candidate = text(value).toUpperCase();
  return RELEASE_GATES.has(candidate as ReleaseGateStatus)
    ? { kind: 'known', value: candidate as ReleaseGateStatus }
    : { kind: 'unknown', value: candidate };
}

function staleGateIssue(orderId: string, value: string): OperationalFlowIssue {
  return {
    code: 'STALE_RELEASE_GATE_IGNORED',
    orderId,
    field: 'releaseGateStatus',
    value,
  };
}

function conflictIssue(orderId: string, value: string): OperationalFlowIssue {
  return {
    code: 'CONFLICTING_PRE_RELEASE_SIGNAL',
    orderId,
    field: 'releaseGateStatus',
    value,
  };
}

export function isOperationalFlowCommissioningDeferred(
  input: OperationalFlowOrderInput,
  context: OperationalFlowContext = {},
): boolean {
  if (context.inventoryQuantityCommissioned !== false) return false;
  const status = knownStatus(input.status);
  if (!status || status === 'CANCELLED' || status === 'FAILED' || EXECUTION_STAGE_BY_STATUS[status]) return false;
  const gate = gateSignal(input.releaseGateStatus);
  return gate.kind === 'known' && COMMISSIONING_DEFERRED_GATES.has(gate.value);
}

export function classifyOperationalFlowOrder(
  input: OperationalFlowOrderInput,
  context: OperationalFlowContext = {},
): OperationalFlowClassification {
  const orderId = text(input.id);
  const statusCandidate = text(input.status).toUpperCase();
  const status = knownStatus(input.status);
  const gate = gateSignal(input.releaseGateStatus);
  const issues: OperationalFlowIssue[] = [];

  if (!status) {
    issues.push({
      code: 'UNKNOWN_STATUS',
      orderId,
      field: 'status',
      value: statusCandidate || undefined,
    });
    if (gate.kind === 'unknown') {
      issues.push({
        code: 'UNKNOWN_RELEASE_GATE',
        orderId,
        field: 'releaseGateStatus',
        value: gate.value || undefined,
      });
    }
    return { kind: 'unknown', orderId, issues };
  }

  if (status === 'CANCELLED') {
    if (gate.kind !== 'absent') issues.push(staleGateIssue(orderId, gate.value ?? ''));
    return { kind: 'excluded', orderId, reason: 'CANCELLED', issues };
  }

  const executionStage = EXECUTION_STAGE_BY_STATUS[status];
  if (executionStage) {
    if (gate.kind !== 'absent') issues.push(staleGateIssue(orderId, gate.value ?? ''));
    return { kind: 'classified', orderId, stage: executionStage, issues };
  }

  const commissioningDeferred = isOperationalFlowCommissioningDeferred(input, context);

  // Before the first APPROVED INITIAL stocktake, mapping/stock-dependent orders
  // are held behind one warehouse commissioning gate. They remain fail-closed,
  // but must not be multiplied into thousands of order-level action items.
  if (status === 'MAPPING_EXCEPTION' && commissioningDeferred) {
    return { kind: 'classified', orderId, stage: 'NEW', issues };
  }

  if (status === 'MAPPING_EXCEPTION' || status === 'FAILED') {
    if (gate.kind === 'unknown') {
      issues.push({
        code: 'UNKNOWN_RELEASE_GATE',
        orderId,
        field: 'releaseGateStatus',
        value: gate.value || undefined,
      });
    } else if (gate.kind === 'known' && !BLOCKED_GATES.has(gate.value)) {
      issues.push(conflictIssue(orderId, gate.value));
    }
    return { kind: 'classified', orderId, stage: 'NEEDS_ACTION', issues };
  }

  if (gate.kind === 'unknown') {
    issues.push({
      code: 'UNKNOWN_RELEASE_GATE',
      orderId,
      field: 'releaseGateStatus',
      value: gate.value || undefined,
    });
    return { kind: 'unknown', orderId, issues };
  }

  if (gate.kind === 'known') {
    if (commissioningDeferred && BLOCKED_GATES.has(gate.value)) {
      return { kind: 'classified', orderId, stage: 'NEW', issues };
    }
    if (BLOCKED_GATES.has(gate.value)) {
      if (status === 'RELEASE_READY') issues.push(conflictIssue(orderId, gate.value));
      return { kind: 'classified', orderId, stage: 'NEEDS_ACTION', issues };
    }
    if (gate.value === 'REVIEW_PAYMENT') {
      if (status === 'RELEASE_READY') issues.push(conflictIssue(orderId, gate.value));
      return { kind: 'classified', orderId, stage: 'FINANCE_REVIEW', issues };
    }
    return { kind: 'classified', orderId, stage: 'READY', issues };
  }

  if (status === 'RELEASE_READY') {
    return { kind: 'classified', orderId, stage: 'READY', issues };
  }
  if (status === 'IMPORTED') {
    return { kind: 'classified', orderId, stage: 'NEW', issues };
  }

  issues.push({ code: 'UNKNOWN_STATUS', orderId, field: 'status', value: status });
  return { kind: 'unknown', orderId, issues };
}

export function buildOperationalFlow(
  input: unknown,
  context: OperationalFlowContext = {},
): OperationalFlow {
  if (!Array.isArray(input)) {
    return {
      state: 'invalid',
      sourceCount: 0,
      uniqueOrderCount: 0,
      classifiedCount: 0,
      excludedCount: 0,
      unknownCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      conservationOk: true,
      nodes: operationalFlowStages.map((stage) => ({ ...stage, count: 0, orderIds: [] })),
      assignments: [],
      exclusions: [],
      unknownOrders: [],
      issues: [{ code: 'INVALID_COLLECTION' }],
    };
  }

  const assignments: OperationalFlowAssignment[] = [];
  const exclusions: OperationalFlowExclusion[] = [];
  const unknownOrders: OperationalFlowUnknown[] = [];
  const issues: OperationalFlowIssue[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;

  input.forEach((raw, row) => {
    const record = recordOf(raw);
    if (!record) {
      invalidCount += 1;
      issues.push({ code: 'INVALID_ORDER', row });
      return;
    }

    const orderId = text(record.id);
    if (!orderId) {
      invalidCount += 1;
      issues.push({ code: 'INVALID_ORDER_ID', row, field: 'id' });
      return;
    }
    if (seen.has(orderId)) {
      duplicateCount += 1;
      issues.push({ code: 'DUPLICATE_ORDER_ID', row, orderId, field: 'id', value: orderId });
      return;
    }
    seen.add(orderId);

    const classification = classifyOperationalFlowOrder({
      id: orderId,
      status: record.status as OrderStatus,
      releaseGateStatus: record.releaseGateStatus as ReleaseGateStatus | undefined,
    }, context);
    issues.push(...classification.issues.map((issue) => ({ ...issue, row })));
    if (classification.kind === 'classified') {
      assignments.push({ orderId, stage: classification.stage });
    } else if (classification.kind === 'excluded') {
      exclusions.push({ orderId, reason: classification.reason });
    } else {
      unknownOrders.push({ orderId });
    }
  });

  const nodes = operationalFlowStages.map((definition) => {
    const orderIds = assignments
      .filter((assignment) => assignment.stage === definition.key)
      .map((assignment) => assignment.orderId);
    return { ...definition, count: orderIds.length, orderIds };
  });
  const uniqueOrderCount = seen.size;
  const classifiedCount = assignments.length;
  const excludedCount = exclusions.length;
  const unknownCount = unknownOrders.length;
  const conservationOk = input.length
    === classifiedCount + excludedCount + unknownCount + invalidCount + duplicateCount
    && uniqueOrderCount === classifiedCount + excludedCount + unknownCount
    && nodes.reduce((total, node) => total + node.count, 0) === classifiedCount;
  const partial = issues.length > 0 || !conservationOk;

  return {
    state: input.length === 0 ? 'empty' : partial ? 'partial' : 'ready',
    sourceCount: input.length,
    uniqueOrderCount,
    classifiedCount,
    excludedCount,
    unknownCount,
    invalidCount,
    duplicateCount,
    conservationOk,
    nodes,
    assignments,
    exclusions,
    unknownOrders,
    issues,
  };
}
