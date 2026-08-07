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
const safeRefreshMigration = fs.readFileSync(
  'supabase/migrations/20260807223500_control_room_snapshot_safe_refresh.sql',
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
  'A committed freshness checkpoint must precede a changed-data dashboard refresh.',
);
assert.ok(
  dashboardMigration.includes('ACTIONABLE_EXCEPTION_SNAPSHOT_STALE'),
  'A failed snapshot refresh must make exception reads fail closed until repair succeeds.',
);
assert.ok(
  safeRefreshMigration.includes('where s.exception_id is not null'),
  'Managed Supabase snapshot replacement must satisfy the production safe-update guard.',
);
assert.ok(
  projection.includes('const projectedMutationCount = totals.projected_orders + totals.projected_invoices + totals.projected_lines'),
  'Projection must distinguish no-op syncs from real operational mutations.',
);
assert.ok(
  projection.includes("action: 'dashboard_read_models_refresh_skipped'")
    && projection.includes("reason: 'NO_PROJECTED_OPERATIONAL_CHANGES'"),
  'No-op syncs must not advance the Control Room stale checkpoint.',
);
assert.ok(
  projection.includes("supabaseRpc(cfg, 'ecoflow_mark_dashboard_read_models_required', {})"),
  'Changed projection must mark dashboard read models stale before refresh.',
);
assert.ok(
  projection.includes("action: 'refresh_dashboard_read_models_retry'"),
  'Changed projection must retry a transient dashboard read-model refresh failure.',
);
assert.ok(
  projection.includes("action: 'control_room_read_models_stale'")
    && projection.includes('blocking: true')
    && projection.includes('authoritative_projection_committed: true'),
  'A stale Control Room must be visible as an operational workflow failure without implying commercial rollback.',
);
assert.ok(
  projection.includes('Control Room read-model refresh failed after authoritative projection committed'),
  'The workflow failure must distinguish committed commercial projection from degraded operating read models.',
);
assert.ok(
  !projection.includes("action: 'refresh_dashboard_read_models_deferred'"),
  'The workflow must not publish a false green state after the stale checkpoint advances.',
);
assert.ok(
  !projection.includes('blocking: false'),
  'Dashboard read-model failure must not be silently classified as non-blocking.',
);
assert.ok(
  projection.includes("action: 'refresh_ui_active_order_keys_rollout_fallback'"),
  'The pre-RPC rollout fallback must retain the lightweight active-key refresh path.',
);

console.log('Lightweight active-order cache and observable self-healing Control Room refresh contract passed.');
