import {
  createApiJob,
  createSyncBatch,
  env,
  extractOrderIdentity,
  extractOrders,
  finishApiJob,
  finishSyncBatch,
  isoDate,
  makeRateLimiter,
  makeWindows,
  ordermentumFetch,
  parseArgs,
  recordImportError,
  templateUrl,
  upsertRawOrder,
} from './ordermentum-sync-common.mjs';
import { makeOrdermentumUrl, getOrdermentumBaseUrl } from './ordermentum-auth.mjs';

const args = parseArgs();
const from = isoDate(args.from || env('ORDERMENTUM_BACKFILL_FROM', { required: true }));
const to = isoDate(args.to || env('ORDERMENTUM_BACKFILL_TO', { default: new Date().toISOString() }));
const windowDays = Number(args['window-days'] || env('ORDERMENTUM_BACKFILL_WINDOW_DAYS', { default: '1' }));
const pageSize = Number(args['page-size'] || env('ORDERMENTUM_PAGE_SIZE', { default: '50' }));
const maxPages = Number(args['max-pages'] || env('ORDERMENTUM_MAX_PAGES_PER_WINDOW', { default: '200' }));
const dryRun = Boolean(args['dry-run']);
const supplierId = env('ORDERMENTUM_SUPPLIER_ID', { required: true });
const searchUrl = env('ORDERMENTUM_SEARCH_URL', { default: `${getOrdermentumBaseUrl()}/v2/orders` });
const searchMethod = env('ORDERMENTUM_SEARCH_METHOD', { default: 'GET' }).toUpperCase();
const detailTemplate = env('ORDERMENTUM_ORDER_DETAIL_URL_TEMPLATE', { default: `${getOrdermentumBaseUrl()}/v1/orders/{id}` });
const searchLimiter = makeRateLimiter(Number(args['max-search-per-minute'] || env('ORDERMENTUM_MAX_SEARCH_PER_MINUTE', { default: '30' })));
const detailLimiter = makeRateLimiter(Number(args['max-detail-per-minute'] || env('ORDERMENTUM_MAX_DETAIL_PER_MINUTE', { default: '20' })));

function makeSearchBody({ window, page, cursor }) {
  const mode = env('ORDERMENTUM_SEARCH_BODY_MODE', { default: 'generic' });
  if (mode === 'raw-env') return JSON.parse(env('ORDERMENTUM_SEARCH_BODY_JSON', { required: true }));
  return {
    dateFrom: window.from,
    dateTo: window.to,
    updatedFrom: window.from,
    updatedTo: window.to,
    page,
    pageSize,
    cursor: cursor || undefined,
  };
}

async function fetchSearchPage(window, page, cursor) {
  await searchLimiter();
  if (searchMethod === 'GET') {
    const url = new URL(searchUrl);
    url.searchParams.set('supplierId', supplierId);
    url.searchParams.set('updatedAt[gte]', window.from);
    url.searchParams.set('updatedAt[lte]', window.to);
    url.searchParams.set('pageNo', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    if (cursor) url.searchParams.set('cursor', cursor);
    return ordermentumFetch(url.toString(), { method: 'GET' });
  }
  return ordermentumFetch(searchUrl, { method: searchMethod, body: JSON.stringify({ supplierId, ...makeSearchBody({ window, page, cursor }) }) });
}

async function fetchDetail(summary) {
  if (!detailTemplate) return summary;
  const identity = extractOrderIdentity(summary);
  const id = identity.externalOrderId || identity.externalOrderNumber;
  if (!id) return summary;
  await detailLimiter();
  return ordermentumFetch(templateUrl(detailTemplate, { id, orderId: id, orderNumber: identity.externalOrderNumber }), { method: 'GET' });
}

const totals = { fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0, rateLimited: 0 };
for (const window of makeWindows(from, to, windowDays)) {
  const job = dryRun ? { id: 'dry-run' } : await createApiJob({ job_type: 'BACKFILL_WINDOW', window_start: window.from, window_end: window.to });
  const batch = dryRun ? { id: 'dry-run' } : await createSyncBatch({ syncType: 'BACKFILL', dateFrom: window.from, dateTo: window.to });
  const counters = { fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0, rateLimited: 0 };
  let cursor = null;
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await fetchSearchPage(window, page, cursor);
      const { orders, cursor: nextCursor, hasMore } = extractOrders(payload);
      if (!orders.length) break;
      for (const summary of orders) {
        counters.fetched += 1;
        try {
          const detail = await fetchDetail(summary);
          if (!dryRun) {
            const result = await upsertRawOrder(detail, { batchId: batch.id, importSource: 'ORDERMENTUM_API' });
            counters[result.result] += 1;
          }
        } catch (error) {
          counters.failed += 1;
          if (error.status === 429) counters.rateLimited += 1;
          if (!dryRun) {
            const identity = extractOrderIdentity(summary);
            await recordImportError({
              job_id: job.id,
              batch_id: batch.id,
              external_order_id: identity.externalOrderId || null,
              external_order_number: identity.externalOrderNumber || null,
              external_invoice_number: identity.externalInvoiceNumber || null,
              error_stage: 'ORDER_DETAIL_OR_RAW_UPSERT',
              error_code: String(error.status || 'ERROR'),
              error_message: error.message,
              retry_after_seconds: error.retryAfter || null,
              raw_payload: { summary },
            });
          }
          if (error.status === 429 && error.retryAfter) await new Promise((resolve) => setTimeout(resolve, error.retryAfter * 1000));
        }
      }
      cursor = nextCursor;
      if (!hasMore || !cursor) break;
    }
    if (!dryRun) {
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
    }
  } catch (error) {
    counters.failed += 1;
    if (!dryRun) {
      await finishApiJob(job.id, { status: error.status === 429 ? 'RATE_LIMITED' : 'FAILED', error_message: error.message });
      await finishSyncBatch(batch.id, { status: error.status === 429 ? 'RATE_LIMITED' : 'FAILED', error_message: error.message });
    }
    throw error;
  } finally {
    Object.keys(totals).forEach((key) => { totals[key] += counters[key]; });
    console.log(`[${window.from} → ${window.to}] fetched=${counters.fetched} created=${counters.created} updated=${counters.updated} unchanged=${counters.unchanged} failed=${counters.failed}`);
  }
}
console.log(`Backfill complete: ${JSON.stringify(totals)}`);
