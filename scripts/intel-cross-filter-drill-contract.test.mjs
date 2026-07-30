import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCrossFilterDrillModel,
  buildCrossFilterDrillPath,
} from '../src/features/intelligence/crossFilter/crossFilterDrillContract.ts';

function entity(kind, id, label, subtitle) {
  return { kind, id, label, subtitle };
}

function breakdown(overrides = {}) {
  return {
    dimensionKey: 'customer',
    dimensionLabel: 'Customer',
    valueKey: 'customer-1',
    valueLabel: 'Customer One',
    affectedCount: 1,
    truncated: false,
    entities: [entity('order', 'order-1', 'ORD-001', 'Customer One')],
    ...overrides,
  };
}

function readyInput(overrides = {}) {
  return {
    metric: {
      metricKey: 'revenue',
      availability: 'READY',
      quality: 'TRUSTED',
      freshness: 'CURRENT',
    },
    drillCapability: 'AVAILABLE',
    supportedDimensions: ['customer'],
    breakdowns: [breakdown()],
    ...overrides,
  };
}

test('READY metric builds KPI to breakdown to entity to drawer to operational route chain', () => {
  const model = buildCrossFilterDrillModel(readyInput());
  assert.equal(model.state, 'ready');
  assert.equal(model.metricKey, 'revenue');
  assert.equal(model.breakdowns.length, 1);
  assert.equal(model.breakdowns[0]?.key, 'customer:customer-1');
  assert.equal(model.breakdowns[0]?.affectedCount, 1);
  assert.equal(model.breakdowns[0]?.entities[0]?.key, 'order:order-1');

  const result = buildCrossFilterDrillPath(model, 'customer:customer-1', 'order:order-1');
  assert.equal(result.status, 'READY');
  assert.equal(result.path.metricKey, 'revenue');
  assert.equal(result.path.primaryDrawer.kind, 'order');
  assert.equal(result.path.primaryDrawer.id, 'order-1');
  assert.equal(result.path.operationalRoute.workspace, 'orders');
  assert.equal(result.path.operationalRoute.pathname, '/orders/order-1');
  assert.equal(result.path.operationalRoute.query.selected, 'order-1');
  assert.equal(result.path.operationalRoute.query.primaryDrawer, 'order:order-1');
  assert.match(result.path.operationalRoute.href, /^\/orders\/order-1\?/);
});

test('SHADOW and BLOCKED metrics suppress supplied drill data', () => {
  for (const availability of ['SHADOW', 'BLOCKED']) {
    const model = buildCrossFilterDrillModel(readyInput({
      metric: { metricKey: 'fill_rate', availability, quality: 'UNKNOWN', freshness: 'UNKNOWN' },
    }));
    assert.equal(model.state, 'blocked');
    assert.equal(model.breakdowns.length, 0);
    assert.ok(model.issues.some((issue) => issue.code === 'NON_DRILLABLE_DATA_SUPPRESSED'));
    assert.deepEqual(
      buildCrossFilterDrillPath(model, 'customer:customer-1', 'order:order-1'),
      { status: 'UNAVAILABLE', reason: 'DRILL_NOT_AVAILABLE' },
    );
  }
});

test('explicit unavailable drill capability blocks an otherwise READY KPI', () => {
  const model = buildCrossFilterDrillModel(readyInput({ drillCapability: 'UNAVAILABLE' }));
  assert.equal(model.state, 'blocked');
  assert.equal(model.metricAvailability, 'READY');
  assert.equal(model.drillCapability, 'UNAVAILABLE');
  assert.deepEqual(model.breakdowns, []);
  assert.ok(model.issues.some((issue) => issue.code === 'NON_DRILLABLE_DATA_SUPPRESSED'));
});

test('unknown metric, availability and drill capability fail closed', () => {
  const unknownMetric = buildCrossFilterDrillModel(readyInput({
    metric: { metricKey: 'imaginary_margin', availability: 'READY' },
  }));
  assert.equal(unknownMetric.state, 'invalid');
  assert.equal(unknownMetric.metricKey, null);
  assert.ok(unknownMetric.issues.some((issue) => issue.code === 'UNKNOWN_METRIC_KEY'));

  const unknownAvailability = buildCrossFilterDrillModel(readyInput({
    metric: { metricKey: 'revenue', availability: 'MAYBE' },
  }));
  assert.equal(unknownAvailability.state, 'invalid');
  assert.ok(unknownAvailability.issues.some((issue) => issue.code === 'UNKNOWN_METRIC_AVAILABILITY'));

  const unknownCapability = buildCrossFilterDrillModel(readyInput({ drillCapability: 'ROLE_OWNER' }));
  assert.equal(unknownCapability.state, 'blocked');
  assert.equal(unknownCapability.drillCapability, 'UNKNOWN');
  assert.ok(unknownCapability.issues.some((issue) => issue.code === 'UNKNOWN_DRILL_CAPABILITY'));
});

test('breakdown dimensions must be explicitly supported', () => {
  const model = buildCrossFilterDrillModel(readyInput({
    supportedDimensions: ['store'],
  }));
  assert.equal(model.state, 'partial');
  assert.equal(model.breakdowns.length, 0);
  assert.ok(model.issues.some((issue) => issue.code === 'UNSUPPORTED_BREAKDOWN_DIMENSION'));
});

