import crypto from 'node:crypto';
import { detailUrl, ordermentumFetchJson, sleep, supabaseRpc } from './ordermentum-full-sync-core.mjs';
import { retryAt } from './ordermentum-history-common.mjs';

async function countBacklog(ctx) {
  const counts = {};
  for (const status of ['PENDING', 'IN_PROGRESS', 'FAILED']) {
    const result = await ctx.db.from('ecoflow_ordermentum_order_catalog').select('order_key', { count: 'exact', head: true })
      .eq('source_status', 'PRESENT').eq('detail_status', status);
    if (result.error) throw result.error;
    counts[status.toLowerCase()] = result.count || 0;
  }
  return counts;
}

export async function runDetailSlice(ctx) {
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
  const reset = await ctx.db.from('ecoflow_ordermentum_order_catalog').update({
    detail_status: 'PENDING', detail_claim_token: null, detail_claimed_at: null,
    next_retry_at: null, last_detail_error: 'Recovered after a cancelled or stale runner.',
  }).eq('detail_status', 'IN_PROGRESS').lt('detail_claimed_at', staleBefore);
  if (reset.error) throw reset.error;

  let auditRunId = null;
  let attempted = 0; let succeeded = 0; let failed = 0; let processed = 0;
  try {
    let id = await supabaseRpc(ctx.cfg, 'ecoflow_start_ordermentum_sync_run', {
      p_run_type: 'BACKFILL', p_window_from: ctx.run.window_from, p_window_to: ctx.run.window_to,
      p_page_size: ctx.run.page_size, p_max_pages: ctx.maxPagesPerSlice,
      p_api_base_url: ctx.cfg.baseUrl, p_auth_mode: ctx.cfg.authMode,
    });
    auditRunId = Array.isArray(id) ? id[0] : id;
  } catch (error) {
    console.warn(JSON.stringify({ action: 'history_audit_run_unavailable', blocking: false, message: error instanceof Error ? error.message : String(error) }));
  }

  while (processed < ctx.maxDetailsPerSlice && Date.now() < ctx.deadline) {
    const result = await ctx.db.rpc('ecoflow_claim_ordermentum_detail_batch', {
      p_run_id: ctx.run.id, p_claim_token: crypto.randomUUID(),
      p_limit: Math.min(ctx.detailBatchSize, ctx.maxDetailsPerSlice - processed), p_max_attempts: ctx.maxDetailAttempts,
    });
    if (result.error) throw result.error;
    const rows = result.data || [];
    if (!rows.length) break;
    let batchAttempted = 0; let batchSucceeded = 0; let batchFailed = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]; attempted += 1; batchAttempted += 1; processed += 1;
      try {
        const identity = { id: row.external_order_id, number: row.external_order_number, invoiceNumber: row.invoice_number };
        const url = detailUrl(ctx.cfg.orderDetailUrlTemplate || '{{baseUrl}}/v1/orders/{{id}}', ctx.cfg, identity);
        if (!url || !identity.id) throw new Error('Ordermentum detail requires a source order id.');
        if (ctx.cfg.minDelayMs) await sleep(ctx.cfg.minDelayMs);
        const payload = await ordermentumFetchJson(ctx.cfg, url, { method: 'GET' });
        await supabaseRpc(ctx.cfg, 'ecoflow_upsert_ordermentum_raw_order_v2', { p_run_id: auditRunId, p_payload: payload, p_import_source: 'ORDERMENTUM_HISTORY_V2' });
        const update = await ctx.db.from('ecoflow_ordermentum_order_catalog').update({
          detail_status: 'COMPLETE', detail_source_updated_at: row.source_updated_at || new Date().toISOString(),
          detail_synced_at: new Date().toISOString(), detail_claim_token: null, detail_claimed_at: null,
          next_retry_at: null, last_detail_error: null,
        }).eq('order_key', row.order_key);
        if (update.error) throw update.error;
        succeeded += 1; batchSucceeded += 1;
      } catch (error) {
        failed += 1; batchFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const permanent = Number(row.detail_attempts || 0) >= ctx.maxDetailAttempts;
        const update = await ctx.db.from('ecoflow_ordermentum_order_catalog').update({
          detail_status: 'FAILED', detail_claim_token: null, detail_claimed_at: null,
          next_retry_at: permanent ? null : retryAt(Number(row.detail_attempts || 1)), last_detail_error: message.slice(0, 2000),
        }).eq('order_key', row.order_key);
        if (update.error) throw update.error;
        console.warn(JSON.stringify({ action: 'history_detail_failed', order_key: row.order_key, attempts: row.detail_attempts, permanent, message }));
      }
      if (processed % 10 === 0 || index === rows.length - 1) {
        console.log(JSON.stringify({ action: 'history_detail_progress', run_id: ctx.run.id, processed_this_slice: processed, succeeded_this_slice: succeeded, failed_this_slice: failed, backlog: await countBacklog(ctx) }));
      }
    }
    await ctx.updateRun({
      details_attempted: Number(ctx.run.details_attempted || 0) + batchAttempted,
      details_succeeded: Number(ctx.run.details_succeeded || 0) + batchSucceeded,
      details_failed: Number(ctx.run.details_failed || 0) + batchFailed, stage: 'DETAILS',
    });
  }

  const backlog = await countBacklog(ctx);
  const terminalResult = await ctx.db.from('ecoflow_ordermentum_order_catalog').select('order_key', { count: 'exact', head: true })
    .eq('source_status', 'PRESENT').eq('detail_status', 'FAILED').is('next_retry_at', null).gte('detail_attempts', ctx.maxDetailAttempts);
  if (terminalResult.error) throw terminalResult.error;
  const terminal = terminalResult.count || 0;
  const ready = backlog.pending === 0 && backlog.in_progress === 0 && backlog.failed === 0;
  await ctx.updateRun(ready
    ? { status: 'RUNNING', stage: 'READY_TO_FINALISE', last_error: null }
    : { status: terminal ? 'FAILED' : 'PAUSED', stage: 'DETAILS', last_error: terminal ? `${terminal} order detail record(s) reached the retry limit.` : null });

  if (auditRunId) {
    try {
      await supabaseRpc(ctx.cfg, 'ecoflow_finish_ordermentum_sync_run', {
        p_run_id: auditRunId, p_status: terminal ? 'FAILED' : ready ? 'SUCCEEDED' : 'PARTIAL',
        p_pages_attempted: 0, p_orders_seen: 0, p_orders_upserted: succeeded, p_orders_changed: succeeded,
        p_detail_fetch_attempted: attempted, p_detail_fetch_succeeded: succeeded, p_detail_fetch_failed: failed,
        p_rate_limited: 0, p_high_watermark_updated_at: null, p_last_error: ctx.run.last_error,
      });
    } catch (error) {
      console.warn(JSON.stringify({ action: 'history_audit_finish_failed', blocking: false, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { ready, backlog: { ...backlog, terminal } };
}
