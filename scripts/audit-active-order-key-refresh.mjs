import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260715003000_active_order_keys_lightweight_refresh.sql',
  'utf8',
);
const dashboardMigration = fs.readFileSync(
  'supabase/migrations/20260805225500_dashboard_read_timeout_hardening.sql',
  'utf8',
);
const projection = fs.readFileSync('scripts/project-ordermentum-raw-orders.mjs', 'utf8');

assert.ok(
  migration.includes('from public.om_orders o'),
  'Active-key refresh must use the canonical order table rather than the expensive operations views.',
);
assert.ok(
  !migration.includes('v_ecoflow_order_operations_v'),
  'Active-key refresh must not scan a multi-join order-operations view.',
);
assert.ok(
  migration.includes('(nullif(o.id::text, \'\'))')
    && migration.includes('(nullif(o.order_number::text, \'\'))')
    && migration.includes('(nullif(o.invoice_number::text, \'\'))'),
  'Active-key refresh must retain the stable canonical order identifiers used by legacy UI views.',
);
assert.ok(
  migration.includes('greatest(') && migration.includes('excluded.refreshed_at'),
  'Concurrent refreshes must not replace a newer timestamp with an older one.',
);
assert.ok(
  !migration.includes('delete from public.ecoflow_ui_active_order_keys'),
  'The lightweight cache refresh must not perform a table-wide delete.',
);
assert.ok(
  !migration.includes('\nselect public.ecoflow_refresh_ui_active_order_keys();'),
  'The cache refresh must not execute inside the original migration transaction.',
);

assert.ok(
  dashboardMigration.includes('ecoflow_mark_dashboard_read_models_required'),
  'A committed freshness checkpoint must precede derived dashboard refresh.',
);
assert.ok(
  dashboardMigration.includes('ACTIONABLE_EXCEPTION_SNAPSHOT_STALE'),
  'A failed snapshot refresh must make exception reads fail closed.',
);
assert.ok(
  projection.includes("supabaseRpc(cfg, 'ecoflow_mark_dashboard_read_models_required', {})"),
  'Projection must mark dashboard read models stale before refresh.',
);
assert.ok(
  projection.includes("action: 'refresh_dashboard_read_models_deferred'"),
  'Projection must report a deferred dashboard read-model refresh.',
);
assert.ok(
  projection.includes('blocking: false'),
  'Derived dashboard caches must remain explicitly non-blocking for authoritative reconciliation.',
);
assert.ok(
  projection.includes('fail_closed: true'),
  'Deferred exception refresh must be explicitly fail-closed for interactive reads.',
);
assert.ok(
  projection.includes("action: 'refresh_ui_active_order_keys_deferred'"),
  'The rollout fallback must retain a non-blocking active-key refresh report.',
);

console.log('Lightweight non-blocking active-order and fail-closed dashboard refresh contract passed.');
