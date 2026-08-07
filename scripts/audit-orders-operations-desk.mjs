import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync('src/features/orders/OrdersCommandWorkspace.tsx', 'utf8');
const repository = fs.readFileSync('src/data/repositories/ordersOperationsDesk.ts', 'utf8');
const route = fs.readFileSync('src/features/operationalStability/OperationalPagedWorkspaceV3.tsx', 'utf8');
const css = fs.readFileSync('src/features/orders/ordersCommandWorkspace.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260807234000_orders_operations_desk.sql', 'utf8');
const guard = fs.readFileSync('supabase/migrations/20260807234100_orders_operations_exception_key_guard.sql', 'utf8');

for (const marker of [
  "rpc('ecoflow_read_orders_operations_v1'",
  "rpc('ecoflow_read_order_operations_detail_v1'",
  'activeExceptionCount: number | null',
  'exceptionSnapshotFresh: boolean',
  'READY_TO_RELEASE',
  'BLOCKED_MAPPING',
  'BLOCKED_BARCODE',
  'BLOCKED_STOCK',
]) assert.ok(repository.includes(marker), `Repository missing ${marker}`);

for (const marker of [
  'ORDER OPERATIONS',
  'Decide, release and hand work into execution',
  'Saved view',
  'Operational priority',
  'Release selected',
  'Order operations detail',
  'RELEASE GATE',
  'Current blockers',
  'LINE DETAIL',
  'CURRENT EXCEPTIONS',
  'Exception snapshot is not current.',
  'Ordermentum source',
  'Reconciliation',
  'Inventory',
  'Delivery',
  "usePickSync(businessDay, day, setDay",
  "row.releaseState === 'READY_TO_RELEASE'",
  "role === 'owner' || role === 'admin'",
]) assert.ok(workspace.includes(marker), `Orders desk missing ${marker}`);

assert.ok(workspace.includes("navigate(`/orders/${encodeURIComponent(row.orderKey)}${location.search}`)"), 'Selected order must be URL-addressable.');
assert.ok(workspace.includes("readOrdersOperationsPage"), 'List must use exact server-paged authority.');
assert.ok(!workspace.includes('loadSupabaseOrdermentumViews'), 'Orders list must not use bounded aggregate current snapshot as list authority.');
assert.ok(!workspace.includes('orders.slice('), 'Orders list must not page a client-loaded aggregate array.');
assert.ok(workspace.includes("detail.exceptions === null"), 'Stale exception snapshot must fail closed in the drawer.');
assert.ok(workspace.includes("action === 'RESOLVE' && !note"), 'Exception resolution requires a note.');

assert.ok(route.includes("if (props.resource==='orders') return <OrdersCommandWorkspace"), 'Orders route must use the transformed desk.');
assert.ok(route.includes("if (props.resource==='exceptions') return <ExceptionQueue"), 'Cross-order exception register remains governed separately.');

for (const marker of [
  '.orders-desk__hero',
  '.orders-desk__commandbar',
  '.orders-desk__table-shell',
  '.orders-desk__row',
  '.orders-desk__drawer',
  '.orders-desk__gate',
  '.orders-desk__exception-list',
  '@media (max-width: 900px)',
  '@media (max-width: 600px)',
]) assert.ok(css.includes(marker), `Orders desk CSS missing ${marker}`);
for (const forbidden of ['!important', '@font-face', 'url(']) assert.ok(!css.includes(forbidden), `Orders desk CSS escape forbidden: ${forbidden}`);

for (const marker of [
  'ecoflow_read_orders_operations_v1',
  'ecoflow_read_order_operations_detail_v1',
  "set statement_timeout='8s'",
  "v_size not in (10,20,25,50,100)",
  "v_view not in ('current','today','decision','ready','warehouse','delivered')",
  'exception_snapshot_fresh',
  "else null::integer end as active_exception_count",
  "else null::jsonb end",
  'limit 250',
  "to authenticated,service_role",
]) assert.ok(migration.includes(marker), `Orders desk migration missing ${marker}`);
assert.ok(!migration.includes('grant execute on function public.ecoflow_read_orders_operations_v1(integer,integer,text,text,text) to anon'), 'Anonymous list access forbidden.');

for (const marker of [
  'ORDERS_EXCEPTION_KEY_GUARD_REPLACEMENT_COUNT_INVALID',
  'ORDERS_EXCEPTION_NULL_KEY_MATCH_REMAINS',
  'is not null and e.raw_order_id = nullif',
  'is not null and e.order_number = nullif',
]) assert.ok(guard.includes(marker), `Exception key guard missing ${marker}`);

console.log('TRANSFORM-004 Orders operations desk audit passed.');
