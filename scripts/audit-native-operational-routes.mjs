import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const main = read('src/main.tsx');
const shell = read('src/features/operationalRoutes/NativeOperationalRoutes.tsx');
const stabilityShell = read('src/features/operationalStability/OperationalStabilityRouteV2.tsx');
const query = read('src/features/navigation/useWorkspaceQueryState.ts');
const stores = read('src/features/stores/StoresWorkspacePage.tsx');
const inventory = read('src/features/inventory/InventoryWorkspacePage.tsx');
const ordermentum = read('src/features/ordermentum/OrdermentumWorkspacePage.tsx');
const warehouseRoute = read('src/features/warehouse/WarehouseMapRoute.tsx');
const warehousePage = read('src/features/warehouse/WarehouseMapPage.tsx');
const documentation = read('docs/PHASE-9C-NATIVE-OPERATIONAL-ROUTES.md');

for (const route of ['/control-room', '/ordermentum', '/inventory/*', '/customers/*', '/stores/*', '/warehouse-map', '/exceptions']) {
  has(main, `path=\"${route}\"`, `main.tsx owns ${route} through React Router`);
}
has(main, 'NativeOperationalRoutes', 'Native route shell is mounted explicitly');
has(main, 'OperationalStabilityRoute', 'Later native operational workspaces have an explicit route shell');
has(main, 'WarehouseMapRoute', 'Warehouse Map has an explicit protected route');

for (const legacy of ['detectDesktopRole', 'RoleIdentityEnhancer', 'OwnerEnhancers', 'AccountEnhancers', 'ViewerEnhancers', 'WarehouseMapRouteModules']) {
  lacks(main, legacy, `${legacy} is absent from the production entry point`);
}
lacks(main, '.sidebar-brand span', 'Entry point does not infer role from sidebar text');
lacks(main, 'navLabels', 'Entry point does not infer capability from visible navigation labels');

for (const [name, source] of [['phase-9c shell', shell], ['stability shell', stabilityShell]]) {
  has(source, 'data-app-role={role}', `${name} publishes authenticated typed role state`);
  has(source, 'canRoleAccessIntelligenceWorkspace', `${name} uses typed route capability contracts`);
  has(source, 'v_ecoflow_current_user', `${name} loads role from the authenticated profile view`);
  lacks(source, 'querySelector', `${name} does not locate UI by DOM selector`);
  lacks(source, 'textContent', `${name} does not infer capability from visible text`);
  lacks(source, 'createPortal', `${name} does not replace panels through portals`);
  lacks(source, 'observeBody', `${name} does not depend on MutationObserver mounting`);
}

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

has(documentation, 'Phase 9C — Native Operational Routes', 'Phase documentation exists');
has(documentation, 'production module graph', 'Runtime removal boundary is documented');

console.log('Native operational route audit passed: explicit route ownership, typed role boundaries and URL state remain intact.');
