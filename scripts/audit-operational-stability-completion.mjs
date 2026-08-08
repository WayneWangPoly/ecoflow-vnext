import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const main = read('src/main.tsx');
const repository = read('src/data/repositories/operationalStabilityV2.ts');
const workspace = read('src/features/operationalStability/OperationalStabilityWorkspaceV2.tsx');
const exceptionWorkspace = read('src/features/operationalStability/OperationalPagedWorkspaceV3.tsx');
const unifiedRoute = read('src/features/operationalRoutes/UnifiedOperationalRoutes.tsx');
const session = read('src/features/navigation/OperationalSessionContext.tsx');
const appShell = read('src/features/navigation/OperationalAppShell.tsx');
const compatibilityRoute = read('src/features/operationalStability/OperationalStabilityRouteV2.tsx');
const stocktakeMigration = read('supabase/migrations/20260801163000_stocktake_transfer_controls.sql');
const stocktakeConflictMigration = read('supabase/migrations/20260801163010_stocktake_variable_conflict_policy.sql');
const pagingMigration = read('supabase/migrations/20260801163100_operational_paging_preferences_close.sql');
const operationalConflictMigration = read('supabase/migrations/20260801163110_operational_variable_conflict_policy.sql');
const contract = read('scripts/operational-stability-contract-test.sql');
const documentation = read('docs/PHASE-9D-G-OPERATIONAL-STABILITY-COMPLETION.md');

// TRANSFORM-002 keeps the stability workspaces and all server contracts while
// moving route/session/shell ownership into one persistent operational root.
has(main, 'isUnifiedOperationalPath', 'Production entry point declares the unified route boundary');
has(main, '<OperationalSessionProvider>', 'Operational workspaces share one authenticated session authority');
has(main, '<Route path="*" element={<ApplicationSurfaceRouter />} />', 'One route element persists across migrated workspace navigation');
for (const path of ['/warehouse-control','/orders','/inventory','/customers','/stores','/exceptions','/logs','/settings']) {
  has(main, `pathname === '${path}'`, `Unified route boundary owns ${path}`);
}
has(unifiedRoute, '<OperationalPagedWorkspace', 'Operational paged workspaces are mounted inside the unified route');
has(unifiedRoute, '<OperationalSettingsWorkspace', 'Settings workspace is mounted inside the unified route');
has(unifiedRoute, '<WarehouseControlWorkspace', 'Warehouse Control is mounted inside the unified route');
has(session, 'v_ecoflow_current_user', 'Profile and role come from one authenticated application state');
has(appShell, 'data-navigation-owner="unified-operational-shell"', 'Unified AppShell remains the single navigation owner');
has(appShell, 'desktop-mobile-nav', 'Responsive primary navigation remains available when the desktop sidebar collapses');
lacks(appShell, 'quickActions.map', 'Workspace Quick Actions do not duplicate primary navigation in the top bar');
lacks(appShell, 'readQuickActions', 'Top bar does not fetch Quick Actions solely to render duplicate workspace navigation');
has(appShell, "role === 'account' && workspace === 'exceptions'", 'Account can manage commercial exceptions');
has(compatibilityRoute, "export { default } from '@/features/operationalRoutes/UnifiedOperationalRoutes';", 'Legacy stability route cannot resurrect a duplicate auth or shell root');
lacks(compatibilityRoute, 'v_ecoflow_current_user', 'Legacy stability route no longer owns profile loading');
lacks(compatibilityRoute, 'onAuthStateChange', 'Legacy stability route no longer owns an auth subscription');

for (const functionName of [
  'ecoflow_start_stocktake_session',
  'ecoflow_record_stocktake_observation',
  'ecoflow_review_stocktake_observation',
  'ecoflow_complete_stocktake_location',
  'ecoflow_reopen_stocktake_location',
  'ecoflow_submit_stocktake_session',
  'ecoflow_approve_stocktake_session',
  'ecoflow_move_warehouse_sku',
  'ecoflow_read_warehouse_control',
]) {
  has(stocktakeMigration, functionName, `${functionName} exists`);
}
has(stocktakeMigration, "session_type in ('INITIAL','CYCLE_COUNT')", 'Initial and cycle count sessions are distinct');
has(stocktakeMigration, 'blind_count boolean not null default false', 'Blind count state is server-owned');
has(stocktakeMigration, "session_status<>'REVIEW'", 'Approval requires submitted review state');
has(stocktakeMigration, "v_item.quantity<>p_expected_source_quantity", 'Move SKU has a source compare-and-swap check');
has(stocktakeMigration, "v_move>v_item.quantity", 'Move SKU prevents a negative source balance');
has(stocktakeMigration, "('MOVE_OUT'", 'Move SKU writes a source leg');
has(stocktakeMigration, "('MOVE_IN'", 'Move SKU writes a destination leg');
has(stocktakeMigration, 'STOCKTAKE_EVENT_IMMUTABLE', 'Stocktake history is immutable');
lacks(stocktakeMigration, 'grant insert on public.ecoflow_stocktake', 'Browser table writes are not granted');

