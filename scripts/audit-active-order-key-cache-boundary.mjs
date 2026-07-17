import assert from 'node:assert/strict';
import fs from 'node:fs';

const projection = fs.readFileSync('scripts/project-ordermentum-raw-orders.mjs', 'utf8');
const verifier = fs.readFileSync('scripts/verify-ordermentum-complete-mirror.mjs', 'utf8');
const currentScopeMigration = fs.readFileSync('supabase/migrations/20260717010000_current_order_cache_scope.sql', 'utf8');
const timeoutSafeRepository = fs.readFileSync('src/data/repositories/resilientOrdermentumViewsTimeoutSafe.ts', 'utf8');
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');

assert.ok(
  projection.includes("action: 'refresh_ui_active_order_keys_deferred'"),
  'Derived cache refresh failure must be reported explicitly.',
);
assert.ok(
  projection.includes('blocking: false'),
  'Derived cache refresh must be non-blocking.',
);
assert.ok(
  !verifier.includes('ecoflow_ui_active_order_keys'),
  'Complete mirror verification must not depend on a UI acceleration cache.',
);
assert.ok(
  currentScopeMigration.includes("now() - interval '60 days'"),
  'Active-order cache must apply the authoritative current/review recency boundary.',
);
assert.ok(
  currentScopeMigration.includes("presence.source_status, 'PRESENT') <> 'SOURCE_MISSING'"),
  'Source-missing historical orders must not re-enter the current-order cache.',
);
assert.ok(
  currentScopeMigration.includes('where refreshed_at < v_refresh_at'),
  'A successful refresh must atomically prune stale historical keys.',
);
assert.ok(
  currentScopeMigration.includes("'completed', 'complete', 'closed', 'delivered', 'fulfilled'"),
  'Terminal source states must be excluded from the current-order cache.',
);
for (const source of [
  'v_ecoflow_ordermentum_ui_active_inbox',
  'v_ecoflow_ordermentum_ui_active_order_lines',
  'v_ecoflow_ordermentum_ui_active_drafts',
  'v_ecoflow_ordermentum_ui_active_om_orders',
]) {
  assert.ok(timeoutSafeRepository.includes(source), `Current operational source ${source} must be paged.`);
}
assert.ok(timeoutSafeRepository.includes('offset'), 'Current operational paging must advance by offset.');
assert.ok(timeoutSafeRepository.includes('snapshot was rejected rather than truncated'), 'A safety ceiling must fail closed instead of silently truncating the snapshot.');
assert.ok(timeoutSafeRepository.includes('fetched: currentLoaded'), 'Sync batch fetched count must use the current loaded slice, not retained raw history.');
assert.ok(dashboard.includes('loadOrderOperationsSummary'), 'Dashboard current-order total must come from the exact server summary.');
assert.ok(dashboard.includes('exact server classification'), 'Dashboard must disclose exact current-order count semantics.');

console.log('Active-order key cache boundary contract passed.');
