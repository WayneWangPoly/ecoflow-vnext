import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const DEFAULT_AUTH_BASE_URL = process.env.ORDERMENTUM_BASE_URL || process.env.ORDERMENTUM_AUTH_BASE_URL || 'https://app.ordermentum.com';
export const DEFAULT_API_BASE_URL = process.env.ORDERMENTUM_API_BASE_URL || 'https://api.ordermentum.com';

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getLegacyBearerToken() {
  // Backwards-compatible name: returns a bearer token for legacy mode.
  // If ORDERMENTUM_API_KEY is present, callers still receive null and fetchOrdermentumJson will use x-api-key.
  if (process.env.ORDERMENTUM_API_KEY?.trim()) return null;
  const existing = process.env.ORDERMENTUM_BEARER_TOKEN;
  if (existing && existing.trim()) return existing.trim();
  const username = requireEnv('ORDERMENTUM_USERNAME');
  const password = requireEnv('ORDERMENTUM_PASSWORD');
  const url = `${DEFAULT_AUTH_BASE_URL.replace(/\/$/, '')}/v1/auth`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Ordermentum auth failed ${response.status}: ${JSON.stringify(data).slice(0, 600)}`);
  }
  const token = data?.access_token || data?.accessToken || data?.token;
  if (!token) throw new Error(`Ordermentum auth response did not contain access_token: ${JSON.stringify(data).slice(0, 600)}`);
  return token;
}

export async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { rawText: text }; }
}

export function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export function extractArray(data, resourceType) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.data,
    data.results,
    data.items,
    data.records,
    data[resourceType],
    data.products,
    data.variants,
    data.purchasers,
    data.customers,
    data.priceGroups,
    data.price_groups,
    data.invoices,
    data.stockLocations,
    data.stock_locations,
    data.leads,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      for (const nested of ['data', 'items', 'results']) {
        if (Array.isArray(candidate[nested])) return candidate[nested];
      }
    }
  }
  return [];
}

export function extractExternalId(item, fallbackPrefix = 'item') {
  const direct = item?.id || item?._id || item?.uuid || item?.externalId || item?.external_id || item?.productId || item?.variantId || item?.purchaserId || item?.retailerId || item?.invoiceId || item?.priceGroupId;
  if (direct) return String(direct);
  const nested = item?.product?.id || item?.variant?.id || item?.retailer?.id || item?.priceGroup?.id;
  if (nested) return String(nested);
  return `${fallbackPrefix}_${hashPayload(item).slice(0, 24)}`;
}

export function extractTimestamp(item, names) {
  for (const name of names) {
    const value = name.split('.').reduce((acc, key) => acc?.[key], item);
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

export function buildUrl(path, params = {}) {
  const url = new URL(path, DEFAULT_API_BASE_URL.replace(/\/$/, '') + '/');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function fetchOrdermentumJson(token, path, params = {}, options = {}) {
  const url = buildUrl(path.replace(/^\//, ''), params);
  const timeoutMs = Number(process.env.ORDERMENTUM_FETCH_TIMEOUT_MS || 60000);
  const retries = Number(process.env.ORDERMENTUM_FETCH_RETRIES || 2);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          ...(process.env.ORDERMENTUM_API_KEY?.trim()
            ? { 'x-api-key': process.env.ORDERMENTUM_API_KEY.trim() }
            : { authorization: `Bearer ${token}` }),
          accept: 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      const data = await safeJson(response);
      clearTimeout(timer);
      return { ok: response.ok, status: response.status, data, url };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

export const RESOURCE_DEFINITIONS = {
  products: {
    path: '/v2/products',
    detailPath: (id) => `/v1/products/${encodeURIComponent(id)}`,
    detailType: 'product_detail',
    needsSupplierId: true,
  },
  variants: {
    path: '/v1/variants',
    detailPath: null,
    detailType: 'variant_detail',
    needsSupplierId: true,
  },
  purchasers: {
    path: '/v1/purchasers',
    detailPath: (id) => `/v1/purchasers/${encodeURIComponent(id)}`,
    detailType: 'purchaser_detail',
    needsSupplierId: true,
  },
  price_groups: {
    path: '/v1/price-groups',
    detailPath: null,
    detailType: 'price_group_detail',
    needsSupplierId: false,
  },
  invoices: {
    path: '/v2/invoices',
    detailPath: null,
    detailType: 'invoice_detail',
    needsSupplierId: true,
  },
  stock_locations: {
    path: '/v1/stock-locations',
    detailPath: null,
    detailType: 'stock_location_detail',
    needsSupplierId: true,
  },
  leads: {
    path: '/v1/leads',
    detailPath: null,
    detailType: 'lead_detail',
    needsSupplierId: true,
  },
};

export function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, rawValue] = arg.slice(2).split('=');
      args[key] = rawValue === undefined ? true : rawValue;
    }
  }
  return args;
}
