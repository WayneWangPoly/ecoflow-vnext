import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260716013000_lightweight_ordermentum_catalog_upsert.sql', 'utf8');
const catalog = fs.readFileSync('scripts/ordermentum-history-catalog.mjs', 'utf8');

assert.ok(migration.includes('raw_history_scan_performed'), 'Catalog upsert must report that no raw archive scan occurred.');
assert.ok(!migration.includes('from public.ordermentum_raw_orders'), 'Catalog page persistence must never scan the full raw-order archive.');
assert.ok(!migration.includes('to_jsonb(r)'), 'Catalog page persistence must not defeat identity indexes through whole-row JSON conversion.');
assert.ok(migration.includes("on conflict(order_key) do update"), 'Catalog upsert must remain idempotent.');
assert.ok(migration.includes("detail_status='COMPLETE'"), 'Previously completed catalog detail must remain reusable.');
assert.ok(catalog.includes("ecoflow_upsert_ordermentum_catalog_page"), 'Catalog runner must use the bounded page RPC.');

console.log('Bounded Ordermentum catalog upsert contract passed.');
