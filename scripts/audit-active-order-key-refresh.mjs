import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260715003000_active_order_keys_lightweight_refresh.sql',
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
  'The cache refresh must not execute inside the migration transaction.',
);
assert.ok(
  projection.includes("action: 'refresh_ui_active_order_keys_deferred'"),
  'Projection must report a deferred derived-cache refresh without failing authoritative data reconciliation.',
);
assert.ok(
  projection.includes('blocking: false'),
  'The derived cache must be explicitly non-blocking.',
);

console.log('Lightweight non-blocking active-order key refresh contract passed.');
