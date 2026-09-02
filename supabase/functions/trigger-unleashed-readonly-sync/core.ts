const MAX_FETCH_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 2_000;
const UNLEASHED_API_ORIGIN = 'https://api.unleashedsoftware.com';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9 ._\-/#]{0,99}$/;
const pageNumberPattern = /^[1-9]\d*$/;

const UNLEASHED_ENDPOINTS = new Set([
  'Products',
  'Customers',
  'CustomerDeliveryAddresses',
  'Suppliers',
  'Warehouses',
  'StockOnHand',
  'SalesOrders',
  'PurchaseOrders',
  'Invoices',
  'CreditNotes',
  'SalesShipments',
  'SupplierReturns',
  'StockAdjustments',
  'WarehouseStockTransfers',
  'StockCounts',
  'SalesQuotes',
  'Salespersons',
  'ProductGroups',
  'ProductBrands',
  'SellPriceTiers',
]);

type TargetField = 'guid' | 'productCode' | 'productId' | 'warehouseCode' | 'orderNumber';

export type TargetableResource = 'products' | 'stock_on_hand' | 'sales_orders_open' | 'purchase_orders_open';

export type NormalizedTarget = {
  resource: TargetableResource;
  pathIdentifier: string | null;
  query: Record<string, string>;
  exactMatches: Array<{ keys: string[]; value: string }>;
  audit: Record<string, string>;
};

export type PayloadHashRow = {
  external_key: string;
  payload_sha256: string;
};

