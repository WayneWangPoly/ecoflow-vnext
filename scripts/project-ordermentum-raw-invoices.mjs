import {
  parseArgs,
  config,
  supabaseRpc,
} from './ordermentum-full-sync-core.mjs';

const args = parseArgs();
const cfg = config();
const batchLimit = Number(args['batch-limit'] || 500);
const maxBatches = Number(args['max-batches'] || 40);

const totals = { projected_invoices: 0, failed_invoices: 0 };
let lastFailures = [];

for (let batch = 1; batch <= maxBatches; batch += 1) {
  const result = await supabaseRpc(cfg, 'ecoflow_project_ordermentum_raw_invoices', { p_limit: batchLimit });
  const summary = Array.isArray(result) ? result[0] : result;
  if (!summary || typeof summary !== 'object') {
    throw new Error(`ecoflow_project_ordermentum_raw_invoices returned an unexpected payload: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify({ action: 'project_raw_invoices_batch', batch, ...summary }));
  totals.projected_invoices += Number(summary.projected_invoices ?? 0);
  totals.failed_invoices += Number(summary.failed_invoices ?? 0);
  if (Array.isArray(summary.failures) && summary.failures.length) lastFailures = summary.failures;

  if (Number(summary.projected_invoices ?? 0) === 0) break;
}

console.log(JSON.stringify({ action: 'project_raw_invoices_complete', ...totals }, null, 2));

if (totals.failed_invoices > 0) {
  console.error(`[invoice-project] ${totals.failed_invoices} invoice payload(s) could not be projected into om_invoices:`);
  console.error(JSON.stringify(lastFailures.slice(0, 25), null, 2));
  process.exitCode = 2;
}
