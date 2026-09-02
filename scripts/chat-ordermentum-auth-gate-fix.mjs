import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing expected block: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one block only: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}
function replaceAllExpected(source, before, after, expected, label) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`Expected ${expected} occurrences for ${label}, found ${count}`);
  return source.split(before).join(after);
}

{
  const path = 'scripts/ordermentum-auth.mjs';
  let source = read(path);
  source = replaceOnce(source,
    "import fs from 'node:fs';\nimport path from 'node:path';\n",
    "import fs from 'node:fs';\nimport path from 'node:path';\nimport {\n  ORDERMENTUM_API_ORIGIN,\n  assertOrdermentumApiBaseUrl,\n} from './ordermentum-api-origin-guard.mjs';\n",
    'auth guard import');
  source = replaceOnce(source,
    "export function getOrdermentumBaseUrl() {\n  const explicit = process.env.ORDERMENTUM_BASE_URL;\n  if (explicit) return explicit.replace(/\\\/$/, '');\n  const mode = getOrdermentumAuthMode();\n  return (mode === 'api-key' || mode === 'x-api-key' ? 'https://api.ordermentum.com' : 'https://app.ordermentum.com');\n}\n\nexport function getOrdermentumAuthMode() {\n  return env('ORDERMENTUM_AUTH_MODE', { default: process.env.ORDERMENTUM_API_KEY ? 'api-key' : 'legacy-bearer' }).toLowerCase();\n}\n",
    "export function getOrdermentumAuthMode() {\n  return env('ORDERMENTUM_AUTH_MODE', { default: 'legacy-bearer' }).toLowerCase();\n}\n\nexport function isOrdermentumApiKeyMode(mode = getOrdermentumAuthMode()) {\n  return mode === 'api-key' || mode === 'x-api-key';\n}\n\nexport function getOrdermentumBaseUrl() {\n  const mode = getOrdermentumAuthMode();\n  const explicit = process.env.ORDERMENTUM_BASE_URL?.trim();\n  if (isOrdermentumApiKeyMode(mode)) {\n    return assertOrdermentumApiBaseUrl(explicit || ORDERMENTUM_API_ORIGIN);\n  }\n  return (explicit || 'https://app.ordermentum.com').replace(/\\\/$/, '');\n}\n",
    'auth mode and base');
  source = replaceOnce(source,
    "  if (mode === 'api-key' || mode === 'x-api-key') {\n",
    "  if (isOrdermentumApiKeyMode(mode)) {\n",
    'auth header mode');
  write(path, source);
}

{
  const path = 'scripts/ordermentum-sync-common.mjs';
  let source = read(path);
  source = replaceOnce(source,
    "import { getOrdermentumAuthHeaders } from './ordermentum-auth.mjs';\n",
    "import {\n  getOrdermentumAuthHeaders,\n  getOrdermentumAuthMode,\n  isOrdermentumApiKeyMode,\n} from './ordermentum-auth.mjs';\nimport {\n  assertNoCredentialedOrdermentumRedirect,\n  assertOrdermentumApiKeyRequestShape,\n  assertOrdermentumApiRequestUrl,\n  redactOrdermentumSecret,\n} from './ordermentum-api-origin-guard.mjs';\n",
    'sync-common auth imports');
  source = replaceOnce(source,
    "export async function ordermentumFetch(url, options = {}) {\n  async function doFetch(forceRefresh = false) {\n    const authHeaders = await getOrdermentumAuthHeaders({ forceRefresh });\n    const headers = {\n      accept: 'application/json',\n      'content-type': 'application/json',\n      ...authHeaders,\n      ...(options.headers || {}),\n    };\n    return fetch(url, { ...options, headers });\n  }\n\n  let response = await doFetch(false);\n  if (response.status === 401 && !process.env.ORDERMENTUM_API_KEY) {\n    response = await doFetch(true);\n  }\n  if (response.status === 429) {\n    const retryAfter = Number(response.headers.get('retry-after') || 60);\n    const error = new Error(`Ordermentum rate limited for ${retryAfter}s`);\n    error.status = 429;\n    error.retryAfter = retryAfter;\n    throw error;\n  }\n  const text = await response.text();\n  const data = text ? JSON.parse(text) : null;\n  if (!response.ok) {\n    const error = new Error(`Ordermentum API ${response.status}: ${text.slice(0, 500)}`);\n    error.status = response.status;\n    error.payload = data;\n    throw error;\n  }\n  return data;\n}\n",
    "export async function ordermentumFetch(url, options = {}) {\n  const authMode = getOrdermentumAuthMode();\n  const apiKeyMode = isOrdermentumApiKeyMode(authMode);\n  const apiKey = apiKeyMode ? env('ORDERMENTUM_API_KEY', { required: true }).trim() : '';\n  const requestUrl = apiKeyMode ? assertOrdermentumApiRequestUrl(url) : url;\n\n  if (apiKeyMode) {\n    assertOrdermentumApiKeyRequestShape({\n      apiKey,\n      requestUrl,\n      body: options.body,\n      callerHeaders: options.headers || {},\n    });\n  }\n\n  async function doFetch(forceRefresh = false) {\n    const authHeaders = await getOrdermentumAuthHeaders({ forceRefresh });\n    const headers = apiKeyMode\n      ? {\n          accept: 'application/json',\n          'content-type': 'application/json',\n          ...(options.headers || {}),\n          ...authHeaders,\n        }\n      : {\n          accept: 'application/json',\n          'content-type': 'application/json',\n          ...authHeaders,\n          ...(options.headers || {}),\n        };\n    const requestOptions = apiKeyMode\n      ? { ...options, headers, redirect: 'manual' }\n      : { ...options, headers };\n    return fetch(requestUrl, requestOptions);\n  }\n\n  let response = await doFetch(false);\n  if (apiKeyMode) assertNoCredentialedOrdermentumRedirect(response, requestUrl);\n  if (response.status === 401 && !apiKeyMode) {\n    response = await doFetch(true);\n  }\n  if (response.status === 429) {\n    const retryAfter = Number(response.headers.get('retry-after') || 60);\n    const error = new Error(`Ordermentum rate limited for ${retryAfter}s`);\n    error.status = 429;\n    error.retryAfter = retryAfter;\n    throw error;\n  }\n  const text = await response.text();\n  const safeText = apiKeyMode ? redactOrdermentumSecret(text, apiKey) : text;\n  const data = safeText ? JSON.parse(safeText) : null;\n  if (!response.ok) {\n    const error = new Error(`Ordermentum API ${response.status}: ${safeText.slice(0, 500)}`);\n    error.status = response.status;\n    error.payload = data;\n    throw error;\n  }\n  return data;\n}\n",
    'sync-common request boundary');
  write(path, source);
}