test('all existing routed entity kinds produce matching drawers and operational routes', () => {
  const entities = [
    entity('order', 'order 1', 'Order One'),
    entity('commercial-sku', 'sku-1', 'Commercial SKU One'),
    entity('physical-sku', 'item-1', 'Physical Item One'),
    entity('customer', 'customer-1', 'Customer One'),
    entity('store', 'store-1', 'Store One'),
    entity('delivery-run', 'run-1', 'Run One'),
  ];
  const model = buildCrossFilterDrillModel(readyInput({
    breakdowns: [breakdown({ affectedCount: 6, entities })],
  }));
  assert.equal(model.state, 'ready');
  const routes = model.breakdowns[0]?.entities.map((item) => [
    item.entity.kind,
    item.primaryDrawer.kind,
    item.operationalRoute.workspace,
    item.operationalRoute.pathname,
  ]);
  assert.deepEqual(routes, [
    ['order', 'order', 'orders', '/orders/order%201'],
    ['commercial-sku', 'commercial-sku', 'inventory', '/inventory/commercial/sku-1'],
    ['physical-sku', 'physical-sku', 'inventory', '/inventory/physical/item-1'],
    ['customer', 'customer', 'customers', '/customers/customer-1'],
    ['store', 'store', 'stores', '/stores/store-1'],
    ['delivery-run', 'delivery-run', 'delivery', '/delivery/runs/run-1'],
  ]);
});

test('duplicate and invalid entities are omitted and reported without inventing routes', () => {
  const model = buildCrossFilterDrillModel(readyInput({
    breakdowns: [breakdown({
      affectedCount: 4,
      truncated: true,
      entities: [
        entity('order', 'order-1', 'Order One'),
        entity('order', 'order-1', 'Duplicate Order'),
        entity('exception', 'exception-1', 'Unsupported Exception Route'),
        entity('order', 'bad/id', 'Invalid Order ID'),
      ],
    })],
  }));
  assert.equal(model.state, 'partial');
  assert.equal(model.breakdowns[0]?.entities.length, 1);
  assert.ok(model.issues.some((issue) => issue.code === 'DUPLICATE_ENTITY'));
  assert.ok(model.issues.some((issue) => issue.code === 'UNKNOWN_ENTITY_KIND'));
  assert.ok(model.issues.some((issue) => issue.code === 'INVALID_ENTITY_ID'));
});

test('affected counts distinguish complete and truncated entity lists', () => {
  const truncated = buildCrossFilterDrillModel(readyInput({
    breakdowns: [breakdown({
      affectedCount: 12,
      truncated: true,
      entities: [entity('order', 'order-1', 'Order One')],
    })],
  }));
  assert.equal(truncated.state, 'ready');
  assert.equal(truncated.breakdowns[0]?.affectedCount, 12);
  assert.equal(truncated.breakdowns[0]?.truncated, true);

  const mismatch = buildCrossFilterDrillModel(readyInput({
    breakdowns: [breakdown({
      affectedCount: 2,
      truncated: false,
      entities: [entity('order', 'order-1', 'Order One')],
    })],
  }));
  assert.equal(mismatch.state, 'partial');
  assert.ok(mismatch.issues.some((issue) => issue.code === 'AFFECTED_COUNT_MISMATCH'));
});

test('duplicate dimensions and breakdown keys remain explicit partial coverage', () => {
  const model = buildCrossFilterDrillModel(readyInput({
    supportedDimensions: ['customer', 'customer'],
    breakdowns: [breakdown(), breakdown()],
  }));
  assert.equal(model.state, 'partial');
  assert.equal(model.supportedDimensions.length, 1);
  assert.equal(model.breakdowns.length, 1);
  assert.ok(model.issues.some((issue) => issue.code === 'DUPLICATE_DIMENSION_KEY'));
  assert.ok(model.issues.some((issue) => issue.code === 'DUPLICATE_BREAKDOWN_KEY'));
});

test('path selection fails explicitly for missing breakdown or entity', () => {
  const model = buildCrossFilterDrillModel(readyInput());
  assert.deepEqual(
    buildCrossFilterDrillPath(model, 'customer:missing', 'order:order-1'),
    { status: 'UNAVAILABLE', reason: 'BREAKDOWN_NOT_FOUND' },
  );
  assert.deepEqual(
    buildCrossFilterDrillPath(model, 'customer:customer-1', 'order:missing'),
    { status: 'UNAVAILABLE', reason: 'ENTITY_NOT_FOUND' },
  );
});

test('empty, malformed and non-array drill collections remain explicit', () => {
  const empty = buildCrossFilterDrillModel(readyInput({ breakdowns: [] }));
  assert.equal(empty.state, 'empty');
  assert.deepEqual(empty.breakdowns, []);

  const malformed = buildCrossFilterDrillModel(readyInput({ breakdowns: { rows: [] } }));
  assert.equal(malformed.state, 'invalid');
  assert.ok(malformed.issues.some((issue) => issue.code === 'INVALID_BREAKDOWN_COLLECTION'));

  const invalid = buildCrossFilterDrillModel(null);
  assert.equal(invalid.state, 'invalid');
  assert.equal(invalid.issues[0]?.code, 'INVALID_INPUT');
});
