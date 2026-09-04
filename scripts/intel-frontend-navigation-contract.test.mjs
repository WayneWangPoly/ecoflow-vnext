import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalIntelligencePaths,
  matchIntelligenceRoute,
  pathForLegacyDesktopTab,
  resolveIntelligenceRoute,
} from '../src/features/intelligence/navigation/routeContract.ts';
import {
  parseWorkspaceQuery,
  serialiseWorkspaceQuery,
  withWorkspaceQuery,
} from '../src/features/intelligence/navigation/queryState.ts';
import {
  EMPTY_INTELLIGENCE_OVERLAY_STATE,
  informationOverlayDepth,
  overlayStateToQuerySelection,
  reduceIntelligenceOverlay,
} from '../src/features/intelligence/navigation/overlayState.ts';
import { resolveIntelligenceFeatureFlags } from '../src/features/intelligence/featureFlags.ts';
import {
  PRODUCT_MASTER_COLUMN_ORDER,
  PRODUCT_MASTER_FILTER_ORDER,
} from '../src/data/repositories/productMaster.ts';
import {
  SUPPLIER_MASTER_COLUMN_ORDER,
  SUPPLIER_MASTER_FILTER_ORDER,
} from '../src/data/repositories/supplierMaster.ts';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('canonical route registry covers the ADR-0008 and #340A route families', () => {
  const paths = new Set(canonicalIntelligencePaths());
  for (const required of [
    '/control-room',
    '/orders',
    '/orders/:orderId',
    '/products',
    '/products/:productId',
    '/inventory',
    '/inventory/commercial/:skuId',
    '/inventory/physical/:itemId',
    '/customers',
    '/customers/:customerId',
    '/suppliers',
    '/suppliers/:supplierId',
    '/purchases',
    '/purchases/:purchaseOrderId',
    '/stores/:storeId',
    '/delivery',
    '/delivery/runs/:runCode',
    '/returns',
    '/exceptions',
    '/reconciliation',
    '/analytics',
    '/settings',
  ]) {
    assert.equal(paths.has(required), true, `missing canonical path ${required}`);
  }
});

test('legacy root and tabs map to canonical paths without text lookup', () => {
  assert.deepEqual(matchIntelligenceRoute('/'), {
    status: 'READY',
    route: {
      workspace: 'control-room',
      canonicalPath: '/control-room',
      legacyDesktopTab: 'dashboard',
    },
  });
  assert.equal(pathForLegacyDesktopTab('inventory'), '/inventory');
  assert.equal(pathForLegacyDesktopTab('reconciliation'), '/reconciliation');
  assert.equal(pathForLegacyDesktopTab('analytics'), '/analytics');
  assert.deepEqual(matchIntelligenceRoute('/analytics'), {
    status: 'READY',
    route: {
      workspace: 'analytics',
      canonicalPath: '/analytics',
      legacyDesktopTab: 'analytics',
    },
  });
});

test('deep entity routes retain decoded identity and typed legacy adapter', () => {
  assert.deepEqual(matchIntelligenceRoute('/orders/ORD%20123'), {
    status: 'READY',
    route: {
      workspace: 'orders',
      canonicalPath: '/orders/:orderId',
      entityKind: 'order',
      entityId: 'ORD 123',
      legacyDesktopTab: 'orders',
    },
  });
  assert.deepEqual(matchIntelligenceRoute('/delivery/runs/RUN-A/'), {
    status: 'READY',
    route: {
      workspace: 'delivery',
      canonicalPath: '/delivery/runs/:runCode',
      entityKind: 'delivery-run',
      entityId: 'RUN-A',
      legacyDesktopTab: 'delivery',
    },
  });
  assert.deepEqual(matchIntelligenceRoute('/products/R-360Y'), {
    status: 'READY',
    route: {
      workspace: 'products',
      canonicalPath: '/products/:productId',
      entityKind: 'product',
      entityId: 'R-360Y',
      legacyDesktopTab: null,
    },
  });
  assert.deepEqual(matchIntelligenceRoute('/purchases/PO-1001'), {
    status: 'READY',
    route: {
      workspace: 'purchases',
      canonicalPath: '/purchases/:purchaseOrderId',
      entityKind: 'purchase-order',
      entityId: 'PO-1001',
      legacyDesktopTab: null,
    },
  });
  assert.deepEqual(matchIntelligenceRoute('/orders/%E0%A4%A'), {
    status: 'UNAVAILABLE',
    pathname: '/orders/%E0%A4%A',
    reason: 'INVALID_ENTITY_ID',
  });
});