{
  const path = 'scripts/ordermentum-master-data-common.mjs';
  let source = read(path);
  source = replaceOnce(source,
    "import { createClient } from '@supabase/supabase-js';\n",
    "import { createClient } from '@supabase/supabase-js';\nimport { getOrdermentumAuthMode, isOrdermentumApiKeyMode } from './ordermentum-auth.mjs';\n",
    'master-data auth import');
  source = replaceOnce(source,
    "export async function getLegacyBearerToken() {\n  // Backwards-compatible name: returns a bearer token for legacy mode.\n  // If ORDERMENTUM_API_KEY is present, callers still receive null and fetchOrdermentumJson will use x-api-key.\n  if (process.env.ORDERMENTUM_API_KEY?.trim()) return null;\n",
    "export async function getLegacyBearerToken() {\n  // API-key activation is explicit. Merely installing the future secret must not cut over incumbent callers.\n  if (isOrdermentumApiKeyMode(getOrdermentumAuthMode())) return null;\n",
    'master-data legacy token gate');
  source = replaceOnce(source,
    "export function buildUrl(path, params = {}) {\n  const apiKeyMode = Boolean(process.env.ORDERMENTUM_API_KEY?.trim());\n",
    "export function buildUrl(path, params = {}) {\n  const apiKeyMode = isOrdermentumApiKeyMode(getOrdermentumAuthMode());\n",
    'master-data buildUrl mode');
  source = replaceOnce(source,
    "export async function fetchOrdermentumJson(token, path, params = {}, options = {}) {\n  const apiKey = process.env.ORDERMENTUM_API_KEY?.trim() || '';\n  const apiKeyMode = Boolean(apiKey);\n",
    "export async function fetchOrdermentumJson(token, path, params = {}, options = {}) {\n  const apiKeyMode = isOrdermentumApiKeyMode(getOrdermentumAuthMode());\n  const apiKey = apiKeyMode ? requireEnv('ORDERMENTUM_API_KEY').trim() : '';\n",
    'master-data fetch mode');
  write(path, source);
}

{
  const path = 'scripts/ordermentum-full-sync-core.mjs';
  let source = read(path);
  source = replaceOnce(source,
    "} from './ordermentum-api-origin-guard.mjs';\n\nconst sleep",
    "} from './ordermentum-api-origin-guard.mjs';\nimport {\n  getOrdermentumAuthMode,\n  getOrdermentumBaseUrl,\n  isOrdermentumApiKeyMode,\n} from './ordermentum-auth.mjs';\n\nconst sleep",
    'full-sync auth import');
  source = replaceOnce(source,
    "  const configuredBaseUrl = env('ORDERMENTUM_BASE_URL', false, 'https://api.ordermentum.com').replace(/\\\/$/, '');\n  const authMode = env('ORDERMENTUM_AUTH_MODE', false, 'api-key');\n  const baseUrl = authMode === 'api-key' ? assertOrdermentumApiBaseUrl(configuredBaseUrl) : configuredBaseUrl;\n",
    "  const authMode = getOrdermentumAuthMode();\n  const configuredBaseUrl = env('ORDERMENTUM_BASE_URL', false, getOrdermentumBaseUrl()).replace(/\\\/$/, '');\n  const baseUrl = isOrdermentumApiKeyMode(authMode) ? assertOrdermentumApiBaseUrl(configuredBaseUrl) : configuredBaseUrl;\n",
    'full-sync config mode');
  source = replaceAllExpected(source,
    "cfg.authMode === 'api-key'",
    "isOrdermentumApiKeyMode(cfg.authMode)",
    2,
    'full-sync api-key checks');
  write(path, source);
}

