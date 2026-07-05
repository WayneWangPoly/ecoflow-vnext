import { activeOrdermentumRepository } from '@/data/repositories/ordermentumRepository';
import type { OrdermentumRepository } from '@/data/repositories/ordermentumRepository';
import { getOrderBucketCounts } from './orderBuckets';
import {
  addDays,
  addMinutes,
  businessDateFromIso,
  deriveChangeImpact,
  makeSyncBatch,
  toIso
} from './syncModel';
import type {
  Activity,
  CatalogRow,
  DataQualityItem,
  EcoFlowDataSet,
  ImportedOrder,
  MappingException,
  OrderLine,
  OrdermentumImportSummary,
  OrderSyncStatus,
  PaymentStatus,
  PriceGroupRow,
  PriceTier,
  StockRow,
  StoreProfile
} from './types';

const tierSequence: PriceTier[] = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'];
const locationSequence = ['A1-01-01A', 'A2-02-01B', 'B1-03-02A', 'B2-01-02B', 'C1-04-01A', 'C2-02-03B', 'D1-01-01A', 'E1-03-01B'];
const statusSequence: ImportedOrder['status'][] = ['MAPPING_EXCEPTION', 'RELEASE_READY', 'RELEASED', 'PICKING', 'PACKED', 'STAGED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED'];

type SyncPlan = {
  syncStatus: OrderSyncStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncedAt: string;
  externalCreatedAt?: string;
  externalUpdatedAt?: string;
  changeSummary: string;
};

let ordermentumSnapshot = activeOrdermentumRepository.getSnapshot();

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';
}

