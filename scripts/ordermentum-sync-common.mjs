import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getOrdermentumAuthHeaders,
  getOrdermentumAuthMode,
  isOrdermentumApiKeyMode,
} from './ordermentum-auth.mjs';
import {
  assertNoCredentialedOrdermentumRedirect,
  assertOrdermentumApiKeyRequestShape,
  assertOrdermentumApiRequestUrl,
  redactOrdermentumSecret,
} from './ordermentum-api-origin-guard.mjs';

export function env(name, options = {}) {
  const value = process.env[name];
  if (!value && options.required) throw new Error(`Missing required environment variable: ${name}`);
  return value || options.default || '';
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

export function makeWindows(fromIso, toIso, windowDays) {
  const windows = [];
  let start = new Date(fromIso);
  const end = new Date(toIso);
  while (start < end) {
    const next = addDays(start, windowDays);
    const windowEnd = next < end ? next : end;
    windows.push({ from: start.toISOString(), to: windowEnd.toISOString() });
    start = windowEnd;
  }
  return windows;
}

export function makeRateLimiter(maxPerMinute) {
  const minGapMs = Math.ceil(60_000 / Math.max(1, Number(maxPerMinute || 1)));
  let lastRunAt = 0;
  return async function waitForSlot() {
    const now = Date.now();
    const waitMs = Math.max(0, lastRunAt + minGapMs - now);
    if (waitMs > 0) await sleep(waitMs);
    lastRunAt = Date.now();
  };
}

export function extractOrders(payload) {
  if (Array.isArray(payload)) return { orders: payload, cursor: null, hasMore: false };
  const orders = payload?.orders || payload?.data?.orders || payload?.data || payload?.items || payload?.results || payload?.edges?.map((edge) => edge.node) || [];
  const cursor = payload?.nextCursor || payload?.next_cursor || payload?.cursor?.next || payload?.pagination?.nextCursor || payload?.pageInfo?.endCursor || null;
  const hasMore = Boolean(payload?.hasMore ?? payload?.has_more ?? payload?.pagination?.hasMore ?? payload?.pageInfo?.hasNextPage ?? cursor);
  return { orders: Array.isArray(orders) ? orders : [], cursor, hasMore };
}

export function extractOrderIdentity(raw) {
  const externalOrderId = String(
    raw?.id || raw?.uuid || raw?.orderId || raw?.order_id || raw?.external_order_id || raw?.order?.id || raw?.order?.uuid || ''
  ).trim();
  const externalOrderNumber = String(
    raw?.orderNumber || raw?.order_number || raw?.number || raw?.reference || raw?.order?.number || raw?.order?.orderNumber || externalOrderId
  ).trim();
  const invoice = raw?.invoice || raw?.latestInvoice || raw?.invoiceDetail || raw?.invoice_detail || {};
  const externalInvoiceId = String(raw?.invoiceId || raw?.invoice_id || invoice?.id || invoice?.uuid || '').trim();
  const externalInvoiceNumber = String(raw?.invoiceNumber || raw?.invoice_number || invoice?.number || invoice?.reference || '').trim();
  return { externalOrderId, externalOrderNumber, externalInvoiceId, externalInvoiceNumber };
}

export function extractOrderDates(raw) {
  return {
    externalCreatedAt: raw?.createdAt || raw?.created_at || raw?.orderedAt || raw?.ordered_at || raw?.date || null,
    externalUpdatedAt: raw?.updatedAt || raw?.updated_at || raw?.modifiedAt || raw?.modified_at || raw?.lastUpdatedAt || null,
    deliveryDate: raw?.deliveryDate || raw?.delivery_date || raw?.requestedDeliveryDate || raw?.requested_delivery_date || null,
    dueAt: raw?.dueAt || raw?.due_at || raw?.invoice?.dueAt || raw?.invoice?.due_at || null,
  };
}

export function extractOrderStatus(raw) {
  return {
    status: raw?.status || raw?.orderStatus || raw?.order_status || raw?.state || null,
    paymentStatus: raw?.paymentStatus || raw?.payment_status || raw?.invoice?.paymentStatus || raw?.invoice?.payment_status || null,
    retailerName: raw?.retailerName || raw?.retailer_name || raw?.customerName || raw?.customer_name || raw?.purchaser?.name || raw?.retailer?.name || null,
  };
}

export function templateUrl(template, values) {
  let url = template;
  Object.entries(values).forEach(([key, value]) => {
    url = url.replaceAll(`{${key}}`, encodeURIComponent(value || ''));
  });
  return url;
}

export async function ordermentumFetch(url, options = {}) {
  const authMode = getOrdermentumAuthMode();
  const apiKeyMode = isOrdermentumApiKeyMode(authMode);
  const apiKey = apiKeyMode ? env('ORDERMENTUM_API_KEY', { required: true }).trim() : '';
  const requestUrl = apiKeyMode ? assertOrdermentumApiRequestUrl(url) : url;

  if (apiKeyMode) {
    assertOrdermentumApiKeyRequestShape({
      apiKey,
      requestUrl,
      body: options.body,
      callerHeaders: options.headers || {},
    });
  }

  async function doFetch(forceRefresh = false) {
    const authHeaders = await getOrdermentumAuthHeaders({ forceRefresh });
    const headers = apiKeyMode
      ? {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(options.headers || {}),
          ...authHeaders,
        }
      : {
          accept: 'application/json',
          'content-type': 'application/json',
          ...authHeaders,
          ...(options.headers || {}),
        };
    const requestOptions = apiKeyMode
      ? { ...options, headers, redirect: 'manual' }
      : { ...options, headers };
    return fetch(requestUrl, requestOptions);
  }

  let response = await doFetch(false);
  if (apiKeyMode) assertNoCredentialedOrdermentumRedirect(response, requestUrl);
  if (response.status === 401 && !apiKeyMode) {
    response = await doFetch(true);
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') || 60);
    const error = new Error(`Ordermentum rate limited for ${retryAfter}s`);
    error.status = 429;
    error.retryAfter = retryAfter;
    throw error;
  }
  const text = await response.text();
  const safeText = apiKeyMode ? redactOrdermentumSecret(text, apiKey) : text;
  const data = safeText ? JSON.parse(safeText) : null;
  if (!response.ok) {
    const error = new Error(`Ordermentum API ${response.status}: ${safeText.slice(0, 500)}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function supabaseRequest(pathname, options = {}) {
  const baseUrl = env('SUPABASE_URL', { required: true }).replace(/\/$/, '');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY', { required: true });
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    prefer: options.prefer || 'return=representation',
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}/rest/v1/${pathname.replace(/^\//, '')}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Supabase REST ${response.status}: ${text.slice(0, 1000)}`);
  }
  return data;
}

export async function createSyncBatch({ syncType, dateFrom = null, dateTo = null }) {
  const [batch] = await supabaseRequest('ordermentum_sync_batches', {
    method: 'POST',
    body: JSON.stringify([{ sync_type: syncType, status: 'STARTED', date_from: dateFrom, date_to: dateTo }]),
  });
  return batch;
}

export async function finishSyncBatch(batchId, patch) {
  await supabaseRequest(`ordermentum_sync_batches?id=eq.${encodeURIComponent(batchId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }),
  });
}

export async function createApiJob(job) {
  const [created] = await supabaseRequest('ordermentum_api_jobs', {
    method: 'POST',
    body: JSON.stringify([{ status: 'STARTED', started_at: new Date().toISOString(), attempts: 1, ...job }]),
  });
  return created;
}

export async function finishApiJob(jobId, patch) {
  await supabaseRequest(`ordermentum_api_jobs?id=eq.${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
}

export async function recordImportError(error) {
  await supabaseRequest('ordermentum_import_errors', {
    method: 'POST',
    body: JSON.stringify([{ ...error, created_at: new Date().toISOString() }]),
  });
}

export async function getRawOrderByExternalId(externalOrderId) {
  if (!externalOrderId) return null;
  const rows = await supabaseRequest(`ordermentum_raw_orders?external_order_id=eq.${encodeURIComponent(externalOrderId)}&select=id,external_order_id,payload_hash&limit=1`, {
    method: 'GET',
    headers: { prefer: 'return=representation' },
  });
  return rows[0] || null;
}

export async function upsertRawOrder(raw, { batchId, importSource = 'ORDERMENTUM_API' }) {
  const identity = extractOrderIdentity(raw);
  if (!identity.externalOrderId) throw new Error(`Order payload has no stable external order id: ${JSON.stringify(raw).slice(0, 300)}`);
  const dates = extractOrderDates(raw);
  const status = extractOrderStatus(raw);
  const payloadHash = hashPayload(raw);
  const existing = await getRawOrderByExternalId(identity.externalOrderId);
  const now = new Date().toISOString();
  const row = {
    external_order_id: identity.externalOrderId,
    external_order_number: identity.externalOrderNumber || identity.externalOrderId,
    external_invoice_id: identity.externalInvoiceId || null,
    external_invoice_number: identity.externalInvoiceNumber || null,
    retailer_name: status.retailerName,
    status: status.status,
    payment_status: status.paymentStatus,
    delivery_date: dates.deliveryDate,
    due_at: dates.dueAt,
    external_created_at: dates.externalCreatedAt,
    external_updated_at: dates.externalUpdatedAt,
    last_seen_at: dates.externalUpdatedAt || now,
    last_synced_at: now,
    payload_hash: payloadHash,
    raw_payload: raw,
    latest_batch_id: batchId,
    import_source: importSource,
    updated_at: now,
  };
  if (!existing) {
    const [inserted] = await supabaseRequest('ordermentum_raw_orders', {
      method: 'POST',
      body: JSON.stringify([{ ...row, first_seen_at: dates.externalCreatedAt || now }]),
    });
    await insertVersion(inserted.id, identity, payloadHash, raw, 'CREATED', batchId);
    return { result: 'created', row: inserted };
  }
  if (existing.payload_hash === payloadHash) {
    const [updated] = await supabaseRequest(`ordermentum_raw_orders?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        last_seen_at: row.last_seen_at,
        last_synced_at: row.last_synced_at,
        latest_batch_id: row.latest_batch_id,
        updated_at: now,
      }),
    });
    return { result: 'unchanged', row: updated || existing };
  }
  const [updated] = await supabaseRequest(`ordermentum_raw_orders?id=eq.${encodeURIComponent(existing.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(row),
  });
  await insertVersion(existing.id, identity, payloadHash, raw, 'UPDATED', batchId);
  return { result: 'updated', row: updated || existing };
}

export async function insertVersion(rawOrderId, identity, payloadHash, raw, changeType, batchId) {
  await supabaseRequest('ordermentum_order_versions', {
    method: 'POST',
    body: JSON.stringify([{
      raw_order_id: rawOrderId,
      external_order_id: identity.externalOrderId,
      external_order_number: identity.externalOrderNumber,
      payload_hash: payloadHash,
      raw_payload: raw,
      change_type: changeType,
      detected_by_batch_id: batchId,
      detected_at: new Date().toISOString(),
    }]),
  });
}

export async function upsertRawInvoice(raw, { jobId = null, batchId = null, importSource = 'ORDERMENTUM_API' }) {
  const invoice = raw?.invoice || raw;
  const externalInvoiceNumber = String(invoice?.number || invoice?.invoiceNumber || invoice?.invoice_number || invoice?.reference || '').trim();
  if (!externalInvoiceNumber) throw new Error(`Invoice payload has no invoice number: ${JSON.stringify(raw).slice(0, 300)}`);
  const externalInvoiceId = String(invoice?.id || invoice?.uuid || invoice?.invoiceId || invoice?.invoice_id || '').trim() || null;
  const order = invoice?.order || raw?.order || {};
  const externalOrderId = String(invoice?.orderId || invoice?.order_id || order?.id || order?.uuid || '').trim() || null;
  const externalOrderNumber = String(invoice?.orderNumber || invoice?.order_number || order?.number || order?.orderNumber || '').trim() || null;
  const payloadHash = hashPayload(raw);
  const now = new Date().toISOString();
  const row = {
    external_invoice_id: externalInvoiceId,
    external_invoice_number: externalInvoiceNumber,
    external_order_id: externalOrderId,
    external_order_number: externalOrderNumber,
    payment_status: invoice?.paymentStatus || invoice?.payment_status || null,
    invoice_status: invoice?.status || invoice?.invoiceStatus || invoice?.invoice_status || null,
    invoice_date: invoice?.date || invoice?.invoiceDate || invoice?.invoice_date || null,
    due_at: invoice?.dueAt || invoice?.due_at || null,
    total: invoice?.total ?? null,
    total_due: invoice?.totalDue ?? invoice?.total_due ?? null,
    payload_hash: payloadHash,
    raw_payload: raw,
    last_seen_at: now,
    last_synced_at: now,
    latest_job_id: jobId,
    latest_batch_id: batchId,
    import_source: importSource,
    updated_at: now,
  };
  const existing = await supabaseRequest(`ordermentum_raw_invoices?external_invoice_number=eq.${encodeURIComponent(externalInvoiceNumber)}&select=id,payload_hash&limit=1`, { method: 'GET' });
  if (existing[0]) {
    const [updated] = await supabaseRequest(`ordermentum_raw_invoices?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      body: JSON.stringify(row),
    });
    return { result: existing[0].payload_hash === payloadHash ? 'unchanged' : 'updated', row: updated };
  }
  const [inserted] = await supabaseRequest('ordermentum_raw_invoices', {
    method: 'POST',
    body: JSON.stringify([{ ...row, first_seen_at: now }]),
  });
  return { result: 'created', row: inserted };
}

export function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}
