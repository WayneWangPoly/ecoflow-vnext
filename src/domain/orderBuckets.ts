import type { ImportedOrder, OrderBucketCount, OrderBucketKey } from './types';
import { isActiveStatus } from './syncModel';

export const orderBucketDefinitions: { key: OrderBucketKey; label: string }[] = [
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'newToday', label: 'New clear' },
  { key: 'updatedToday', label: 'Updated clear' },
  { key: 'dueToday', label: 'Due today' },
  { key: 'future', label: 'Future' },
  { key: 'carryOver', label: 'Carry-over' },
  { key: 'all', label: 'All retained' },
];

function primaryQueue(order: ImportedOrder, businessDay: string): Exclude<OrderBucketKey, 'all'> | null {
  if (!isActiveStatus(order.status)) return null;
  if (order.status === 'MAPPING_EXCEPTION' || order.openExceptionCount > 0) return 'exceptions';
  if (order.syncStatus === 'NEW' && order.firstSeenBusinessDay === businessDay) return 'newToday';
  if (order.syncStatus === 'UPDATED' && order.lastUpdatedBusinessDay === businessDay) return 'updatedToday';
  if (order.requestedDeliveryBusinessDay === businessDay) return 'dueToday';
  if (order.requestedDeliveryBusinessDay > businessDay) return 'future';
  return 'carryOver';
}

export function orderMatchesBucket(order: ImportedOrder, bucket: OrderBucketKey, businessDay: string): boolean {
  if (bucket === 'all') return true;
  return primaryQueue(order, businessDay) === bucket;
}

export function bucketOrders(orders: ImportedOrder[], bucket: OrderBucketKey, businessDay: string): ImportedOrder[] {
  return orders.filter((order) => orderMatchesBucket(order, bucket, businessDay));
}

export function getOrderBucketCounts(orders: ImportedOrder[], businessDay: string): OrderBucketCount[] {
  return orderBucketDefinitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    count: bucketOrders(orders, definition.key, businessDay).length,
  }));
}
