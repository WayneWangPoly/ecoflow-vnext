import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const main = read('src/main.tsx');
const unified = read('src/features/operationalRoutes/UnifiedOperationalRoutes.tsx');
const delivery = read('src/features/delivery/DeliveryOperationsWorkspace.tsx');
const session = read('src/features/navigation/OperationalSessionContext.tsx');
const appShell = read('src/features/navigation/OperationalAppShell.tsx');
const query = read('src/features/navigation/useWorkspaceQueryState.ts');
const stores = read('src/features/stores/StoresWorkspacePage.tsx');
const inventory = read('src/features/inventory/InventoryWorkspacePage.tsx');
const ordermentum = read('src/features/ordermentum/OrdermentumWorkspacePage.tsx');
const warehouseRoute = read('src/features/warehouse/WarehouseMapRoute.tsx');
const warehousePage = read('src/features/warehouse/WarehouseMapPage.tsx');
const documentation = read('docs/PHASE-9C-NATIVE-OPERATIONAL-ROUTES.md');

// TRANSFORM-002: migrated routes are dispatched inside one persistent route
// element rather than each mounting a separate authenticated application root.
has(main, 'const UnifiedOperationalRoutes', 'Unified operational route root is lazy-loaded explicitly');
has(main, '<OperationalSessionProvider>', 'Migrated routes share one session provider');
has(main, '<Route path="*" element={<ApplicationSurfaceRouter />} />', 'A single router element remains mounted across workspace navigation');
has(main, 'isUnifiedOperationalPath', 'Production entry point owns an explicit unified-route boundary');
for (const route of ['/control-room', '/ordermentum', '/orders', '/inventory', '/customers', '/stores', '/exceptions', '/delivery', '/analytics', '/logs', '/settings', '/warehouse-control']) {
  has(main, `pathname === '${route}'`, `Unified route boundary includes ${route}`);
}
has(main, "pathname.startsWith('/delivery/')", 'Delivery run routes stay inside the unified application surface');
has(main, 'if (routeSurface(destination.pathname) === routeSurface(window.location.pathname)) return;', 'Cross-surface bridge leaves unified-to-unified navigation to React Router');
has(main, 'WarehouseMapRoute', 'Warehouse Map remains a separately protected route feature');
lacks(main, "import('./features/operationalRoutes/NativeOperationalRoutes')", 'Old NativeOperationalRoutes root is not mounted in production');
lacks(main, "import('./features/operationalStability/OperationalStabilityRoute')", 'Old OperationalStabilityRoute root is not mounted in production');

for (const legacy of ['detectDesktopRole', 'RoleIdentityEnhancer', 'OwnerEnhancers', 'AccountEnhancers', 'ViewerEnhancers', 'WarehouseMapRouteModules']) {
  lacks(main, legacy, `${legacy} is absent from the production entry point`);
}
lacks(main, '.sidebar-brand span', 'Entry point does not infer role from sidebar text');
lacks(main, 'navLabels', 'Entry point does not infer capability from visible navigation labels');

has(session, 'OperationalSessionProvider', 'Shared operational session authority exists');
has(session, 'v_ecoflow_current_user', 'Shared session authority loads role from authenticated profile view');
has(session, 'roleFromOperationalProfile', 'Authenticated app role is converted to typed domain role once');
has(session, 'onAuthStateChange', 'Shared session authority owns auth subscription');
lacks(unified, 'v_ecoflow_current_user', 'Workspace dispatcher does not create a second profile authority');

has(appShell, 'data-app-role={role}', 'Shared AppShell publishes authenticated typed role state');
has(appShell, 'mayAccessOperationalWorkspace', 'Shared AppShell uses typed capability contracts');
has(appShell, 'data-navigation-owner="unified-operational-shell"', 'Shared AppShell declares navigation ownership');
for (const [name, source] of [['unified route', unified], ['session authority', session], ['shared AppShell', appShell]]) {
  lacks(source, 'querySelector', `${name} does not locate UI by DOM selector`);
  lacks(source, 'textContent', `${name} does not infer capability from visible text`);
  lacks(source, 'createPortal', `${name} does not replace panels through portals`);
  lacks(source, 'observeBody', `${name} does not depend on MutationObserver mounting`);
}

