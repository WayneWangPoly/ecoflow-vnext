import { getOrderBucketCounts } from '@/domain/orderBuckets';
import { sortOrdersForOperations } from '@/domain/syncModel';
import type { EcoFlowDataSet, ImportedOrder, OrderBucketKey } from '@/domain/types';
import type { OwnerCommandKpis } from '@/data/repositories/ownerCommandCenter';

export type DashboardTone = 'good' | 'warn' | 'danger' | 'blue' | 'neutral';
export type DashboardBadge = { label: string; tone: DashboardTone };

export function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function money(value: unknown) {
  return numberValue(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

export function signalTone(signal?: string | null): DashboardTone {
  const normalized = String(signal || '').toUpperCase();
  if (normalized.includes('URGENT') || normalized.includes('OVERDUE') || normalized.includes('HOLD') || normalized.includes('BLOCKED')) return 'danger';
  if (normalized.includes('NEEDS') || normalized.includes('WATCH') || normalized.includes('HIGH') || normalized.includes('LEGACY') || normalized.includes('BARCODE')) return 'warn';
  if (normalized.includes('OPEN') || normalized.includes('REORDER') || normalized.includes('UPDATED')) return 'blue';
  if (normalized.includes('READY') || normalized.includes('ACTIVE') || normalized.includes('CLEAR') || normalized.includes('SUCCESS')) return 'good';
  return 'neutral';
}

function orderStatusTone(status: ImportedOrder['status']): DashboardTone {
  if (status === 'DELIVERED' || status === 'CLOSED') return 'good';
  if (status === 'MAPPING_EXCEPTION' || status === 'FAILED') return 'danger';
  if (status === 'OUT_FOR_DELIVERY' || status === 'PACKED' || status === 'STAGED') return 'blue';
  if (status === 'RELEASE_READY') return 'warn';
  return 'neutral';
}

function releaseTone(status: ImportedOrder['releaseGateStatus']): DashboardTone {
  if (status === 'READY_TO_RELEASE') return 'good';
  if (status === 'REVIEW_PAYMENT') return 'warn';
  if (status === 'BLOCKED_DATA' || status === 'BLOCKED_MAPPING' || status === 'BLOCKED_STOCK') return 'danger';
  return 'neutral';
}

function syncTone(status: ImportedOrder['syncStatus']): DashboardTone {
  if (status === 'NEW') return 'good';
  if (status === 'UPDATED') return 'blue';
  return 'neutral';
}

export function lineSummary(order: ImportedOrder) {
  const parts = order.lines.slice(0, 3).map((line) => {
    const baseUnit = line.unit === 'sleeve' ? 'sleeve' : 'carton';
    return `${line.sku} × ${line.qty} ${line.qty === 1 ? baseUnit : `${baseUnit}s`}`;
  });
  const remaining = Math.max(0, order.lines.length - 3);
  if (remaining) parts.push(`+${remaining} more line${remaining === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function queueBadges(order: ImportedOrder): DashboardBadge[] {
  const badges: DashboardBadge[] = [{ label: title(order.status), tone: orderStatusTone(order.status) }];
  if (order.syncStatus !== 'UNCHANGED') badges.push({ label: title(order.syncStatus), tone: syncTone(order.syncStatus) });
  if (order.releaseGateStatus && order.releaseGateStatus !== 'READY_TO_RELEASE') {
    badges.push({ label: title(order.releaseGateStatus), tone: releaseTone(order.releaseGateStatus) });
  }
  const seen = new Set<string>();
  return badges.filter((badge) => {
    const key = badge.label.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildDashboardView(data: EcoFlowDataSet, orders: ImportedOrder[], kpis: OwnerCommandKpis | null) {
  const bucketCounts = getOrderBucketCounts(orders, data.businessDay.date);
  const count = (key: OrderBucketKey) => bucketCounts.find((item) => item.key === key)?.count ?? 0;
  const activeOrders = orders.filter((order) => !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(order.status)).length;
  const openArFallback = orders.filter((order) => order.paymentStatus !== 'PAID').reduce((sum, order) => sum + order.amount, 0);
  const sorted = sortOrdersForOperations(orders);
  const actionable = sorted.filter((order) => order.syncStatus !== 'UNCHANGED' || order.openExceptionCount > 0);
  const queueSource = actionable.length ? actionable : sorted.filter((order) => !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(order.status));
  const latestOrderChange = orders
    .map((order) => order.lastSeenAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  return {
    bucketCounts,
    count,
    activeOrders,
    openAr: kpis?.open_ar_value ?? openArFallback,
    queue: queueSource.slice(0, 10),
    actionableCount: queueSource.length,
    latestOrderChange,
    dataCheckCount: data.dataQuality.filter((item) => item.severity === 'warn' || item.severity === 'danger').length,
  };
}
