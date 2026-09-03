import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPurchaseOrders, type PurchaseOrderSummary } from './purchaseOrders';
import type { NativeReadResult } from './nativeReadModel';

export const PURCHASE_ORDER_FAMILIAR_STATUS_ORDER = [
  'Open',
  'Unapproved',
  'Parked',
  'Placed',
  'Costed',
  'Receipted',
  'Deleted',
  'Complete',
] as const;

export const PURCHASE_OPERATIONS_FILTER_ORDER = [
  'status',
  'purchase-order',
  'supplier',
  'warehouse',
  'order-date',
  'expected-date',
  'product',
] as const;

export const PURCHASE_OPERATIONS_COLUMN_ORDER = [
  'purchase-order',
  'supplier',
  'order-date',
  'expected-date',
  'currency',
  'status',
  'ordered',
  'received',
  'variance',
  'action',
] as const;

export type PurchaseOperationsRow = PurchaseOrderSummary;
export type PurchaseOperationsListResult = NativeReadResult<PurchaseOperationsRow>;

function latestUpdatedAt(rows: PurchaseOperationsRow[]): string | null {
  const candidates = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time);
  return candidates[0]?.value ?? null;
}

/**
 * Read-only #340A adapter over the existing governed purchase-order RPC. No
 * receiving, costing, review, or inventory mutation is exposed from this file.
 */
export async function readPurchaseOperationsList(client?: SupabaseClient | null): Promise<PurchaseOperationsListResult> {
  const rows = await loadPurchaseOrders(client);
  const readAt = new Date().toISOString();
  return {
    state: rows.length ? 'READY' : 'EMPTY',
    rows,
    metadata: {
      source: 'ecoflow_read_purchase_orders',
      authority: 'WAYNX_PURCHASE_ORDER',
      isAuthoritative: true,
      freshness: rows.length ? 'CURRENT' : 'UNKNOWN',
      readAt,
      sourceObservedAt: latestUpdatedAt(rows),
    },
    issues: [],
  };
}
