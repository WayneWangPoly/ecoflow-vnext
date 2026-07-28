import { ordermentumSnapshot } from '@/data/ordermentumSnapshot';
import type { OrdermentumSnapshot } from '@/data/ordermentumTypes';
import type { OrdermentumRepository } from './ordermentumRepository';

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createSampleOrdermentumRepository(
  snapshot: OrdermentumSnapshot = ordermentumSnapshot,
): OrdermentumRepository {
  return {
    getSnapshot: () => snapshot,
    getStatus: () => ({
      mode: 'sample-snapshot',
      label: 'Synthetic Ordermentum data',
      connected: true,
      loadedAt: snapshot.detailOrder.updatedAt || snapshot.recentOrders[0]?.updatedAt || 'current',
      sourceFiles: ['synthetic-ordermentum-fixture'],
      counts: {
        recentOrders: snapshot.recentOrders.length,
        products: snapshot.products.length,
        productsTotal: asNumber(snapshot.productsMeta.totalResults, snapshot.products.length),
        variants: snapshot.variants.length,
        variantsTotal: asNumber(snapshot.variantsMeta.totalResults, snapshot.variants.length),
        priceGroups: snapshot.priceGroups.length,
        stockLocations: snapshot.stockLocations.length,
        detailOrderLines: snapshot.detailOrder.lineItems.length,
      },
    }),
  };
}
