import type { InventoryBalance, StockMovement } from '@/core/types/database';
import { STOCK_MOVEMENT_TYPES } from '@/core/constants/statuses';
import { SEED_NOW } from '@/core/data/seedTime';

export function createReceiveMovement(input: {
  warehouseId: string;
  toLocationId: string;
  skuId: string;
  quantity: number;
  referenceId?: string;
  userId?: string;
  note?: string;
}): StockMovement {
  return {
    id: `stock-move-receive-${cryptoSafeId()}`,
    movementType: STOCK_MOVEMENT_TYPES.receive,
    warehouseId: input.warehouseId,
    toLocationId: input.toLocationId,
    skuId: input.skuId,
    quantity: input.quantity,
    referenceType: 'RECEIVING_BATCH',
    referenceId: input.referenceId,
    createdByUserId: input.userId,
    note: input.note,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };
}

export function applyStockMovement(balance: InventoryBalance | undefined, movement: StockMovement): InventoryBalance {
  const base: InventoryBalance = balance ?? {
    id: `inv-${movement.warehouseId}-${movement.toLocationId ?? movement.fromLocationId}-${movement.skuId}`,
    warehouseId: movement.warehouseId,
    locationId: movement.toLocationId ?? movement.fromLocationId ?? '',
    skuId: movement.skuId,
    quantityOnHand: 0,
    quantityReserved: 0,
    quantityAvailable: 0,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };

  const quantityDelta = movement.movementType === STOCK_MOVEMENT_TYPES.pick || movement.movementType === STOCK_MOVEMENT_TYPES.damaged ? -movement.quantity : movement.quantity;
  const quantityOnHand = Math.max(0, base.quantityOnHand + quantityDelta);
  const quantityAvailable = Math.max(0, quantityOnHand - base.quantityReserved);

  return {
    ...base,
    quantityOnHand,
    quantityAvailable,
    updatedAt: SEED_NOW
  };
}

function cryptoSafeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