for (const marker of [
  "pathname === '/control-room'",
  "pathname === '/ordermentum'",
  "pathname === '/orders' || pathname.startsWith('/orders/')",
  "pathname === '/inventory' || pathname.startsWith('/inventory/')",
  "pathname === '/customers' || pathname.startsWith('/customers/')",
  "pathname === '/delivery' || pathname.startsWith('/delivery/')",
  "pathname === '/analytics'",
  "pathname === '/exceptions'",
  "pathname === '/logs'",
  "pathname === '/settings'",
  "pathname === '/warehouse-control' || pathname.startsWith('/warehouse-control/')",
]) {
  has(unified, marker, `Unified workspace dispatcher owns ${marker}`);
}
has(unified, '<OperationalAppShell', 'All desktop migrated workspaces render through the shared AppShell');
has(unified, '<OperationalPagedWorkspace', 'Stability business workspaces are retained inside unified route ownership');
has(unified, '<DashboardPage', 'Control Room remains a native workspace inside unified route ownership');
has(unified, '<OrdermentumWorkspacePage', 'Ordermentum remains a native workspace inside unified route ownership');
has(unified, '<DeliveryOperationsWorkspace', 'Delivery renders its operational controls inside the unified AppShell');
has(unified, '<AnalyticsHealthConsole', 'Analytics renders its health console inside the unified AppShell');
has(delivery, '<DeliveryDispatchCommandSurface', 'Unified Delivery retains the server-authoritative dispatch command surface');
has(delivery, 'lockDeliveryRouteSnapshot', 'Unified Delivery retains route-lock authority');
has(delivery, 'loadActiveDispatchDrivers', 'Unified Delivery retains authenticated Driver assignment');
lacks(delivery, 'window.location.assign', 'Unified Delivery never hard-navigates out of the operational shell');

for (const [name, source] of [['stores', stores], ['inventory', inventory], ['ordermentum', ordermentum]]) {
  has(source, 'useWorkspaceQueryState', `${name} owns URL query state`);
  has(source, 'NativeWorkspaceLoading', `${name} has an explicit loading state`);
  has(source, 'NativeWorkspaceUnavailable', `${name} has an explicit unavailable state`);
  has(source, 'NativeWorkspaceEmpty', `${name} has an explicit empty state`);
  lacks(source, 'createPortal', `${name} has no portal replacement`);
  lacks(source, 'observeBody', `${name} has no DOM observer`);
  lacks(source, 'querySelector', `${name} has no DOM selector ownership`);
}

for (const key of ["params.get('tab')", "params.get('q')", "params.get('filter')", "params.get('sort')", "params.get('page')", "params.get('size')"]) {
  has(query, key, `URL state reads ${key}`);
}
has(query, 'changesView && !options.preservePage ? 1', 'View changes reset pagination safely');
has(query, 'useSearchParams', 'URL state uses React Router rather than window mutation');

has(warehouseRoute, 'ALLOWED_MAP_ROLES', 'Warehouse Map has typed role access');
has(warehouseRoute, '<WarehouseMapPage />', 'Warehouse Map route owns its page directly');
has(warehousePage, "type LoadState = 'loading' | 'live' | 'empty' | 'offline'", 'Warehouse Map has explicit data states');
lacks(warehouseRoute, 'createPortal', 'Warehouse Map route does not portal-replace a native page');

has(documentation, 'Phase 9C — Native Operational Routes', 'Prior route migration documentation remains available');
has(documentation, 'production module graph', 'Runtime removal boundary is documented');

console.log('Native operational route audit passed: one shared session/AppShell owns migrated workspaces, including Delivery and Analytics, with typed role and URL boundaries.');
