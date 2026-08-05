import assert from 'node:assert/strict';
import fs from 'node:fs';

const projection = fs.readFileSync('scripts/project-ordermentum-raw-orders.mjs', 'utf8');
const verifier = fs.readFileSync('scripts/verify-ordermentum-complete-mirror.mjs', 'utf8');
const currentScopeMigration = fs.readFileSync('supabase/migrations/20260717010000_current_order_cache_scope.sql', 'utf8');
const dashboardMigration = fs.readFileSync('supabase/migrations/20260805225500_dashboard_read_timeout_hardening.sql', 'utf8');
const timeoutSafeRepository = fs.readFileSync('src/data/repositories/resilientOrdermentumViewsTimeoutSafe.ts', 'utf8');
const dashboardRepository = fs.readFileSync('src/data/repositories/dashboardReadiness.ts', 'utf8');
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

assert.ok(
  dashboardRepository.includes("rpc('ecoflow_get_dashboard_readiness_v1')"),
  'Dashboard current-order total must come from the bounded server-authority RPC.',
);
assert.ok(
  dashboardMigration.includes('from public.om_orders o'),
  'Dashboard readiness must count current orders directly from canonical om_orders.',
);
assert.ok(
  dashboardMigration.includes("now() - interval '60 days'"),
  'Dashboard readiness must retain the authoritative current/review recency boundary.',
);
assert.ok(
  dashboardMigration.includes("presence.source_status, 'PRESENT') <> 'SOURCE_MISSING'"),
  'Dashboard readiness must exclude source-missing historical orders.',
);
assert.ok(
  dashboardMigration.includes("'completed', 'complete', 'closed', 'delivered', 'fulfilled'"),
  'Dashboard readiness must exclude terminal source states.',
);
assert.ok(
  dashboard.includes('readiness.server_current_orders'),
  'Dashboard must render the bounded server-current total.',
);
assert.ok(
  dashboard.includes(': orders.length'),
  'Dashboard may use the loaded current slice only as a fallback when readiness is unavailable.',
);
assert.ok(
  !dashboard.includes('loadOrderOperationsSummary'),
  'Dashboard must not restore the timeout-prone multi-join server summary.',
);

console.log('Active-order key cache and bounded dashboard readiness boundary contract passed.');
