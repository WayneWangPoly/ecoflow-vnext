import type { ImportedOrder, OrderStatus, PaymentStatus } from '@/domain/types';
import type { OverlayRecordInput } from '@/features/intelligence/overlays';
import type { ListQuerySchema } from '@/features/intelligence/query';

export type OrdersFilterKey = 'status' | 'payment' | 'pod';
export type OrdersSortKey = 'updated' | 'value' | 'order' | 'store' | 'status';
export type OrdersSignalTone = 'success' | 'warning' | 'danger' | 'information' | 'neutral';

export const orderStatusOptions: readonly OrderStatus[] = [
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
];

export const paymentStatusOptions: readonly PaymentStatus[] = [
  'UNPAID',
  'PAID',
  'OVERDUE',
  'CREDIT_HOLD',
];

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en-AU', { numeric: true, sensitivity: 'base' });
}

function compareTime(left?: string, right?: string): number {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

export const ordersListQuerySchema: ListQuerySchema<ImportedOrder, OrdersFilterKey, OrdersSortKey> = {
  searchText: (order) => [
    order.orderNo,
    order.invoiceNo,
    order.store,
    order.suburb,
    order.account,
    order.address,
    order.externalOrderId,
    order.priceTier,
  ],
  filters: {
    status: { read: (order) => order.status },
    payment: { read: (order) => order.paymentStatus },
    pod: { read: (order) => order.podStatus },
  },
  sorts: {
    updated: (left, right) => compareTime(left.lastSeenAt, right.lastSeenAt),
    value: (left, right) => left.amount - right.amount,
    order: (left, right) => compareText(left.orderNo, right.orderNo),
    store: (left, right) => compareText(left.store, right.store),
    status: (left, right) => compareText(left.status, right.status),
  },
  defaultSort: { key: 'updated', direction: 'desc' },
  pageSizes: [25, 50, 100],
  defaultPageSize: 25,
};

export function orderStatusLabel(status: OrderStatus): string {
  return status.replace(/_/g, ' ');
}

export function orderStatusTone(status: OrderStatus): OrdersSignalTone {
  if (status === 'DELIVERED' || status === 'CLOSED') return 'success';
  if (status === 'MAPPING_EXCEPTION' || status === 'FAILED' || status === 'CANCELLED') return 'danger';
  if (status === 'RELEASE_READY') return 'warning';
  if (status === 'RELEASED' || status === 'PICKING' || status === 'PACKED' || status === 'STAGED' || status === 'OUT_FOR_DELIVERY') return 'information';
  return 'neutral';
}

export function paymentStatusTone(status: PaymentStatus): OrdersSignalTone {
  if (status === 'PAID') return 'success';
  if (status === 'OVERDUE' || status === 'CREDIT_HOLD') return 'danger';
  return 'warning';
}

export function podStatusTone(status: ImportedOrder['podStatus']): OrdersSignalTone {
  return status === 'captured' ? 'success' : 'warning';
}

export function formatOrderMoney(value: number): string {
  return value.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  });
}

export function formatOrderDateTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function buildOrderOverlayRecord(order: ImportedOrder): OverlayRecordInput {
  return {
    entity: { kind: 'order', id: order.id },
    eyebrow: 'Order',
    title: order.orderNo,
    subtitle: `${order.store} · ${order.suburb}`,
    width: 'wide',
    fields: [
      { label: 'Order', value: order.orderNo },
      { label: 'Invoice', value: order.invoiceNo || '—' },
      { label: 'Store', value: order.store },
      { label: 'Account', value: order.account },
      { label: 'Address', value: order.address || '—' },
      { label: 'Price tier', value: order.priceTier },
      { label: 'Status', value: orderStatusLabel(order.status) },
      { label: 'Payment', value: order.paymentStatus },
      { label: 'Value', value: formatOrderMoney(order.amount) },
      { label: 'Packages', value: String(order.packageCount) },
      { label: 'POD', value: order.podStatus },
      { label: 'Release gate', value: order.releaseGateStatus?.replace(/_/g, ' ') || '—' },
      { label: 'Blockers', value: order.releaseBlockers || order.changeSummary || 'None reported' },
      { label: 'Updated', value: formatOrderDateTime(order.lastSeenAt) },
      { label: 'Lines', value: order.lines.map((line) => `${line.sku} × ${line.qty} ${line.unit}`).join('\n') || '—' },
    ],
  };
}
