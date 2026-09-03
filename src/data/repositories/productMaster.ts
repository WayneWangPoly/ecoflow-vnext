import type { NativeReadListRequest, NativeReadResult } from './nativeReadModel';

export const PRODUCT_MASTER_FILTER_ORDER = [
  'search',
  'product-group',
  'brand',
  'supplier',
  'supplier-product',
  'barcode',
  'obsolete',
  'sellable',
  'purchasable',
] as const;

export const PRODUCT_MASTER_COLUMN_ORDER = [
  'image',
  'product-code',
  'description',
  'product-group',
  'base-pack',
  'allocated',
  'on-hand',
  'base-unit',
  'status-action',
] as const;

export type ProductMasterInventoryAuthority =
  | 'WAYNX_LOCATION_LEDGER'
  | 'UNLEASHED_WAREHOUSE_REFERENCE'
  | 'UNAVAILABLE';

export type ProductMasterRow = {
  productId: string;
  productCode: string;
  description: string;
  productGroup: string | null;
  brand: string | null;
  supplierName: string | null;
  supplierProductCode: string | null;
  basePack: string | null;
  baseUnit: string | null;
  barcode: string | null;
  imagePath: string | null;
  allocated: number | null;
  onHand: number | null;
  inventoryAuthority: ProductMasterInventoryAuthority;
  isObsolete: boolean | null;
  isSellable: boolean | null;
  isPurchasable: boolean | null;
  sourceObservedAt: string | null;
};

export type ProductMasterListRequest = NativeReadListRequest;
export type ProductMasterListResult = NativeReadResult<ProductMasterRow>;

/**
 * #340A Product Master is a Commercial Product read model. It must be composed
 * from governed commercial/catalog facts plus explicit Product Identity and
 * inventory-reference context. It must never treat raw unleashed_* staging JSON
 * as operational truth and must remain separate from /inventory and Physical SKU
 * commissioning authority.
 */
export type ProductMasterReader = {
  readList(request?: ProductMasterListRequest): Promise<ProductMasterListResult>;
};