export type SourceIdentity = {
  externalKey: string;
  guid: string | null;
  externalCode: string | null;
  externalNumber: string | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readString(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function sourceIdentityForItem(resource: string, item: Record<string, unknown>, payloadSha256: string): SourceIdentity {
  const guid = resource === 'stock_on_hand'
    ? readString(item, ['ProductGuid', 'Guid', 'guid'])
    : readString(item, ['Guid', 'guid', 'ProductGuid', 'CustomerGuid', 'SupplierGuid', 'WarehouseId']);
  const externalCode = readString(item, [
    'ProductCode',
    'CustomerCode',
    'SupplierCode',
    'WarehouseCode',
    'SalespersonCode',
    'GroupName',
    'BrandName',
  ]);
  const externalNumber = readString(item, [
    'OrderNumber',
    'PurchaseOrderNumber',
    'InvoiceNumber',
    'CreditNoteNumber',
    'ShipmentNumber',
    'SupplierReturnNumber',
    'StockAdjustmentNumber',
    'TransferOrderNumber',
    'QuoteNumber',
    'StockCountNumber',
  ]);

  if (resource === 'stock_on_hand' && guid && uuidPattern.test(guid)) {
    const warehouseIdentity = readString(item, ['WarehouseId', 'WarehouseCode']) ?? 'all';
    return {
      externalKey: `product:${guid.toLowerCase()}:warehouse:${warehouseIdentity.toLowerCase()}`,
      guid,
      externalCode,
      externalNumber,
    };
  }

  const externalKey = guid && uuidPattern.test(guid)
    ? `guid:${guid.toLowerCase()}`
    : externalCode
      ? `code:${externalCode}`
      : externalNumber
        ? `number:${externalNumber}`
        : `hash:${payloadSha256}`;
  return { externalKey, guid, externalCode, externalNumber };
}

function normalizeTargetIdentifier(field: TargetField, value: unknown) {
  if (typeof value !== 'string') throw new Error(`INVALID_TARGET_${field.toUpperCase()}`);
  const trimmed = value.trim();
  if (field === 'guid' || field === 'productId') {
    if (!uuidPattern.test(trimmed)) throw new Error(`INVALID_TARGET_${field.toUpperCase()}`);
    return trimmed.toLowerCase();
  }
  if (!identifierPattern.test(trimmed)) throw new Error(`INVALID_TARGET_${field.toUpperCase()}`);
  return trimmed;
}

export function normalizeTarget(resources: string[], value: unknown): NormalizedTarget | null {
  if (value === undefined || value === null) return null;
  if (resources.length !== 1) throw new Error('TARGET_REQUIRES_ONE_RESOURCE');
  if (!isRecord(value)) throw new Error('INVALID_TARGET');

  const allowedFields = new Set<TargetField>(['guid', 'productCode', 'productId', 'warehouseCode', 'orderNumber']);
  const suppliedFields = Object.keys(value);
  if (!suppliedFields.length || suppliedFields.some((field) => !allowedFields.has(field as TargetField))) {
    throw new Error('INVALID_TARGET_FIELDS');
  }

  const resource = resources[0];
  if (resource === 'products') {
    const hasGuid = value.guid !== undefined;
    const hasCode = value.productCode !== undefined;
    if (hasGuid === hasCode || suppliedFields.length !== 1) throw new Error('PRODUCT_TARGET_REQUIRES_GUID_OR_CODE');
    if (hasGuid) {
      const guid = normalizeTargetIdentifier('guid', value.guid);
      return {
        resource,
        pathIdentifier: null,
        query: { productId: guid },
        exactMatches: [{ keys: ['Guid', 'guid', 'ProductGuid'], value: guid }],
        audit: { guid },
      };
    }
    const productCode = normalizeTargetIdentifier('productCode', value.productCode);
    return {
      resource,
      pathIdentifier: null,
      query: { productCode },
      exactMatches: [{ keys: ['ProductCode'], value: productCode }],
      audit: { productCode },
    };
  }

  if (resource === 'stock_on_hand') {
    if (!suppliedFields.includes('productId') || suppliedFields.some((field) => !['productId', 'warehouseCode'].includes(field))) {
      throw new Error('STOCK_TARGET_REQUIRES_PRODUCT_ID');
    }
    const productId = normalizeTargetIdentifier('productId', value.productId);
    const warehouseCode = value.warehouseCode === undefined
      ? null
      : normalizeTargetIdentifier('warehouseCode', value.warehouseCode);
    return {
      resource,
      pathIdentifier: null,
      query: warehouseCode ? { productId, warehouseCode } : { productId },
      exactMatches: [
        { keys: ['ProductGuid', 'ProductId', 'Guid'], value: productId },
        ...(warehouseCode ? [{ keys: ['WarehouseCode'], value: warehouseCode }] : []),
      ],
      audit: warehouseCode ? { productId, warehouseCode } : { productId },
    };
  }

  if (resource === 'sales_orders_open' || resource === 'purchase_orders_open') {
    const hasGuid = value.guid !== undefined;
    const hasNumber = value.orderNumber !== undefined;
    if (hasGuid === hasNumber || suppliedFields.length !== 1) throw new Error('ORDER_TARGET_REQUIRES_GUID_OR_NUMBER');
    if (hasGuid) {
      const guid = normalizeTargetIdentifier('guid', value.guid);
      return {
        resource,
        pathIdentifier: guid,
        query: {},
        exactMatches: [{ keys: ['Guid', 'guid'], value: guid }],
        audit: { guid },
      };
    }
    const orderNumber = normalizeTargetIdentifier('orderNumber', value.orderNumber);
    return {
      resource,
      pathIdentifier: null,
      query: { orderNumber },
      exactMatches: [{ keys: ['OrderNumber', 'PurchaseOrderNumber'], value: orderNumber }],
      audit: { orderNumber },
    };
  }

  throw new Error(`TARGET_NOT_SUPPORTED_FOR_RESOURCE:${resource}`);
}

export function serializeUnleashedQuery(search: URLSearchParams) {
  // Unleashed documents multi-value filters with literal commas and validates
  // the HMAC against that query-string representation. URLSearchParams encodes
  // commas as %2C, which produces a different signature for those requests.
  return search.toString().replaceAll('%2C', ',');
}

function valuesMatch(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

export function selectTargetItems(items: Record<string, unknown>[], target: NormalizedTarget | null) {
  if (!target) return items;
  const matches = items.filter((item) => target.exactMatches.every((match) => {
    const value = readString(item, match.keys);
    return value !== null && valuesMatch(value, match.value);
  }));
  if (!matches.length) throw new Error('UNLEASHED_TARGET_NOT_FOUND');
  if (matches.length > 1) throw new Error('UNLEASHED_TARGET_AMBIGUOUS');
  return matches;
}

export function classifyPayloadRows<T extends PayloadHashRow>(existing: PayloadHashRow[], rows: T[]) {
  const hashes = new Map(existing.map((row) => [row.external_key, row.payload_sha256]));
  const inserted: T[] = [];
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const row of rows) {
    const existingHash = hashes.get(row.external_key);
    if (existingHash === undefined) inserted.push(row);
    else if (existingHash === row.payload_sha256) unchanged.push(row);
    else changed.push(row);
  }
  return { inserted, changed, unchanged };
}

function retryDelayMs(response: Response | null, attempt: number) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS);
}

