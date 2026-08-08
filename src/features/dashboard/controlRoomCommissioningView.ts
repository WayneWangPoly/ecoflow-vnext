import type { ImportedOrder, ReleaseGateStatus } from '../../domain/types.ts';
import {
  operationalFlowStages,
  type OperationalFlow,
  type OperationalFlowAssignment,
  type OperationalFlowNode,
} from '../intelligence/operationalFlow/operationalFlowContract.ts';

const COMMISSIONING_GATES = new Set<ReleaseGateStatus>([
  'BLOCKED_MAPPING',
  'BLOCKED_STOCK',
]);

export type ControlRoomCommissioningView = {
  assignments: readonly OperationalFlowAssignment[];
  nodes: readonly OperationalFlowNode[];
  deferredOrderIds: readonly string[];
  deferredCount: number;
};

export function isControlRoomCommissioningDeferred(
  order: Pick<ImportedOrder, 'status' | 'releaseGateStatus'>,
  inventoryQuantityCommissioned: boolean | undefined,
): boolean {
  if (inventoryQuantityCommissioned !== false) return false;
  if (order.status === 'FAILED' || order.status === 'CANCELLED') return false;
  return Boolean(order.releaseGateStatus && COMMISSIONING_GATES.has(order.releaseGateStatus));
}

/**
 * Presentation-only view of the canonical operational flow.
 *
 * The canonical classifier remains unchanged and therefore continues to fail
 * closed. Before the first APPROVED INITIAL stocktake, this adapter moves only
 * mapping/stock commissioning dependencies out of the visual Needs Action
 * bucket and into Loaded/New. No order status, release gate or write path is
 * mutated.
 */
export function buildControlRoomCommissioningView(
  flow: OperationalFlow,
  orders: readonly ImportedOrder[],
  inventoryQuantityCommissioned: boolean | undefined,
): ControlRoomCommissioningView {
  const orderById = new Map(orders.map((order) => [order.id, order] as const));
  const deferredOrderIds: string[] = [];

  const assignments = flow.assignments.map((assignment) => {
    if (assignment.stage !== 'NEEDS_ACTION') return assignment;
    const order = orderById.get(assignment.orderId);
    if (!order || !isControlRoomCommissioningDeferred(order, inventoryQuantityCommissioned)) return assignment;
    deferredOrderIds.push(assignment.orderId);
    return { ...assignment, stage: 'NEW' as const };
  });

  const nodes = operationalFlowStages.map((definition) => {
    const orderIds = assignments
      .filter((assignment) => assignment.stage === definition.key)
      .map((assignment) => assignment.orderId);
    return { ...definition, count: orderIds.length, orderIds };
  });

  return {
    assignments,
    nodes,
    deferredOrderIds,
    deferredCount: deferredOrderIds.length,
  };
}
