import type { CatalogRow } from '@/domain/types';
import type { ProductIdentityRow } from './productIdentity';
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
  identity: ProductMasterIdentitySummary | null;
};

export type ProductMasterListRequest = NativeReadListRequest;
export type ProductMasterListResult = NativeReadResult<ProductMasterRow> & {
  totalCount: number;
  page: number;
  pageSize: number;
};

export type ProductMasterIdentitySummary = {
  commercialSkuId: string;
  ordermentumSku: string | null;
  identityStatus: ProductIdentityRow['identityStatus'];
  taskStatus: ProductIdentityRow['taskStatus'];
  familyCode: string | null;
  familyName: string | null;
  preferredPhysicalCode: string | null;
  preferredPhysicalName: string | null;
  brand: string | null;
  substitutionPolicy: ProductIdentityRow['substitutionPolicy'];
  publishedBarcodeCount: number;
};

export type ProductMasterIdentityEvidence = {
  summary: ProductMasterIdentitySummary | null;
  barcodes: Array<{
    barcode: string;
    physicalSkuCode: string | null;
    packageLevel: string | null;
    unitsInBaseUnit: number | null;
  }>;
  readAt: string | null;
  state: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  issues: string[];
};

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

type FilterMap = Map<string, string[]>;

const SOURCE_PRIORITY: Readonly<Record<CatalogRow['source'], number>> = {
  product: 0,
  variant: 1,
  'order-detail': 2,
};

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function filterMap(filters?: readonly string[]): FilterMap {
  const result = new Map<string, string[]>();
  for (const raw of filters ?? []) {
    const separator = raw.indexOf(':');
    if (separator <= 0) continue;
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    if (!key || !value) continue;
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function matchesNullableText(value: string | null, accepted?: string[]) {
  if (!accepted?.length) return true;
  const normalized = clean(value).toLowerCase();
  return accepted.some((candidate) => normalized === clean(candidate).toLowerCase());
}

function matchesBoolean(value: boolean | null, accepted?: string[]) {
  if (!accepted?.length) return true;
  return accepted.some((candidate) => {
    const normalized = clean(candidate).toLowerCase();
    if (normalized === 'all') return true;
    if (value === null) return normalized === 'unknown';
    return normalized === String(value);
  });
}

export function toProductMasterIdentitySummary(row: ProductIdentityRow): ProductMasterIdentitySummary {
  return {
    commercialSkuId: row.commercialSkuId,
    ordermentumSku: row.ordermentumSku,
    identityStatus: row.identityStatus,
    taskStatus: row.taskStatus,
    familyCode: row.familyCode,
    familyName: row.familyName,
    preferredPhysicalCode: row.preferredPhysicalCode,
    preferredPhysicalName: row.preferredPhysicalName,
    brand: row.brand,
    substitutionPolicy: row.substitutionPolicy,
    publishedBarcodeCount: row.publishedBarcodeCount,
  };
}

function identityIndex(rows: readonly ProductIdentityRow[]) {
  const index = new Map<string, ProductMasterIdentitySummary>();
  for (const row of rows) {
    const summary = toProductMasterIdentitySummary(row);
    for (const key of [row.commercialSkuCode, row.ordermentumSku]) {
      const normalized = clean(key).toUpperCase();
      if (normalized) index.set(normalized, summary);
    }
  }
  return index;
}

function catalogToRows(
  catalog: readonly CatalogRow[],
  sourceObservedAt: string | null,
  identityRows: readonly ProductIdentityRow[],
): ProductMasterRow[] {
  const bySku = new Map<string, CatalogRow>();
  const identities = identityIndex(identityRows);
  for (const candidate of catalog) {
    const sku = clean(candidate.sku);
    if (!sku) continue;
    const key = sku.toUpperCase();
    const current = bySku.get(key);
    if (!current || SOURCE_PRIORITY[candidate.source] < SOURCE_PRIORITY[current.source]) bySku.set(key, candidate);
  }

  return [...bySku.values()]
    .map((row): ProductMasterRow => {
      const identity = identities.get(clean(row.sku).toUpperCase()) ?? null;
      return {
        // Commercial SKU is the durable route identity for this read-only surface.
        // It deliberately does not claim to be a Physical SKU id.
        productId: clean(row.sku),
        productCode: clean(row.sku),
        description: clean(row.name) || clean(row.sku),
        productGroup: clean(row.category) || null,
        brand: identity?.brand ?? null,
        supplierName: null,
        supplierProductCode: null,
        basePack: null,
        baseUnit: clean(row.unit) || null,
        barcode: null,
        imagePath: null,
        allocated: null,
        onHand: null,
        inventoryAuthority: 'UNAVAILABLE',
        isObsolete: null,
        // The governed commercial SKU projection used by #340A does not expose a
        // sellability flag. Do not reinterpret a catalog visibility placeholder.
        isSellable: null,
        isPurchasable: null,
        sourceObservedAt,
        identity,
      };
    })
    .sort((left, right) => left.productCode.localeCompare(right.productCode, 'en-AU', { numeric: true }));
}

function applyRequest(rows: ProductMasterRow[], request: ProductMasterListRequest) {
  const filters = filterMap(request.filters);
  const search = clean(request.search).toLowerCase();
  let next = rows.filter((row) => {
    if (search && ![row.productCode, row.description, row.productGroup].some((value) => clean(value).toLowerCase().includes(search))) return false;
    if (!matchesNullableText(row.productGroup, filters.get('product-group'))) return false;
    if (!matchesNullableText(row.brand, filters.get('brand'))) return false;
    if (!matchesNullableText(row.supplierName, filters.get('supplier'))) return false;
    if (!matchesNullableText(row.supplierProductCode, filters.get('supplier-product'))) return false;
    if (!matchesNullableText(row.barcode, filters.get('barcode'))) return false;
    if (!matchesBoolean(row.isObsolete, filters.get('obsolete'))) return false;
    if (!matchesBoolean(row.isSellable, filters.get('sellable'))) return false;
    if (!matchesBoolean(row.isPurchasable, filters.get('purchasable'))) return false;
    return true;
  });

  const sort = clean(request.sort);
  if (sort === 'description') next = [...next].sort((a, b) => a.description.localeCompare(b.description));
  else if (sort === 'product-group') next = [...next].sort((a, b) => clean(a.productGroup).localeCompare(clean(b.productGroup)) || a.productCode.localeCompare(b.productCode));
  else if (sort === 'product-code-desc') next = [...next].sort((a, b) => b.productCode.localeCompare(a.productCode, 'en-AU', { numeric: true }));

  const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 50));
  const totalCount = next.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(totalPages, Math.max(1, request.page ?? 1));
  const offset = (page - 1) * pageSize;
  return { rows: next.slice(offset, offset + pageSize), totalCount, page, pageSize };
}

