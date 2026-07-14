import {
  parseArgs,
  config,
  sleep,
  supabaseRpc,
} from './ordermentum-full-sync-core.mjs';

const args = parseArgs();
const cfg = config();

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

function isStatementTimeout(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('57014') || /statement timeout|canceling statement due to statement timeout/i.test(message);
}

const requestedBatchLimit = positiveInteger(args['batch-limit'], 100);
const minBatchLimit = Math.min(
  requestedBatchLimit,
  positiveInteger(args['min-batch-limit'], 10),
);
const requestedMaxBatches = positiveInteger(args['max-batches'], 200);
const maxProjectedRecords = positiveInteger(
  args['max-records'],
  requestedBatchLimit * requestedMaxBatches,
);
const maxSuccessfulBatches = Math.max(
  requestedMaxBatches,
  Math.ceil(maxProjectedRecords / minBatchLimit) + 1,
);
const delayMs = positiveInteger(args['delay-ms'], 100, 0);

const totals = { projected_invoices: 0, failed_invoices: 0 };
let lastFailures = [];
let batchLimit = requestedBatchLimit;
let successfulBatches = 0;
let timeoutReductions = 0;
let converged = false;

while (successfulBatches < maxSuccessfulBatches && totals.projected_invoices < maxProjectedRecords) {
  let result;
  try {
    result = await supabaseRpc(cfg, 'ecoflow_project_ordermentum_raw_invoices', { p_limit: batchLimit });
  } catch (error) {
    if (isStatementTimeout(error) && batchLimit > minBatchLimit) {
      const previousBatchLimit = batchLimit;
      batchLimit = Math.max(minBatchLimit, Math.floor(batchLimit / 2));
      timeoutReductions += 1;
      console.warn(JSON.stringify({
        action: 'project_raw_invoices_batch_reduced',
        reason: 'SUPABASE_STATEMENT_TIMEOUT',
        previous_batch_limit: previousBatchLimit,
        next_batch_limit: batchLimit,
        timeout_reductions: timeoutReductions,
      }));
      await sleep(Math.max(delayMs, 500));
      continue;
    }
    throw error;
  }

  successfulBatches += 1;
  const summary = Array.isArray(result) ? result[0] : result;
  if (!summary || typeof summary !== 'object') {
    throw new Error(`ecoflow_project_ordermentum_raw_invoices returned an unexpected payload: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify({
    action: 'project_raw_invoices_batch',
    batch: successfulBatches,
    batch_limit: batchLimit,
    ...summary,
  }));

  totals.projected_invoices += Number(summary.projected_invoices ?? 0);
  totals.failed_invoices += Number(summary.failed_invoices ?? 0);
  if (Array.isArray(summary.failures) && summary.failures.length) lastFailures = summary.failures;

  if (Number(summary.projected_invoices ?? 0) === 0) {
    converged = true;
    break;
  }

  if (delayMs) await sleep(delayMs);
}

console.log(JSON.stringify({
  action: 'project_raw_invoices_complete',
  requested_batch_limit: requestedBatchLimit,
  final_batch_limit: batchLimit,
  successful_batches: successfulBatches,
  timeout_reductions: timeoutReductions,
  converged,
  ...totals,
}, null, 2));

if (!converged) {
  throw new Error(
    `Raw invoice projection reached its ${maxProjectedRecords}-record safety cap before a zero-result convergence probe. `
    + 'Increase --max-records only after checking the remaining projection gap.',
  );
}

if (totals.failed_invoices > 0) {
  console.error(`[invoice-project] ${totals.failed_invoices} invoice payload(s) could not be projected into om_invoices:`);
  console.error(JSON.stringify(lastFailures.slice(0, 25), null, 2));
  process.exitCode = 2;
}