test('#340A office routes are Owner/Admin only until explicit capability work expands them', () => {
  for (const path of ['/products', '/suppliers', '/purchases']) {
    assert.equal(resolveIntelligenceRoute(path, 'owner').status, 'READY');
    assert.equal(resolveIntelligenceRoute(path, 'admin').status, 'READY');
    assert.equal(resolveIntelligenceRoute(path, 'account').status, 'FORBIDDEN');
    assert.equal(resolveIntelligenceRoute(path, 'viewer').status, 'FORBIDDEN');
    assert.equal(resolveIntelligenceRoute(path, 'warehouse').status, 'FORBIDDEN');
    assert.equal(resolveIntelligenceRoute(path, 'driver').status, 'FORBIDDEN');
  }
});

test('#340A preserves Product and Supplier muscle-memory contracts without inventing authority', () => {
  assert.deepEqual(PRODUCT_MASTER_FILTER_ORDER, [
    'search', 'product-group', 'brand', 'supplier', 'supplier-product', 'barcode', 'obsolete', 'sellable', 'purchasable',
  ]);
  assert.deepEqual(PRODUCT_MASTER_COLUMN_ORDER, [
    'image', 'product-code', 'description', 'product-group', 'base-pack', 'allocated', 'on-hand', 'base-unit', 'status-action',
  ]);
  assert.deepEqual(SUPPLIER_MASTER_FILTER_ORDER, ['supplier', 'obsolete']);
  assert.deepEqual(SUPPLIER_MASTER_COLUMN_ORDER, ['code', 'name', 'city', 'country', 'currency', 'action']);
});

test('#340A native office surfaces are owned by the unified React shell', () => {
  const main = source('src/main.tsx');
  const routes = source('src/features/operationalRoutes/UnifiedOperationalRoutes.tsx');
  const shell = source('src/features/navigation/OperationalAppShell.tsx');
  for (const path of ['/products', '/suppliers', '/purchases']) {
    assert.match(main, new RegExp(`pathname === '${path.replace('/', '\\/')}'`));
    assert.match(routes, new RegExp(`pathname === '${path.replace('/', '\\/')}'`));
    assert.match(shell, new RegExp(`path: '${path.replace('/', '\\/')}'`));
  }
  assert.match(routes, /ProductMasterWorkspace/);
  assert.match(routes, /SupplierMasterWorkspace/);
  assert.match(routes, /PurchaseOperationsWorkspace/);
});

test('#340A supplier and purchase surfaces fail closed on data and mutation authority', () => {
  const supplierRepository = source('src/data/repositories/supplierMaster.ts');
  const productRepository = source('src/data/repositories/productMaster.ts');
  const purchaseRepository = source('src/data/repositories/purchaseOperations.ts');
  const purchaseSurface = source('src/features/purchases/PurchaseOperationsWorkspace.tsx');
  assert.doesNotMatch(supplierRepository, /unleashed_raw_snapshots/);
  assert.doesNotMatch(productRepository, /unleashed_raw_snapshots/);
  for (const forbidden of ['createPurchaseOrder', 'startPurchaseOrderReceipt', 'uploadReceivingDocument', 'reviewPurchaseOrder']) {
    assert.equal(purchaseRepository.includes(forbidden), false, `purchase read adapter leaked ${forbidden}`);
    assert.equal(purchaseSurface.includes(forbidden), false, `purchase surface leaked ${forbidden}`);
  }
  assert.match(supplierRepository, /state: 'DEGRADED'/);
  assert.match(supplierRepository, /'UNAVAILABLE'/);
  assert.match(supplierRepository, /isAuthoritative: false/);
});

test('unknown routes and role violations fail closed without dashboard fallback', () => {
  assert.deepEqual(matchIntelligenceRoute('/not-a-workspace'), {
    status: 'UNAVAILABLE',
    pathname: '/not-a-workspace',
    reason: 'ROUTE_NOT_FOUND',
  });
  assert.equal(resolveIntelligenceRoute('/inventory', 'account').status, 'FORBIDDEN');
  assert.equal(resolveIntelligenceRoute('/settings', 'viewer').status, 'FORBIDDEN');
  assert.equal(resolveIntelligenceRoute('/ordermentum', 'viewer').status, 'FORBIDDEN');
  assert.equal(resolveIntelligenceRoute('/inventory', 'viewer').status, 'READY');
  assert.equal(resolveIntelligenceRoute('/analytics', 'account').status, 'READY');
  assert.equal(resolveIntelligenceRoute('/reconciliation', 'viewer').status, 'READY');
  assert.equal(resolveIntelligenceRoute('/control-room', 'warehouse').status, 'FORBIDDEN');
});

