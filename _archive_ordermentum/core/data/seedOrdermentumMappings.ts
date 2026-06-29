import type { ExternalCustomerMapping, ExternalProductMapping, ExternalSiteMapping } from '@/core/types/database';
import { SEED_NOW } from './seedTime';
import { SKU_IDS, SKU_UNIT_IDS } from './seedSkus';

// Current rule: Ordermentum SKU = EcoFlow SKU = warehouse SKU.
export const seedExternalProductMappings: ExternalProductMapping[] = [
  { id: 'map-prod-jp-pbs-6x197-artbox', provider: 'ORDERMENTUM', externalProductCode: 'JP-PBS-6X197-ARTBOX', internalSkuId: SKU_IDS.paperStraw6x197, internalSkuUnitId: SKU_UNIT_IDS.paperStraw6x197Sleeve, confidence: 'EXACT', isActive: true, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'map-prod-jp-jumbo-10mm', provider: 'ORDERMENTUM', externalProductCode: 'JP-JUMBO-10MM', internalSkuId: SKU_IDS.jumboStraw10mm, internalSkuUnitId: SKU_UNIT_IDS.jumboStraw10mmSleeve, confidence: 'EXACT', isActive: true, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'map-prod-ccspw16-90', provider: 'ORDERMENTUM', externalProductCode: 'CCSPW16-90', internalSkuId: SKU_IDS.coffeeCup16oz, internalSkuUnitId: SKU_UNIT_IDS.coffeeCup16ozSleeve, confidence: 'EXACT', isActive: true, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'map-prod-ccspw8-90', provider: 'ORDERMENTUM', externalProductCode: 'CCSPW8-90', internalSkuId: SKU_IDS.coffeeCup8oz, internalSkuUnitId: SKU_UNIT_IDS.coffeeCup8ozSleeve, confidence: 'EXACT', isActive: true, createdAt: SEED_NOW, updatedAt: SEED_NOW }
];

export const seedExternalCustomerMappings: ExternalCustomerMapping[] = [
  {
    id: 'map-customer-ordermentum-test',
    provider: 'ORDERMENTUM',
    externalCustomerId: 'OM-CUST-TEST',
    externalCustomerName: 'Ordermentum Test Customer',
    customerId: 'cust-ordermentum-test',
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedExternalSiteMappings: ExternalSiteMapping[] = [
  {
    id: 'map-site-ordermentum-test',
    provider: 'ORDERMENTUM',
    externalSiteId: 'OM-SITE-TEST',
    externalSiteName: 'Ordermentum Test Site',
    customerSiteId: 'site-ordermentum-test',
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];
