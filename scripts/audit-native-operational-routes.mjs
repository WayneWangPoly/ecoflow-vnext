import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const main = read('src/main.tsx');
const shell = read('src/features/operationalRoutes/NativeOperationalRoutes.tsx');
const query = read('src/features/navigation/useWorkspaceQueryState.ts');
const stores = read('src/features/stores/StoresWorkspacePage.tsx');
const inventory = read('src/features/inventory/InventoryWorkspacePage.tsx');
const ordermentum = read('src/features/ordermentum/OrdermentumWorkspacePage.tsx');
const warehouseRoute = read('src/features/warehouse/WarehouseMapRoute.tsx');
const warehousePage = read('src/features/warehouse/WarehouseMapPage.tsx');
const documentation = read('docs/PHASE-9C-NATIVE-OPERATIONAL-ROUTES.md');

for (const route of ['/control-room', '/ordermentum', '/inventory/*', '/customers/*', '/stores/*', '/warehouse-map']) {
  has(main, `path=\"${route}\"`, `main.tsx owns ${route} through React Router`);
}
has(main, 'NativeOperationalRoutes', 'Native route shell is mounted explicitly');
has(main, 'WarehouseMapRoute', 'Warehouse Map has an explicit protected route');
has(main, 'Navigate to="/ordermentum?tab=exceptions"', 'Exceptions has a canonical native route');

for (const legacy of ['detectDesktopRole', 'RoleIdentityEnhancer', 'OwnerEnhancers', 'AccountEnhancers', 'ViewerEnhancers', 'WarehouseMapRouteModules']) {
  lacks(main, legacy, `${legacy} is absent from the production entry point`);
}
lacks(main, '.sidebar-brand span', 'Entry point does not infer role from sidebar text');
lacks(main, 'navLabels', 'Entry point does not infer capability from visible navigation labels');

has(shell, 'data-app-role={role}', 'Authenticated typed role is published by React state');
has(shell, 'canRoleAccessIntelligenceWorkspace', 'Workspace access uses typed role contracts');
has(shell, 'v_ecoflow_current_user', 'Role is loaded from the authenticated profile view');
lacks(shell, 'querySelector', 'Native shell does not locate UI by DOM selector');
lacks(shell, 'textContent', 'Native shell does not infer capability from visible text');
lacks(shell, 'createPortal', 'Native shell does not replace panels through portals');
lacks(shell, 'observeBody', 'Native shell does not depend on MutationObserver mounting');

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

console.log('Native operational route audit passed: 5/5 workspaces, typed role boundary, URL state and explicit data states.');
