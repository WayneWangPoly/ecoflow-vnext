import type {
  ExternalCustomerMapping,
  ExternalProductMapping,
  ExternalSiteMapping,
  ImportException,
  Order,
  OrderExternalRef,
  OrderLine,
  Sku,
  SkuUnit
} from '@/core/types/database';
import { IMPORT_EXCEPTION_STATUSES, IMPORT_EXCEPTION_TYPES, ORDER_STATUSES } from '@/core/constants/statuses';
import type { OrdermentumOrderPayload } from '@/core/types/ordermentum';
import { SEED_NOW } from '@/core/data/seedTime';
import { mapOrdermentumLine } from './mapOrdermentumLine';

export interface MapOrdermentumOrderInput {
  importBatchId: string;
  payload: OrdermentumOrderPayload;
  customerMappings: ExternalCustomerMapping[];
  siteMappings: ExternalSiteMapping[];
  productMappings: ExternalProductMapping[];
  skus: Sku[];
  skuUnits: SkuUnit[];
}

export interface MapOrdermentumOrderResult {
  order?: Order;
  orderLines: OrderLine[];
  externalRef?: OrderExternalRef;
  importExceptions: ImportException[];
}

export function mapOrdermentumOrder(input: MapOrdermentumOrderInput): MapOrdermentumOrderResult {
  const { importBatchId, payload, customerMappings, siteMappings, productMappings, skus, skuUnits } = input;
  const importExceptions: ImportException[] = [];

  const customerMapping = payload.customer?.id
    ? customerMappings.find((mapping) => mapping.provider === 'ORDERMENTUM' && mapping.externalCustomerId === payload.customer?.id && mapping.isActive)
    : undefined;

  const siteMapping = payload.site?.id
    ? siteMappings.find((mapping) => mapping.provider === 'ORDERMENTUM' && mapping.externalSiteId === payload.site?.id && mapping.isActive)
    : undefined;

  if (!customerMapping) {
    importExceptions.push(makeImportException(importBatchId, 'CUSTOMER_NOT_MAPPED', `Customer is not mapped: ${payload.customer?.name ?? 'unknown'}`, payload));
  }

  if (!siteMapping) {
    importExceptions.push(makeImportException(importBatchId, 'SITE_NOT_MAPPED', `Site is not mapped: ${payload.site?.name ?? 'unknown'}`, payload));
  }

  if (!payload.invoice?.id && !payload.invoice?.number) {
    importExceptions.push(makeImportException(importBatchId, 'MISSING_INVOICE', `Order ${payload.orderNumber} has no invoice reference.`, payload));
  }

  const orderId = `order-${payload.id}`;
  const orderLines: OrderLine[] = [];

  for (const line of payload.lines) {
    const mapped = mapOrdermentumLine({ orderId, line, productMappings, skus, skuUnits });
    if (mapped.orderLine) {
      orderLines.push(mapped.orderLine);
    } else if (mapped.error) {
      importExceptions.push(makeImportException(importBatchId, mapped.error, mapped.message ?? 'Line mapping error.', line));
    }
  }

  if (!customerMapping || !siteMapping || importExceptions.some((exception) => exception.exceptionType !== IMPORT_EXCEPTION_TYPES.missingInvoice)) {
    return { orderLines, importExceptions };
  }

  const order: Order = {
    id: orderId,
    orderNumber: `EF-${payload.orderNumber}`,
    customerId: customerMapping.customerId,
    customerSiteId: siteMapping.customerSiteId,
    status: ORDER_STATUSES.reviewReady,
    deliveryDate: payload.deliveryDate,
    deliveryZone: 'CBD',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };

  const externalRef: OrderExternalRef = {
    id: `order-ext-ref-${payload.id}`,
    orderId,
    provider: 'ORDERMENTUM',
    externalOrderId: payload.id,
    externalOrderNumber: payload.orderNumber,
    externalInvoiceId: payload.invoice?.id,
    externalInvoiceNumber: payload.invoice?.number,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };

  return { order, orderLines, externalRef, importExceptions };
}

function makeImportException(importBatchId: string, type: keyof typeof IMPORT_EXCEPTION_TYPES | string, message: string, rawPayload: unknown): ImportException {
  const value = (IMPORT_EXCEPTION_TYPES as Record<string, string>)[type] ?? type;
  return {
    id: `import-exc-${cryptoSafeId()}`,
    importBatchId,
    exceptionType: value as ImportException['exceptionType'],
    message,
    rawPayload,
    status: IMPORT_EXCEPTION_STATUSES.open,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  };
}

function cryptoSafeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
