#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260808194000_active_order_keys_delta_refresh.sql';
const cloudSyncPath = 'scripts/ordermentum-cloud-sync.mjs';
const projectionPath = 'scripts/project-ordermentum-raw-orders.mjs';

const [migration, cloudSync, projection] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(cloudSyncPath, 'utf8'),
  readFile(projectionPath, 'utf8'),
]);

function includesAll(source, values, label) {
  values.forEach((value) => assert.ok(
    source.includes(value),
    `${label} is missing required contract: ${value}`,
  ));
}

includesAll(migration, [
  'create or replace function public.ecoflow_refresh_ui_active_order_keys()',
  "set search_path=pg_catalog,public",
  "pg_advisory_xact_lock",
  "ecoflow_refresh_ui_active_order_keys",
  'create temporary table ecoflow_desired_active_order_keys',
  'primary key (order_key)',
  "presence.domain='ORDER'",
  "coalesce(presence.source_status, 'PRESENT') <> 'SOURCE_MISSING'",
  'coalesce(o.cancelled, false)=false',
  "'cancelled', 'canceled', 'void', 'voided'",
  "'completed', 'complete', 'closed', 'delivered', 'fulfilled'",
  "now() - interval '60 days'",
  'on conflict(order_key) do nothing',
  'delete from public.ecoflow_ui_active_order_keys existing',
  'where existing.order_key is not null',
  'not exists (',
  'select count(*)::integer',
  'from public.ecoflow_ui_active_order_keys',
  'grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role',
  'select public.ecoflow_refresh_ui_active_order_keys()',
], 'active-order-key delta refresh migration');

assert.ok(
  !migration.includes('on conflict(order_key) do update'),
  'active-order-key refresh must not rewrite every existing key on conflict',
);
assert.ok(
  !migration.includes('refreshed_at=excluded.refreshed_at'),
  'unchanged active keys must retain their existing refreshed_at value',
);
assert.ok(
  !migration.includes('delete from public.ecoflow_ui_active_order_keys;'),
  'managed Supabase safe-update protection forbids an unconditional cache delete',
);

includesAll(cloudSync, [
  "runNode('scripts/project-ordermentum-raw-orders.mjs', ['--batch-limit', '100'])",
], 'Ordermentum cloud sync');
assert.ok(
  !cloudSync.includes("runNode('scripts/project-ordermentum-raw-orders.mjs', ['--batch-limit', '500'])"),
  'scheduled projection must not start with the timeout-prone 500-row batch',
);

includesAll(projection, [
  "const requestedBatchLimit = positiveInteger(args['batch-limit'], 100)",
  "args['max-records']",
  'requestedBatchLimit * requestedMaxBatches',
  "if (Number(summary.projected_orders ?? 0) === 0)",
  'converged = true',
  'if (!converged)',
], 'raw-order projection convergence guard');

console.log('Disk IO write-amplification audit passed: active keys are delta-written and scheduled projection starts at batch 100.');
