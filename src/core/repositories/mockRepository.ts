import { seedCustomerSites, seedCustomers } from '@/core/data/seedCustomers';
import { seedLocations } from '@/core/data/seedLocations';
import { seedSkuBarcodes } from '@/core/data/seedSkuBarcodes';
import { seedSkus } from '@/core/data/seedSkus';
import {
  seedDeliveryRuns,
  seedDeliveryStops,
  seedImportExceptions,
  seedInventoryBalances,
  seedOrderImportBatches,
  seedOrderLines,
  seedOrders,
  seedPickTasks,
  seedPickWaves
} from '@/core/data/seedOperational';

export const mockRepository = {
  customers: seedCustomers,
  customerSites: seedCustomerSites,
  skus: seedSkus,
  skuBarcodes: seedSkuBarcodes,
  locations: seedLocations,
  importBatches: seedOrderImportBatches,
  importExceptions: seedImportExceptions,
  orders: seedOrders,
  orderLines: seedOrderLines,
  inventoryBalances: seedInventoryBalances,
  pickWaves: seedPickWaves,
  pickTasks: seedPickTasks,
  deliveryRuns: seedDeliveryRuns,
  deliveryStops: seedDeliveryStops
};
