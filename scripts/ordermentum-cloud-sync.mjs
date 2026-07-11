#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const args = { mode: 'orders_invoices' };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg === '--mode' && argv[index + 1]) {
      args.mode = argv[index + 1];
      index += 1;
    } else if (arg === '--orders-only') args.mode = 'orders_invoices';
    else if (arg === '--master-only') args.mode = 'standard';
  }
  if (args.mode === 'orders_only') args.mode = 'orders_invoices';
  if (args.mode === 'master_only') args.mode = 'standard';
  return args;
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
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

async function timed(label, work) {
  const startedAt = Date.now();
  console.log(`[cloud-sync] START ${label}`);
  await work();
  console.log(`[cloud-sync] FINISH ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

async function runOrders(mode) {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDERMENTUM_USERNAME', 'ORDERMENTUM_PASSWORD', 'ORDERMENTUM_SUPPLIER_ID']);

  const catchup = mode === 'catchup';
  const standard = mode === 'standard';
  const common = catchup
    ? ['--page-size', '20', '--max-pages', '80']
    : standard
      ? ['--page-size', '30', '--max-pages', '24']
      : ['--page-size', '50', '--max-pages', '10'];
  const windowArgs = catchup
    ? ['--window-minutes', '10080', '--overlap-minutes', '180']
    : standard
      ? ['--window-minutes', '1440', '--overlap-minutes', '60']
      : ['--window-minutes', '360', '--overlap-minutes', '20'];

  await timed(`order + invoice-detail incremental sync (${mode})`, () =>
    runNode('scripts/ordermentum-sync-now-legacy.mjs', [...windowArgs, ...common]));
}

async function runMasterResources(resources, label) {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDERMENTUM_USERNAME', 'ORDERMENTUM_PASSWORD', 'ORDERMENTUM_SUPPLIER_ID']);
  const apiBase = process.env.ORDERMENTUM_API_BASE_URL || process.env.ORDERMENTUM_BASE_URL || 'https://app.ordermentum.com';
  process.env.ORDERMENTUM_API_BASE_URL = apiBase;
  process.env.ORDERMENTUM_BASE_URL = process.env.ORDERMENTUM_BASE_URL || 'https://app.ordermentum.com';

  if (isOfficialApiHostRequiringApiKey(apiBase) && !process.env.ORDERMENTUM_API_KEY) {
    throw new Error('[cloud-sync] ORDERMENTUM_API_BASE_URL uses api.ordermentum.com but ORDERMENTUM_API_KEY is missing.');
  }

  await timed(`${label} master sync via ${apiBase}`, () =>
    runNode('scripts/ordermentum-master-data-sync.mjs', [
      `--resources=${resources}`,
      '--page-size=50',
      '--max-pages=80',
    ]));
}

async function main() {
  const { mode } = parseArgs(process.argv);
  const valid = new Set(['orders_invoices', 'stores_only', 'sku_only', 'standard', 'catchup']);
  if (!valid.has(mode)) throw new Error(`Invalid mode: ${mode}`);

  console.log(`[cloud-sync] mode=${mode}`);
  console.log(`[cloud-sync] ORDERMENTUM_BASE_URL=${process.env.ORDERMENTUM_BASE_URL || '(default app host)'}`);
  console.log(`[cloud-sync] ORDERMENTUM_API_BASE_URL=${process.env.ORDERMENTUM_API_BASE_URL || process.env.ORDERMENTUM_BASE_URL || '(default app host)'}`);

  if (mode === 'orders_invoices' || mode === 'catchup') {
    await runOrders(mode);
    return;
  }
  if (mode === 'stores_only') {
    await runMasterResources('purchasers,price_groups', 'store + price group');
    return;
  }
  if (mode === 'sku_only') {
    await runMasterResources('products,variants', 'SKU product + variant');
    return;
  }

  // Manual diagnostic only. It is never scheduled and intentionally runs each domain separately.
  await runOrders(mode);
  await runMasterResources('purchasers,price_groups', 'store + price group');
  await runMasterResources('products,variants', 'SKU product + variant');
}

main().catch((error) => {
  console.error('[cloud-sync] FAILED');
  console.error(error);
  process.exit(1);
});
