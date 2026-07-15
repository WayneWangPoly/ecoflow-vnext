import crypto from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config } from './ordermentum-full-sync-core.mjs';

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const equal = arg.indexOf('=');
    if (equal > 2) out[arg.slice(2, equal)] = arg.slice(equal + 1);
    else if (!argv[i + 1] || argv[i + 1].startsWith('--')) out[arg.slice(2)] = true;
    else { out[arg.slice(2)] = argv[i + 1]; i += 1; }
  }
  return out;
}
export function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}
export function optionalIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
export function payloadHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }
export function pageCount(payload) {
  for (const value of [payload?.totalPages, payload?.pagination?.totalPages, payload?.meta?.totalPages, payload?.pageCount]) {
    const parsed = Number(value); if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
export function retryAt(attempts) {
  const minutes = Math.min(1440, Math.max(15, attempts * attempts * 15));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
export async function writeResult(path, payload) { if (path) fs.writeFileSync(path, JSON.stringify(payload, null, 2)); }
function asIso(value, fallback) {
  const parsed = new Date(value || fallback);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ISO timestamp: ${value}`);
  return parsed.toISOString();
}

export async function createHistoryContext(args) {
  const supabaseUrl = process.env.SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const mode = String(args.mode || 'resume');
  if (!['resume', 'restart'].includes(mode)) throw new Error(`Unsupported history mode: ${mode}`);
  const ctx = {
    args, mode, cfg: config(),
    db: createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    resultFile: args['result-file'] ? String(args['result-file']) : null,
    pageSize: positiveInteger(args['page-size'], 50, 1, 100),
    maxPagesPerSlice: positiveInteger(args['max-pages-per-slice'], 80, 1, 250),
    maxDetailsPerSlice: positiveInteger(args['max-details-per-slice'], 400, 1, 5000),
    detailBatchSize: positiveInteger(args['detail-batch-size'], 20, 1, 50),
    maxDetailAttempts: positiveInteger(args['max-detail-attempts'], 5, 1, 20),
    timeBudgetMinutes: positiveInteger(args['time-budget-minutes'], 45, 5, 80), run: null,
  };
  ctx.deadline = Date.now() + ctx.timeBudgetMinutes * 60_000;
  ctx.updateRun = async (patch) => {
    const result = await ctx.db.from('ecoflow_ordermentum_history_runs')
      .update({ ...patch, heartbeat_at: new Date().toISOString() }).eq('id', ctx.run.id).select('*').single();
    if (result.error) throw result.error; ctx.run = result.data;
  };
  const createRun = async () => {
    const result = await ctx.db.from('ecoflow_ordermentum_history_runs').insert({
      pipeline_key: 'ORDER_HISTORY_V2', status: 'RUNNING', stage: 'CATALOG',
      window_from: asIso(args.from, process.env.ORDERMENTUM_FULL_SYNC_FROM || '2000-01-01T00:00:00.000Z'),
      window_to: asIso(args.to, new Date().toISOString()), next_page: 1, page_size: ctx.pageSize,
      metadata: { created_by: process.env.GITHUB_RUN_ID ? 'GITHUB_ACTIONS' : 'CLI', github_run_id: process.env.GITHUB_RUN_ID || null },
    }).select('*').single();
    if (result.error) throw result.error; return result.data;
  };

  if (mode === 'restart') {
    const cancelled = await ctx.db.from('ecoflow_ordermentum_history_runs')
      .update({ status: 'CANCELLED', completed_at: new Date().toISOString(), last_error: 'Superseded by an explicit restart.' })
      .in('status', ['RUNNING', 'PAUSED', 'FAILED']).neq('stage', 'COMPLETE');
    if (cancelled.error) throw cancelled.error; ctx.run = await createRun();
  } else {
    const active = await ctx.db.from('ecoflow_ordermentum_history_runs').select('*')
      .in('status', ['RUNNING', 'PAUSED', 'FAILED']).neq('stage', 'COMPLETE')
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (active.error) throw active.error;
    if (active.data) {
      ctx.run = active.data; await ctx.updateRun({ status: 'RUNNING', last_error: null });
    } else {
      const completed = await ctx.db.from('ecoflow_ordermentum_history_runs').select('*')
        .eq('status', 'COMPLETE').eq('stage', 'COMPLETE')
        .order('completed_at', { ascending: false }).limit(1).maybeSingle();
      if (completed.error) throw completed.error;
      const restartAfterDays = positiveInteger(process.env.ORDERMENTUM_HISTORY_RESTART_AFTER_DAYS, 6, 1, 30);
      const completedAt = completed.data?.completed_at ? new Date(completed.data.completed_at).getTime() : 0;
      const aged = completedAt > 0 && Date.now() - completedAt >= restartAfterDays * 86_400_000;
      ctx.run = !completed.data || aged ? await createRun() : completed.data;
    }
  }
  return ctx;
}
