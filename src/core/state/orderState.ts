import type { AuditEvent, Order } from '@/core/types/database';
import { ORDER_STATUSES, type OrderStatus } from '@/core/constants/statuses';
import { SEED_NOW } from '@/core/data/seedTime';

export interface OrderTransitionResult {
  order: Order;
  auditEvent: AuditEvent;
}

export function approveOrder(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.reviewReady], ORDER_STATUSES.approved, 'ORDER_APPROVED', userId);
}

export function reserveStock(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.approved], ORDER_STATUSES.stockReserved, 'STOCK_RESERVED', userId);
}

export function startPicking(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.stockReserved], ORDER_STATUSES.picking, 'STOCK_RESERVED', userId);
}

export function markPacked(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.picking], ORDER_STATUSES.packed, 'ORDER_PACKED', userId);
}

export function assignToRun(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.packed], ORDER_STATUSES.assignedToRun, 'RUN_ASSIGNED', userId);
}

export function startDelivery(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.assignedToRun], ORDER_STATUSES.outForDelivery, 'RUN_ASSIGNED', userId);
}

export function markDelivered(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.outForDelivery], ORDER_STATUSES.delivered, 'STOP_DELIVERED', userId);
}

export function completeOrder(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.delivered], ORDER_STATUSES.completed, 'ORDER_COMPLETED', userId);
}

export function holdOrder(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, [ORDER_STATUSES.reviewReady, ORDER_STATUSES.approved], ORDER_STATUSES.onHold, 'EXCEPTION_CREATED', userId);
}

export function markOrderException(order: Order, userId?: string): OrderTransitionResult {
  return transitionOrder(order, activeStatuses(), ORDER_STATUSES.exception, 'EXCEPTION_CREATED', userId);
}

function transitionOrder(order: Order, allowedFrom: OrderStatus[], toStatus: OrderStatus, eventType: AuditEvent['eventType'], userId?: string): OrderTransitionResult {
  if (!allowedFrom.includes(order.status)) {
    throw new Error(`Invalid order transition from ${order.status} to ${toStatus}`);
  }

  const updatedOrder: Order = {
    ...order,
    status: toStatus,
    updatedAt: SEED_NOW
  };

  return {
    order: updatedOrder,
    auditEvent: {
      id: `audit-${order.id}-${toStatus}`,
      eventType,
      entityType: 'order',
      entityId: order.id,
      userId,
      payload: { fromStatus: order.status, toStatus },
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW
    }
  };
}

function activeStatuses(): OrderStatus[] {
  return [
    ORDER_STATUSES.imported,
    ORDER_STATUSES.reviewReady,
    ORDER_STATUSES.approved,
    ORDER_STATUSES.stockReserved,
    ORDER_STATUSES.picking,
    ORDER_STATUSES.packed,
    ORDER_STATUSES.assignedToRun,
    ORDER_STATUSES.outForDelivery,
    ORDER_STATUSES.delivered,
    ORDER_STATUSES.onHold
  ];
}
