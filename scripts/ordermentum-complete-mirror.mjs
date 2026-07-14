#!/usr/bin/env node
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const out = { scope: 'recent' };
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    out[key] = value ?? true;
  }
  return out;
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      env: process.env,
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

async function timed(label, work) {
  const startedAt = Date.now();
  console.log(`[complete-mirror] START ${label}`);
  await work();
  console.log(`[complete-mirror] FINISH ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const args = parseArgs(process.argv);
const scope = String(args.scope || 'recent');
if (!['recent', 'full_history'].includes(scope)) throw new Error(`Unsupported complete mirror scope: ${scope}`);

requireEnv([
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ORDERMENTUM_USERNAME',
  'ORDERMENTUM_PASSWORD',
  'ORDERMENTUM_SUPPLIER_ID',
]);

const mirrorStart = new Date().toISOString();
const from = scope === 'full_history'
  ? (process.env.ORDERMENTUM_FULL_SYNC_FROM || '2000-01-01T00:00:00.000Z')
  : isoDaysAgo(Number(process.env.ORDERMENTUM_COMPLETE_RECENT_DAYS || 90));
const to = new Date().toISOString();
const maxPages = scope === 'full_history' ? '250' : '100';

console.log(JSON.stringify({ action: 'complete_mirror_start', scope, mirrorStart, from, to }, null, 2));

await timed(`complete order detail mirror (${scope})`, () => runNode('scripts/ordermentum-sync-now-legacy.mjs', [
  '--script', 'scripts/ordermentum-backfill-window.mjs',
  '--from', from,
  '--to', to,
  '--page-size', '50',
  '--max-pages', maxPages,
]));

await timed('complete Ordermentum master mirror', () => runNode('scripts/ordermentum-master-data-sync.mjs', [
  '--resources=purchasers,price_groups,products,variants,invoices,stock_locations',
  '--page-size=50',
  '--max-pages=200',
  '--detail',
  '--delay-ms=300',
]));

await timed('complete invoice detail mirror', () => runNode('scripts/ordermentum-invoice-detail-sync.mjs', [
  '--page-size=500',
  '--limit=10000',
  '--delay-ms=300',
]));

// Projection RPCs parse JSON and upsert orders, invoices and lines inside one
// database transaction. Start conservatively and let the projection scripts
// reduce their batch again when Supabase reports SQLSTATE 57014.
await timed('project raw orders', () => runNode('scripts/project-ordermentum-raw-orders.mjs', [
  '--batch-limit', '100',
  '--min-batch-limit', '5',
  '--max-batches', '400',
  '--delay-ms', '100',
]));

await timed('project raw invoices', () => runNode('scripts/project-ordermentum-raw-invoices.mjs', [
  '--batch-limit', '100',
  '--min-batch-limit', '10',
  '--max-batches', '400',
  '--delay-ms', '100',
]));

await timed('finalise Ordermentum source presence', () => runNode('scripts/finalise-ordermentum-source-presence.mjs', [
  `--scope=${scope}`,
  `--mirror-start=${mirrorStart}`,
]));

await timed('verify complete mirror', () => runNode('scripts/verify-ordermentum-complete-mirror.mjs'));

console.log(JSON.stringify({ action: 'complete_mirror_succeeded', scope, mirrorStart, completedAt: new Date().toISOString() }, null, 2));