{
  const path = 'scripts/ordermentum-master-data-sync.mjs';
  let source = read(path);
  source = replaceOnce(source,
    "} from './ordermentum-master-version-policy.mjs';\n",
    "} from './ordermentum-master-version-policy.mjs';\nimport { getOrdermentumAuthMode } from './ordermentum-auth.mjs';\n",
    'master-data-sync auth import');
  source = replaceOnce(source,
    "    auth_mode: process.env.ORDERMENTUM_BEARER_TOKEN ? 'legacy-bearer-env' : 'legacy-username-password',\n",
    "    auth_mode: getOrdermentumAuthMode(),\n",
    'master-data-sync auth evidence');
  write(path, source);
}

{
  const path = 'scripts/ordermentum-invoice-detail-sync.mjs';
  let source = read(path);
  source = replaceOnce(source,
    "} from './ordermentum-master-version-policy.mjs';\n",
    "} from './ordermentum-master-version-policy.mjs';\nimport { getOrdermentumAuthMode } from './ordermentum-auth.mjs';\n",
    'invoice-detail auth import');
  source = replaceOnce(source,
    "    auth_mode: process.env.ORDERMENTUM_API_KEY ? 'api-key' : 'legacy-username-password',\n",
    "    auth_mode: getOrdermentumAuthMode(),\n",
    'invoice-detail auth evidence');
  write(path, source);
}

for (const path of [
  '.github/workflows/ordermentum-cloud-sync.yml',
  '.github/workflows/ordermentum-targeted-store-sync.yml',
  '.github/workflows/ordermentum-complete-mirror.yml',
]) {
  let source = read(path);
  source = replaceOnce(source,
    "      ORDERMENTUM_API_KEY: ${{ secrets.ORDERMENTUM_API_KEY }}\n",
    "      ORDERMENTUM_API_KEY: ${{ secrets.ORDERMENTUM_API_KEY }}\n      ORDERMENTUM_AUTH_MODE: legacy-bearer\n",
    `${path} explicit legacy mode`);
  write(path, source);
}

{
  const path = '.github/workflows/ordermentum-api-origin-guard-check.yml';
  let source = read(path);
  source = replaceAllExpected(source,
    "      - 'scripts/ordermentum-master-data-common.mjs'\n",
    "      - 'scripts/ordermentum-master-data-common.mjs'\n      - 'scripts/ordermentum-auth.mjs'\n      - 'scripts/ordermentum-sync-common.mjs'\n      - 'scripts/ordermentum-master-data-sync.mjs'\n      - 'scripts/ordermentum-invoice-detail-sync.mjs'\n      - 'scripts/ordermentum-cloud-sync.mjs'\n      - 'scripts/ordermentum-complete-mirror.mjs'\n      - 'scripts/ordermentum-targeted-store-sync.mjs'\n      - 'scripts/ordermentum-sync-now-legacy.mjs'\n      - 'scripts/import-ordermentum-backfill-all.mjs'\n      - 'scripts/import-ordermentum-incremental.mjs'\n      - 'scripts/refresh-ordermentum-missing-invoices.mjs'\n      - '.github/workflows/ordermentum-cloud-sync.yml'\n      - '.github/workflows/ordermentum-complete-mirror.yml'\n      - '.github/workflows/ordermentum-targeted-store-sync.yml'\n",
    2,
    'guard workflow caller paths');
  source = replaceOnce(source,
    "          node --check scripts/ordermentum-master-data-common.mjs\n          node --check scripts/ordermentum-api-origin-guard.test.mjs\n          node --check scripts/ordermentum-api-origin-guard-edge.test.mjs\n",
    "          node --check scripts/ordermentum-master-data-common.mjs\n          node --check scripts/ordermentum-auth.mjs\n          node --check scripts/ordermentum-sync-common.mjs\n          node --check scripts/ordermentum-master-data-sync.mjs\n          node --check scripts/ordermentum-invoice-detail-sync.mjs\n          node --check scripts/ordermentum-cloud-sync.mjs\n          node --check scripts/ordermentum-complete-mirror.mjs\n          node --check scripts/ordermentum-targeted-store-sync.mjs\n          node --check scripts/ordermentum-sync-now-legacy.mjs\n          node --check scripts/import-ordermentum-backfill-all.mjs\n          node --check scripts/import-ordermentum-incremental.mjs\n          node --check scripts/refresh-ordermentum-missing-invoices.mjs\n          node --check scripts/ordermentum-api-origin-guard.test.mjs\n          node --check scripts/ordermentum-api-origin-guard-edge.test.mjs\n          node --check scripts/ordermentum-api-origin-guard-operational.test.mjs\n",
    'guard workflow syntax coverage');
  write(path, source);
}

console.log('Applied bounded Ordermentum auth gate correction.');
