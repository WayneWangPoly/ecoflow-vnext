export const ORDER_STATUSES = {
  imported: 'IMPORTED',
  importException: 'IMPORT_EXCEPTION',
  reviewReady: 'REVIEW_READY',
  approved: 'APPROVED',
  stockReserved: 'STOCK_RESERVED',
  picking: 'PICKING',
  packed: 'PACKED',
  assignedToRun: 'ASSIGNED_TO_RUN',
  outForDelivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  onHold: 'ON_HOLD',
  exception: 'EXCEPTION'
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const ORDER_LINE_STATUSES = {
  requested: 'REQUESTED',
  reserved: 'RESERVED',
  picked: 'PICKED',
  short: 'SHORT',
  substituted: 'SUBSTITUTED',
  cancelled: 'CANCELLED'
} as const;

export type OrderLineStatus = (typeof ORDER_LINE_STATUSES)[keyof typeof ORDER_LINE_STATUSES];

export const IMPORT_BATCH_STATUSES = {
  started: 'STARTED',
  completed: 'COMPLETED',
  failed: 'FAILED',
  partial: 'PARTIAL'
} as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[keyof typeof IMPORT_BATCH_STATUSES];

export const IMPORT_EXCEPTION_TYPES = {
  customerNotMapped: 'CUSTOMER_NOT_MAPPED',
  siteNotMapped: 'SITE_NOT_MAPPED',
  skuNotMapped: 'SKU_NOT_MAPPED',
  barcodeNotMapped: 'BARCODE_NOT_MAPPED',
  unitNotMapped: 'UNIT_NOT_MAPPED',
  addressInvalid: 'ADDRESS_INVALID',
  duplicateOrder: 'DUPLICATE_ORDER',
  missingInvoice: 'MISSING_INVOICE',
  apiError: 'API_ERROR'
} as const;

export type ImportExceptionType = (typeof IMPORT_EXCEPTION_TYPES)[keyof typeof IMPORT_EXCEPTION_TYPES];

export const IMPORT_EXCEPTION_STATUSES = {
  open: 'OPEN',
  resolved: 'RESOLVED',
  ignored: 'IGNORED'
} as const;

export type ImportExceptionStatus = (typeof IMPORT_EXCEPTION_STATUSES)[keyof typeof IMPORT_EXCEPTION_STATUSES];

export const STOCK_MOVEMENT_TYPES = {
  receive: 'RECEIVE',
  putaway: 'PUTAWAY',
  reserve: 'RESERVE',
  pick: 'PICK',
  pack: 'PACK',
  dispatch: 'DISPATCH',
  adjust: 'ADJUST',
  return: 'RETURN',
  damaged: 'DAMAGED',
  transfer: 'TRANSFER'
} as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[keyof typeof STOCK_MOVEMENT_TYPES];

export const PICK_TASK_STATUSES = {
  open: 'OPEN',
  inProgress: 'IN_PROGRESS',
  picked: 'PICKED',
  short: 'SHORT',
  cancelled: 'CANCELLED'
} as const;

export type PickTaskStatus = (typeof PICK_TASK_STATUSES)[keyof typeof PICK_TASK_STATUSES];

export const DELIVERY_RUN_STATUSES = {
  planned: 'PLANNED',
  assigned: 'ASSIGNED',
  inProgress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED'
} as const;

export type DeliveryRunStatus = (typeof DELIVERY_RUN_STATUSES)[keyof typeof DELIVERY_RUN_STATUSES];

export const DELIVERY_STOP_STATUSES = {
  pending: 'PENDING',
  arrived: 'ARRIVED',
  delivered: 'DELIVERED',
  failed: 'FAILED',
  skipped: 'SKIPPED'
} as const;

export type DeliveryStopStatus = (typeof DELIVERY_STOP_STATUSES)[keyof typeof DELIVERY_STOP_STATUSES];

export const EXCEPTION_TYPES = {
  outOfStock: 'OUT_OF_STOCK',
  wrongItem: 'WRONG_ITEM',
  damagedItem: 'DAMAGED_ITEM',
  customerNotAvailable: 'CUSTOMER_NOT_AVAILABLE',
  addressIssue: 'ADDRESS_ISSUE',
  driverIssue: 'DRIVER_ISSUE',
  paymentIssue: 'PAYMENT_ISSUE',
  systemIssue: 'SYSTEM_ISSUE'
} as const;

export type ExceptionType = (typeof EXCEPTION_TYPES)[keyof typeof EXCEPTION_TYPES];