function nonEmpty(value: string | undefined, fallback: string) {
  return value && value.trim().length > 0 ? value : fallback;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maxIso(values: Array<string | undefined>) {
  const max = values
    .map(parseDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return (max || new Date()).toISOString();
}

function formatEta(iso: string | undefined, fallbackIndex: number) {
  if (!iso) return `${String(9 + Math.floor(fallbackIndex / 3)).padStart(2, '0')}:${String((fallbackIndex % 3) * 20).padStart(2, '0')}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `${String(9 + Math.floor(fallbackIndex / 3)).padStart(2, '0')}:${String((fallbackIndex % 3) * 20).padStart(2, '0')}`;
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Adelaide' });
}

function suburbFromAddress(address: string) {
  const match = address.match(/\b([A-Za-z ]+)\s+SA\s+\d{4}\b/);
  return match?.[1]?.trim() || 'Adelaide';
}

function paymentStatusFromOrdermentum(value: string | undefined): PaymentStatus {
  if (!value) return 'UNPAID';
  if (value.toLowerCase() === 'paid') return 'PAID';
  if (value.toLowerCase().includes('overdue')) return 'OVERDUE';
  return 'UNPAID';
}

function tierForIndex(index: number): PriceTier {
  return tierSequence[index % tierSequence.length];
}

function makeBarcode(seed: string, index: number) {
  const digits = seed.replace(/\D/g, '').slice(0, 8).padEnd(8, String(index % 10));
  return `93${digits}${String(100 + index).slice(-3)}`;
}

function buildOperationalAnchor() {
  const recentDates = ordermentumSnapshot.recentOrders.flatMap((order) => [order.updatedAt, order.dueAt, order.deliveryDate]);
  return maxIso([ordermentumSnapshot.detailOrder.updatedAt, ...recentDates]);
}

function buildSyncPlans(anchorIso: string): Map<string, SyncPlan> {
  const anchor = parseDate(anchorIso) || new Date();
  const sorted = [...(ordermentumSnapshot.recentOrders as unknown as any[])].sort((a, b) => {
    const dateA = parseDate(a.updatedAt)?.getTime() || 0;
    const dateB = parseDate(b.updatedAt)?.getTime() || 0;
    return dateB - dateA;
  });
  const planById = new Map<string, SyncPlan>();

  sorted.forEach((raw, rank) => {
    const sourceUpdated = raw.updatedAt || raw.dueAt || raw.deliveryDate || anchorIso;
    const sourceCreated = raw.deliveryDate || raw.dueAt || sourceUpdated;
    if (rank < 6) {
      const firstSeen = toIso(addMinutes(anchor, -rank * 18));
      planById.set(raw.id, {
        syncStatus: 'NEW',
        firstSeenAt: firstSeen,
        lastSeenAt: firstSeen,
        lastSyncedAt: anchorIso,
        externalCreatedAt: sourceCreated,
        externalUpdatedAt: sourceUpdated,
        changeSummary: 'Created in Ordermentum intake'
      });
      return;
    }
    if (rank < 13) {
      const changed = toIso(addMinutes(anchor, -rank * 11));
      planById.set(raw.id, {
        syncStatus: 'UPDATED',
        firstSeenAt: toIso(addDays(anchor, -1)),
        lastSeenAt: changed,
        lastSyncedAt: anchorIso,
        externalCreatedAt: sourceCreated,
        externalUpdatedAt: sourceUpdated,
        changeSummary: 'Ordermentum change detected'
      });
      return;
    }
    const firstSeen = raw.deliveryDate || raw.dueAt || sourceUpdated;
    planById.set(raw.id, {
      syncStatus: 'UNCHANGED',
      firstSeenAt: firstSeen,
      lastSeenAt: sourceUpdated,
      lastSyncedAt: anchorIso,
      externalCreatedAt: sourceCreated,
      externalUpdatedAt: sourceUpdated,
      changeSummary: 'No change since last sync'
    });
  });

  planById.set(ordermentumSnapshot.detailOrder.id, {
    syncStatus: 'UNCHANGED',
    firstSeenAt: ordermentumSnapshot.detailOrder.deliveryDate || ordermentumSnapshot.detailOrder.updatedAt || anchorIso,
    lastSeenAt: ordermentumSnapshot.detailOrder.updatedAt || anchorIso,
    lastSyncedAt: anchorIso,
    externalCreatedAt: ordermentumSnapshot.detailOrder.deliveryDate || ordermentumSnapshot.detailOrder.updatedAt,
    externalUpdatedAt: ordermentumSnapshot.detailOrder.updatedAt,
    changeSummary: 'Detail order retained in order history'
  });

  return planById;
}

function withSync(order: Omit<ImportedOrder, 'externalOrderId' | 'externalCreatedAt' | 'externalUpdatedAt' | 'firstSeenAt' | 'lastSeenAt' | 'lastSyncedAt' | 'businessDay' | 'requestedDeliveryBusinessDay' | 'firstSeenBusinessDay' | 'lastUpdatedBusinessDay' | 'syncStatus' | 'changeImpact' | 'changeSummary' | 'openExceptionCount'>, plan: SyncPlan): ImportedOrder {
  const firstSeenBusinessDay = businessDateFromIso(plan.firstSeenAt);
  const lastUpdatedBusinessDay = businessDateFromIso(plan.lastSeenAt);
  const requestedDeliveryBusinessDay = businessDateFromIso(order.deliveryDate || order.dueAt || plan.firstSeenAt);
  const syncStatus = plan.syncStatus;
  const changeImpact = deriveChangeImpact(order.status, syncStatus);
  const preliminary: ImportedOrder = {
    ...order,
    externalOrderId: order.id,
    externalCreatedAt: plan.externalCreatedAt,
    externalUpdatedAt: plan.externalUpdatedAt,
    firstSeenAt: plan.firstSeenAt,
    lastSeenAt: plan.lastSeenAt,
    lastSyncedAt: plan.lastSyncedAt,
    businessDay: firstSeenBusinessDay,
    requestedDeliveryBusinessDay,
    firstSeenBusinessDay,
    lastUpdatedBusinessDay,
    syncStatus,
    changeImpact,
    changeSummary: plan.changeSummary,
    openExceptionCount: 0
  };
  return preliminary;
}

function buildCatalog(): CatalogRow[] {
  const products: CatalogRow[] = ordermentumSnapshot.products.map((item) => ({
    id: item.id,
    source: 'product',
    sku: nonEmpty(item.SKU, `PRODUCT-${item.id.slice(0, 8)}`),
    name: item.name,
    basePrice: asNumber(item.basePrice),
    displayPrice: nonEmpty(item.displayPrice, `$${asNumber(item.basePrice).toFixed(2)}`),
    unit: nonEmpty(item.unit, 'Carton'),
    category: item.categoryNames[0] || 'Packaging',
    visible: item.visible,
    tierPrices: Object.fromEntries(Object.entries(item.prices).map(([key, value]) => [key, asNumber(value)]))
  }));

  const variants: CatalogRow[] = ordermentumSnapshot.variants.map((item) => ({
    id: item.id,
    source: 'variant',
    sku: nonEmpty(item.SKU, `VARIANT-${item.id.slice(0, 8)}`),
    name: item.name,
    basePrice: asNumber(item.basePrice),
    displayPrice: nonEmpty(item.displayPrice, `$${asNumber(item.basePrice).toFixed(2)}`),
    unit: nonEmpty(item.unit, 'Carton'),
    category: 'Variant',
    visible: item.visible && !item.deactivatedAt,
    tierPrices: {}
  }));

  const detailLines: CatalogRow[] = ordermentumSnapshot.detailOrder.lineItems.map((line) => ({
    id: line.id,
    source: 'order-detail',
    sku: nonEmpty(line.sku, `DETAIL-${line.id.slice(0, 8)}`),
    name: nonEmpty(line.productName, line.name),
    basePrice: asNumber(line.basePrice),
    displayPrice: `$${asNumber(line.basePrice).toFixed(2)}`,
    unit: nonEmpty(line.unit, 'Carton'),
    category: nonEmpty(line.category, 'Order detail'),
    visible: true,
    tierPrices: {}
  }));

  const rows = [...detailLines, ...products, ...variants];
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.sku)) return false;
    seen.add(row.sku);
    return true;
  });
}

function catalogLineForOrder(orderIndex: number, totalQty: number, catalog: CatalogRow[]): OrderLine {
  const row = catalog[orderIndex % catalog.length];
  const qty = Math.max(1, Math.min(12, totalQty || ((orderIndex % 5) + 1)));
  const lowStockIndexes = new Set([0, 4, 11, 17, 25, 37]);
  const stock = lowStockIndexes.has(orderIndex) ? Math.max(0, qty - 1) : qty + 4 + (orderIndex % 8);
  return {
    sku: row.sku,
    name: row.name,
    qty,
    unit: row.unit.toLowerCase().includes('sleeve') || orderIndex % 3 === 2 ? 'sleeve' : 'carton',
    stock,
    location: locationSequence[orderIndex % locationSequence.length],
    barcode: makeBarcode(row.sku, orderIndex),
    source: row.source === 'order-detail' ? 'order-detail' : 'catalog-sample'
  };
}

function buildOrders(catalog: CatalogRow[], syncPlans: Map<string, SyncPlan>): ImportedOrder[] {
  const detail = ordermentumSnapshot.detailOrder;
  const detailAddress = detail.address.formatted || `${detail.address.street1 || ''} ${detail.address.suburb || ''} SA ${detail.address.postcode || ''}`.trim();
  const detailLines: OrderLine[] = detail.lineItems.map((line, index) => ({
    sku: nonEmpty(line.sku, `DETAIL-${index + 1}`),
    name: nonEmpty(line.productName, line.name),
    qty: Math.max(1, asNumber(line.quantity, 1)),
    unit: 'carton',
    stock: index === 0 ? 0 : 8,
    location: locationSequence[index],
    barcode: makeBarcode(nonEmpty(line.sku, line.id), index),
    source: 'order-detail'
  }));

  const detailPlan = syncPlans.get(detail.id)!;
  const detailOrder = withSync({
    id: detail.id,
    orderNo: detail.orderNumber,
    invoiceNo: detail.invoiceNumber,
    store: detail.retailerName,
    account: detail.retailerName,
    priceTier: 'Tier 1',
    address: detailAddress,
    suburb: detail.address.suburb || suburbFromAddress(detailAddress),
    eta: formatEta(detail.deliveryDate, 0),
    status: 'MAPPING_EXCEPTION',
    paymentStatus: paymentStatusFromOrdermentum(detail.paymentStatus),
    selected: true,
    sequence: 1,
    amount: asNumber(detail.total),
    packageCount: Math.max(1, asNumber(detail.totalQuantity, detailLines.length)),
    podStatus: 'missing',
    mappingNotes: ['Order detail payload loaded with line-level Ordermentum products.', 'Purchaser address available for site master record.'],
    deliveryNote: ordermentumSnapshot.purchaserDetail.deliveryInstructions || undefined,
    dueAt: detail.dueAt,
    deliveryDate: detail.deliveryDate,
    ordermentumUpdatedAt: detail.updatedAt,
    lines: detailLines
  }, detailPlan);

  const recentOrders = ordermentumSnapshot.recentOrders.map((raw, index) => {
    const totalQty = asNumber(raw.totalQuantity, 1);
    const line = catalogLineForOrder(index + 2, totalQty, catalog);
    const status = statusSequence[(index + 1) % statusSequence.length];
    const store = raw.retailerName || 'Unknown retailer';
    const hasDetailedSite = String(store) === String(detail.retailerName);
    const address = hasDetailedSite ? detailAddress : `${store}, Adelaide SA`;
    const mappingNotes = status === 'MAPPING_EXCEPTION'
      ? ['Store profile generated from order summary header.', line.stock < line.qty ? `Stock short: ${line.sku} requested ${line.qty}, available ${line.stock}.` : `SKU mapping check for ${line.sku}.`]
      : [];
    const plan = syncPlans.get(raw.id)!;

    return withSync({
      id: raw.id,
      orderNo: raw.orderNumber,
      invoiceNo: `OMI${raw.orderNumber.replace(/\D/g, '')}`,
      store,
      account: store,
      priceTier: tierForIndex(index),
      address,
      suburb: hasDetailedSite ? detail.address.suburb || 'Mawson Lakes' : 'Adelaide',
      eta: formatEta(raw.deliveryDate, index + 1),
      status,
      paymentStatus: paymentStatusFromOrdermentum(raw.paymentStatus),
      selected: status === 'RELEASE_READY',
      sequence: index + 2,
      amount: asNumber(raw.total),
      packageCount: Math.max(1, Math.ceil(totalQty / 4)),
      podStatus: ['DELIVERED', 'CLOSED'].includes(status) ? 'captured' : 'missing',
      mappingNotes,
      dueAt: raw.dueAt,
      deliveryDate: raw.deliveryDate,
      ordermentumUpdatedAt: raw.updatedAt,
      lines: [line]
    }, plan);
  });

  return [detailOrder, ...recentOrders];
}

function buildStores(orders: ImportedOrder[]): StoreProfile[] {
  const byStore = new Map<string, ImportedOrder[]>();
  orders.forEach((order) => byStore.set(order.store, [...(byStore.get(order.store) || []), order]));

  return Array.from(byStore.entries()).map(([store, rows], index) => ({
    id: store === ordermentumSnapshot.detailOrder.retailerName ? ordermentumSnapshot.detailOrder.retailerId : `generated-${slug(store)}`,
    name: store,
    account: rows[0]?.account || store,
    suburb: rows[0]?.suburb || 'Adelaide',
    priceTier: rows[0]?.priceTier || tierForIndex(index),
    paymentTerms: store === ordermentumSnapshot.detailOrder.retailerName ? 'Ordermentum purchaser detail loaded' : 'Summary profile',
    ordermentumId: store === ordermentumSnapshot.detailOrder.retailerName ? ordermentumSnapshot.detailOrder.purchaserId : `summary-only:${slug(store)}`,
    statementGroup: store,
    status: store === ordermentumSnapshot.detailOrder.retailerName ? 'OK' : 'NEEDS_ADDRESS',
    orderCount: rows.length,
    totalValue: rows.reduce((sum, order) => sum + order.amount, 0)
  }));
}

function buildStock(orders: ImportedOrder[], catalog: CatalogRow[]): StockRow[] {
  const reservedBySku = new Map<string, number>();
  orders.forEach((order) => {
    if (['CLOSED', 'DELIVERED', 'CANCELLED'].includes(order.status)) return;
    order.lines.forEach((line) => reservedBySku.set(line.sku, (reservedBySku.get(line.sku) || 0) + line.qty));
  });

  return catalog.slice(0, 18).map((row, index) => {
    const reserved = reservedBySku.get(row.sku) || (index % 5);
    const onHand = index === 0 ? Math.max(0, reserved - 1) : reserved + 6 + (index % 14);
    return {
      sku: row.sku,
      name: row.name,
      location: locationSequence[index % locationSequence.length],
      onHand,
      reserved,
      reorderPoint: 10 + (index % 4) * 3,
      tierSensitive: Object.keys(row.tierPrices).length > 0,
      source: row.source === 'variant' ? 'ordermentum-variant' : row.source === 'product' ? 'ordermentum-product' : 'order-detail'
    } satisfies StockRow;
  });
}

function buildPriceGroups(): PriceGroupRow[] {
  return ordermentumSnapshot.priceGroups.map((group) => ({
    id: group.id,
    name: group.name,
    default: group.default,
    retailersTotal: group.retailersTotal,
    productsTotal: group.productsTotal
  }));
}

function buildDataQuality(catalog: CatalogRow[], stores: StoreProfile[], priceGroups: PriceGroupRow[]): DataQualityItem[] {
  const detail = ordermentumSnapshot.detailOrder;
  const productsMeta = ordermentumSnapshot.productsMeta;
  const variantsMeta = ordermentumSnapshot.variantsMeta;
  const sampledProducts = ordermentumSnapshot.products.length;
  const sampledVariants = ordermentumSnapshot.variants.length;
  const productTotal = asNumber(productsMeta.totalResults, sampledProducts);
  const variantTotal = asNumber(variantsMeta.totalResults, sampledVariants);

  return [
    {
      severity: 'good',
      area: 'Order headers',
      message: `${ordermentumSnapshot.recentOrders.length} Ordermentum order headers loaded.`,
      detail: 'Order headers support volume, payment status, retailer frequency and daily inbox control.'
    },
    {
      severity: 'good',
      area: 'Order detail',
      message: `${detail.orderNumber} / ${detail.invoiceNumber} loaded with ${detail.lineItems.length} line items.`,
      detail: 'Line-level detail supports SKU mapping, address lock and invoice reconciliation.'
    },
    {
      severity: sampledProducts < productTotal ? 'warn' : 'good',
      area: 'Product catalog',
      message: `${sampledProducts} of ${productTotal} products loaded.`,
      detail: 'Product page coverage controls catalog confidence.'
    },
    {
      severity: sampledVariants < variantTotal ? 'warn' : 'good',
      area: 'Variant catalog',
      message: `${sampledVariants} of ${variantTotal} variants loaded.`,
      detail: 'Variants carry practical sales SKUs and label matching fields.'
    },
    {
      severity: 'good',
      area: 'Price tiers',
      message: `${priceGroups.length} Ordermentum price groups active.`,
      detail: 'Every detected price group is treated as a valid trading tier.'
    },
    {
      severity: 'warn',
      area: 'Store/site master',
      message: `${stores.filter((store) => store.status === 'NEEDS_ADDRESS').length} stores require address confirmation.`,
      detail: 'Summary-only stores remain visible but require site master completion before automatic release.'
    },
    {
      severity: catalog.some((row) => !row.sku) ? 'danger' : 'good',
      area: 'SKU integrity',
      message: catalog.some((row) => !row.sku) ? 'Some catalog rows have missing SKU.' : `${catalog.length} catalog rows have a SKU value.`,
      detail: 'Rows without SKU remain blocked from warehouse release until mapped to a local product code.'
    }
  ];
}

function buildMappingExceptions(orders: ImportedOrder[], stores: StoreProfile[]): MappingException[] {
  const storesByName = new Map(stores.map((store) => [store.name, store]));
  const exceptions: MappingException[] = [];

  orders.forEach((order) => {
    const store = storesByName.get(order.store);
    if (order.status === 'MAPPING_EXCEPTION' && store?.status === 'NEEDS_ADDRESS') {
      exceptions.push({
        id: `${order.id}-site`,
        orderId: order.id,
        orderNo: order.orderNo,
        store: order.store,
        category: 'SITE_MAPPING',
        severity: 'warn',
        summary: 'Store address profile is incomplete',
        detail: `${order.store} is currently using an order-summary profile.`,
        action: 'Open store profile'
      });
    }

    order.lines.forEach((line) => {
      if (line.source !== 'order-detail') {
        exceptions.push({
          id: `${order.id}-${line.sku}-sku`,
          orderId: order.id,
          orderNo: order.orderNo,
          store: order.store,
          category: 'SKU_MAPPING',
          severity: 'warn',
          summary: 'SKU mapping check',
          detail: `${line.sku} · ${line.name}`,
          action: 'Confirm SKU mapping'
        });
      }

      if (line.stock < line.qty) {
        exceptions.push({
          id: `${order.id}-${line.sku}-stock`,
          orderId: order.id,
          orderNo: order.orderNo,
          store: order.store,
          category: 'STOCK_SHORTAGE',
          severity: 'danger',
          summary: 'Stock shortage',
          detail: `${line.sku}: requested ${line.qty}, available ${line.stock}.`,
          action: 'Hold or split order'
        });
      }
    });

    if (order.paymentStatus === 'OVERDUE' || order.paymentStatus === 'CREDIT_HOLD') {
      exceptions.push({
        id: `${order.id}-payment`,
        orderId: order.id,
        orderNo: order.orderNo,
        store: order.store,
        category: 'PAYMENT',
        severity: 'danger',
        summary: 'Payment status requires attention',
        detail: `${order.paymentStatus} · $${order.amount.toFixed(2)}`,
        action: 'Open reconciliation'
      });
    }
  });

  const seen = new Set<string>();
  return exceptions.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function attachExceptionCounts(orders: ImportedOrder[], exceptions: MappingException[]): ImportedOrder[] {
  const counts = exceptions.reduce<Record<string, number>>((acc, exception) => {
    acc[exception.orderId] = (acc[exception.orderId] || 0) + 1;
    return acc;
  }, {});
  return orders.map((order) => ({ ...order, openExceptionCount: counts[order.id] || 0 }));
}

function buildLogs(summary: OrdermentumImportSummary, dataQuality: DataQualityItem[], syncBatch: ReturnType<typeof makeSyncBatch>): Activity[] {
  const openWarnings = dataQuality.filter((item) => item.severity === 'warn' || item.severity === 'danger').length;
  return [
    { at: '08:45', actor: 'Ordermentum', action: 'Sync completed', detail: `${syncBatch.fetched} orders fetched, ${syncBatch.created} new, ${syncBatch.updated} updated, ${syncBatch.unchanged} unchanged.` },
    { at: '08:47', actor: 'EcoFlow OS', action: 'Order history updated', detail: `${summary.recentOrdersCount + 1} Ordermentum orders are retained in the internal order database.` },
    { at: '08:49', actor: 'EcoFlow OS', action: 'Import checks', detail: `${openWarnings} warnings remain in the mapping queue.` },
    { at: '08:52', actor: 'Account', action: 'Price tiers loaded', detail: `${summary.priceGroupCount} Ordermentum price groups are active in store control.` },
    { at: '08:55', actor: 'Warehouse', action: 'Pick readiness', detail: 'Released orders can move from release queue into reservation and pick waves.' }
  ];
}

export function buildEcoFlowData(repository: OrdermentumRepository = activeOrdermentumRepository): EcoFlowDataSet {
  ordermentumSnapshot = repository.getSnapshot();
  const repositoryStatus = repository.getStatus();
  const anchorIso = buildOperationalAnchor();
  const syncPlans = buildSyncPlans(anchorIso);
  const catalog = buildCatalog();
  const preliminaryOrders = buildOrders(catalog, syncPlans);
  const stores = buildStores(preliminaryOrders);
  const preliminaryExceptions = buildMappingExceptions(preliminaryOrders, stores);
  const orders = attachExceptionCounts(preliminaryOrders, preliminaryExceptions);
  const mappingExceptions = buildMappingExceptions(orders, stores);
  const stock = buildStock(orders, catalog);
  const priceGroups = buildPriceGroups();

  const syncBatch = makeSyncBatch({
    completedAt: anchorIso,
    fetched: orders.length,
    created: orders.filter((order) => order.syncStatus === 'NEW').length,
    updated: orders.filter((order) => order.syncStatus === 'UPDATED').length,
    unchanged: orders.filter((order) => order.syncStatus === 'UNCHANGED').length,
    failed: 0
  });

  const summary: OrdermentumImportSummary = {
    recentOrdersCount: ordermentumSnapshot.recentOrders.length,
    detailOrderNo: ordermentumSnapshot.detailOrder.orderNumber,
    detailInvoiceNo: ordermentumSnapshot.detailOrder.invoiceNumber,
    detailRetailerName: ordermentumSnapshot.detailOrder.retailerName,
    detailLineCount: ordermentumSnapshot.detailOrder.lineItems.length,
    invoiceTotal: asNumber(ordermentumSnapshot.invoiceDetail.total),
    invoiceStatus: String(ordermentumSnapshot.detailOrder.paymentStatus || 'Unknown'),
    supplierName: ordermentumSnapshot.invoiceDetail.supplierName || 'EcoFlow Packaging',
    productSampleCount: ordermentumSnapshot.products.length,
    productCatalogTotal: asNumber(ordermentumSnapshot.productsMeta.totalResults, ordermentumSnapshot.products.length),
    variantSampleCount: ordermentumSnapshot.variants.length,
    variantCatalogTotal: asNumber(ordermentumSnapshot.variantsMeta.totalResults, ordermentumSnapshot.variants.length),
    priceGroupCount: ordermentumSnapshot.priceGroups.length,
    stockLocationCount: ordermentumSnapshot.stockLocations.length,
    sourceFiles: [
      'ordermentum-recent-orders.csv',
      'ordermentum-order-detail.json',
      'ordermentum-invoice-detail.json',
      'ordermentum-products-page1.json',
      'ordermentum-variants-page1.json',
      'ordermentum-price-groups.json',
      'ordermentum-purchaser-detail.json',
      'ordermentum-stock-locations.json'
    ]
  };

  const dataQuality = buildDataQuality(catalog, stores, priceGroups);
  const logs = buildLogs(summary, dataQuality, syncBatch);
  const bucketCounts = getOrderBucketCounts(orders, syncBatch.businessDay.date);

  return {
    orders,
    stores,
    stock,
    logs,
    catalog,
    priceGroups,
    dataQuality,
    mappingExceptions,
    syncBatch,
    businessDay: syncBatch.businessDay,
    bucketCounts,
    repositoryStatus,
    summary
  };
}
