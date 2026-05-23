import type {
  DeliveryRun,
  DeliveryStop,
  ExternalOrder,
  ExternalOrderLine,
  ImportException,
  InventoryBalance,
  Order,
  OrderExternalRef,
  OrderImportBatch,
  OrderLine,
  PickTask,
  PickWave,
  PodPhoto,
  StockMovement
} from '@/core/types/database';
import {
  DELIVERY_RUN_STATUSES,
  DELIVERY_STOP_STATUSES,
  IMPORT_BATCH_STATUSES,
  ORDER_LINE_STATUSES,
  ORDER_STATUSES,
  PICK_TASK_STATUSES,
  STOCK_MOVEMENT_TYPES
} from '@/core/constants/statuses';
import { SEED_NOW } from './seedTime';
import { LOCATION_IDS } from './seedLocations';
import { SKU_IDS, SKU_UNIT_IDS } from './seedSkus';

export const TRIAL_ORDER = {
  orderId: 'order-omo-test-001',
  orderNumber: 'OMO-TEST-001',
  orderLineId: 'order-line-omo-test-001-jp-pbs',
  externalOrderId: 'ext-order-omo-test-001',
  externalLineId: 'ext-line-omo-test-001-jp-pbs',
  requestedSleeves: 11
} as const;

export const seedOrderImportBatches: OrderImportBatch[] = [
  {
    id: 'batch-om-trial-001',
    provider: 'ORDERMENTUM',
    startedAt: '2026-05-23T07:00:00.000Z',
    finishedAt: '2026-05-23T07:01:00.000Z',
    status: IMPORT_BATCH_STATUSES.completed,
    totalOrders: 1,
    importedOrders: 1,
    failedOrders: 0,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedExternalOrders: ExternalOrder[] = [
  {
    id: TRIAL_ORDER.externalOrderId,
    provider: 'ORDERMENTUM',
    externalOrderId: 'OMO-TEST-001',
    externalOrderNumber: 'OMO-TEST-001',
    externalCustomerId: 'OM-CUST-TEST',
    externalCustomerName: 'Ordermentum Test Customer',
    externalSiteId: 'OM-SITE-TEST',
    externalSiteName: 'Ordermentum Test Site',
    externalInvoiceId: 'OMO-INV-TEST-001',
    externalInvoiceNumber: 'OMO-INV-TEST-001',
    rawPayload: {
      source: 'ordermentum-trial-baseline',
      note: 'Ordermentum SKU equals EcoFlow SKU equals warehouse SKU.'
    },
    importedAt: SEED_NOW,
    importBatchId: 'batch-om-trial-001',
    importStatus: 'IMPORTED',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedExternalOrderLines: ExternalOrderLine[] = [
  {
    id: TRIAL_ORDER.externalLineId,
    externalOrderId: TRIAL_ORDER.externalOrderId,
    externalLineId: 'OMO-TEST-001-L1',
    externalSkuCode: 'JP-PBS-6X197-ARTBOX',
    externalProductName: 'BioPak 6x197mm Paper Straw Art Series',
    externalBarcode: '9344062033639',
    quantity: TRIAL_ORDER.requestedSleeves,
    unit: 'sleeve',
    rawPayload: {
      sku_code: 'JP-PBS-6X197-ARTBOX',
      quantity: TRIAL_ORDER.requestedSleeves,
      unit: 'sleeve'
    },
    importStatus: 'IMPORTED',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedImportExceptions: ImportException[] = [];

export const seedOrders: Order[] = [
  {
    id: TRIAL_ORDER.orderId,
    orderNumber: TRIAL_ORDER.orderNumber,
    customerId: 'cust-ordermentum-test',
    customerSiteId: 'site-ordermentum-test',
    status: ORDER_STATUSES.stockReserved,
    deliveryDate: '2026-05-24',
    deliveryZone: 'CBD',
    ownerNote: 'Trial order: scan one carton barcode plus one sleeve barcode to complete 11 sleeves.',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedOrderExternalRefs: OrderExternalRef[] = [
  {
    id: 'order-ext-ref-omo-test-001',
    orderId: TRIAL_ORDER.orderId,
    provider: 'ORDERMENTUM',
    externalOrderId: 'OMO-TEST-001',
    externalOrderNumber: 'OMO-TEST-001',
    externalInvoiceId: 'OMO-INV-TEST-001',
    externalInvoiceNumber: 'OMO-INV-TEST-001',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedOrderLines: OrderLine[] = [
  {
    id: TRIAL_ORDER.orderLineId,
    orderId: TRIAL_ORDER.orderId,
    skuId: SKU_IDS.paperStraw6x197,
    skuUnitId: SKU_UNIT_IDS.paperStraw6x197Sleeve,
    status: ORDER_LINE_STATUSES.reserved,
    requestedQuantity: TRIAL_ORDER.requestedSleeves,
    reservedQuantity: TRIAL_ORDER.requestedSleeves,
    pickedQuantity: 0,
    packedQuantity: 0,
    displayNameSnapshot: 'BioPak 6x197mm Paper Straw Art Series',
    externalLineId: 'OMO-TEST-001-L1',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedInventoryBalances: InventoryBalance[] = [
  {
    id: 'inv-a1-01-02a-jp-pbs',
    warehouseId: 'wh-main',
    locationId: LOCATION_IDS.a10102a,
    skuId: SKU_IDS.paperStraw6x197,
    quantityOnHand: 11,
    quantityReserved: 11,
    quantityAvailable: 0,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedStockMovements: StockMovement[] = [
  {
    id: 'stock-move-receive-jp-pbs-trial',
    movementType: STOCK_MOVEMENT_TYPES.receive,
    warehouseId: 'wh-main',
    toLocationId: LOCATION_IDS.staging,
    skuId: SKU_IDS.paperStraw6x197,
    quantity: 11,
    referenceType: 'RECEIVING_BATCH',
    referenceId: 'receive-batch-trial-001',
    note: 'Trial stock received in base unit sleeves.',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'stock-move-putaway-jp-pbs-trial',
    movementType: STOCK_MOVEMENT_TYPES.putaway,
    warehouseId: 'wh-main',
    fromLocationId: LOCATION_IDS.staging,
    toLocationId: LOCATION_IDS.a10102a,
    skuId: SKU_IDS.paperStraw6x197,
    quantity: 11,
    referenceType: 'MANUAL',
    referenceId: LOCATION_IDS.a10102a,
    note: 'Trial stock put away to A1-01-02A.',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'stock-move-reserve-omo-test-001',
    movementType: STOCK_MOVEMENT_TYPES.reserve,
    warehouseId: 'wh-main',
    fromLocationId: LOCATION_IDS.a10102a,
    skuId: SKU_IDS.paperStraw6x197,
    quantity: 11,
    referenceType: 'ORDER',
    referenceId: TRIAL_ORDER.orderId,
    note: 'Reserved for OMO-TEST-001.',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedPickWaves: PickWave[] = [
  {
    id: 'wave-trial-001',
    waveNumber: 'W-OMO-TEST-001',
    warehouseId: 'wh-main',
    deliveryZone: 'CBD',
    status: 'OPEN',
    orderCount: 1,
    taskCount: 1,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedPickTasks: PickTask[] = [
  {
    id: 'pick-task-omo-test-001-jp-pbs',
    pickWaveId: 'wave-trial-001',
    orderId: TRIAL_ORDER.orderId,
    orderLineId: TRIAL_ORDER.orderLineId,
    skuId: SKU_IDS.paperStraw6x197,
    fromLocationId: LOCATION_IDS.a10102a,
    requestedQuantity: TRIAL_ORDER.requestedSleeves,
    pickedQuantity: 0,
    status: PICK_TASK_STATUSES.open,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedDeliveryRuns: DeliveryRun[] = [
  {
    id: 'run-trial-001',
    runNumber: 'RUN-OMO-TEST-001',
    warehouseId: 'wh-main',
    status: DELIVERY_RUN_STATUSES.planned,
    assignedDriverUserId: 'user-driver',
    plannedDate: '2026-05-24',
    stopCount: 1,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedDeliveryStops: DeliveryStop[] = [
  {
    id: 'stop-trial-001',
    deliveryRunId: 'run-trial-001',
    stopSequence: 1,
    orderId: TRIAL_ORDER.orderId,
    customerSiteId: 'site-ordermentum-test',
    status: DELIVERY_STOP_STATUSES.pending,
    eta: '2026-05-24T10:30:00.000Z',
    driverNote: 'Trial stop. Capture POD photo after delivery.',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedPodPhotos: PodPhoto[] = [];
