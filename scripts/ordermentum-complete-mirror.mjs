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

const args = parseArgs(process.argv);
const legacyScope = args.scope ? String(args.scope) : null;
const mode = String(args.mode || (legacyScope === 'full_history' ? 'resume_history' : 'recent'));
if (!['recent', 'resume_history', 'restart_history', 'verify_only'].includes(mode)) throw new Error(`Unsupported complete mirror mode: ${mode}`);

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDERMENTUM_USERNAME', 'ORDERMENTUM_PASSWORD', 'ORDERMENTUM_SUPPLIER_ID']);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const timeBudgetMinutes = String(args['time-budget-minutes'] || process.env.ORDERMENTUM_HISTORY_SLICE_MINUTES || 45);
const resultFile = '/tmp/ordermentum-history-pipeline-result.json';
const mirrorStart = new Date().toISOString();

console.log(JSON.stringify({ action: 'complete_mirror_start', mode, mirrorStart, timeBudgetMinutes: Number(timeBudgetMinutes) }, null, 2));

async function projectAndVerify({ scope, historyRunId = null, requireHistory = false }) {
  await timed('complete Ordermentum master mirror', () => runNode('scripts/ordermentum-master-data-sync.mjs', [
    '--resources=purchasers,price_groups,products,variants,invoices,stock_locations', '--page-size=50', '--max-pages=200', '--detail', '--detail-changed-only', '--delay-ms=300',
  ]));
  await timed('complete invoice detail mirror', () => runNode('scripts/ordermentum-invoice-detail-sync.mjs', ['--page-size=500', '--limit=10000', '--delay-ms=300']));
  await timed('project raw orders', () => runNode('scripts/project-ordermentum-raw-orders.mjs', ['--batch-limit', '100', '--min-batch-limit', '5', '--max-batches', '400', '--delay-ms', '100']));
  await timed('project raw invoices', () => runNode('scripts/project-ordermentum-raw-invoices.mjs', ['--batch-limit', '100', '--min-batch-limit', '10', '--max-batches', '400', '--delay-ms', '100']));
  await timed('finalise Ordermentum source presence', () => runNode('scripts/finalise-ordermentum-source-presence.mjs', [
    `--scope=${scope}`, `--mirror-start=${mirrorStart}`, ...(historyRunId ? [`--history-run-id=${historyRunId}`] : []),
  ]));
  await timed('verify complete mirror', () => runNode('scripts/verify-ordermentum-complete-mirror.mjs', [`--require-history=${requireHistory ? 'true' : 'false'}`]));
}

if (mode === 'verify_only') {
  await timed('verify complete mirror', () => runNode('scripts/verify-ordermentum-complete-mirror.mjs', ['--require-history=true']));
  console.log(JSON.stringify({ action: 'complete_mirror_verified', mode, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

if (mode === 'recent') {
  const from = isoDaysAgo(Number(process.env.ORDERMENTUM_COMPLETE_RECENT_DAYS || 7));
  const to = new Date().toISOString();
  await timed('recent order detail reconciliation', () => runNode('scripts/ordermentum-sync-now-legacy.mjs', [
    '--script', 'scripts/ordermentum-backfill-window.mjs', '--from', from, '--to', to, '--page-size', '50', '--max-pages', '100',
  ]));
  await projectAndVerify({ scope: 'recent', requireHistory: false });
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
  await projectAndVerify({ scope: 'full_history', historyRunId, requireHistory: false });
  const result = await db.from('ecoflow_ordermentum_history_runs').update({
    status: 'COMPLETE', stage: 'COMPLETE', completed_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), last_error: null,
  }).eq('id', historyRunId).select('id').single();
  if (result.error || !result.data) throw result.error || new Error('Could not mark history pipeline complete.');
  await timed('verify completed history contract', () => runNode('scripts/verify-ordermentum-complete-mirror.mjs', ['--require-history=true']));
  console.log(JSON.stringify({ action: 'complete_mirror_succeeded', mode, historyRunId, mirrorStart, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}

if (history.state === 'COMPLETE') {
  await timed('verify completed history contract', () => runNode('scripts/verify-ordermentum-complete-mirror.mjs', ['--require-history=true']));
  console.log(JSON.stringify({ action: 'complete_mirror_succeeded', mode, historyRunId, mirrorStart, completedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}
throw new Error(`Unexpected history pipeline state: ${JSON.stringify(history)}`);
