import { ordermentumSnapshot } from '@/data/ordermentumSnapshot';

export type OrdermentumSnapshot = typeof ordermentumSnapshot;

export type OrdermentumSourceMode = 'sample-snapshot' | 'manual-upload' | 'supabase' | 'live-api';

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

export type OrdermentumRepository = {
  getSnapshot: () => OrdermentumSnapshot;
  getStatus: () => OrdermentumRepositoryStatus;
};

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const sourceFiles = [
  'synthetic-ordermentum-fixture'
];

export function createSampleOrdermentumRepository(snapshot: OrdermentumSnapshot = ordermentumSnapshot): OrdermentumRepository {
  return {
    getSnapshot: () => snapshot,
    getStatus: () => ({
      mode: 'sample-snapshot',
      label: 'Ordermentum data',
      connected: true,
      loadedAt: snapshot.detailOrder.updatedAt || snapshot.recentOrders[0]?.updatedAt || 'current',
      sourceFiles,
      counts: {
        recentOrders: snapshot.recentOrders.length,
        products: snapshot.products.length,
        productsTotal: asNumber(snapshot.productsMeta.totalResults, snapshot.products.length),
        variants: snapshot.variants.length,
        variantsTotal: asNumber(snapshot.variantsMeta.totalResults, snapshot.variants.length),
        priceGroups: snapshot.priceGroups.length,
        stockLocations: snapshot.stockLocations.length,
        detailOrderLines: snapshot.detailOrder.lineItems.length
      }
    })
  };
}

export const activeOrdermentumRepository = createSampleOrdermentumRepository();
