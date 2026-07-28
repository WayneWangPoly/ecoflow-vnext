import type { OrdermentumSnapshot } from '@/data/ordermentumTypes';

export type { OrdermentumSnapshot } from '@/data/ordermentumTypes';

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
