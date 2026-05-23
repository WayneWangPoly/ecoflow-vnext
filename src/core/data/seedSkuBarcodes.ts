import type { SkuBarcode } from '@/core/types/database';
import { SEED_NOW } from './seedTime';
import { SKU_IDS, SKU_UNIT_IDS } from './seedSkus';

// barcodeValue is text. Do not convert to number; ComPak barcodes intentionally begin with 0.
// Supplier carton/sleeve barcode identifies SKU + unit level. It is not a unique physical carton ID.
export const seedSkuBarcodes: SkuBarcode[] = [
  {
    id: 'barcode-jp-pbs-6x197-carton',
    skuId: SKU_IDS.paperStraw6x197,
    skuUnitId: SKU_UNIT_IDS.paperStraw6x197Carton,
    barcodeValue: '19344062036170',
    barcodeType: 'carton',
    unitLevel: 'carton',
    quantityInBaseUnit: 10,
    isPrimary: true,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-jp-pbs-6x197-sleeve',
    skuId: SKU_IDS.paperStraw6x197,
    skuUnitId: SKU_UNIT_IDS.paperStraw6x197Sleeve,
    barcodeValue: '9344062033639',
    barcodeType: 'sleeve',
    unitLevel: 'sleeve',
    quantityInBaseUnit: 1,
    isPrimary: false,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-jp-jumbo-10mm-carton',
    skuId: SKU_IDS.jumboStraw10mm,
    skuUnitId: SKU_UNIT_IDS.jumboStraw10mmCarton,
    barcodeValue: '19344062037160',
    barcodeType: 'carton',
    unitLevel: 'carton',
    quantityInBaseUnit: 25,
    isPrimary: true,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-jp-jumbo-10mm-sleeve',
    skuId: SKU_IDS.jumboStraw10mm,
    skuUnitId: SKU_UNIT_IDS.jumboStraw10mmSleeve,
    barcodeValue: '9344062034629',
    barcodeType: 'sleeve',
    unitLevel: 'sleeve',
    quantityInBaseUnit: 1,
    isPrimary: false,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-ccspw16-90-carton',
    skuId: SKU_IDS.coffeeCup16oz,
    skuUnitId: SKU_UNIT_IDS.coffeeCup16ozCarton,
    barcodeValue: '07579531135548',
    barcodeType: 'carton',
    unitLevel: 'carton',
    quantityInBaseUnit: 20,
    isPrimary: true,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-ccspw16-90-sleeve',
    skuId: SKU_IDS.coffeeCup16oz,
    skuUnitId: SKU_UNIT_IDS.coffeeCup16ozSleeve,
    barcodeValue: '07579531136521',
    barcodeType: 'sleeve',
    unitLevel: 'sleeve',
    quantityInBaseUnit: 1,
    isPrimary: false,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-ccspw8-90-carton',
    skuId: SKU_IDS.coffeeCup8oz,
    skuUnitId: SKU_UNIT_IDS.coffeeCup8ozCarton,
    barcodeValue: '07579531135517',
    barcodeType: 'carton',
    unitLevel: 'carton',
    quantityInBaseUnit: 20,
    isPrimary: true,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  },
  {
    id: 'barcode-ccspw8-90-sleeve',
    skuId: SKU_IDS.coffeeCup8oz,
    skuUnitId: SKU_UNIT_IDS.coffeeCup8ozSleeve,
    barcodeValue: '07579531136507',
    barcodeType: 'sleeve',
    unitLevel: 'sleeve',
    quantityInBaseUnit: 1,
    isPrimary: false,
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];
