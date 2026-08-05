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
    || /ecoflow_(mark|refresh)_dashboard_read_models.*schema cache/i.test(message)
    || /could not find the function.*ecoflow_(mark|refresh)_dashboard_read_models/i.test(message);
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

// Mark the dashboard projections stale in a separate committed transaction,
// then attempt their bounded refresh. A refresh failure must never invalidate
// authoritative Ordermentum reconciliation; the database freshness gate makes
// dashboard and exception reads fail closed until a later refresh succeeds.
let dashboardRefreshMarked = false;
try {
  const requiredAt = await supabaseRpc(cfg, 'ecoflow_mark_dashboard_read_models_required', {});
  dashboardRefreshMarked = true;
  console.log(JSON.stringify({ action: 'mark_dashboard_read_models_required', required_at: requiredAt }));
} catch (error) {
  if (isMissingDashboardRefreshRpc(error)) {
    try {
      const refreshedKeys = await supabaseRpc(cfg, 'ecoflow_refresh_ui_active_order_keys', {});
      console.warn(JSON.stringify({
        action: 'refresh_ui_active_order_keys_deferred',
        blocking: false,
        reason: 'DASHBOARD_RPCS_NOT_DEPLOYED_YET',
        active_order_keys: refreshedKeys,
      }));
    } catch (fallbackError) {
      console.warn(JSON.stringify({
        action: 'refresh_ui_active_order_keys_deferred',
        blocking: false,
        reason: isStatementTimeout(fallbackError)
          ? 'SUPABASE_STATEMENT_TIMEOUT'
          : 'DERIVED_CACHE_REFRESH_FAILED',
        message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      }));
    }
  } else {
    console.warn(JSON.stringify({
      action: 'mark_dashboard_read_models_deferred',
      blocking: false,
      reason: isStatementTimeout(error)
        ? 'SUPABASE_STATEMENT_TIMEOUT'
        : 'DERIVED_READ_MODEL_MARK_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

if (dashboardRefreshMarked) {
  try {
    const refreshed = await supabaseRpc(cfg, 'ecoflow_refresh_dashboard_read_models', {});
    console.log(JSON.stringify({ action: 'refresh_dashboard_read_models', result: refreshed }));
  } catch (error) {
    console.warn(JSON.stringify({
      action: 'refresh_dashboard_read_models_deferred',
      blocking: false,
      fail_closed: true,
      reason: isStatementTimeout(error)
        ? 'SUPABASE_STATEMENT_TIMEOUT'
        : isMissingDashboardRefreshRpc(error)
          ? 'RPC_SCHEMA_CACHE_PENDING'
          : 'DERIVED_READ_MODEL_REFRESH_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

if (totals.failed_orders > 0) {
  console.error(`[project] ${totals.failed_orders} raw order(s) could not be projected into om_orders:`);
  console.error(JSON.stringify(lastFailures, null, 2));
}
