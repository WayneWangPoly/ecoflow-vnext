import test from 'node:test';
import assert from 'node:assert/strict';
import { buildControlRoomCommissioningView } from '../src/features/dashboard/controlRoomCommissioningView.ts';

function flow(assignments) {
  const keys = ['NEW', 'NEEDS_ACTION', 'FINANCE_REVIEW', 'READY', 'WAREHOUSE', 'STAGED', 'ROUTE', 'DELIVERED'];
  return {
    state: 'ready',
    sourceCount: assignments.length,
    uniqueOrderCount: assignments.length,
    classifiedCount: assignments.length,
    excludedCount: 0,
    unknownCount: 0,
    invalidCount: 0,
    duplicateCount: 0,
    conservationOk: true,
    nodes: keys.map((key) => ({ key, label: key, count: assignments.filter((row) => row.stage === key).length, orderIds: assignments.filter((row) => row.stage === key).map((row) => row.orderId) })),
    assignments,
    exclusions: [],
    unknownOrders: [],
    issues: [],
  };
}

function order(id, status, releaseGateStatus) {
  return { id, status, releaseGateStatus };
}

test('pre-go-live mapping and stock Needs Action rows are presentation-deferred to Loaded/New', () => {
  const canonical = flow([
    { orderId: 'map', stage: 'NEEDS_ACTION' },
    { orderId: 'stock', stage: 'NEEDS_ACTION' },
  ]);
  const view = buildControlRoomCommissioningView(canonical, [
    order('map', 'MAPPING_EXCEPTION', 'BLOCKED_MAPPING'),
    order('stock', 'IMPORTED', 'BLOCKED_STOCK'),
  ], false);
  assert.deepEqual(view.assignments.map((row) => row.stage), ['NEW', 'NEW']);
  assert.deepEqual(view.deferredOrderIds, ['map', 'stock']);
  assert.equal(view.deferredCount, 2);
});

test('commissioned inventory preserves canonical mapping and stock Needs Action rows', () => {
  const canonical = flow([{ orderId: 'map', stage: 'NEEDS_ACTION' }]);
  const view = buildControlRoomCommissioningView(canonical, [
    order('map', 'MAPPING_EXCEPTION', 'BLOCKED_MAPPING'),
  ], true);
  assert.equal(view.assignments[0].stage, 'NEEDS_ACTION');
  assert.equal(view.deferredCount, 0);
});

test('unknown commissioning authority preserves canonical fail-closed presentation', () => {
  const canonical = flow([{ orderId: 'stock', stage: 'NEEDS_ACTION' }]);
  const view = buildControlRoomCommissioningView(canonical, [
    order('stock', 'IMPORTED', 'BLOCKED_STOCK'),
  ], undefined);
  assert.equal(view.assignments[0].stage, 'NEEDS_ACTION');
  assert.equal(view.deferredCount, 0);
});

test('FAILED and BLOCKED_DATA remain item-level Needs Action before go-live', () => {
  const canonical = flow([
    { orderId: 'failed', stage: 'NEEDS_ACTION' },
    { orderId: 'data', stage: 'NEEDS_ACTION' },
  ]);
  const view = buildControlRoomCommissioningView(canonical, [
    order('failed', 'FAILED', 'BLOCKED_STOCK'),
    order('data', 'IMPORTED', 'BLOCKED_DATA'),
  ], false);
  assert.deepEqual(view.assignments.map((row) => row.stage), ['NEEDS_ACTION', 'NEEDS_ACTION']);
  assert.equal(view.deferredCount, 0);
});

test('adapter never moves canonical non-Needs-Action execution or finance assignments', () => {
  const canonical = flow([
    { orderId: 'finance', stage: 'FINANCE_REVIEW' },
    { orderId: 'warehouse', stage: 'WAREHOUSE' },
    { orderId: 'route', stage: 'ROUTE' },
  ]);
  const view = buildControlRoomCommissioningView(canonical, [
    order('finance', 'IMPORTED', 'BLOCKED_STOCK'),
    order('warehouse', 'PICKING', 'BLOCKED_STOCK'),
    order('route', 'OUT_FOR_DELIVERY', 'BLOCKED_MAPPING'),
  ], false);
  assert.deepEqual(view.assignments.map((row) => row.stage), ['FINANCE_REVIEW', 'WAREHOUSE', 'ROUTE']);
  assert.equal(view.deferredCount, 0);
});
