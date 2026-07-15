import {
  extractArray, extractOrderIdentity, hasNextPage, makeSearchRequest, ordermentumFetchJson, sleep,
} from './ordermentum-full-sync-core.mjs';
import { optionalIso, pageCount, payloadHash } from './ordermentum-history-common.mjs';

function createdAt(order) { return order?.createdAt || order?.created_at || order?.orderDate || order?.date || null; }

export async function runCatalogSlice(ctx) {
  let page = Number(ctx.run.next_page || 1);
  let pagesThisSlice = 0;
  while (pagesThisSlice < ctx.maxPagesPerSlice && Date.now() < ctx.deadline) {
    const request = makeSearchRequest(ctx.cfg, { from: ctx.run.window_from, to: ctx.run.window_to, page, limit: ctx.run.page_size });
    const startedAt = Date.now();
    const payload = await ordermentumFetchJson(ctx.cfg, request.url, {
      method: request.method, body: request.body ? JSON.stringify(request.body) : undefined,
    });
    const orders = extractArray(payload);
    const rows = orders.map((summary) => {
      const identity = extractOrderIdentity(summary);
      return {
        order_key: String(identity.id || identity.number || `summary_${payloadHash(summary).slice(0, 24)}`),
        external_order_id: identity.id ? String(identity.id) : null,
        external_order_number: identity.number ? String(identity.number) : null,
        invoice_number: identity.invoiceNumber ? String(identity.invoiceNumber) : null,
        source_created_at: optionalIso(createdAt(summary)), source_updated_at: optionalIso(identity.updatedAt),
        summary_payload: summary, summary_hash: payloadHash(summary),
      };
    });
    let catalog = null;
    if (rows.length) {
      const result = await ctx.db.rpc('ecoflow_upsert_ordermentum_catalog_page', { p_run_id: ctx.run.id, p_rows: rows });
      if (result.error) throw result.error;
      catalog = result.data;
    }
    const more = hasNextPage(payload, orders, page, ctx.run.page_size);
    pagesThisSlice += 1;
    await ctx.updateRun({
      next_page: more ? page + 1 : page,
      pages_completed: Number(ctx.run.pages_completed || 0) + 1,
      summaries_seen: Number(ctx.run.summaries_seen || 0) + orders.length,
      metadata: { ...(ctx.run.metadata || {}), last_catalog_page: page, source_total_pages: pageCount(payload), last_page_items: orders.length },
    });
    console.log(JSON.stringify({ action: 'history_catalog_page', run_id: ctx.run.id, page, total_pages: pageCount(payload), items: orders.length, has_next_page: more, elapsed_ms: Date.now() - startedAt, catalog, next_page: more ? page + 1 : null }));
    if (!more || orders.length === 0) {
      const result = await ctx.db.rpc('ecoflow_finalise_ordermentum_catalog_scan', { p_run_id: ctx.run.id });
      if (result.error) throw result.error;
      console.log(JSON.stringify({ action: 'history_catalog_complete', run_id: ctx.run.id, page, result: result.data }, null, 2));
      return true;
    }
    page += 1;
    if (ctx.cfg.minDelayMs) await sleep(Math.min(ctx.cfg.minDelayMs, 1500));
  }
  await ctx.updateRun({ status: 'PAUSED', stage: 'CATALOG' });
  return false;
}