test('query parsing preserves valid context while reporting malformed values', () => {
  const parsed = parseWorkspaceQuery('?date=2026-07-29&from=2026-07-30&to=2026-07-01&filter=status%3AREADY&filter=store%3A42&sort=priority&drawer=order%3A1');
  assert.equal(parsed.state.businessDate, '2026-07-29');
  assert.equal(parsed.state.dateFrom, '2026-07-30');
  assert.equal(parsed.state.dateTo, '2026-07-01');
  assert.deepEqual(parsed.state.filters, ['status:READY', 'store:42']);
  assert.equal(parsed.state.sort, 'priority');
  assert.equal(parsed.state.primaryDrawer, 'order:1');
  assert.equal(parsed.issues.some((issue) => issue.code === 'INVALID_DATE_RANGE'), true);

  const partiallyInvalid = parseWorkspaceQuery('?date=2026-02-30&filter=status%3AREADY&view=morning');
  assert.equal(partiallyInvalid.state.businessDate, undefined);
  assert.deepEqual(partiallyInvalid.state.filters, ['status:READY']);
  assert.equal(partiallyInvalid.state.savedView, 'morning');
  assert.equal(partiallyInvalid.issues[0]?.code, 'INVALID_BUSINESS_DATE');
});

test('query serialisation is stable, bounded and shareable', () => {
  const state = {
    businessDate: '2026-07-29',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-29',
    compare: 'previous-period',
    filters: ['status:READY', 'store:42'],
    sort: 'priority',
    cursor: 'page-2',
    selected: 'order-1',
    primaryDrawer: 'order:order-1',
    secondaryInspector: 'store:store-42',
    savedView: 'morning',
  };
  const query = serialiseWorkspaceQuery(state);
  assert.equal(query, 'date=2026-07-29&from=2026-07-01&to=2026-07-29&compare=previous-period&filter=status%3AREADY&filter=store%3A42&sort=priority&cursor=page-2&selected=order-1&drawer=order%3Aorder-1&inspector=store%3Astore-42&view=morning');
  assert.equal(withWorkspaceQuery('/orders', state), `/orders?${query}`);
  assert.deepEqual(parseWorkspaceQuery(query).state, state);
});

test('overlay reducer enforces one primary and one replaceable secondary', () => {
  let state = reduceIntelligenceOverlay(EMPTY_INTELLIGENCE_OVERLAY_STATE, {
    type: 'OPEN_PRIMARY',
    entity: { kind: 'order', id: 'order-1' },
  });
  assert.equal(informationOverlayDepth(state), 1);

  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_RELATED',
    entity: { kind: 'store', id: 'store-1' },
  });
  assert.equal(informationOverlayDepth(state), 2);
  assert.equal(state.secondary?.entity.id, 'store-1');

  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_RELATED',
    entity: { kind: 'customer', id: 'customer-1' },
    openedFrom: 'secondary',
  });
  assert.equal(informationOverlayDepth(state), 2);
  assert.equal(state.primary?.entity.id, 'order-1');
  assert.equal(state.secondary?.entity.id, 'customer-1');
  assert.deepEqual(overlayStateToQuerySelection(state), {
    selected: 'order-1',
    drawer: 'order:order-1',
    inspector: 'customer:customer-1',
  });
});

test('close-top dismisses commit before secondary and primary overlays', () => {
  let state = reduceIntelligenceOverlay(EMPTY_INTELLIGENCE_OVERLAY_STATE, {
    type: 'OPEN_PRIMARY',
    entity: { kind: 'order', id: 'order-1' },
  });
  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_RELATED',
    entity: { kind: 'store', id: 'store-1' },
  });
  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_COMMIT',
    modal: { actionKey: 'release-order', title: 'Release order', reasonRequired: true },
  });

  state = reduceIntelligenceOverlay(state, { type: 'CLOSE_TOP' });
  assert.equal(state.commit, null);
  assert.equal(informationOverlayDepth(state), 2);

  state = reduceIntelligenceOverlay(state, { type: 'CLOSE_TOP' });
  assert.equal(state.secondary, null);
  assert.equal(informationOverlayDepth(state), 1);

  state = reduceIntelligenceOverlay(state, { type: 'CLOSE_TOP' });
  assert.equal(state.primary, null);
  assert.equal(informationOverlayDepth(state), 0);
});

test('overlay navigation flag is opt-in and false by default', () => {
  assert.deepEqual(resolveIntelligenceFeatureFlags(), { overlay_navigation_v1: false });
  assert.equal(resolveIntelligenceFeatureFlags({ VITE_OVERLAY_NAVIGATION_V1: 'true' }).overlay_navigation_v1, true);
  assert.equal(resolveIntelligenceFeatureFlags({ VITE_OVERLAY_NAVIGATION_V1: 'ON' }).overlay_navigation_v1, true);
  assert.equal(resolveIntelligenceFeatureFlags({ VITE_OVERLAY_NAVIGATION_V1: 'false' }).overlay_navigation_v1, false);
  assert.equal(resolveIntelligenceFeatureFlags({ VITE_OVERLAY_NAVIGATION_V1: 'unexpected' }).overlay_navigation_v1, false);
});
