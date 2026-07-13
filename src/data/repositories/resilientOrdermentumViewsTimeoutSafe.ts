import {
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

let inFlightSnapshot: Promise<ResilientOrdermentumViews | null> | null = null;

function isActiveExceptionRequest(input: RequestInfo | URL) {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  return url.includes(ACTIVE_EXCEPTION_PATH);
}

function lighterActiveExceptionRequest(input: RequestInfo | URL): RequestInfo | URL {
  if (!isActiveExceptionRequest(input)) return input;
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const url = new URL(rawUrl);
  url.searchParams.set('select', ACTIVE_EXCEPTION_COLUMNS);
  url.searchParams.delete('order');
  url.searchParams.set('limit', '300');

  if (typeof input === 'string') return url.toString();
  if (input instanceof URL) return url;
  return new Request(url.toString(), input);
}

async function isStatementTimeout(response: Response) {
  if (response.ok) return false;
  const body = await response.clone().text();
  const normalized = body.toLowerCase();
  return normalized.includes('57014') || normalized.includes('statement timeout');
}

async function loadTimeoutSafeSnapshot(): Promise<ResilientOrdermentumViews | null> {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let activeExceptionTimedOut = false;

  const guardedFetch: typeof fetch = async (input, init) => {
    const activeExceptionRequest = isActiveExceptionRequest(input);
    const response = await nativeFetch(lighterActiveExceptionRequest(input), init);

    if (activeExceptionRequest && await isStatementTimeout(response)) {
      activeExceptionTimedOut = true;
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return response;
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

export function loadSupabaseOrdermentumViews(): Promise<ResilientOrdermentumViews | null> {
  if (inFlightSnapshot) return inFlightSnapshot;
  inFlightSnapshot = loadTimeoutSafeSnapshot().finally(() => {
    inFlightSnapshot = null;
  });
  return inFlightSnapshot;
}