export function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isRedirectStatus(status: number) {
  return status >= 300 && status <= 399;
}

export function assertUnleashedCredentialUrl(url: URL) {
  if (url.origin !== UNLEASHED_API_ORIGIN || url.username || url.password) {
    throw new Error('UNLEASHED_API_ORIGIN_NOT_ALLOWED');
  }
  if (url.hash) throw new Error('UNLEASHED_API_FRAGMENT_NOT_ALLOWED');

  const pathSegments = url.pathname.split('/').filter(Boolean);
  if (!pathSegments.length || pathSegments.length > 2 || !UNLEASHED_ENDPOINTS.has(pathSegments[0])) {
    throw new Error('UNLEASHED_API_PATH_NOT_ALLOWED');
  }
  if (
    pathSegments.length === 2
    && !pageNumberPattern.test(pathSegments[1])
    && !uuidPattern.test(pathSegments[1])
  ) {
    throw new Error('UNLEASHED_API_PATH_NOT_ALLOWED');
  }
}

type RetryDependencies = {
  fetcher?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

export async function fetchUnleashedWithRetry(url: URL, headers: HeadersInit, dependencies: RetryDependencies = {}) {
  assertUnleashedCredentialUrl(url);
  const fetcher = dependencies.fetcher ?? fetch;
  const sleep = dependencies.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher(url.toString(), { method: 'GET', headers, redirect: 'manual' });
      if (isRedirectStatus(response.status)) {
        await response.body?.cancel();
        throw new Error('UNLEASHED_API_REDIRECT_BLOCKED');
      }
      if (!isRetryableStatus(response.status) || attempt === MAX_FETCH_ATTEMPTS) {
        return { response, attempts: attempt };
      }
      await response.body?.cancel();
      await sleep(retryDelayMs(response, attempt));
    } catch (error) {
      if (error instanceof Error && error.message === 'UNLEASHED_API_REDIRECT_BLOCKED') throw error;
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS) break;
      await sleep(retryDelayMs(null, attempt));
    }
  }
  const detail = lastError instanceof Error ? lastError.message.slice(0, 300) : 'network failure';
  throw new Error(`UNLEASHED_API_RETRY_EXHAUSTED:${detail}`);
}


export type PaginationWindowSummary = {
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
  highWatermark: string | null;
};

export function summarizePaginationWindow(input: {
  paginated: boolean;
  startPage: number;
  lastPageRead: number | null;
  numberOfPages: number | null;
  terminalShortPage: boolean;
  failed: boolean;
  highWatermark: string | null;
}): PaginationWindowSummary {
  const windowComplete = !input.failed && (
    !input.paginated
    || (input.lastPageRead !== null && (
      (input.numberOfPages !== null && input.lastPageRead >= input.numberOfPages)
      || input.terminalShortPage
    ))
  );
  return {
    startPage: input.paginated ? input.startPage : 1,
    lastPage: input.lastPageRead,
    numberOfPages: input.numberOfPages,
    windowComplete,
    nextPage: windowComplete || input.failed || input.lastPageRead === null ? null : input.lastPageRead + 1,
    highWatermark: input.highWatermark,
  };
}
