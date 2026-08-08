#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260805225500_dashboard_read_timeout_hardening.sql';
const safeRefreshMigrationPath = 'supabase/migrations/20260807223500_control_room_snapshot_safe_refresh.sql';
const inventoryAuthorityMigrationPath = 'supabase/migrations/20260808095000_dashboard_inventory_quantity_authority.sql';
const replayMigrationPath = 'supabase/migrations/20260730190100_actionable_exception_idempotent_replay_snapshot.sql';
const dashboardPath = 'src/features/dashboard/DashboardPage.tsx';
const repositoryPath = 'src/data/repositories/dashboardReadiness.ts';
const projectionPath = 'scripts/project-ordermentum-raw-orders.mjs';
const operationalJobPath = 'scripts/operational-sync-job.mjs';

const [migration, safeRefreshMigration, inventoryAuthorityMigration, replayMigration, dashboard, repository, projection, operationalJob] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(safeRefreshMigrationPath, 'utf8'),
  readFile(inventoryAuthorityMigrationPath, 'utf8'),
  readFile(replayMigrationPath, 'utf8'),
  readFile(dashboardPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(projectionPath, 'utf8'),
  readFile(operationalJobPath, 'utf8'),
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
  'analytics.get_actionable_exception_queue(integer)',
  'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamptz,text,text)',
  'analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(uuid,text,text,text,timestamptz,text,text)',
  'perform public.ecoflow_assert_current_exception_snapshot()',
  'The public lifecycle command',
  'is an idempotent replay wrapper and intentionally remains unchanged',
], 'timeout-hardening migration');

includesAll(safeRefreshMigration, [
  'CONTROL_ROOM_SNAPSHOT_SAFE_REFRESH_PREREQUISITES_MISSING',
  'create or replace function public.ecoflow_refresh_current_exception_snapshot()',
  'delete from public.ecoflow_current_exception_snapshot s',
  'where s.exception_id is not null',
  'select public.ecoflow_refresh_dashboard_read_models()',
  'perform public.ecoflow_assert_current_exception_snapshot()',
  'CONTROL_ROOM_SNAPSHOT_SAFE_REFRESH_VERIFY_FAILED',
], 'managed-Supabase safe refresh migration');

assert.ok(
  !safeRefreshMigration.includes('delete from public.ecoflow_current_exception_snapshot;'),
  'current-exception refresh must never use an unconditional DELETE on managed Supabase',
);

includesAll(inventoryAuthorityMigration, [
  'ecoflow_get_dashboard_readiness_v2',
  "set statement_timeout='8s'",
  'inventory_quantity_commissioned boolean',
  'initial_stocktake_approved_at timestamptz',
  "s.session_type='INITIAL'",
  "s.session_status='APPROVED'",
  'from public.ecoflow_inventory_movements m',
  'from public.ecoflow_sku_barcode_registry',
  'perform public.ecoflow_assert_current_exception_snapshot()',
  "grant execute on function public.ecoflow_get_dashboard_readiness_v2()\n  to authenticated",
], 'inventory-aware bounded readiness migration');

assert.ok(
  !inventoryAuthorityMigration.includes("s.session_type='CYCLE_COUNT'"),
  'a cycle count must never establish initial inventory quantity authority',
);

includesAll(replayMigration, [
  'rename to apply_actionable_exception_lifecycle_command_unsnapshotted_20260730',
  'from analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(',
], 'idempotent lifecycle wrapper migration');

assert.ok(
  !migration.includes('DASHBOARD_TIMEOUT_FUNCTION_SOURCE_NOT_FOUND'),
  'The migration must not require the idempotent public wrapper to contain the live exception source.',
);
assert.ok(
  migration.includes("'analytics.get_actionable_exception_queue(integer)',\n    'analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730"),
  'Only the queue RPC and the real source-consuming lifecycle delegate may be source-rewritten.',
);
assert.ok(
  migration.includes("grant execute on function public.ecoflow_get_dashboard_readiness_v1()\n  to authenticated"),
  'legacy interactive readiness RPC remains available through its function boundary',
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
  "rpc('ecoflow_get_dashboard_readiness_v2')",
  'server_current_orders',
  'live_on_hand_units',
  'registered_barcodes',
  'active_exception_count',
  'inventory_quantity_commissioned',
  'initial_stocktake_approved_at',
], 'dashboard readiness repository');

includesAll(dashboard, [
  "from '@/data/repositories/dashboardReadiness'",
  'loadDashboardReadiness()',
  'readiness.registered_barcodes',
  'readiness.live_on_hand_units',
  'readiness.active_exception_count',
  'readiness.server_current_orders',
  'inventoryQuantityCommissioned',
  'authoritativeInventoryUnits',
  'quantity not commissioned — approve the first stocktake',
], 'dashboard surface');

assert.ok(
  !dashboard.includes('n(readiness?.live_on_hand_units) <= 0'),
  'DashboardPage must not infer first-stocktake commissioning from a numeric zero',
);
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
  'supabaseTimeoutMs: Math.max(cfg.supabaseTimeoutMs, 210000)',
  'const projectedMutationCount = totals.projected_orders + totals.projected_invoices + totals.projected_lines',
  "action: 'dashboard_read_models_refresh_skipped'",
  "reason: 'NO_PROJECTED_OPERATIONAL_CHANGES'",
  "supabaseRpc(cfg, 'ecoflow_mark_dashboard_read_models_required', {})",
  "'ecoflow_refresh_dashboard_read_models'",
  'dashboardRefreshCfg',
  "action: 'refresh_dashboard_read_models_retry'",
  "action: 'control_room_read_models_stale'",
  'blocking: true',
  'authoritative_projection_committed: true',
  'Control Room read-model refresh failed after authoritative projection committed',
], 'Ordermentum projection refresh hook');

assert.ok(!projection.includes("action: 'refresh_dashboard_read_models_deferred'"),
  'a stale Control Room may not be hidden behind a non-blocking successful sync');
assert.ok(!projection.includes('blocking: false'),
  'Control Room refresh failures may not be reported as non-blocking after the stale checkpoint advances');

includesAll(operationalJob, [
  "const hasExplicitValue = next !== undefined && !next.startsWith('--')",
  "result[keyName] = hasExplicitValue ? values[++index] : 'true'",
], 'operational sync job argument parser');

assert.ok(
  !operationalJob.includes("const next = values[index + 1];\n    result[keyName] = next && !next.startsWith('--') ? values[++index] : 'true';"),
  'empty explicit values such as --job-id "" must not be converted to the string true',
);

console.log('Dashboard bounded reads, inventory quantity authority, managed-Supabase snapshot refresh and operational sync observability audit passed.');
