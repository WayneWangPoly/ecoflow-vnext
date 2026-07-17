#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const out = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const equal = arg.indexOf('=');
    if (equal > 2) {
      out[arg.slice(2, equal)] = arg.slice(equal + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; index += 1; }
  }
  return out;
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env, shell: false });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`)));
  });
}

async function timed(label, work) {
  const startedAt = Date.now();
  console.log(`[complete-mirror] START ${label}`);
  await work();
  console.log(`[complete-mirror] FINISH ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

function readJson(path) { return JSON.parse(fs.readFileSync(path, 'utf8')); }
function isoDaysAgo(days) { return new Date(Date.now() - days * 86_400_000).toISOString(); }
function time(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

const args = parseArgs(process.argv);
const legacyScope = args.scope ? String(args.scope) : null;
const mode = String(args.mode || (legacyScope === 'full_history' ? 'resume_history' : 'recent'));
if (!['recent', 'resume_history', 'restart_history', 'verify_only'].includes(mode)) throw new Error(`Unsupported complete mirror mode: ${mode}`);

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDERMENTUM_USERNAME', 'ORDERMENTUM_PASSWORD', 'ORDERMENTUM_SUPPLIER_ID']);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const timeBudgetMinutes = String(args['time-budget-minutes'] || process.env.ORDERMENTUM_HISTORY_SLICE_MINUTES || 45);
const degradedExitMode = String(args['degraded-exit-mode'] || process.env.ORDERMENTUM_DEGRADED_EXIT_MODE || 'always').toLowerCase();
if (!['always', 'transition', 'never'].includes(degradedExitMode)) throw new Error(`Unsupported degraded exit mode: ${degradedExitMode}`);
const resultFile = '/tmp/ordermentum-history-pipeline-result.json';
const mirrorStart = new Date().toISOString();

console.log(JSON.stringify({ action: 'complete_mirror_start', mode, mirrorStart, timeBudgetMinutes: Number(timeBudgetMinutes), degradedExitMode }, null, 2));

async function runFinalisationData({ scope, historyRunId = null }) {
  await timed('complete Ordermentum master mirror', () => runNode('scripts/ordermentum-master-data-sync.mjs', [
    '--resources=purchasers,price_groups,products,variants,invoices,stock_locations', '--page-size=50', '--max-pages=200', '--detail', '--detail-changed-only', '--delay-ms=300',
  ]));
  await timed('complete invoice detail mirror', () => runNode('scripts/ordermentum-invoice-detail-sync.mjs', ['--page-size=500', '--limit=10000', '--delay-ms=300']));
  await timed('project raw orders', () => runNode('scripts/project-ordermentum-raw-orders.mjs', ['--batch-limit', '100', '--min-batch-limit', '5', '--max-batches', '400', '--delay-ms', '100']));
  await timed('project raw invoices', () => runNode('scripts/project-ordermentum-raw-invoices.mjs', ['--batch-limit', '100', '--min-batch-limit', '10', '--max-batches', '400', '--delay-ms', '100']));
  await timed('finalise Ordermentum source presence', () => runNode('scripts/finalise-ordermentum-source-presence.mjs', [
    `--scope=${scope}`, `--mirror-start=${mirrorStart}`, ...(historyRunId ? [`--history-run-id=${historyRunId}`] : []),
  ]));
}

async function verifyMirror(requireHistory) {
  await timed(requireHistory ? 'verify completed history contract' : 'verify complete mirror', () =>
    runNode('scripts/verify-ordermentum-complete-mirror.mjs', [
      `--require-history=${requireHistory ? 'true' : 'false'}`,
      `--degraded-exit-mode=${degradedExitMode}`,
    ]));
}

async function loadHistoryRun(historyRunId) {
  const result = await db.from('ecoflow_ordermentum_history_runs')
    .select('id,status,stage,started_at,heartbeat_at,metadata')
    .eq('id', historyRunId)
    .single();
  if (result.error || !result.data) throw result.error || new Error(`History run ${historyRunId} is unavailable.`);
  return result.data;
}

async function latestFullPresenceAt() {
  const result = await db.from('ecoflow_ordermentum_source_presence')
    .select('last_full_mirror_at')
    .not('last_full_mirror_at', 'is', null)
    .order('last_full_mirror_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.last_full_mirror_at || null;
}

async function saveFinalisationCheckpoint(run, patch) {
  const metadata = { ...(run.metadata || {}), ...patch };
  const result = await db.from('ecoflow_ordermentum_history_runs')
    .update({ metadata, heartbeat_at: new Date().toISOString() })
    .eq('id', run.id)
    .select('id,metadata')
    .single();
  if (result.error || !result.data) throw result.error || new Error(`Could not save finalisation checkpoint for ${run.id}.`);
  return result.data.metadata;
}

async function ensureHistoryFinalised(historyRunId) {
  const run = await loadHistoryRun(historyRunId);
  const existing = run.metadata?.finalisation_completed_at;
  if (existing) {
    console.log(JSON.stringify({
      action: 'complete_mirror_finalisation_reused',
      historyRunId,
      finalisationCompletedAt: existing,
      inferred: Boolean(run.metadata?.finalisation_checkpoint_inferred),
    }, null, 2));
    return;
  }

  const latestPresenceAt = await latestFullPresenceAt();
  if (run.stage === 'READY_TO_FINALISE' && time(latestPresenceAt) >= time(run.started_at)) {
    const completedAt = latestPresenceAt || new Date().toISOString();
    await saveFinalisationCheckpoint(run, {
      finalisation_completed_at: completedAt,
      finalisation_mirror_start: completedAt,
      finalisation_checkpoint_inferred: true,
    });
    console.log(JSON.stringify({
      action: 'complete_mirror_finalisation_recovered',
      historyRunId,
      finalisationCompletedAt: completedAt,
      reason: 'A full source-presence checkpoint newer than this history run proves the data finalisation stages already completed.',
    }, null, 2));
    return;
  }

  await runFinalisationData({ scope: 'full_history', historyRunId });
  const completedAt = new Date().toISOString();
  await saveFinalisationCheckpoint(run, {
    finalisation_completed_at: completedAt,
    finalisation_mirror_start: mirrorStart,
    finalisation_checkpoint_inferred: false,
  });
  console.log(JSON.stringify({ action: 'complete_mirror_finalisation_checkpointed', historyRunId, finalisationCompletedAt: completedAt }, null, 2));
}

if (mode === 'verify_only') {
  await verifyMirror(true);
  console.log(JSON.stringify({ action: 'complete_mirror_verified', mode, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

if (mode === 'recent') {
  const from = isoDaysAgo(Number(process.env.ORDERMENTUM_COMPLETE_RECENT_DAYS || 7));
  const to = new Date().toISOString();
  await timed('recent order detail reconciliation', () => runNode('scripts/ordermentum-sync-now-legacy.mjs', [
    '--script', 'scripts/ordermentum-backfill-window.mjs', '--from', from, '--to', to, '--page-size', '50', '--max-pages', '100',
  ]));
  await runFinalisationData({ scope: 'recent' });
  await verifyMirror(false);
  console.log(JSON.stringify({ action: 'complete_mirror_succeeded', mode, mirrorStart, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

try { fs.unlinkSync(resultFile); } catch {}
const historyMode = mode === 'restart_history' ? 'restart' : 'resume';
await timed(`resumable order history slice (${historyMode})`, () => runNode('scripts/ordermentum-sync-now-legacy.mjs', [
  '--script', 'scripts/ordermentum-history-pipeline.mjs', '--mode', historyMode,
  '--time-budget-minutes', timeBudgetMinutes,
  '--max-pages-per-slice', String(args['max-pages-per-slice'] || 80),
  '--max-details-per-slice', String(args['max-details-per-slice'] || 400),
  '--result-file', resultFile,
]));

const history = readJson(resultFile);
if (String(history.state || '').startsWith('PAUSED')) {
  console.log(JSON.stringify({ action: 'complete_mirror_paused', blocking: false, mode, history, nextAction: 'Run resume_history again; completed pages and details are retained.' }, null, 2));
  process.exit(0);
}
if (history.state === 'FAILED') throw new Error(`Resumable history pipeline failed: ${history.message || 'unknown failure'}`);
const historyRunId = history.runId;
if (!historyRunId) throw new Error(`History pipeline returned no run id: ${JSON.stringify(history)}`);

if (history.state === 'READY_TO_FINALISE') {
  await ensureHistoryFinalised(historyRunId);
  await verifyMirror(false);
  const run = await loadHistoryRun(historyRunId);
  const result = await db.from('ecoflow_ordermentum_history_runs').update({
    status: 'COMPLETE',
    stage: 'COMPLETE',
    completed_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    last_error: null,
    metadata: { ...(run.metadata || {}), verification_completed_at: new Date().toISOString(), verification_mode: 'LIGHTWEIGHT_DIRECT_V4' },
  }).eq('id', historyRunId).select('id').single();
  if (result.error || !result.data) throw result.error || new Error('Could not mark history pipeline complete.');
  await verifyMirror(true);
  console.log(JSON.stringify({ action: 'complete_mirror_succeeded', mode, historyRunId, mirrorStart, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

if (history.state === 'COMPLETE') {
  await verifyMirror(true);
  console.log(JSON.stringify({ action: 'complete_mirror_succeeded', mode, historyRunId, mirrorStart, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

throw new Error(`Unexpected history pipeline state: ${JSON.stringify(history)}`);
