import {
  createApiJob,
  createSyncBatch,
  env,
  extractOrderIdentity,
  extractOrders,
  finishApiJob,
  finishSyncBatch,
  makeRateLimiter,
  ordermentumFetch,
  recordImportError,
  supabaseRequest,
  templateUrl,
  upsertRawInvoice,
  upsertRawOrder,
} from './ordermentum-sync-common.mjs';
import { getOrdermentumBaseUrl } from './ordermentum-auth.mjs';

const supplierId = env('ORDERMENTUM_SUPPLIER_ID', { required: true });
const mode = env('ORDERMENTUM_MISSING_INVOICE_REFRESH_MODE', { default: 'order-detail' });
const orderDetailTemplate = env('ORDERMENTUM_ORDER_DETAIL_URL_TEMPLATE', { default: `${getOrdermentumBaseUrl()}/v1/orders/{id}` });
const invoiceSearchUrl = env('ORDERMENTUM_INVOICE_SEARCH_URL', { default: `${getOrdermentumBaseUrl()}/v2/invoices` });
const invoiceDetailTemplate = env('ORDERMENTUM_INVOICE_DETAIL_URL_TEMPLATE', { default: `${getOrdermentumBaseUrl()}/v1/invoices/{id}` });
const maxPerMinute = Number(process.env.ORDERMENTUM_MAX_INVOICE_DETAIL_PER_MINUTE || 12);
const limiter = makeRateLimiter(maxPerMinute);

const rows = await supabaseRequest('v_ecoflow_ordermentum_invoice_gap_queue?gap_status=eq.FETCH_REQUIRED&select=external_order_id,external_order_number,invoice_number,external_invoice_number,order_number&order=order_updated_at.desc', { method: 'GET' });
const job = await createApiJob({ job_type: 'MISSING_INVOICE_REFRESH' });
const batch = await createSyncBatch({ syncType: 'INCREMENTAL' });
const counters = { fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0, rateLimited: 0 };

function invoiceCandidatesFromOrderDetail(payload) {
  const root = payload?.order || payload;
  const candidates = [];
  if (root?.invoice) candidates.push(root.invoice);
  if (root?.latestInvoice) candidates.push(root.latestInvoice);
  if (root?.invoiceDetail) candidates.push(root.invoiceDetail);
  if (Array.isArray(root?.invoices)) candidates.push(...root.invoices);
  if (Array.isArray(payload?.invoices)) candidates.push(...payload.invoices);
  return candidates.filter(Boolean);
}

async function fetchInvoiceByNumber(invoiceNumber) {
  const url = new URL(invoiceSearchUrl);
  url.searchParams.set('supplierId', supplierId);
  url.searchParams.set('number', invoiceNumber);
  url.searchParams.set('pageSize', '10');
  url.searchParams.set('pageNo', '1');
  const searchPayload = await ordermentumFetch(url.toString(), { method: 'GET' });
  const { orders: invoices } = extractOrders(searchPayload);
  const match = invoices.find((item) => String(item.number || item.invoiceNumber || item.reference || '').trim() === invoiceNumber) || invoices[0];
  if (!match) throw new Error(`Invoice ${invoiceNumber} was not found by /v2/invoices search`);
  const invoiceId = match.id || match.uuid || match.invoiceId;
  if (!invoiceId) return match;
  return ordermentumFetch(templateUrl(invoiceDetailTemplate, { id: invoiceId, invoiceId, invoiceNumber }), { method: 'GET' });
}

for (const row of rows) {
  const invoiceNumber = row.invoice_number || row.external_invoice_number;
  if (!invoiceNumber) continue;
  try {
    await limiter();
    let invoicePayload = null;
    if (mode === 'invoice-search') {
      invoicePayload = await fetchInvoiceByNumber(invoiceNumber);
      counters.fetched += 1;
    } else {
      const orderId = row.external_order_id || row.external_order_number || row.order_number;
      const orderPayload = await ordermentumFetch(templateUrl(orderDetailTemplate, {
        id: orderId,
        orderId,
        orderNumber: row.order_number || row.external_order_number,
      }), { method: 'GET' });
      counters.fetched += 1;
      await upsertRawOrder(orderPayload, { batchId: batch.id, importSource: 'ORDERMENTUM_API_DETAIL_REFRESH' });
      const candidates = invoiceCandidatesFromOrderDetail(orderPayload);
      invoicePayload = candidates.find((candidate) => String(candidate.number || candidate.invoiceNumber || candidate.reference || '').trim() === invoiceNumber) || candidates[0] || null;
      if (!invoicePayload && mode === 'order-detail-then-invoice-search') {
        invoicePayload = await fetchInvoiceByNumber(invoiceNumber);
        counters.fetched += 1;
      }
    }
    if (!invoicePayload) throw new Error(`Ordermentum response did not include invoice detail for ${invoiceNumber}. Try ORDERMENTUM_MISSING_INVOICE_REFRESH_MODE=invoice-search.`);
    const result = await upsertRawInvoice(invoicePayload, { jobId: job.id, batchId: batch.id });
    counters[result.result] += 1;
  } catch (error) {
    counters.failed += 1;
    if (error.status === 429) counters.rateLimited += 1;
    await recordImportError({
      job_id: job.id,
      batch_id: batch.id,
      external_order_id: row.external_order_id,
      external_order_number: row.external_order_number || row.order_number,
      external_invoice_number: invoiceNumber,
      error_stage: 'INVOICE_DETAIL_REFRESH',
      error_code: String(error.status || 'ERROR'),
      error_message: error.message,
      retry_after_seconds: error.retryAfter || null,
      raw_payload: { row, mode },
    });
    if (error.status === 429 && error.retryAfter) await new Promise((resolve) => setTimeout(resolve, error.retryAfter * 1000));
  }
}
await finishApiJob(job.id, {
  status: counters.failed ? 'PARTIAL' : 'COMPLETED',
  fetched_count: counters.fetched,
  created_count: counters.created,
  updated_count: counters.updated,
  unchanged_count: counters.unchanged,
  failed_count: counters.failed,
  rate_limited_count: counters.rateLimited,
});
await finishSyncBatch(batch.id, {
  status: counters.failed ? 'PARTIAL' : 'COMPLETED',
  fetched_count: counters.fetched,
  created_count: counters.created,
  updated_count: counters.updated,
  unchanged_count: counters.unchanged,
  failed_count: counters.failed,
});
console.log(`Missing invoice refresh complete: ${JSON.stringify(counters)}`);
