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
  'supplier-reference',
  'sales-order-reference',
  'printed-export',
] as const;

export const PURCHASE_OPERATIONS_COLUMN_ORDER = [
  'purchase-order',
  'order-date',
  'delivery-date',
  'supplier',
  'supplier-reference',
  'status',
  'warehouse',
  'currency',
  'total',
  'action',
] as const;

export type PurchaseOrderFamiliarStatus = typeof PURCHASE_ORDER_FAMILIAR_STATUS_ORDER[number];

/** Conservative display-only mapping; the WAYNX source state is always retained. */
export function mapPurchaseOrderFamiliarStatus(status: string): PurchaseOrderFamiliarStatus | null {
  switch (String(status || '').trim().toUpperCase()) {
    case 'OPEN': return 'Open';
    case 'PART_RECEIVED':
    case 'AWAITING_REVIEW':
    case 'VARIANCE': return 'Receipted';
    case 'MATCHED':
    case 'CLOSED': return 'Complete';
    case 'CANCELLED': return 'Deleted';
    default: return null;
  }
}
