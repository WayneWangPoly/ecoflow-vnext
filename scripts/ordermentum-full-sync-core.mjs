import {
  assertNoCredentialedOrdermentumRedirect,
  assertOrdermentumApiBaseUrl,
  assertOrdermentumApiKeyRequestShape,
  assertOrdermentumApiRequestUrl,
  redactOrdermentumSecret,
} from './ordermentum-api-origin-guard.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function env(name, required = false, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if ((value === undefined || value === '') && required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function config() {
  const skipSupabase = env('ORDERMENTUM_SKIP_SUPABASE', false, 'false') === 'true';
  const supabaseUrl = env('SUPABASE_URL', !skipSupabase, '').replace(/\/$/, '');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY', !skipSupabase, '');
  const configuredBaseUrl = env('ORDERMENTUM_BASE_URL', false, 'https://api.ordermentum.com').replace(/\/$/, '');
  const authMode = env('ORDERMENTUM_AUTH_MODE', false, 'api-key');
  const baseUrl = authMode === 'api-key' ? assertOrdermentumApiBaseUrl(configuredBaseUrl) : configuredBaseUrl;

  return {
    supabaseUrl,
    serviceRoleKey,
    baseUrl,
    authMode,
    apiKey: env('ORDERMENTUM_API_KEY'),
    bearerToken: env('ORDERMENTUM_BEARER_TOKEN'),
    username: env('ORDERMENTUM_USERNAME'),
    password: env('ORDERMENTUM_PASSWORD'),
    searchMethod: env('ORDERMENTUM_SEARCH_METHOD', false, 'GET').toUpperCase(),
    searchUrl: env('ORDERMENTUM_SEARCH_URL'),
    searchBodyTemplate: env('ORDERMENTUM_SEARCH_BODY_TEMPLATE'),
    fromParam: env('ORDERMENTUM_FROM_PARAM', false, 'updatedAt[gte]'),
    toParam: env('ORDERMENTUM_TO_PARAM', false, 'updatedAt[lte]'),
    pageParam: env('ORDERMENTUM_PAGE_PARAM', false, 'pageNo'),
    limitParam: env('ORDERMENTUM_LIMIT_PARAM', false, 'pageSize'),
    supplierId: env('ORDERMENTUM_SUPPLIER_ID'),
    extraQuery: env('ORDERMENTUM_EXTRA_QUERY'),
    orderDetailUrlTemplate: env('ORDERMENTUM_ORDER_DETAIL_URL_TEMPLATE'),
    invoiceDetailUrlTemplate: env('ORDERMENTUM_INVOICE_DETAIL_URL_TEMPLATE'),
    minDelayMs: Number(env('ORDERMENTUM_MIN_DELAY_MS', false, '1500')),
    supabaseTimeoutMs: Number(env('SUPABASE_FETCH_TIMEOUT_MS', false, '30000')),
    ordermentumTimeoutMs: Number(env('ORDERMENTUM_FETCH_TIMEOUT_MS', false, '30000')),
    fetchRetries: Number(env('ORDERMENTUM_FETCH_RETRIES', false, '2')),
    skipSupabase,
  };
}


