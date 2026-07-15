#!/usr/bin/env node
import { createHistoryContext, parseArgs, writeResult } from './ordermentum-history-common.mjs';
import { runCatalogSlice } from './ordermentum-history-catalog.mjs';
import { runDetailSlice } from './ordermentum-history-details.mjs';

const args = parseArgs();
let ctx;

async function main() {
  ctx = await createHistoryContext(args);
  const run = ctx.run;
  if (run.status === 'COMPLETE' && run.stage === 'COMPLETE') {
    const payload = { action: 'history_pipeline_already_complete', state: 'COMPLETE', runId: run.id, completedAt: run.completed_at };
    console.log(JSON.stringify(payload, null, 2)); await writeResult(ctx.resultFile, payload); return;
  }

  console.log(JSON.stringify({
    action: 'history_pipeline_start', mode: ctx.mode, run_id: run.id, status: run.status, stage: run.stage,
    window_from: run.window_from, window_to: run.window_to, next_page: run.next_page,
    time_budget_minutes: ctx.timeBudgetMinutes, max_pages_per_slice: ctx.maxPagesPerSlice,
    max_details_per_slice: ctx.maxDetailsPerSlice,
  }, null, 2));

  if (!ctx.run.catalog_complete || ctx.run.stage === 'CATALOG') {
    if (!await runCatalogSlice(ctx)) {
      const payload = { action: 'history_pipeline_paused', state: 'PAUSED_CATALOG', runId: ctx.run.id, nextPage: ctx.run.next_page, pagesCompleted: ctx.run.pages_completed, summariesSeen: ctx.run.summaries_seen };
      console.log(JSON.stringify(payload, null, 2)); await writeResult(ctx.resultFile, payload); return;
    }
    const latest = await ctx.db.from('ecoflow_ordermentum_history_runs').select('*').eq('id', ctx.run.id).single();
    if (latest.error) throw latest.error; ctx.run = latest.data;
  }

  const detail = await runDetailSlice(ctx);
  const payload = detail.ready
    ? { action: 'history_pipeline_ready', state: 'READY_TO_FINALISE', runId: ctx.run.id, backlog: detail.backlog }
    : { action: 'history_pipeline_paused', state: ctx.run.status === 'FAILED' ? 'FAILED' : 'PAUSED_DETAILS', runId: ctx.run.id, backlog: detail.backlog, message: ctx.run.last_error };
  console.log(JSON.stringify(payload, null, 2)); await writeResult(ctx.resultFile, payload);
  if (ctx.run.status === 'FAILED') process.exitCode = 1;
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ action: 'history_pipeline_failed', message }));
  try {
    if (ctx?.run?.id) await ctx.db.from('ecoflow_ordermentum_history_runs').update({ status: 'FAILED', heartbeat_at: new Date().toISOString(), last_error: message.slice(0, 4000) }).eq('id', ctx.run.id);
    await writeResult(ctx?.resultFile, { action: 'history_pipeline_failed', state: 'FAILED', runId: ctx?.run?.id || null, message });
  } catch (updateError) { console.error(updateError); }
  process.exit(1);
});
