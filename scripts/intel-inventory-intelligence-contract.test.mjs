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
  buildInventoryIntelligenceHandoff,
  buildInventoryIntelligenceModel,
  inventoryIntelligenceSurfaceCapabilities,
} = await import('../src/features/intelligence/inventory/inventoryIntelligenceContract.ts');

const AS_OF = '2026-07-31T02:00:00.000Z';
const READ_AT = '2026-07-31T02:01:00.000Z';

function commercial(overrides = {}) {
  return {
    commercialSkuId: 'commercial-glove-medium-black',
    label: 'Medium black gloves',
    identityState: 'RESOLVED',
    coverageState: 'FULL',
    approvedPhysicalSkuCount: 3,
    availablePhysicalSkuCount: 2,
    affectedOrderCount: 0,
    daysOfCover: 12.5,
    reorderRisk: 'NONE',
    asOfAt: AS_OF,
    ...overrides,
  };
}

function physical(overrides = {}) {
  return {
    physicalSkuId: 'supplier-a-glove-medium-black',
    label: 'Supplier A medium black gloves',
    identityState: 'RESOLVED',
    commercialSkuId: 'commercial-glove-medium-black',
    commercialSkuLabel: 'Medium black gloves',
    supplier: 'Supplier A',
    brand: 'Brand A',
    locationId: 'A1-01',
    locationLabel: 'Rack A1 / Cell 01',
    quantityDomain: 'LOCATION_PACKAGE',
    unitLevel: 'CARTON',
    onHand: 0,
    available: 0,
    reserved: null,
    daysOfCover: null,
    reorderRisk: 'WATCH',
    asOfAt: AS_OF,
    ...overrides,
  };
}

function timeline(overrides = {}) {
  return {
    eventId: 'movement-1',
    occurredAt: AS_OF,
    eventType: 'PICK',
    physicalSkuId: 'supplier-a-glove-medium-black',
    physicalSkuLabel: 'Supplier A medium black gloves',
    commercialSkuId: 'commercial-glove-medium-black',
    locationId: 'A1-01',
    locationLabel: 'Rack A1 / Cell 01',
    quantityDomain: 'LOCATION_PACKAGE',
    unitLevel: 'CARTON',
    quantityDelta: -2,
    referenceKind: 'order',
    referenceId: 'order-100',
    referenceLabel: 'OMO100',
    ...overrides,
  };
}

function readyInput(overrides = {}) {
  return {
    state: 'READY',
    asOfAt: AS_OF,
    serverReadAt: READ_AT,
    freshness: 'CURRENT',
    quality: 'TRUSTED',
    commercialSkus: [commercial()],
    physicalSkus: [physical()],
    timeline: [timeline()],
    ...overrides,
  };
}

test('domain manifest covers every required Inventory Intelligence surface', () => {
  assert.deepEqual(inventoryIntelligenceSurfaceCapabilities, [
    'OVERVIEW',
    'FILTERS',
    'TREND',
    'BREAKDOWN',
    'COMMERCIAL_TABLE',
    'PHYSICAL_TABLE',
    'DETAIL_DRAWER',
    'TIMELINE',
    'FRESHNESS',
    'OPERATIONAL_HANDOFF',
  ]);
});

test('READY inventory preserves confirmed zero and separate commercial and physical identities', () => {
  const model = buildInventoryIntelligenceModel(readyInput());
  assert.equal(model.status, 'ready');
  assert.equal(model.state, 'READY');
  assert.equal(model.commercialSkus[0]?.commercialSkuId, 'commercial-glove-medium-black');
  assert.equal(model.commercialSkus[0]?.affectedOrderCount, 0);
  assert.equal(model.physicalSkus[0]?.physicalSkuId, 'supplier-a-glove-medium-black');
  assert.equal(model.physicalSkus[0]?.commercialSkuId, 'commercial-glove-medium-black');
  assert.equal(model.physicalSkus[0]?.onHand, 0);
  assert.equal(model.physicalSkus[0]?.available, 0);
  assert.equal(model.physicalSkus[0]?.reserved, null);
});

test('global base and location package quantities remain distinct server-owned domains', () => {
  const model = buildInventoryIntelligenceModel(readyInput({
    physicalSkus: [
      physical({
        physicalSkuId: 'base-ledger-item',
        quantityDomain: 'GLOBAL_BASE',
        unitLevel: 'EACH',
        onHand: 120,
      }),
      physical({
        physicalSkuId: 'package-location-item',
        quantityDomain: 'LOCATION_PACKAGE',
        unitLevel: 'CARTON',
        onHand: 6,
      }),
    ],
  }));
  assert.equal(model.status, 'ready');
  assert.deepEqual(
    model.physicalSkus.map((row) => [row.quantityDomain, row.unitLevel, row.onHand]),
    [
      ['GLOBAL_BASE', 'EACH', 120],
      ['LOCATION_PACKAGE', 'CARTON', 6],
    ],
  );
});

test('non-data states suppress supplied rows instead of presenting stale facts', () => {
  for (const state of ['EMPTY', 'UNAVAILABLE', 'FORBIDDEN', 'FAILED']) {
    const model = buildInventoryIntelligenceModel(readyInput({ state }));
    assert.equal(model.commercialSkus.length, 0);
    assert.equal(model.physicalSkus.length, 0);
    assert.equal(model.timeline.length, 0);
    assert.ok(model.issues.some((issue) => issue.code === 'NON_DATA_STATE_SUPPRESSED'));
  }
});

