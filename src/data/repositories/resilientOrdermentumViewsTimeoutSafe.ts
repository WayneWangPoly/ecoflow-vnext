import {
  applySupabaseOrdermentumViews as applyBaseProjection,
  loadSupabaseOrdermentumViews as loadBaseSnapshot,
  type ResilientOrdermentumViews,
} from './resilientOrdermentumViews';

export * from './resilientOrdermentumViews';

const ACTIVE_EXCEPTION_PATH = '/rest/v1/v_ecoflow_ordermentum_ui_active_exceptions';
const ACTIVE_ORDER_LINE_PATH = '/rest/v1/v_ecoflow_ordermentum_ui_active_order_lines';
const ACTIVE_EXCEPTION_COLUMNS = [
  'raw_order_id',
  'external_order_id',
  'external_order_number',
  'external_invoice_number',
  'order_number',
  'invoice_number',
  'exception_type',
  'message',
  'status',
  'detected_at',
].join(',');
const ACTIVE_ORDER_LINE_COLUMNS = [
  'source_order_id',
  'order_number',
  'invoice_number',
  'source_line_id',
  'external_sku_code',
  'external_product_name',
  'quantity',
  'unit',
  'uom',
  'packing_unit',
  'price',
  'rate_price',
  'subtotal',
  'gst',
  'tax',
  'total',
  'source',
].join(',');

const PAGED_ACTIVE_SOURCES = [
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_inbox', pageSize: 400, minPageSize: 100, maxRows: 10000 },
  { path: ACTIVE_EXCEPTION_PATH, pageSize: 200, minPageSize: 50, maxRows: 10000 },
  { path: ACTIVE_ORDER_LINE_PATH, pageSize: 250, minPageSize: 50, maxRows: 50000 },
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_drafts', pageSize: 300, minPageSize: 100, maxRows: 10000 },
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_om_orders', pageSize: 300, minPageSize: 100, maxRows: 10000 },
] as const;

const SNAPSHOT_CACHE_MS = 12_000;
const NETWORK_RETRY_DELAYS_MS = [250, 700] as const;

type PagedSource = (typeof PAGED_ACTIVE_SOURCES)[number];
type CachedSnapshot = { snapshot: ResilientOrdermentumViews | null; loadedAt: number };

let inFlightSnapshot: Promise<ResilientOrdermentumViews | null> | null = null;
let cachedSnapshot: CachedSnapshot | null = null;

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function pagedSourceFor(input: RequestInfo | URL): PagedSource | null {
  const url = requestUrl(input);
  return PAGED_ACTIVE_SOURCES.find((source) => url.includes(source.path)) ?? null;
}

