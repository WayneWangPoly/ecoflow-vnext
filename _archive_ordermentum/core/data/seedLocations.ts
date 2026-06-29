import type { Location, LocationBarcode } from '@/core/types/database';
import { SEED_NOW } from './seedTime';
import { SKU_IDS } from './seedSkus';

export const LOCATION_IDS = {
  staging: 'loc-staging',
  dispatch: 'loc-dispatch',
  a10102a: 'loc-a1-01-02a'
} as const;

export const seedLocations: Location[] = [
  {
    id: LOCATION_IDS.staging,
    warehouseId: 'wh-main',
    locationCode: 'STAGING',
    zone: 'INBOUND',
    barcodeValue: 'LOC-STAGING',
    locationType: 'staging',
    sortOrder: 10,
    isPickable: false,
    isStaging: true,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: LOCATION_IDS.a10102a,
    warehouseId: 'wh-main',
    locationCode: 'A1-01-02A',
    zone: 'A1',
    bay: '01',
    level: '02',
    side: 'A',
    barcodeValue: 'LOC-A1-01-02A',
    locationType: 'rack',
    sortOrder: 10102,
    isPickable: true,
    isStaging: false,
    isActive: true,
    assignedSkuId: SKU_IDS.paperStraw6x197,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: LOCATION_IDS.dispatch,
    warehouseId: 'wh-main',
    locationCode: 'DISPATCH',
    zone: 'DISPATCH',
    barcodeValue: 'LOC-DISPATCH',
    locationType: 'dispatch',
    sortOrder: 90000,
    isPickable: false,
    isStaging: false,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedLocationBarcodes: LocationBarcode[] = seedLocations.map((location) => ({
  id: `loc-barcode-${location.id}`,
  locationId: location.id,
  barcodeValue: location.barcodeValue,
  isActive: true,
  createdAt: SEED_NOW,
  updatedAt: SEED_NOW
}));
