import {
  parseArgs,
  config,
  supabaseRpc,
} from './ordermentum-full-sync-core.mjs';

const args = parseArgs();
const cfg = config();
const batchLimit = Number(args['batch-limit'] || 500);
const maxBatches = Number(args['max-batches'] || 20);

const totals = { projected_orders: 0, projected_invoices: 0, projected_lines: 0, failed_orders: 0 };
let lastFailures = [];

for (let batch = 1; batch <= maxBatches; batch += 1) {
  const result = await supabaseRpc(cfg, 'ecoflow_project_ordermentum_raw_orders', { p_limit: batchLimit });
  const summary = Array.isArray(result) ? result[0] : result;
  if (!summary || typeof summary !== 'object') {
    throw new Error(`ecoflow_project_ordermentum_raw_orders returned an unexpected payload: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify({ action: 'project_raw_orders_batch', batch, ...summary }));
  for (const key of Object.keys(totals)) totals[key] += Number(summary[key] ?? 0);
  if (Array.isArray(summary.failures) && summary.failures.length) lastFailures = summary.failures;

  // Stop when nothing new was projected; anything still pending is a
  // permanent per-order failure already reported above.
  if (Number(summary.projected_orders ?? 0) === 0) break;
}

console.log(JSON.stringify({ action: 'project_raw_orders_complete', ...totals }, null, 2));

if (totals.failed_orders > 0) {
  console.error(`[project] ${totals.failed_orders} raw order(s) could not be projected into om_orders:`);
  console.error(JSON.stringify(lastFailures, null, 2));
}
