import type { Role } from '@/core/constants/roles';
import type {
  DeliveryRunStatus,
  DeliveryStopStatus,
  ExceptionType,
  ImportBatchStatus,
  ImportExceptionStatus,
  ImportExceptionType,
  OrderLineStatus,
  OrderStatus,
  PickTaskStatus,
  StockMovementType
} from '@/core/constants/statuses';

export type ID = string;
export type ISODateTime = string;

export interface BaseRecord {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface User extends BaseRecord {
  displayName: string;
  email?: string;
  isActive: boolean;
}

export interface UserRole extends BaseRecord {
  userId: ID;
  role: Role;
}

export interface Address extends BaseRecord {
  line1: string;
  line2?: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

export interface Customer extends BaseRecord {
  code: string;
  name: string;
  invoiceName?: string;
  isActive: boolean;
}

export interface CustomerSite extends BaseRecord {
  customerId: ID;
  code: string;
  name: string;
  addressId: ID;
  contactName?: string;
  phone?: string;
  deliveryNote?: string;
  isActive: boolean;
}

export interface SkuCategory extends BaseRecord {
  code: string;
  name: string;
  sortOrder: number;
}

// Mirrors current Supabase skus table.
// Supabase column names: sku_code, display_name, category, sleeves_per_carton, pieces_per_sleeve, etc.
export interface Sku extends BaseRecord {
  skuCode: string;
  displayName: string;
  category: string;
  canSellByCarton: boolean;
  canSellBySleeve: boolean;
  sleevesPerCarton: number;
  piecesPerSleeve?: number;
  defaultStorageUnit: 'carton' | 'sleeve' | 'piece' | 'package';
  defaultPickUnit: 'carton' | 'sleeve' | 'piece' | 'package';
  packageWeight?: number;
  canMixPack: boolean;
  setupStatus: 'trial_ready' | 'needs_location' | 'needs_barcode' | 'active' | 'inactive';
}

export interface SkuUnit extends BaseRecord {
  skuId: ID;
  unitLevel: 'carton' | 'sleeve' | 'inner' | 'piece' | 'box' | 'pack';
  quantityInBaseUnit: number;
  isDefaultReceivingUnit: boolean;
  isDefaultPickingUnit: boolean;
}

// Mirrors current Supabase barcodes table.
// barcode_value must always be text because some real barcodes start with 0.
export interface SkuBarcode extends BaseRecord {
  skuId: ID;
  skuUnitId?: ID;
  barcodeValue: string;
  barcodeType: 'carton' | 'sleeve' | 'inner' | 'piece' | 'location' | 'package' | 'supplier' | 'unknown';
  unitLevel: 'carton' | 'sleeve' | 'inner' | 'piece' | 'location' | 'package' | 'unknown';
  quantityInBaseUnit: number;
  isPrimary: boolean;
  isActive: boolean;
}

export interface Warehouse extends BaseRecord {
  code: string;
  name: string;
  addressId?: ID;
  isActive: boolean;
}

export interface WarehouseZone extends BaseRecord {
  warehouseId: ID;
  code: string;
  name: string;
  sortOrder: number;
}

// Mirrors current Supabase warehouse_locations table.
export interface Location extends BaseRecord {
  warehouseId: ID;
  locationCode: string;
  zone: string;
  bay?: string;
  level?: string;
  side?: string;
  barcodeValue: string;
  locationType: 'rack' | 'shelf' | 'floor' | 'staging' | 'receiving' | 'dispatch' | 'damaged' | 'return' | 'quarantine';
  sortOrder: number;
  isPickable: boolean;
  isStaging: boolean;
  isActive: boolean;
  assignedSkuId?: ID;
}

export interface LocationBarcode extends BaseRecord {
  locationId: ID;
  barcodeValue: string;
  isActive: boolean;
}

export interface IntegrationConnection extends BaseRecord {
  provider: 'ORDERMENTUM';
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'ERROR';
  lastSyncAt?: ISODateTime;
}

export interface OrderImportBatch extends BaseRecord {
  provider: 'ORDERMENTUM';
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  status: ImportBatchStatus;
  totalOrders: number;
  importedOrders: number;
  failedOrders: number;
  createdByUserId?: ID;
}

export interface ExternalOrder extends BaseRecord {
  provider: 'ORDERMENTUM';
  externalOrderId: string;
  externalOrderNumber: string;
  externalCustomerId?: string;
  externalCustomerName?: string;
  externalSiteId?: string;
  externalSiteName?: string;
  externalInvoiceId?: string;
  externalInvoiceNumber?: string;
  rawPayload: unknown;
  importedAt: ISODateTime;
  importBatchId: ID;
  importStatus: 'IMPORTED' | 'EXCEPTION' | 'DUPLICATE';
}

export interface ExternalOrderLine extends BaseRecord {
  externalOrderId: ID;
  externalLineId: string;
  externalSkuCode?: string;
  externalProductName: string;
  externalBarcode?: string;
  quantity: number;
  unit?: string;
  rawPayload: unknown;
  importStatus: 'IMPORTED' | 'EXCEPTION';
}

export interface ExternalProductMapping extends BaseRecord {
  provider: 'ORDERMENTUM';
  externalProductCode: string;
  internalSkuId: ID;
  internalSkuUnitId?: ID;
  confidence: 'EXACT' | 'MANUAL' | 'LOW';
  isActive: boolean;
}

export interface ExternalCustomerMapping extends BaseRecord {
  provider: 'ORDERMENTUM';
  externalCustomerId: string;
  externalCustomerName?: string;
  customerId: ID;
  isActive: boolean;
}

export interface ExternalSiteMapping extends BaseRecord {
  provider: 'ORDERMENTUM';
  externalSiteId: string;
  externalSiteName?: string;
  customerSiteId: ID;
  isActive: boolean;
}

export interface ImportException extends BaseRecord {
  importBatchId: ID;
  externalOrderId?: ID;
  externalOrderLineId?: ID;
  exceptionType: ImportExceptionType;
  message: string;
  rawPayload?: unknown;
  status: ImportExceptionStatus;
  resolvedByUserId?: ID;
  resolvedAt?: ISODateTime;
}

export interface Order extends BaseRecord {
  orderNumber: string;
  customerId: ID;
  customerSiteId: ID;
  status: OrderStatus;
  deliveryDate?: string;
  deliveryZone?: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST' | 'CBD' | 'URGENT';
  ownerNote?: string;
}

export interface OrderExternalRef extends BaseRecord {
  orderId: ID;
  provider: 'ORDERMENTUM';
  externalOrderId: string;
  externalOrderNumber: string;
  externalInvoiceId?: string;
  externalInvoiceNumber?: string;
}

export interface OrderLine extends BaseRecord {
  orderId: ID;
  skuId: ID;
  skuUnitId?: ID;
  status: OrderLineStatus;
  requestedQuantity: number;
  reservedQuantity: number;
  pickedQuantity: number;
  packedQuantity: number;
  displayNameSnapshot: string;
  externalLineId?: string;
}

export interface OrderStatusHistory extends BaseRecord {
  orderId: ID;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  changedByUserId?: ID;
  note?: string;
}

export interface OrderNote extends BaseRecord {
  orderId: ID;
  createdByUserId: ID;
  note: string;
  visibleToDriver: boolean;
}

export interface InventoryBalance extends BaseRecord {
  warehouseId: ID;
  locationId: ID;
  skuId: ID;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
}

export interface StockMovement extends BaseRecord {
  movementType: StockMovementType;
  warehouseId: ID;
  fromLocationId?: ID;
  toLocationId?: ID;
  skuId: ID;
  quantity: number;
  referenceType?: 'RECEIVING_BATCH' | 'ORDER' | 'PICK_TASK' | 'PACK_JOB' | 'DELIVERY_RUN' | 'STOCKTAKE' | 'MANUAL';
  referenceId?: ID;
  createdByUserId?: ID;
  note?: string;
}

export interface ReceivingBatch extends BaseRecord {
  batchNumber: string;
  warehouseId: ID;
  status: 'DRAFT' | 'RECEIVING' | 'STAGED' | 'PUTAWAY_COMPLETE' | 'CANCELLED';
  skuLineCount: number;
  cartonCount: number;
  stagedLocationId: ID;
  receivedByUserId?: ID;
}

export interface ReceivingLine extends BaseRecord {
  receivingBatchId: ID;
  skuId: ID;
  skuBarcodeId?: ID;
  quantity: number;
  unitLevel: string;
  quantityInBaseUnit: number;
  toLocationId: ID;
  note?: string;
}

export interface PickWave extends BaseRecord {
  waveNumber: string;
  warehouseId: ID;
  deliveryZone?: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'PICKED' | 'PACKED' | 'CANCELLED';
  orderCount: number;
  taskCount: number;
}

export interface PickTask extends BaseRecord {
  pickWaveId: ID;
  orderId: ID;
  orderLineId: ID;
  skuId: ID;
  fromLocationId: ID;
  requestedQuantity: number;
  pickedQuantity: number;
  status: PickTaskStatus;
  assignedToUserId?: ID;
}

export interface PackJob extends BaseRecord {
  orderId: ID;
  status: 'OPEN' | 'IN_PROGRESS' | 'PACKED' | 'CANCELLED';
  packedByUserId?: ID;
  packedAt?: ISODateTime;
}

export interface PackItem extends BaseRecord {
  packJobId: ID;
  orderLineId: ID;
  skuId: ID;
  quantity: number;
}

export interface DeliveryRun extends BaseRecord {
  runNumber: string;
  warehouseId: ID;
  status: DeliveryRunStatus;
  assignedDriverUserId?: ID;
  plannedDate: string;
  stopCount: number;
}

export interface DeliveryStop extends BaseRecord {
  deliveryRunId: ID;
  stopSequence: number;
  orderId: ID;
  customerSiteId: ID;
  status: DeliveryStopStatus;
  eta?: ISODateTime;
  arrivedAt?: ISODateTime;
  deliveredAt?: ISODateTime;
  driverNote?: string;
}

export interface PodPhoto extends BaseRecord {
  deliveryStopId: ID;
  orderId: ID;
  imageUrl: string;
  takenByUserId: ID;
  takenAt: ISODateTime;
  latitude?: number;
  longitude?: number;
  note?: string;
}

export interface DeliveryEvent extends BaseRecord {
  deliveryRunId: ID;
  deliveryStopId?: ID;
  eventType: 'RUN_STARTED' | 'ARRIVED' | 'POD_UPLOADED' | 'STOP_DELIVERED' | 'STOP_FAILED' | 'RUN_COMPLETED';
  createdByUserId?: ID;
  note?: string;
}

export interface ExceptionRecord extends BaseRecord {
  exceptionType: ExceptionType;
  status: 'OPEN' | 'RESOLVED' | 'ESCALATED';
  orderId?: ID;
  orderLineId?: ID;
  deliveryStopId?: ID;
  message: string;
  assignedToUserId?: ID;
  resolvedAt?: ISODateTime;
}

export interface AuditEvent extends BaseRecord {
  eventType:
    | 'ORDER_IMPORTED'
    | 'IMPORT_EXCEPTION_CREATED'
    | 'ORDER_APPROVED'
    | 'STOCK_RESERVED'
    | 'ITEM_PICKED'
    | 'ITEM_SHORT'
    | 'ORDER_PACKED'
    | 'RUN_ASSIGNED'
    | 'STOP_DELIVERED'
    | 'POD_UPLOADED'
    | 'ORDER_COMPLETED'
    | 'EXCEPTION_CREATED';
  entityType: string;
  entityId: ID;
  userId?: ID;
  payload?: unknown;
}