async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function withNetworkRetry(label, fn, retries = 2, baseDelayMs = 1500) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt + 1);
    } catch (error) {
      lastError = error;
      const networkCode = error?.cause?.code || error?.code || error?.name;
      const retryable = ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'AbortError', 'TypeError'].includes(networkCode) || error?.message === 'fetch failed';
      if (!retryable || attempt >= retries) break;
      const waitMs = baseDelayMs * (attempt + 1);
      console.warn(`${label} network retry ${attempt + 1}/${retries} after ${networkCode || error.message}; waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function supabaseRpc(cfg, fn, body = {}) {
  if (cfg.skipSupabase || !cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error(`Supabase RPC ${fn} skipped: Supabase is not configured in this run.`);
  const response = await withNetworkRetry(`Supabase RPC ${fn}`, () => fetchWithTimeout(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: cfg.serviceRoleKey,
      authorization: `Bearer ${cfg.serviceRoleKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  }, cfg.supabaseTimeoutMs), cfg.fetchRetries);
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase RPC ${fn} ${response.status}: ${text}`);
  if (!text) return null;
  return JSON.parse(text);
}

async function supabaseSelect(cfg, path) {
  if (cfg.skipSupabase || !cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error(`Supabase select skipped: Supabase is not configured in this run.`);
  const response = await withNetworkRetry(`Supabase select ${path}`, () => fetchWithTimeout(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: cfg.serviceRoleKey,
      authorization: `Bearer ${cfg.serviceRoleKey}`,
    },
  }, cfg.supabaseTimeoutMs), cfg.fetchRetries);
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase select ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function supabasePatch(cfg, path, body) {
  if (cfg.skipSupabase || !cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error(`Supabase patch skipped: Supabase is not configured in this run.`);
  const response = await withNetworkRetry(`Supabase patch ${path}`, () => fetchWithTimeout(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: cfg.serviceRoleKey,
      authorization: `Bearer ${cfg.serviceRoleKey}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  }, cfg.supabaseTimeoutMs), cfg.fetchRetries);
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase patch ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function getLegacyBearer(cfg) {
  if (cfg.bearerToken) return cfg.bearerToken;
  if (!cfg.username || !cfg.password) {
    throw new Error('legacy auth requires ORDERMENTUM_BEARER_TOKEN or ORDERMENTUM_USERNAME + ORDERMENTUM_PASSWORD');
  }

  const response = await withNetworkRetry('Ordermentum legacy auth', () => fetchWithTimeout(`${cfg.baseUrl}/v1/auth`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({username: cfg.username, password: cfg.password}),
  }, cfg.ordermentumTimeoutMs), cfg.fetchRetries);
  const text = await response.text();
  if (!response.ok) throw new Error(`Ordermentum legacy auth ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  return payload.accessToken || payload.access_token || payload.token;
}

async function ordermentumHeaders(cfg) {
  const headers = {'accept': 'application/json'};
  if (cfg.authMode === 'api-key') {
    if (!cfg.apiKey) throw new Error('ORDERMENTUM_AUTH_MODE=api-key requires ORDERMENTUM_API_KEY');
    headers['x-api-key'] = cfg.apiKey;
    return headers;
  }
  if (cfg.authMode === 'legacy-bearer' || cfg.authMode === 'legacy-password') {
    headers.authorization = `Bearer ${await getLegacyBearer(cfg)}`;
    return headers;
  }
  if (cfg.authMode === 'bearer') {
    if (!cfg.bearerToken) throw new Error('ORDERMENTUM_AUTH_MODE=bearer requires ORDERMENTUM_BEARER_TOKEN');
    headers.authorization = `Bearer ${cfg.bearerToken}`;
    return headers;
  }
  throw new Error(`Unsupported ORDERMENTUM_AUTH_MODE: ${cfg.authMode}`);
}

function fillTemplate(template, values) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (!(key in values)) return '';
    return String(values[key]);
  });
}

function makeSearchRequest(cfg, {from, to, page, limit}) {
  const url = cfg.searchUrl || `${cfg.baseUrl}/v2/orders`;
  const values = {
    from,
    to,
    page,
    limit,
    updatedFrom: from,
    updatedTo: to,
    createdFrom: from,
    createdTo: to,
    pageNo: page,
    pageSize: limit,
    supplierId: cfg.supplierId || '',
  };
  if (cfg.searchMethod === 'GET') {
    const u = new URL(url);
    if (cfg.extraQuery) {
      const extras = new URLSearchParams(cfg.extraQuery);
      for (const [key, value] of extras.entries()) {
        if (value !== '') u.searchParams.set(key, value);
      }
    }
    if (cfg.supplierId) u.searchParams.set('supplierId', cfg.supplierId);
    u.searchParams.set(cfg.fromParam, from);
    u.searchParams.set(cfg.toParam, to);
    u.searchParams.set(cfg.pageParam, String(page));
    u.searchParams.set(cfg.limitParam, String(limit));
    return {method: 'GET', url: u.toString(), body: undefined};
  }

  const body = cfg.searchBodyTemplate
    ? JSON.parse(fillTemplate(cfg.searchBodyTemplate, values))
    : {
        supplierId: cfg.supplierId || undefined,
        [cfg.fromParam]: from,
        [cfg.toParam]: to,
        [cfg.pageParam]: page,
        [cfg.limitParam]: limit,
      };

  return {method: cfg.searchMethod, url, body};
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'orders', 'items', 'results', 'rows', 'records']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  for (const path of [['data', 'orders'], ['data', 'items'], ['result', 'orders'], ['result', 'items']]) {
    let cur = payload;
    for (const key of path) cur = cur?.[key];
    if (Array.isArray(cur)) return cur;
  }
  return [];
}

function hasNextPage(payload, items, page, limit) {
  if (payload?.nextPage || payload?.next_page || payload?.nextPageToken || payload?.next_page_token) return true;
  if (payload?.pagination?.hasNextPage === true) return true;
  if (payload?.meta?.hasNextPage === true) return true;
  if (typeof payload?.totalPages === 'number') return page < payload.totalPages;
  if (typeof payload?.pagination?.totalPages === 'number') return page < payload.pagination.totalPages;
  return items.length >= limit;
}

async function ordermentumFetchJson(cfg, url, options = {}, attempt = 1) {
  const apiKeyMode = cfg.authMode === 'api-key';
  const requestUrl = apiKeyMode ? assertOrdermentumApiRequestUrl(url) : url;
  if (apiKeyMode) {
    assertOrdermentumApiKeyRequestShape({
      apiKey: cfg.apiKey,
      requestUrl,
      body: options.body,
      callerHeaders: options.headers || {},
    });
  }

  const headers = {...(await ordermentumHeaders(cfg)), ...(options.headers || {})};
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const requestOptions = apiKeyMode
    ? {...options, headers, redirect: 'manual'}
    : {...options, headers};
  const response = await withNetworkRetry(
    `Ordermentum fetch ${requestUrl}`,
    () => fetchWithTimeout(requestUrl, requestOptions, cfg.ordermentumTimeoutMs),
    cfg.fetchRetries,
  );

  if (apiKeyMode) assertNoCredentialedOrdermentumRedirect(response, requestUrl);
  const text = await response.text();

  if (response.status === 429 && attempt <= 4) {
    const retryAfter = Number(response.headers.get('retry-after') || '0');
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 5000 * attempt);
    await sleep(waitMs);
    return ordermentumFetchJson(cfg, requestUrl, options, attempt + 1);
  }

  if (!response.ok) {
    const safeText = apiKeyMode ? redactOrdermentumSecret(text, cfg.apiKey) : text;
    const err = new Error(`Ordermentum ${response.status}: ${safeText}`);
    err.status = response.status;
    err.payload = safeJson(safeText) ?? {raw: safeText};
    throw err;
  }

  return text ? JSON.parse(text) : null;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractOrderIdentity(order) {
  return {
    id: order?.id || order?.orderId || order?.order_id || order?.uuid || null,
    number: order?.orderNumber || order?.order_number || order?.number || order?.orderNo || order?.order?.number || null,
    invoiceNumber: order?.invoiceNumber || order?.invoice_number || order?.invoiceNo || order?.invoice?.number || null,
    updatedAt: order?.updatedAt || order?.updated_at || order?.modifiedAt || order?.lastUpdatedAt || null,
  };
}

function detailUrl(template, cfg, identity) {
  if (!template) return null;
  return fillTemplate(template, {
    baseUrl: cfg.baseUrl,
    id: identity.id || '',
    orderId: identity.id || '',
    orderNumber: identity.number || '',
    invoiceNumber: identity.invoiceNumber || '',
  });
}

export {
  sleep,
  env,
  parseArgs,
  config,
  supabaseRpc,
  supabaseSelect,
  supabasePatch,
  makeSearchRequest,
  extractArray,
  hasNextPage,
  ordermentumFetchJson,
  extractOrderIdentity,
  detailUrl,
  fetchWithTimeout,
  withNetworkRetry,
};
