#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/ordermentum-storage-maintenance.yml', 'utf8');
const trigger = await readFile('ops/ordermentum-storage-maintenance-trigger.md', 'utf8');
const retention = await readFile('supabase/migrations/20260814100000_ordermentum_master_version_retention_v2.sql', 'utf8');
const slimOrders = await readFile('supabase/migrations/20260714010000_slim_om_orders_raw_json.sql', 'utf8');

function requireText(source, expected, label) {
  assert.ok(source.includes(expected), `${label} is missing required contract: ${expected}`);
}

requireText(workflow, 'workflow_dispatch:', 'maintenance workflow');
requireText(workflow, "- 'ops/ordermentum-storage-maintenance-trigger.md'", 'one-shot production trigger path');
requireText(workflow, 'environment: production', 'production environment boundary');
requireText(workflow, 'group: ordermentum-cloud-sync', 'Ordermentum sync serialization');
requireText(workflow, 'ORDERMENTUM_DATABASE_GUARD_BYTES: "498073600"', 'unchanged 475 MiB guard');
requireText(workflow, 'VACUUM (FULL, ANALYZE, VERBOSE) public.om_order_items;', 'order-item physical compaction');
requireText(workflow, 'VACUUM (FULL, ANALYZE, VERBOSE) public.om_orders;', 'order physical compaction');
requireText(workflow, 'ORDERS_PRE=', 'pre-maintenance order identity evidence');
requireText(workflow, 'ITEMS_PRE=', 'pre-maintenance order-item identity evidence');
requireText(workflow, 'test "$ORDERS_PRE" = "$ORDERS_POST"', 'order identity fail-closed gate');
requireText(workflow, 'test "$ITEMS_PRE" = "$ITEMS_POST"', 'order-item identity fail-closed gate');
requireText(workflow, 'DB_AFTER" -ge "$ORDERMENTUM_DATABASE_GUARD_BYTES', 'post-maintenance storage guard');
requireText(workflow, 'gh workflow run ordermentum-complete-mirror.yml --ref main -f scope=recent', 'post-maintenance verification dispatch');

assert.ok(!/VACUUM\s*\([^)]*FULL[^)]*\)\s+public\.(?:om_invoices|ordermentum_raw_orders|ordermentum_raw_master_resources|ordermentum_raw_master_resource_versions)/i.test(workflow),
  'physical maintenance must not rewrite raw authority, invoice projection, or version-history relations');
assert.ok(!/\b(?:delete\s+from|truncate(?:\s+table)?|drop\s+table|insert\s+into|update\s+public\.)\b/i.test(workflow),
  'maintenance workflow must not perform business-data DML or destructive table operations');
assert.ok(!/schedule:/i.test(workflow), 'physical compaction must not become a recurring schedule');

requireText(retention, 'Physical file compaction remains', 'retention/physical-maintenance separation');
requireText(retention, 'intentionally not hidden in a migration', 'no hidden physical rewrite contract');
requireText(slimOrders, 'The complete payload remains in ordermentum_raw_orders.', 'raw order authority preservation');

requireText(trigger, '542706835', 'observed Complete Mirror #336 database size');
requireText(trigger, '498073600', 'trigger guard evidence');
requireText(trigger, 'No increase or bypass of the 475 MiB guard.', 'guard non-bypass authorization');
requireText(trigger, 'No Ordermentum or QBO source writes.', 'source-write prohibition');
requireText(trigger, 'No hidden `VACUUM FULL` inside a schema migration or recurring schedule.', 'explicit physical-maintenance boundary');

console.log('Ordermentum storage-maintenance audit passed: one-shot production compaction is restricted to already-slim derived order projections, row identity is fail-closed, the 475 MiB guard is unchanged, and raw/source authority remains untouched.');
