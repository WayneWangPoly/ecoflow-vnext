import {
  applySupabaseOrdermentumViews as applyBaseProjection,
  loadSupabaseOrdermentumViews as loadBaseSnapshot,
  type ResilientOrdermentumViews,
} from './resilientOrdermentumViews';

export * from './resilientOrdermentumViews';

const ACTIVE_EXCEPTION_PATH = '/rest/v1/v_ecoflow_ordermentum_ui_active_exceptions';
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

const PAGED_ACTIVE_SOURCES = [
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_inbox', pageSize: 500, maxRows: 10000 },
  { path: ACTIVE_EXCEPTION_PATH, pageSize: 300, maxRows: 10000 },
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_order_lines', pageSize: 500, maxRows: 50000 },
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_drafts', pageSize: 500, maxRows: 10000 },
  { path: '/rest/v1/v_ecoflow_ordermentum_ui_active_om_orders', pageSize: 500, maxRows: 10000 },
] as const;

type PagedSource = (typeof PAGED_ACTIVE_SOURCES)[number];

let inFlightSnapshot: Promise<ResilientOrdermentumViews | null> | null = null;

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

function pageRequest(input: RequestInfo | URL, source: PagedSource, offset: number): RequestInfo | URL {
  const url = new URL(requestUrl(input));
  url.searchParams.set('limit', String(source.pageSize));
  url.searchParams.set('offset', String(offset));

  if (source.path === ACTIVE_EXCEPTION_PATH) {
    url.searchParams.set('select', ACTIVE_EXCEPTION_COLUMNS);
    url.searchParams.delete('order');
  }

  if (typeof input === 'string') return url.toString();
  if (input instanceof URL) return url;
  return new Request(url.toString(), input);
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

  for (let offset = 0; offset < source.maxRows; offset += source.pageSize) {
    const response = await nativeFetch(pageRequest(input, source, offset), init);

    if (source.path === ACTIVE_EXCEPTION_PATH && await isStatementTimeout(response)) {
      activeExceptionTimedOut = true;
      return { response: jsonResponse([]), activeExceptionTimedOut };
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
    if (page.length < source.pageSize) return { response: jsonResponse(rows), activeExceptionTimedOut };
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
  if (inFlightSnapshot) return inFlightSnapshot;
  inFlightSnapshot = loadTimeoutSafeSnapshot().finally(() => {
    inFlightSnapshot = null;
  });
  return inFlightSnapshot;
}
