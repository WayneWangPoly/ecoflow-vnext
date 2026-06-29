import type { Sku, SkuCategory, SkuUnit } from '@/core/types/database';
import { SEED_NOW } from './seedTime';

export const SKU_IDS = {
  paperStraw6x197: 'sku-jp-pbs-6x197-artbox',
  jumboStraw10mm: 'sku-jp-jumbo-10mm',
  coffeeCup16oz: 'sku-ccspw16-90',
  coffeeCup8oz: 'sku-ccspw8-90'
} as const;

export const SKU_UNIT_IDS = {
  paperStraw6x197Carton: 'unit-jp-pbs-6x197-artbox-carton',
  paperStraw6x197Sleeve: 'unit-jp-pbs-6x197-artbox-sleeve',
  jumboStraw10mmCarton: 'unit-jp-jumbo-10mm-carton',
  jumboStraw10mmSleeve: 'unit-jp-jumbo-10mm-sleeve',
  coffeeCup16ozCarton: 'unit-ccspw16-90-carton',
  coffeeCup16ozSleeve: 'unit-ccspw16-90-sleeve',
  coffeeCup8ozCarton: 'unit-ccspw8-90-carton',
  coffeeCup8ozSleeve: 'unit-ccspw8-90-sleeve'
} as const;

export const seedSkuCategories: SkuCategory[] = [
  { id: 'cat-straws', code: 'Straws', name: 'Straws', sortOrder: 10, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'cat-coffee-cup', code: 'Coffee Cup', name: 'Coffee Cup', sortOrder: 20, createdAt: SEED_NOW, updatedAt: SEED_NOW }
];

export const seedSkus: Sku[] = [
  {
    id: SKU_IDS.paperStraw6x197,
    skuCode: 'JP-PBS-6X197-ARTBOX',
    displayName: 'BioPak 6x197mm Paper Straw Art Series',
    category: 'Straws',
    canSellByCarton: true,
    canSellBySleeve: true,
    sleevesPerCarton: 10,
    defaultStorageUnit: 'carton',
    defaultPickUnit: 'sleeve',
    canMixPack: true,
    setupStatus: 'trial_ready',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: SKU_IDS.jumboStraw10mm,
    skuCode: 'JP-JUMBO-10MM',
    displayName: 'BioPak 10x197mm Jumbo Paper Straw Art Series',
    category: 'Straws',
    canSellByCarton: true,
    canSellBySleeve: true,
    sleevesPerCarton: 25,
    defaultStorageUnit: 'carton',
    defaultPickUnit: 'sleeve',
    canMixPack: true,
    setupStatus: 'needs_location',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: SKU_IDS.coffeeCup16oz,
    skuCode: 'CCSPW16-90',
    displayName: 'ComPak PLA Compostable Single Wall Coffee Cup Plain White 16oz 90mm',
    category: 'Coffee Cup',
    canSellByCarton: true,
    canSellBySleeve: true,
    sleevesPerCarton: 20,
    defaultStorageUnit: 'carton',
    defaultPickUnit: 'sleeve',
    canMixPack: true,
    setupStatus: 'needs_location',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: SKU_IDS.coffeeCup8oz,
    skuCode: 'CCSPW8-90',
    displayName: 'ComPak PLA Compostable Single Wall Coffee Cup Plain White 8oz 90mm',
    category: 'Coffee Cup',
    canSellByCarton: true,
    canSellBySleeve: true,
    sleevesPerCarton: 20,
    defaultStorageUnit: 'carton',
    defaultPickUnit: 'sleeve',
    canMixPack: true,
    setupStatus: 'needs_location',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedSkuUnits: SkuUnit[] = [
  { id: SKU_UNIT_IDS.paperStraw6x197Carton, skuId: SKU_IDS.paperStraw6x197, unitLevel: 'carton', quantityInBaseUnit: 10, isDefaultReceivingUnit: true, isDefaultPickingUnit: false, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.paperStraw6x197Sleeve, skuId: SKU_IDS.paperStraw6x197, unitLevel: 'sleeve', quantityInBaseUnit: 1, isDefaultReceivingUnit: false, isDefaultPickingUnit: true, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.jumboStraw10mmCarton, skuId: SKU_IDS.jumboStraw10mm, unitLevel: 'carton', quantityInBaseUnit: 25, isDefaultReceivingUnit: true, isDefaultPickingUnit: false, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.jumboStraw10mmSleeve, skuId: SKU_IDS.jumboStraw10mm, unitLevel: 'sleeve', quantityInBaseUnit: 1, isDefaultReceivingUnit: false, isDefaultPickingUnit: true, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.coffeeCup16ozCarton, skuId: SKU_IDS.coffeeCup16oz, unitLevel: 'carton', quantityInBaseUnit: 20, isDefaultReceivingUnit: true, isDefaultPickingUnit: false, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.coffeeCup16ozSleeve, skuId: SKU_IDS.coffeeCup16oz, unitLevel: 'sleeve', quantityInBaseUnit: 1, isDefaultReceivingUnit: false, isDefaultPickingUnit: true, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.coffeeCup8ozCarton, skuId: SKU_IDS.coffeeCup8oz, unitLevel: 'carton', quantityInBaseUnit: 20, isDefaultReceivingUnit: true, isDefaultPickingUnit: false, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: SKU_UNIT_IDS.coffeeCup8ozSleeve, skuId: SKU_IDS.coffeeCup8oz, unitLevel: 'sleeve', quantityInBaseUnit: 1, isDefaultReceivingUnit: false, isDefaultPickingUnit: true, createdAt: SEED_NOW, updatedAt: SEED_NOW }
];
