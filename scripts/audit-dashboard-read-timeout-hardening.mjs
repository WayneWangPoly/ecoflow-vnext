#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260805225500_dashboard_read_timeout_hardening.sql';
const dashboardPath = 'src/features/dashboard/DashboardPage.tsx';
const repositoryPath = 'src/data/repositories/dashboardReadiness.ts';
const projectionPath = 'scripts/project-ordermentum-raw-orders.mjs';

const [migration, dashboard, repository, projection] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(dashboardPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(projectionPath, 'utf8'),
]);

function includesAll(source, values, label) {
  values.forEach((value) => assert.ok(
    source.includes(value),
    `${label} is missing required contract: ${value}`,
  ));
}

includesAll(migration, [
  'ecoflow_current_exception_snapshot',
  'v_ecoflow_ordermentum_ui_active_exceptions_live_v1',
  'ecoflow_mark_dashboard_read_models_required',
  'ecoflow_assert_current_exception_snapshot',
  'ACTIONABLE_EXCEPTION_SNAPSHOT_STALE',
  'ecoflow_refresh_current_exception_snapshot',
  'ecoflow_refresh_dashboard_read_models',
  'ecoflow_get_dashboard_readiness_v1',
  "set statement_timeout='180s'",
  "set statement_timeout='8s'",
  'from public.ecoflow_inventory_movements m',
  'from public.ecoflow_sku_barcode_registry',
  "analytics.get_actionable_exception_queue(integer)",
  "analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamptz,text,text)",
  'perform public.ecoflow_assert_current_exception_snapshot()',
], 'timeout-hardening migration');

assert.ok(
  migration.includes("grant execute on function public.ecoflow_get_dashboard_readiness_v1()\n  to authenticated"),
  'interactive readiness RPC must be granted only through its function boundary',
);
assert.ok(
  migration.includes("grant execute on function public.ecoflow_refresh_dashboard_read_models()\n  to service_role"),
  'background refresh must remain service-role only',
);
assert.ok(
  migration.includes("grant execute on function public.ecoflow_mark_dashboard_read_models_required()\n  to service_role"),
  'freshness checkpoint must remain service-role only',
);
assert.ok(
  migration.includes('Commercial and\n-- warehouse tables remain authoritative'),
  'migration must retain the authority boundary statement',
);
assert.ok(
  migration.includes('with freshness as materialized'),
  'the compatibility exception view must execute its freshness assertion even when the snapshot is empty',
);

includesAll(repository, [
  "rpc('ecoflow_get_dashboard_readiness_v1')",
  'server_current_orders',
  'live_on_hand_units',
  'registered_barcodes',
  'active_exception_count',
], 'dashboard readiness repository');

includesAll(dashboard, [
  "from '@/data/repositories/dashboardReadiness'",
  'loadDashboardReadiness()',
  'readiness?.registered_barcodes',
  'readiness?.live_on_hand_units',
], 'dashboard surface');

assert.ok(!dashboard.includes("from '@/data/repositories/orderOperations'"),
  'DashboardPage must not restore the historical order summary view');
assert.ok(!dashboard.includes("from '@/data/repositories/inventoryControl'"),
  'DashboardPage must not restore heavyweight inventory/barcode KPI views');
assert.ok(!dashboard.includes('loadOrderOperationsSummary()'),
  'DashboardPage must not execute the historical order summary');
assert.ok(!dashboard.includes('loadInventoryKpis()'),
  'DashboardPage must not execute the historical inventory KPI view');
assert.ok(!dashboard.includes('loadBarcodeSprintKpis()'),
  'DashboardPage must not execute the historical barcode KPI view');

includesAll(projection, [
  "supabaseRpc(cfg, 'ecoflow_mark_dashboard_read_models_required', {})",
  "supabaseRpc(cfg, 'ecoflow_refresh_dashboard_read_models', {})",
  "action: 'refresh_dashboard_read_models_deferred'",
  'blocking: false',
  'fail_closed: true',
  'isMissingDashboardRefreshRpc',
], 'Ordermentum projection refresh hook');

assert.ok(!projection.includes('Dashboard read-model refresh failed after successful projection'),
  'derived dashboard refresh must not invalidate authoritative Ordermentum reconciliation');

console.log('Dashboard read-timeout hardening and stale-snapshot fail-closed audit passed.');
