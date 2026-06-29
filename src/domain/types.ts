export type Role = 'owner' | 'account' | 'warehouse' | 'driver';
export type DesktopTab = 'dashboard' | 'ordermentum' | 'orders' | 'delivery' | 'inventory' | 'stores' | 'reconciliation' | 'logs' | 'settings';
export type WarehouseTab = 'receive' | 'pick' | 'pack' | 'stock';
export type DriverTab = 'run' | 'route' | 'pod' | 'issues';
export type OrderStatus = 'IMPORTED' | 'MAPPING_EXCEPTION' | 'RELEASE_READY' | 'RELEASED' | 'PICKING' | 'PACKED' | 'STAGED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CLOSED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'OVERDUE' | 'CREDIT_HOLD';
export type PriceTier = 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4' | 'Tier 5';

export type OrderSyncStatus = 'NEW' | 'UPDATED' | 'UNCHANGED';
export type OrderChangeImpact = 'SAFE_UPDATE' | 'REVIEW_REQUIRED' | 'RECONCILIATION_VARIANCE' | 'NO_CHANGE';
export type OrderBucketKey = 'newToday' | 'updatedToday' | 'carryOver' | 'dueToday' | 'future' | 'exceptions' | 'all';
export type SyncBatchStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

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
  location: string;
  barcode: string;
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
