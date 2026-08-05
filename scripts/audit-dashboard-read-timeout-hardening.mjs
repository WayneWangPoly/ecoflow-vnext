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
  'ecoflow_refresh_current_exception_snapshot',
  'ecoflow_refresh_dashboard_read_models',
  'ecoflow_get_dashboard_readiness_v1',
  "set statement_timeout='180s'",
  "set statement_timeout='8s'",
  'from public.ecoflow_inventory_movements m',
  'from public.ecoflow_sku_barcode_registry',
  "analytics.get_actionable_exception_queue(integer)",
  "analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamptz,text,text)",
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
  migration.includes('Commercial and\n-- warehouse tables remain authoritative'),
  'migration must retain the authority boundary statement',
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
  "supabaseRpc(cfg, 'ecoflow_refresh_dashboard_read_models', {})",
  'Dashboard read-model refresh failed after successful projection',
  'isMissingDashboardRefreshRpc',
], 'Ordermentum projection refresh hook');

assert.ok(!projection.includes('refresh_ui_active_order_keys_deferred'),
  'post-sync refresh must not silently defer ordinary cache failures');

console.log('Dashboard read-timeout hardening audit passed.');
