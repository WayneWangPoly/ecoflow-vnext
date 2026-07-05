import {config, supabaseSelect} from './ordermentum-full-sync-core.mjs';

const cfg = config();
const [dashboard, progress, runs, errors] = await Promise.all([
  supabaseSelect(cfg, 'v_ecoflow_ordermentum_sync_dashboard_v2?select=*'),
  supabaseSelect(cfg, 'v_ecoflow_ordermentum_backfill_progress_v2?select=*'),
  supabaseSelect(cfg, 'v_ecoflow_ordermentum_sync_runs_recent_v2?select=*&limit=10'),
  supabaseSelect(cfg, 'ordermentum_sync_errors_v2?select=*&resolved_at=is.null&order=created_at.desc&limit=10'),
]);

console.log('\n=== Ordermentum Sync Dashboard ===');
console.table(dashboard);
console.log('\n=== Backfill Progress ===');
console.table(progress);
console.log('\n=== Recent Runs ===');
console.table(runs);
console.log('\n=== Unresolved Errors ===');
console.table(errors.map((e) => ({
  created_at: e.created_at,
  scope: e.error_scope,
  order: e.external_order_number,
  invoice: e.external_invoice_number,
  status: e.http_status,
  message: e.error_message?.slice(0, 160),
})));
