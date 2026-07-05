#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const args = { mode: 'standard' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg === '--orders-only') args.mode = 'orders_only';
    else if (arg === '--master-only') args.mode = 'master_only';
  }
  return args;
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function runNode(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

function isOfficialApiHostRequiringApiKey(baseUrl) {
  return /\/\/api\.ordermentum\.com\/?$/i.test(String(baseUrl || '').trim());
}

async function runOrders(mode) {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDERMENTUM_USERNAME', 'ORDERMENTUM_PASSWORD', 'ORDERMENTUM_SUPPLIER_ID']);

  const common = ['--page-size', '20', '--max-pages', mode === 'catchup' ? '80' : '40'];
  const windowArgs = mode === 'catchup'
    ? ['--window-minutes', '10080', '--overlap-minutes', '180']
    : ['--window-minutes', '2880', '--overlap-minutes', '90'];

  console.log(`[cloud-sync] Running order incremental sync (${mode})...`);
  await runNode('scripts/ordermentum-sync-now-legacy.mjs', [...windowArgs, ...common]);
}

async function runMaster(mode) {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDERMENTUM_USERNAME', 'ORDERMENTUM_PASSWORD', 'ORDERMENTUM_SUPPLIER_ID']);

  const apiBase = process.env.ORDERMENTUM_API_BASE_URL || process.env.ORDERMENTUM_BASE_URL || 'https://app.ordermentum.com';
  process.env.ORDERMENTUM_API_BASE_URL = apiBase;
  process.env.ORDERMENTUM_BASE_URL = process.env.ORDERMENTUM_BASE_URL || 'https://app.ordermentum.com';

  if (isOfficialApiHostRequiringApiKey(apiBase) && !process.env.ORDERMENTUM_API_KEY) {
    const message = '[cloud-sync] ORDERMENTUM_API_BASE_URL is https://api.ordermentum.com but ORDERMENTUM_API_KEY is missing. Master-data sync requires API key on this host. Use ORDERMENTUM_API_BASE_URL=https://app.ordermentum.com for legacy bearer fallback, or add ORDERMENTUM_API_KEY.';
    if (mode === 'master_only') throw new Error(message);
    console.warn(message);
    console.warn('[cloud-sync] Skipping master-data sync; order sync can still continue.');
    return;
  }

  const resources = process.env.ORDERMENTUM_MASTER_RESOURCES || 'products,variants,purchasers,price_groups,invoices,leads';
  const maxPages = mode === 'catchup' ? '120' : '60';

  console.log(`[cloud-sync] Running master-data discovery via ${apiBase} for ${resources}...`);
  await runNode('scripts/ordermentum-master-data-discovery.mjs', [`--resources=${resources}`, '--page-size=5']);

  console.log(`[cloud-sync] Running master-data sync via ${apiBase} for ${resources}...`);
  await runNode('scripts/ordermentum-master-data-sync.mjs', [`--resources=${resources}`, '--page-size=50', `--max-pages=${maxPages}`]);
}

async function main() {
  const { mode } = parseArgs(process.argv);
  const valid = new Set(['standard', 'catchup', 'master_only', 'orders_only']);
  if (!valid.has(mode)) throw new Error(`Invalid mode: ${mode}`);

  console.log(`[cloud-sync] mode=${mode}`);
  console.log(`[cloud-sync] ORDERMENTUM_BASE_URL=${process.env.ORDERMENTUM_BASE_URL || '(default app host)'}`);
  console.log(`[cloud-sync] ORDERMENTUM_API_BASE_URL=${process.env.ORDERMENTUM_API_BASE_URL || process.env.ORDERMENTUM_BASE_URL || '(default app host)'}`);

  if (mode === 'orders_only') {
    await runOrders(mode);
    return;
  }
  if (mode === 'master_only') {
    await runMaster(mode);
    return;
  }

  await runOrders(mode);
  await runMaster(mode);
}

main().catch((error) => {
  console.error('[cloud-sync] FAILED');
  console.error(error);
  process.exit(1);
});
