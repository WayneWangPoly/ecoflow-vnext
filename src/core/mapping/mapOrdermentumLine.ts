import type { ExternalProductMapping, OrderLine, Sku, SkuUnit } from '@/core/types/database';
import { ORDER_LINE_STATUSES } from '@/core/constants/statuses';
import type { OrdermentumOrderLinePayload } from '@/core/types/ordermentum';
import { SEED_NOW } from '@/core/data/seedTime';

export interface MapOrdermentumLineInput {
  orderId: string;
  line: OrdermentumOrderLinePayload;
  productMappings: ExternalProductMapping[];
  skus: Sku[];
  skuUnits: SkuUnit[];
}

export interface MapOrdermentumLineResult {
  orderLine?: OrderLine;
  error?: 'SKU_NOT_MAPPED' | 'UNIT_NOT_MAPPED';
  message?: string;
}

export function mapOrdermentumLine(input: MapOrdermentumLineInput): MapOrdermentumLineResult {
  const { orderId, line, productMappings, skus, skuUnits } = input;

  // Current trial rule: Ordermentum productCode is the internal skuCode.
  const mapping = productMappings.find(
    (candidate) => candidate.isActive && line.productCode && candidate.externalProductCode === line.productCode
  );

  const sku = mapping
    ? skus.find((candidate) => candidate.id === mapping.internalSkuId)
    : skus.find((candidate) => candidate.skuCode === line.productCode);

  if (!sku) {
    return {
      error: 'SKU_NOT_MAPPED',
      message: `Ordermentum line ${line.id} could not be mapped to internal sku_code ${line.productCode ?? 'unknown'}.`
    };
  }

  const skuUnit = mapping?.internalSkuUnitId
    ? skuUnits.find((candidate) => candidate.id === mapping.internalSkuUnitId)
    : skuUnits.find((candidate) => candidate.skuId === sku.id && candidate.isDefaultPickingUnit);

  if (!skuUnit) {
    return {
      error: 'UNIT_NOT_MAPPED',
      message: `Internal SKU ${sku.skuCode} has no mapped pick unit.`
    };
  }

  return {
    orderLine: {
      id: `order-line-${orderId}-${line.id}`,
      orderId,
      skuId: sku.id,
      skuUnitId: skuUnit.id,
      status: ORDER_LINE_STATUSES.requested,
      requestedQuantity: line.quantity,
      reservedQuantity: 0,
      pickedQuantity: 0,
      packedQuantity: 0,
      displayNameSnapshot: sku.displayName,
      externalLineId: line.id,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW
    }
  };
}