for (const resource of ['orders','stores','inventory','exceptions','logs']) {
  has(pagingMigration, `v_resource='${resource}'`, `Server pagination supports ${resource}`);
}
has(pagingMigration, 'p_page_size integer default 25', 'Server pagination has a bounded default');
has(pagingMigration, 'v_size not in (10,20,25,50,100)', 'Server pagination allows only bounded page sizes');
has(pagingMigration, 'recommended_action', 'Exception policy includes a recommended action');
has(pagingMigration, 'owner_team', 'Exception queue exposes governed ownership');
has(pagingMigration, 'due_at', 'Exception queue exposes a due time');
has(pagingMigration, 'ecoflow_business_day_close_readiness', 'Business Day Close has explicit readiness');
has(pagingMigration, 'ecoflow_complete_business_day_close', 'Business Day Close wraps the server carry-over authority');
has(pagingMigration, 'accountsVarianceAcknowledged', 'Accounts variance requires explicit acknowledgement');
has(pagingMigration, 'cardinality(action_keys) between 0 and 4', 'Quick Actions are capped at four');
has(pagingMigration, 'user_id uuid primary key', 'Quick Actions are authenticated-user scoped');

for (const [name, migration] of [
  ['stocktake', stocktakeConflictMigration],
  ['operational', operationalConflictMigration],
]) {
  has(migration, 'pg_get_functiondef', `${name} functions are recompiled from their authoritative definitions`);
  has(migration, '#variable_conflict use_column', `${name} functions use a per-function compiler directive`);
  lacks(migration, "set plpgsql.variable_conflict='use_column'", `${name} migration avoids the managed-Supabase superuser-only GUC`);
  has(migration, 'PLPGSQL_FUNCTION_BODY_MARKER_NOT_FOUND', `${name} migration fails closed when function source cannot be patched safely`);
}

for (const rpcName of [
  'ecoflow_read_operational_page',
  'ecoflow_read_warehouse_control',
  'ecoflow_move_warehouse_sku',
  'ecoflow_read_quick_actions',
  'ecoflow_set_quick_actions',
  'ecoflow_complete_business_day_close',
]) {
  has(repository, rpcName, `Repository calls ${rpcName}`);
}
has(repository, 'row.row_data ? [row.row_data] : []', 'Pagination metadata rows are not exposed as fake records');

has(workspace, 'Save current view', 'Saved Views are available from operational pages');
has(workspace, 'Select up to four navigation shortcuts', 'Quick Action configuration remains explicit even though the shell no longer duplicates workspace navigation');
has(workspace, 'Save observation only', 'Stocktake observation is visibly non-posting');
has(workspace, 'Approve and post balances', 'Supervisor approval is visibly distinct');
has(workspace, 'Apply paired transfer', 'Move SKU is presented as one paired transaction');
has(exceptionWorkspace, 'Business Day Close', 'Business Day Close is reachable from the exception queue');
has(exceptionWorkspace, 'row.recommended_action', 'Each exception recommendation is rendered');
lacks(unifiedRoute, 'querySelector', 'Route access is not inferred from DOM text');
lacks(unifiedRoute, 'createPortal', 'Operational pages are not portal replacements');

for (const testMarker of [
  'observation posted stock before approval',
  'blind count exposed current balances',
  'paired transfer must produce exactly two warehouse legs',
  'orders pagination contract failed',
  'exception policy fields missing',
  'five Quick Actions unexpectedly accepted',
  'Business Day Close failed',
  'Account physical inventory access unexpectedly succeeded',
]) {
  has(contract, testMarker, `PostgreSQL contract covers: ${testMarker}`);
}

has(documentation, 'Phase 9D–9G — Operational Stability Completion', 'Completion documentation exists');
has(documentation, 'Observation rows are evidence only', 'Non-posting evidence boundary is documented');
has(documentation, 'one transfer reference', 'Paired transfer boundary is documented');
has(documentation, 'server-authoritative carry-over', 'Business Day Close authority is documented');

console.log('Operational stability completion audit passed: governed UI/RPC/PostgreSQL contracts remain intact under the unified AppShell.');