function pageRequest(input: RequestInfo | URL, source: PagedSource, offset: number, pageSize: number): RequestInfo | URL {
  const url = new URL(requestUrl(input));
  url.searchParams.set('limit', String(pageSize));
  url.searchParams.set('offset', String(offset));

  if (source.path === ACTIVE_EXCEPTION_PATH) {
    url.searchParams.set('select', ACTIVE_EXCEPTION_COLUMNS);
    url.searchParams.delete('order');
  }

  if (source.path === ACTIVE_ORDER_LINE_PATH) {
    url.searchParams.set('select', ACTIVE_ORDER_LINE_COLUMNS);
  }

  if (typeof input === 'string') return url.toString();
  if (input instanceof URL) return url;
  return new Request(url.toString(), input);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchWithNetworkRetry(
  nativeFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await nativeFetch(input, init);
      if (response.status < 500 || attempt === NETWORK_RETRY_DELAYS_MS.length) return response;
      await wait(NETWORK_RETRY_DELAYS_MS[attempt]);
    } catch (error) {
      lastError = error;
      if (attempt === NETWORK_RETRY_DELAYS_MS.length) throw error;
      await wait(NETWORK_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operational snapshot request failed.');
}

async function responseText(response: Response) {
  try {
    return await response.clone().text();
  } catch {
    return '';
  }
}

async function isStatementTimeout(response: Response) {
  if (response.ok) return false;
  const normalized = (await responseText(response)).toLowerCase();
  return normalized.includes('57014') || normalized.includes('statement timeout');
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function fetchPagedSource(
  nativeFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  source: PagedSource,
): Promise<{ response: Response; activeExceptionTimedOut: boolean }> {
  const rows: unknown[] = [];
  let activeExceptionTimedOut = false;
  let offset = 0;
  let pageSize: number = source.pageSize;

  while (offset < source.maxRows) {
    const response = await fetchWithNetworkRetry(nativeFetch, pageRequest(input, source, offset, pageSize), init);

    if (await isStatementTimeout(response)) {
      if (pageSize > source.minPageSize) {
        pageSize = Math.max(source.minPageSize, Math.floor(pageSize / 2));
        continue;
      }

      if (source.path === ACTIVE_EXCEPTION_PATH) {
        activeExceptionTimedOut = true;
        return { response: jsonResponse([]), activeExceptionTimedOut };
      }

      return { response, activeExceptionTimedOut };
    }

    if (!response.ok) return { response, activeExceptionTimedOut };

    let page: unknown;
    try {
      page = await response.json();
    } catch {
      return {
        response: jsonResponse({
          message: `${source.path} returned a non-JSON response while paging current operational data.`,
        }, 502),
        activeExceptionTimedOut,
      };
    }

    if (!Array.isArray(page)) {
      return {
        response: jsonResponse({ message: `${source.path} did not return a row array.` }, 502),
        activeExceptionTimedOut,
      };
    }

    rows.push(...page);
    offset += page.length;
    if (page.length < pageSize) return { response: jsonResponse(rows), activeExceptionTimedOut };
  }

  return {
    response: jsonResponse({
      message: `${source.path} reached the current-operation safety ceiling of ${source.maxRows} rows. The snapshot was rejected rather than truncated.`,
    }, 409),
    activeExceptionTimedOut,
  };
}

async function loadTimeoutSafeSnapshot(): Promise<ResilientOrdermentumViews | null> {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let activeExceptionTimedOut = false;

  const guardedFetch: typeof fetch = async (input, init) => {
    const source = pagedSourceFor(input);
    if (!source) return nativeFetch(input, init);

    const result = await fetchPagedSource(nativeFetch, input, init, source);
    activeExceptionTimedOut ||= result.activeExceptionTimedOut;
    return result.response;
  };

  globalThis.fetch = guardedFetch;
  try {
    const snapshot = await loadBaseSnapshot();
    if (!snapshot || !activeExceptionTimedOut) return snapshot;

    return {
      ...snapshot,
      diagnostics: snapshot.diagnostics.map((diagnostic) => diagnostic.source === 'active exceptions'
        ? {
            source: diagnostic.source,
            required: false,
            status: 'DEGRADED' as const,
            rowCount: 0,
            error: 'The active exception detail query exceeded the database time limit. Release-gate blockers remain available from the active order and draft sources.',
          }
        : diagnostic),
    };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

export function applySupabaseOrdermentumViews(
  ...args: Parameters<typeof applyBaseProjection>
): ReturnType<typeof applyBaseProjection> {
  const projected = applyBaseProjection(...args);
  const currentLoaded = projected.orders.length;
  return {
    ...projected,
    syncBatch: {
      ...projected.syncBatch,
      fetched: currentLoaded,
    },
  };
}

export function loadSupabaseOrdermentumViews(): Promise<ResilientOrdermentumViews | null> {
  const now = Date.now();
  if (cachedSnapshot && now - cachedSnapshot.loadedAt < SNAPSHOT_CACHE_MS) {
    return Promise.resolve(cachedSnapshot.snapshot);
  }
  if (inFlightSnapshot) return inFlightSnapshot;

  inFlightSnapshot = loadTimeoutSafeSnapshot()
    .then((snapshot) => {
      cachedSnapshot = { snapshot, loadedAt: Date.now() };
      return snapshot;
    })
    .finally(() => {
      inFlightSnapshot = null;
    });
  return inFlightSnapshot;
}
