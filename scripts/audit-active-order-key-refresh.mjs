import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260715001000_active_order_keys_safe_refresh.sql',
  'utf8',
);

assert.ok(
  migration.includes("to_regclass('public.v_ecoflow_order_operations_v5')"),
  'Active-key refresh must prefer the latest effective order-operations view.',
);
assert.ok(
  migration.includes('v_refresh_at timestamptz := clock_timestamp()'),
  'Active-key refresh must use one stable mark timestamp.',
);
assert.ok(
  migration.includes('where refreshed_at is null') && migration.includes('or refreshed_at < v_refresh_at'),
  'Stale-key deletion must carry an explicit safe-update predicate.',
);
assert.ok(
  migration.includes('greatest(ecoflow_ui_active_order_keys.refreshed_at,excluded.refreshed_at)'),
  'Concurrent refreshes must not overwrite a newer mark with an older timestamp.',
);
assert.ok(
  !migration.includes("execute 'delete from public.ecoflow_ui_active_order_keys'"),
  'The unsafe unconditional dynamic DELETE must not return.',
);
assert.ok(
  !migration.includes('delete from public.ecoflow_ui_active_order_keys;'),
  'The refresh must not use a table-wide DELETE without a predicate.',
);

console.log('Safe active-order key refresh contract passed.');
