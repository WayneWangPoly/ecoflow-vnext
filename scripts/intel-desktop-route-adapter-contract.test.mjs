import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDesktopRouteAdapterModel,
  desktopTabNavigationTarget,
} from '../src/features/intelligence/navigation/useDesktopRouteAdapter.ts';

test('flag-off mode preserves the existing local desktop tab regardless of URL', () => {
  assert.deepEqual(
    deriveDesktopRouteAdapterModel({
      enabled: false,
      pathname: '/orders/ORD-1',
      role: 'owner',
      legacyTab: 'delivery',
    }),
    { enabled: false, tab: 'delivery', boundary: null },
  );
});

test('canonical workspace and entity routes select the matching legacy panel', () => {
  assert.equal(deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/control-room', role: 'owner', legacyTab: 'settings' }).tab, 'dashboard');
  assert.equal(deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/orders/ORD-1', role: 'owner', legacyTab: 'dashboard' }).tab, 'orders');
  assert.equal(deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/inventory/physical/ITEM-1', role: 'viewer', legacyTab: 'dashboard' }).tab, 'inventory');
  assert.equal(deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/delivery/runs/RUN-A', role: 'account', legacyTab: 'dashboard' }).tab, 'delivery');
});

test('legacy root requests a replace-only canonical redirect', () => {
  assert.deepEqual(
    deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/', role: 'owner', legacyTab: 'settings' }),
    {
      enabled: true,
      tab: 'dashboard',
      boundary: null,
      canonicalRedirect: '/control-room',
    },
  );
});

test('forbidden routes remain explicit and do not select a hidden workspace', () => {
  const result = deriveDesktopRouteAdapterModel({
    enabled: true,
    pathname: '/inventory',
    role: 'account',
    legacyTab: 'orders',
  });
  assert.equal(result.tab, 'orders');
  assert.deepEqual(result.boundary, {
    status: 'FORBIDDEN',
    pathname: '/inventory',
    workspace: 'inventory',
    reason: 'ROLE_NOT_AUTHORISED',
  });
});

test('unknown and invalid routes remain explicit rather than falling back', () => {
  assert.deepEqual(
    deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/unknown', role: 'owner', legacyTab: 'dashboard' }).boundary,
    { status: 'UNAVAILABLE', pathname: '/unknown', reason: 'ROUTE_NOT_FOUND' },
  );
  assert.deepEqual(
    deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/orders/%E0%A4%A', role: 'owner', legacyTab: 'dashboard' }).boundary,
    { status: 'UNAVAILABLE', pathname: '/orders/%E0%A4%A', reason: 'INVALID_ENTITY_ID' },
  );
});

test('reserved routes without a migrated legacy panel show a migration boundary', () => {
  assert.deepEqual(
    deriveDesktopRouteAdapterModel({ enabled: true, pathname: '/returns', role: 'owner', legacyTab: 'delivery' }).boundary,
    {
      status: 'UNAVAILABLE',
      pathname: '/returns',
      workspace: 'returns',
      reason: 'WORKSPACE_NOT_MIGRATED',
    },
  );
});

test('sidebar navigation writes canonical paths and preserves current query context', () => {
  assert.equal(desktopTabNavigationTarget('orders', '?date=2026-07-29&filter=status%3AREADY'), '/orders?date=2026-07-29&filter=status%3AREADY');
  assert.equal(desktopTabNavigationTarget('inventory', 'date=2026-07-29'), '/inventory?date=2026-07-29');
  assert.equal(desktopTabNavigationTarget('dashboard', ''), '/control-room');
});
