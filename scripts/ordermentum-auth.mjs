import fs from 'node:fs';
import path from 'node:path';

function env(name, options = {}) {
  const value = process.env[name];
  if (!value && options.required) throw new Error(`Missing required environment variable: ${name}`);
  return value || options.default || '';
}

function cachePath() {
  return path.resolve(process.cwd(), '.cache', 'ordermentum-token.json');
}

function readCachedToken() {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (cached.access_token && cached.expires_at && new Date(cached.expires_at).getTime() > Date.now() + 120_000) return cached.access_token;
  } catch {
    return null;
  }
  return null;
}

function writeCachedToken(token, expiresInHours = 23) {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify({
    access_token: token,
    expires_at: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
    cached_at: new Date().toISOString(),
  }, null, 2));
}

export function getOrdermentumBaseUrl() {
  const explicit = process.env.ORDERMENTUM_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const mode = getOrdermentumAuthMode();
  return (mode === 'api-key' || mode === 'x-api-key' ? 'https://api.ordermentum.com' : 'https://app.ordermentum.com');
}

export function getOrdermentumAuthMode() {
  return env('ORDERMENTUM_AUTH_MODE', { default: process.env.ORDERMENTUM_API_KEY ? 'api-key' : 'legacy-bearer' }).toLowerCase();
}

export async function getLegacyBearerToken({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCachedToken();
    if (cached) return cached;
  }

  const directToken = process.env.ORDERMENTUM_BEARER_TOKEN || process.env.ORDERMENTUM_ACCESS_TOKEN || process.env.ORDERMENTUM_API_TOKEN;
  if (directToken && !forceRefresh) return directToken;

  const username = env('ORDERMENTUM_USERNAME', { required: true });
  const password = env('ORDERMENTUM_PASSWORD', { required: true });
  const authUrl = env('ORDERMENTUM_AUTH_URL', { default: 'https://app.ordermentum.com/v1/auth' });

  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Ordermentum auth ${response.status}: ${text.slice(0, 500)}`);
  if (!data?.access_token) throw new Error(`Ordermentum auth response did not include access_token: ${text.slice(0, 500)}`);
  writeCachedToken(data.access_token, 23);
  return data.access_token;
}

export async function getOrdermentumAuthHeaders({ forceRefresh = false } = {}) {
  const mode = getOrdermentumAuthMode();
  if (mode === 'api-key' || mode === 'x-api-key') {
    const key = env('ORDERMENTUM_API_KEY', { required: true });
    return { 'x-api-key': key };
  }
  if (mode === 'bearer' || mode === 'legacy-bearer' || mode === 'user-password') {
    const token = await getLegacyBearerToken({ forceRefresh });
    return { authorization: `Bearer ${token}` };
  }
  throw new Error(`Unsupported ORDERMENTUM_AUTH_MODE: ${mode}`);
}

export function makeOrdermentumUrl(pathname, params = {}) {
  const base = getOrdermentumBaseUrl();
  const url = new URL(pathname.startsWith('http') ? pathname : `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}
