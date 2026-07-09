export type Role = 'owner' | 'account' | 'warehouse' | 'driver';
export type DesktopTab = 'dashboard' | 'ordermentum' | 'orders' | 'delivery' | 'inventory' | 'stores' | 'reconciliation' | 'logs' | 'settings';
export type WarehouseTab = 'receive' | 'pick' | 'stock';
export type DriverTab = 'today' | 'pick' | 'stops' | 'history' | 'clock';
export type OrderStatus = 'IMPORTED' | 'MAPPING_EXCEPTION' | 'RELEASE_READY' | 'RELEASED' | 'PICKING' | 'PACKED' | 'STAGED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CLOSED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'OVERDUE' | 'CREDIT_HOLD';
/** Real Ordermentum price-group names flow through here; 'Unmapped' when no group is linked. */
export type PriceTier = string;

export type OrderSyncStatus = 'NEW' | 'UPDATED' | 'UNCHANGED';
export type OrderChangeImpact = 'SAFE_UPDATE' | 'REVIEW_REQUIRED' | 'RECONCILIATION_VARIANCE' | 'NO_CHANGE';
export type OrderBucketKey = 'newToday' | 'updatedToday' | 'carryOver' | 'dueToday' | 'future' | 'exceptions' | 'all';
export type SyncBatchStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type ReleaseGateStatus = 'READY_TO_RELEASE' | 'REVIEW_PAYMENT' | 'BLOCKED_DATA' | 'BLOCKED_MAPPING' | 'BLOCKED_STOCK';

export type BusinessDay = {
  date: string;
  label: string;
  timezone: 'Australia/Adelaide';
  cutoffTime: string;
};

export type SyncBatch = {
  id: string;
  source: string;
  status: SyncBatchStatus;
  startedAt: string;
  completedAt: string;
  businessDay: BusinessDay;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
};

export type OrderBucketCount = {
  key: OrderBucketKey;
  label: string;
  count: number;
};

export type OrdermentumSourceMode = 'sample-snapshot' | 'manual-upload' | 'supabase' | 'live-api';


export type OrderLine = {
  sku: string;
  name: string;
  qty: number;
  unit: 'sleeve' | 'carton';
  stock: number;
  /** Empty string means no verified warehouse location — never fabricate one in live mode. */
  location: string;
  /** Undefined means no verified barcode — never fabricate one in live mode. */
  barcode?: string;
  /** From the SKU master: freight/service lines are invoiced but never picked. */
  isService?: boolean;
  source?: 'order-detail' | 'catalog-sample' | 'fallback';
};

export type ImportedOrder = {
  id: string;
  orderNo: string;
  invoiceNo: string;
  store: string;
  account: string;
  priceTier: PriceTier;
  address: string;
  suburb: string;
  eta: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  selected: boolean;
  sequence: number;
  amount: number;
  packageCount: number;
  podStatus: 'missing' | 'captured';
  mappingNotes: string[];
  deliveryNote?: string;
  /** From the store-site master. */
  phone?: string;
  lat?: number;
  lng?: number;
  dueAt?: string;
  deliveryDate?: string;
  ordermentumUpdatedAt?: string;
  externalOrderId: string;
  externalCreatedAt?: string;
  externalUpdatedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncedAt: string;
  businessDay: string;
  requestedDeliveryBusinessDay: string;
  firstSeenBusinessDay: string;
  lastUpdatedBusinessDay: string;
  syncStatus: OrderSyncStatus;
  changeImpact: OrderChangeImpact;
  changeSummary: string;
  openExceptionCount: number;
  releaseGateStatus?: ReleaseGateStatus;
  releaseBlockers?: string;
  mappedLineCount?: number;
  unmappedLineCount?: number;
  stockShortageCount?: number;
  requiredQuantity?: number;
  mappedAvailableQuantity?: number;
  canCreateInternalOrder?: boolean;
  lines: OrderLine[];
};

export type StoreProfile = {
  id: string;
  name: string;
  account: string;
  suburb: string;
  priceTier: PriceTier;
  paymentTerms: string;
  ordermentumId: string;
  statementGroup: string;
  status: 'OK' | 'MISSING_TIER' | 'CREDIT_HOLD' | 'NEEDS_ADDRESS';
  address?: string;
  phone?: string;
  orderCount?: number;
  totalValue?: number;
};

export type StockRow = {
  sku: string;
  name: string;
  location: string;
  onHand: number;
  reserved: number;
  reorderPoint: number;
  tierSensitive?: boolean;
  source?: 'ordermentum-product' | 'ordermentum-variant' | 'order-detail';
};

export type Activity = {
  at: string;
  actor: string;
  action: string;
  detail: string;
};

export type PriceGroupRow = {
  id: string;
  name: PriceTier | string;
  default: boolean;
  retailersTotal: number;
  productsTotal: number;
};

export type CatalogRow = {
  id: string;
  source: 'product' | 'variant' | 'order-detail';
  sku: string;
  name: string;
  basePrice: number;
  displayPrice: string;
  unit: string;
  category: string;
  visible: boolean;
  tierPrices: Record<string, number>;
};

export type DataQualityItem = {
  severity: 'good' | 'info' | 'warn' | 'danger';
  area: string;
  message: string;
  detail: string;
};


export type OrdermentumRepositoryStatus = {
  mode: OrdermentumSourceMode;
  label: string;
  connected: boolean;
  loadedAt: string;
  sourceFiles: string[];
  counts: {
    recentOrders: number;
    products: number;
    productsTotal: number;
    variants: number;
    variantsTotal: number;
    priceGroups: number;
    stockLocations: number;
    detailOrderLines: number;
  };
};

export type MappingExceptionCategory = 'SITE_MAPPING' | 'SKU_MAPPING' | 'STOCK_SHORTAGE' | 'PRICE_TIER' | 'PAYMENT' | 'ADDRESS';

export type MappingException = {
  id: string;
  orderId: string;
  orderNo: string;
  store: string;
  category: MappingExceptionCategory;
  severity: 'warn' | 'danger';
  summary: string;
  detail: string;
  action: string;
};

export type OrdermentumImportSummary = {
  recentOrdersCount: number;
  detailOrderNo: string;
  detailInvoiceNo: string;
  detailRetailerName: string;
  detailLineCount: number;
  invoiceTotal: number;
  invoiceStatus: string;
  supplierName: string;
  productSampleCount: number;
  productCatalogTotal: number;
  variantSampleCount: number;
  variantCatalogTotal: number;
  priceGroupCount: number;
  stockLocationCount: number;
  sourceFiles: string[];
};

export type EcoFlowDataSet = {
  orders: ImportedOrder[];
  stores: StoreProfile[];
  stock: StockRow[];
  logs: Activity[];
  catalog: CatalogRow[];
  priceGroups: PriceGroupRow[];
  dataQuality: DataQualityItem[];
  mappingExceptions: MappingException[];
  syncBatch: SyncBatch;
  businessDay: BusinessDay;
  bucketCounts: OrderBucketCount[];
  repositoryStatus: OrdermentumRepositoryStatus;
  summary: OrdermentumImportSummary;
};
