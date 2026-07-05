import {
  sleep,
  parseArgs,
  config,
  supabaseRpc,
  makeSearchRequest,
  extractArray,
  hasNextPage,
  ordermentumFetchJson,
  extractOrderIdentity,
  detailUrl,
} from './ordermentum-full-sync-core.mjs';

const args = parseArgs();
const dryRunArg = Boolean(args['dry-run']);
const noSupabaseLogArg = Boolean(args['no-supabase-log']) || (dryRunArg && process.env.ORDERMENTUM_DRY_RUN_NO_SUPABASE === 'true');
if (noSupabaseLogArg) process.env.ORDERMENTUM_SKIP_SUPABASE = 'true';
const cfg = config();

const from = args.from;
const to = args.to;
const limit = Number(args['page-size'] || args.limit || 50);
const maxPages = Number(args['max-pages'] || 10);
const dryRun = dryRunArg;
const fetchDetail = args['fetch-detail'] !== 'false';
const noSupabaseLog = noSupabaseLogArg;

if (!from || !to) {
  throw new Error('Usage: node scripts/ordermentum-backfill-window.mjs --from 2026-01-01T00:00:00Z --to 2026-01-08T00:00:00Z [--page-size 50] [--max-pages 10] [--dry-run]');
}

let runId = null;
const counters = {
  pages: 0,
  ordersSeen: 0,
  ordersUpserted: 0,
  ordersChanged: 0,
  detailAttempted: 0,
  detailSucceeded: 0,
  detailFailed: 0,
  rateLimited: 0,
  highWatermark: null,
};

try {
  if (!noSupabaseLog) {
    runId = await supabaseRpc(cfg, 'ecoflow_start_ordermentum_sync_run', {
    p_run_type: 'BACKFILL',
    p_window_from: from,
    p_window_to: to,
    p_page_size: limit,
    p_max_pages: maxPages,
    p_api_base_url: cfg.baseUrl,
    p_auth_mode: cfg.authMode,
  });
    runId = Array.isArray(runId) ? runId[0] : runId;
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const req = makeSearchRequest(cfg, {from, to, page, limit});
    const payload = await ordermentumFetchJson(cfg, req.url, {
      method: req.method,
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
    counters.pages += 1;

    const orders = extractArray(payload);
    if (orders.length === 0) break;

    for (const summary of orders) {
      counters.ordersSeen += 1;
      const identity = extractOrderIdentity(summary);
      let rawOrder = summary;

      if (fetchDetail) {
        const url = detailUrl(cfg.orderDetailUrlTemplate || '{{baseUrl}}/v1/orders/{{id}}', cfg, identity);
        if (url && identity.id) {
          counters.detailAttempted += 1;
          try {
            await sleep(cfg.minDelayMs);
            rawOrder = await ordermentumFetchJson(cfg, url, {method: 'GET'});
            counters.detailSucceeded += 1;
          } catch (error) {
            counters.detailFailed += 1;
            if (error.status === 429) counters.rateLimited += 1;
            if (!noSupabaseLog && runId) await supabaseRpc(cfg, 'ecoflow_record_ordermentum_sync_error', {
              p_run_id: runId,
              p_error_scope: 'ORDER_DETAIL',
              p_error_message: error.message,
              p_external_order_id: identity.id,
              p_external_order_number: identity.number,
              p_external_invoice_number: identity.invoiceNumber,
              p_http_status: error.status || null,
              p_error_payload: error.payload || null,
              p_retryable: true,
            });
          }
        }
      }

      const rawIdentity = extractOrderIdentity(rawOrder);
      if (rawIdentity.updatedAt) {
        const updatedAt = new Date(rawIdentity.updatedAt);
        if (!Number.isNaN(updatedAt.valueOf())) {
          if (!counters.highWatermark || updatedAt > new Date(counters.highWatermark)) counters.highWatermark = updatedAt.toISOString();
        }
      }

      if (!dryRun) {
        const result = await supabaseRpc(cfg, 'ecoflow_upsert_ordermentum_raw_order_v2', {
          p_run_id: runId,
          p_payload: rawOrder,
          p_import_source: 'ORDERMENTUM_BACKFILL',
        });
        const row = Array.isArray(result) ? result[0] : result;
        counters.ordersUpserted += 1;
        if (row?.changed) counters.ordersChanged += 1;
      }
    }

    if (!hasNextPage(payload, orders, page, limit)) break;
    await sleep(cfg.minDelayMs);
  }

  if (!noSupabaseLog && runId) await supabaseRpc(cfg, 'ecoflow_finish_ordermentum_sync_run', {
    p_run_id: runId,
    p_status: dryRun ? 'CANCELLED' : 'SUCCEEDED',
    p_pages_attempted: counters.pages,
    p_orders_seen: counters.ordersSeen,
    p_orders_upserted: counters.ordersUpserted,
    p_orders_changed: counters.ordersChanged,
    p_detail_fetch_attempted: counters.detailAttempted,
    p_detail_fetch_succeeded: counters.detailSucceeded,
    p_detail_fetch_failed: counters.detailFailed,
    p_rate_limited: counters.rateLimited,
    p_high_watermark_updated_at: counters.highWatermark,
    p_last_error: dryRun ? 'Dry run only; no raw orders were written.' : null,
  });

  console.log(JSON.stringify({runId, dryRun, noSupabaseLog, from, to, ...counters}, null, 2));
} catch (error) {
  if (!noSupabaseLog && runId) {
    if (!noSupabaseLog && runId) await supabaseRpc(cfg, 'ecoflow_finish_ordermentum_sync_run', {
      p_run_id: runId,
      p_status: 'FAILED',
      p_pages_attempted: counters.pages,
      p_orders_seen: counters.ordersSeen,
      p_orders_upserted: counters.ordersUpserted,
      p_orders_changed: counters.ordersChanged,
      p_detail_fetch_attempted: counters.detailAttempted,
      p_detail_fetch_succeeded: counters.detailSucceeded,
      p_detail_fetch_failed: counters.detailFailed,
      p_rate_limited: counters.rateLimited,
      p_high_watermark_updated_at: counters.highWatermark,
      p_last_error: error.message,
    });
  }
  throw error;
}
