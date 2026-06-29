import type { ImportedOrder, OrderBucketCount, OrderBucketKey } from './types';
import { isActiveStatus } from './syncModel';

export const orderBucketDefinitions: { key: OrderBucketKey; label: string }[] = [
  { key: 'newToday', label: 'New today' },
  { key: 'updatedToday', label: 'Updated today' },
  { key: 'carryOver', label: 'Carry-over' },
  { key: 'dueToday', label: 'Due today' },
  { key: 'future', label: 'Future' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'all', label: 'All' }
];

export function orderMatchesBucket(order: ImportedOrder, bucket: OrderBucketKey, businessDay: string): boolean {
  if (bucket === 'all') return true;
  if (bucket === 'newToday') return order.syncStatus === 'NEW' && order.firstSeenBusinessDay === businessDay;
  if (bucket === 'updatedToday') return order.syncStatus === 'UPDATED' && order.lastUpdatedBusinessDay === businessDay;
  if (bucket === 'carryOver') return order.firstSeenBusinessDay < businessDay && isActiveStatus(order.status);
  if (bucket === 'dueToday') return order.requestedDeliveryBusinessDay === businessDay && isActiveStatus(order.status);
  if (bucket === 'future') return order.requestedDeliveryBusinessDay > businessDay && isActiveStatus(order.status);
  if (bucket === 'exceptions') return order.status === 'MAPPING_EXCEPTION' || order.openExceptionCount > 0;
  return false;
}

export function bucketOrders(orders: ImportedOrder[], bucket: OrderBucketKey, businessDay: string): ImportedOrder[] {
  return orders.filter((order) => orderMatchesBucket(order, bucket, businessDay));
}

export function getOrderBucketCounts(orders: ImportedOrder[], businessDay: string): OrderBucketCount[] {
  return orderBucketDefinitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    count: bucketOrders(orders, definition.key, businessDay).length
  }));
}
