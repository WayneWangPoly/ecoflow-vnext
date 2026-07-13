import { getOrderBucketCounts } from './orderBuckets';
import { makeBusinessDay } from './syncModel';
import type { EcoFlowDataSet } from './types';

/**
 * Production must never inherit sample orders, stock, stores or KPIs when a live
 * read is unavailable. This empty dataset supplies only neutral structural
 * values while the authenticated Supabase snapshot is loading.
 */
export function buildProductionEmptyData(anchorIso = new Date().toISOString()): EcoFlowDataSet {
  const businessDay = makeBusinessDay(anchorIso);
  const syncBatch: EcoFlowDataSet['syncBatch'] = {
    id: `OM-SYNC-PENDING-${businessDay.date.replace(/-/g, '')}`,
    source: 'Ordermentum',
    status: 'FAILED',
    startedAt: anchorIso,
    completedAt: anchorIso,
    businessDay,
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
  };

  return {
    orders: [],
    stores: [],
    stock: [],
    logs: [],
    catalog: [],
    priceGroups: [],
    dataQuality: [],
    mappingExceptions: [],
    syncBatch,
    businessDay,
    bucketCounts: getOrderBucketCounts([], businessDay.date),
    repositoryStatus: {
      mode: 'supabase',
      label: 'Awaiting authenticated live snapshot',
      connected: false,
      loadedAt: anchorIso,
      sourceFiles: [],
      counts: {
        recentOrders: 0,
        products: 0,
        productsTotal: 0,
        variants: 0,
        variantsTotal: 0,
        priceGroups: 0,
        stockLocations: 0,
        detailOrderLines: 0,
      },
    },
    summary: {
      recentOrdersCount: 0,
      detailOrderNo: '',
      detailInvoiceNo: '',
      detailRetailerName: '',
      detailLineCount: 0,
      invoiceTotal: 0,
      invoiceStatus: 'Not loaded',
      supplierName: 'EcoFlow Packaging',
      productSampleCount: 0,
      productCatalogTotal: 0,
      variantSampleCount: 0,
      variantCatalogTotal: 0,
      priceGroupCount: 0,
      stockLocationCount: 0,
      sourceFiles: [],
    },
  };
}