export function createProductMasterReader(input: {
  catalog: readonly CatalogRow[];
  sourceObservedAt?: string | null;
  identityRows?: readonly ProductIdentityRow[];
}): ProductMasterReader {
  const sourceObservedAt = input.sourceObservedAt ?? null;
  const sourceRows = catalogToRows(input.catalog, sourceObservedAt, input.identityRows ?? []);

  return {
    async readList(request = {}) {
      const page = applyRequest(sourceRows, request);
      const readAt = new Date().toISOString();
      return {
        state: sourceRows.length ? 'DEGRADED' : 'EMPTY',
        rows: page.rows,
        totalCount: page.totalCount,
        page: page.page,
        pageSize: page.pageSize,
        metadata: {
          source: 'governed Ordermentum commercial catalog projection',
          authority: 'ORDERMENTUM_COMMERCIAL',
          isAuthoritative: true,
          freshness: sourceObservedAt ? 'CURRENT' : 'UNKNOWN',
          readAt,
          sourceObservedAt,
        },
        issues: sourceRows.length ? [
          'Allocated and on-hand quantities are intentionally unavailable until an approved WAYNX location-ledger read model is joined.',
          'Supplier, barcode and sellability fields are not inferred from the commercial catalog projection.',
          'Product Master remains separate from Inventory and Physical SKU commissioning authority.',
        ] : [],
      };
    },
  };
}
