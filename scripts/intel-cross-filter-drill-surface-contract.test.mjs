import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const aliasLoader = `
import { pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return {
      url: pathToFileURL(\`${process.cwd()}/src/\${specifier.slice(2)}\`).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(aliasLoader)}`, import.meta.url);

const {
  crossFilterBreakdownMeta,
  crossFilterDrillMetricLabel,
  crossFilterDrillStatePresentation,
  crossFilterEntityKindLabel,
  crossFilterOperationalRouteLabel,
  resolveCrossFilterBreakdown,
} = await import('../src/features/intelligence/crossFilter/crossFilterDrillPresentationContract.ts');

function route(workspace, pathname) {
  return {
    workspace,
    pathname,
    href: `${pathname}?selected=id-1&drawer=order%3Aid-1`,
    query: { filters: [], selected: 'id-1', primaryDrawer: 'order:id-1' },
  };
}

function affectedEntity(kind = 'order', workspace = 'orders') {
  const entity = { kind, id: 'id-1' };
  return {
    key: `${kind}:id-1`,
    entity,
    label: 'Entity One',
    subtitle: 'Verified entity',
    primaryDrawer: entity,
    operationalRoute: route(workspace, '/orders/id-1'),
  };
}

function breakdown(overrides = {}) {
  return {
    key: 'customer:customer-1',
    dimensionKey: 'customer',
    dimensionLabel: 'Customer',
    valueKey: 'customer-1',
    valueLabel: 'Customer One',
    affectedCount: 1,
    truncated: false,
    entities: [affectedEntity()],
    ...overrides,
  };
}

function model(state = 'ready', overrides = {}) {
  return {
    state,
    metricKey: 'revenue',
    metricAvailability: state === 'blocked' ? 'SHADOW' : 'READY',
    metricQuality: 'TRUSTED',
    metricFreshness: 'CURRENT',
    drillCapability: state === 'blocked' ? 'UNAVAILABLE' : 'AVAILABLE',
    supportedDimensions: ['customer'],
    breakdowns: state === 'ready' || state === 'partial' ? [breakdown()] : [],
    issues: state === 'partial' ? [{ code: 'AFFECTED_COUNT_MISMATCH' }] : [],
    ...overrides,
  };
}

test('metric presentation uses canonical Operational Pulse labels', () => {
  assert.equal(crossFilterDrillMetricLabel(model()), 'Revenue');
  assert.equal(crossFilterDrillMetricLabel(model('invalid', { metricKey: null })), 'Unknown metric');
});

test('ready partial empty blocked and invalid states remain visibly distinct', () => {
  assert.deepEqual(crossFilterDrillStatePresentation(model('ready')), {
    label: 'DRILL READY',
    title: 'Governed breakdown available',
    description: 'Select a breakdown value to review its verified affected entities.',
    tone: 'information',
  });
  assert.equal(crossFilterDrillStatePresentation(model('partial')).label, 'PARTIAL DRILL');
  assert.equal(crossFilterDrillStatePresentation(model('empty')).label, 'NO BREAKDOWNS');
  assert.equal(crossFilterDrillStatePresentation(model('blocked')).label, 'DRILL BLOCKED');
  assert.equal(crossFilterDrillStatePresentation(model('invalid')).label, 'DRILL INVALID');
  assert.equal(crossFilterDrillStatePresentation(model('invalid')).tone, 'danger');
});

test('breakdown selection defaults once but fails closed for stale explicit keys', () => {
  const current = model();
  assert.equal(resolveCrossFilterBreakdown(current)?.key, 'customer:customer-1');
  assert.equal(resolveCrossFilterBreakdown(current, 'customer:customer-1')?.valueLabel, 'Customer One');
  assert.equal(resolveCrossFilterBreakdown(current, 'customer:missing'), null);
  assert.equal(resolveCrossFilterBreakdown(model('blocked')), null);
});

test('breakdown meta distinguishes complete and truncated routed coverage', () => {
  assert.equal(crossFilterBreakdownMeta(breakdown()), '1 affected');
  assert.equal(crossFilterBreakdownMeta(breakdown({
    affectedCount: 12,
    truncated: true,
    entities: [affectedEntity(), affectedEntity('store', 'stores')],
  })), '2 routed of 12 affected');
});

test('entity kind labels cover all six routed entity kinds', () => {
  assert.equal(crossFilterEntityKindLabel(affectedEntity('order', 'orders')), 'Order');
  assert.equal(crossFilterEntityKindLabel(affectedEntity('commercial-sku', 'inventory')), 'Commercial SKU');
  assert.equal(crossFilterEntityKindLabel(affectedEntity('physical-sku', 'inventory')), 'Physical SKU');
  assert.equal(crossFilterEntityKindLabel(affectedEntity('customer', 'customers')), 'Customer');
  assert.equal(crossFilterEntityKindLabel(affectedEntity('store', 'stores')), 'Store');
  assert.equal(crossFilterEntityKindLabel(affectedEntity('delivery-run', 'delivery')), 'Delivery run');
});

test('operational route labels derive only from validated route workspace', () => {
  assert.equal(crossFilterOperationalRouteLabel(affectedEntity('order', 'orders')), 'Open Orders');
  assert.equal(crossFilterOperationalRouteLabel(affectedEntity('commercial-sku', 'inventory')), 'Open Inventory');
  assert.equal(crossFilterOperationalRouteLabel(affectedEntity('customer', 'customers')), 'Open Customers');
  assert.equal(crossFilterOperationalRouteLabel(affectedEntity('store', 'stores')), 'Open Stores');
  assert.equal(crossFilterOperationalRouteLabel(affectedEntity('delivery-run', 'delivery')), 'Open Delivery');
});