test('duplicate and malformed records are omitted and remain explicit partial coverage', () => {
  const model = buildInventoryIntelligenceModel(readyInput({
    commercialSkus: [commercial(), commercial({ label: 'Duplicate' }), null],
    physicalSkus: [physical(), physical({ label: 'Duplicate' }), physical({ quantityDomain: 'MIXED' })],
    timeline: [timeline(), timeline({ referenceLabel: 'Duplicate' }), timeline({ eventType: 'MAGIC' })],
  }));
  assert.equal(model.status, 'partial');
  assert.equal(model.commercialSkus.length, 1);
  assert.equal(model.physicalSkus.length, 1);
  assert.equal(model.timeline.length, 1);
  assert.ok(model.issues.some((issue) => issue.code === 'DUPLICATE_COMMERCIAL_SKU'));
  assert.ok(model.issues.some((issue) => issue.code === 'DUPLICATE_PHYSICAL_SKU'));
  assert.ok(model.issues.some((issue) => issue.code === 'INVALID_QUANTITY_DOMAIN'));
  assert.ok(model.issues.some((issue) => issue.code === 'DUPLICATE_TIMELINE_EVENT'));
  assert.ok(model.issues.some((issue) => issue.code === 'UNKNOWN_TIMELINE_EVENT_TYPE'));
});

test('commercial and physical identities cannot collapse into one identifier', () => {
  const model = buildInventoryIntelligenceModel(readyInput({
    physicalSkus: [physical({
      physicalSkuId: 'commercial-glove-medium-black',
      commercialSkuId: 'commercial-glove-medium-black',
    })],
  }));
  assert.equal(model.status, 'partial');
  assert.equal(model.physicalSkus.length, 0);
  assert.ok(model.issues.some((issue) => issue.code === 'COMMERCIAL_PHYSICAL_IDENTITY_COLLISION'));
});

test('movement deltas preserve signed values while missing evidence remains null', () => {
  const model = buildInventoryIntelligenceModel(readyInput({
    timeline: [
      timeline({ eventId: 'outbound', quantityDelta: -2 }),
      timeline({ eventId: 'unknown-quantity', quantityDelta: null }),
      timeline({ eventId: 'inbound', quantityDelta: 5, eventType: 'RECEIVING' }),
    ],
  }));
  assert.equal(model.status, 'ready');
  assert.deepEqual(model.timeline.map((event) => event.quantityDelta), [-2, null, 5]);
});

test('row and envelope timestamps fail closed when they exceed the server read', () => {
  const invalidEnvelope = buildInventoryIntelligenceModel(readyInput({
    asOfAt: '2026-07-31T02:02:00.000Z',
  }));
  assert.equal(invalidEnvelope.status, 'invalid');
  assert.ok(invalidEnvelope.issues.some((issue) => issue.code === 'TIMESTAMP_ORDER_INVALID'));

  const invalidRow = buildInventoryIntelligenceModel(readyInput({
    physicalSkus: [physical({ asOfAt: '2026-07-31T02:02:00.000Z' })],
  }));
  assert.equal(invalidRow.status, 'partial');
  assert.equal(invalidRow.physicalSkus.length, 0);
  assert.ok(invalidRow.issues.some((issue) => issue.code === 'ROW_TIMESTAMP_INVALID'));
});

test('commercial SKU, physical SKU and Order handoffs use canonical routed drawers', () => {
  const commercialHandoff = buildInventoryIntelligenceHandoff(
    'commercial-sku',
    'commercial-glove-medium-black',
  );
  assert.equal(commercialHandoff.status, 'READY');
  assert.equal(commercialHandoff.handoff.workspace, 'inventory');
  assert.equal(
    commercialHandoff.handoff.pathname,
    '/inventory/commercial/commercial-glove-medium-black',
  );
  assert.equal(
    commercialHandoff.handoff.query.primaryDrawer,
    'commercial-sku:commercial-glove-medium-black',
  );

  const physicalHandoff = buildInventoryIntelligenceHandoff(
    'physical-sku',
    'supplier-a-glove-medium-black',
  );
  assert.equal(physicalHandoff.status, 'READY');
  assert.equal(physicalHandoff.handoff.workspace, 'inventory');
  assert.equal(
    physicalHandoff.handoff.query.primaryDrawer,
    'physical-sku:supplier-a-glove-medium-black',
  );

  const orderHandoff = buildInventoryIntelligenceHandoff('order', 'order 100');
  assert.equal(orderHandoff.status, 'READY');
  assert.equal(orderHandoff.handoff.workspace, 'orders');
  assert.equal(orderHandoff.handoff.pathname, '/orders/order%20100');
  assert.equal(orderHandoff.handoff.query.primaryDrawer, 'order:order 100');
});

test('invalid entity IDs and malformed envelopes remain unavailable instead of guessing', () => {
  assert.deepEqual(
    buildInventoryIntelligenceHandoff('physical-sku', 'bad/id'),
    { status: 'UNAVAILABLE', reason: 'INVALID_ENTITY_ID' },
  );
  const invalid = buildInventoryIntelligenceModel(null);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.state, 'UNKNOWN');
  assert.equal(invalid.issues[0]?.code, 'INVALID_INPUT');
});

test('a valid data-bearing envelope with no rows is explicitly empty', () => {
  const model = buildInventoryIntelligenceModel(readyInput({
    commercialSkus: [],
    physicalSkus: [],
    timeline: [],
  }));
  assert.equal(model.status, 'empty');
  assert.equal(model.state, 'READY');
  assert.deepEqual(model.commercialSkus, []);
  assert.deepEqual(model.physicalSkus, []);
  assert.deepEqual(model.timeline, []);
});
