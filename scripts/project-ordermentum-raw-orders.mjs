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

function isMissingDashboardRefreshRpc(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('PGRST202')
    || /ecoflow_refresh_dashboard_read_models.*schema cache/i.test(message)
    || /could not find the function.*ecoflow_refresh_dashboard_read_models/i.test(message);
}

const requestedBatchLimit = positiveInteger(args['batch-limit'], 100);
const minBatchLimit = Math.min(
  requestedBatchLimit,
  positiveInteger(args['min-batch-limit'], 5),
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

const totals = { projected_orders: 0, projected_invoices: 0, projected_lines: 0, failed_orders: 0 };
let lastFailures = [];
let batchLimit = requestedBatchLimit;
let successfulBatches = 0;
let timeoutReductions = 0;
let converged = false;

while (successfulBatches < maxSuccessfulBatches && totals.projected_orders < maxProjectedRecords) {
  let result;
  try {
    result = await supabaseRpc(cfg, 'ecoflow_project_ordermentum_raw_orders', { p_limit: batchLimit });
  } catch (error) {
    if (isStatementTimeout(error) && batchLimit > minBatchLimit) {
      const previousBatchLimit = batchLimit;
      batchLimit = Math.max(minBatchLimit, Math.floor(batchLimit / 2));
      timeoutReductions += 1;
      console.warn(JSON.stringify({
        action: 'project_raw_orders_batch_reduced',
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
    throw new Error(`ecoflow_project_ordermentum_raw_orders returned an unexpected payload: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify({
    action: 'project_raw_orders_batch',
    batch: successfulBatches,
    batch_limit: batchLimit,
    ...summary,
  }));

  for (const key of Object.keys(totals)) totals[key] += Number(summary[key] ?? 0);
  if (Array.isArray(summary.failures) && summary.failures.length) lastFailures = summary.failures;

  // A zero-result probe proves that every projectable raw order has either
  // landed or is represented by the permanent per-order failures returned by
  // the RPC. Do not infer convergence merely from reaching a fixed batch count.
  if (Number(summary.projected_orders ?? 0) === 0) {
    converged = true;
    break;
  }

  if (delayMs) await sleep(delayMs);
}

console.log(JSON.stringify({
  action: 'project_raw_orders_complete',
  requested_batch_limit: requestedBatchLimit,
  final_batch_limit: batchLimit,
  successful_batches: successfulBatches,
  timeout_reductions: timeoutReductions,
  converged,
  ...totals,
}, null, 2));

if (!converged) {
  throw new Error(
    `Raw order projection reached its ${maxProjectedRecords}-record safety cap before a zero-result convergence probe. `
    + 'Increase --max-records only after checking the remaining projection gap.',
  );
}

// Refresh the indexed active-order key set and the current-exception snapshot
// only after projection converges. This keeps browser reads bounded while the
// commercial order and inventory tables remain authoritative.
try {
  const refreshed = await supabaseRpc(cfg, 'ecoflow_refresh_dashboard_read_models', {});
  console.log(JSON.stringify({ action: 'refresh_dashboard_read_models', result: refreshed }));
} catch (error) {
  // During the short rollout window where workflow code reaches main before the
  // migration, retain the previous active-key refresh. Every other refresh
  // failure is blocking: a successful sync must not publish a stale exception queue.
  if (isMissingDashboardRefreshRpc(error)) {
    const refreshedKeys = await supabaseRpc(cfg, 'ecoflow_refresh_ui_active_order_keys', {});
    console.warn(JSON.stringify({
      action: 'refresh_dashboard_read_models_deferred',
      reason: 'RPC_NOT_DEPLOYED_YET',
      active_order_keys: refreshedKeys,
    }));
  } else {
    throw new Error(
      `Dashboard read-model refresh failed after successful projection: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

if (totals.failed_orders > 0) {
  console.error(`[project] ${totals.failed_orders} raw order(s) could not be projected into om_orders:`);
  console.error(JSON.stringify(lastFailures, null, 2));
}
