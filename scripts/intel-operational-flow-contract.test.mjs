import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOperationalFlow,
  classifyOperationalFlowOrder,
  operationalFlowStages,
} from '../src/features/intelligence/operationalFlow/operationalFlowContract.ts';

function order(id, status, releaseGateStatus) {
  return { id, status, releaseGateStatus };
}

function stage(id, status, releaseGateStatus) {
  const result = classifyOperationalFlowOrder(order(id, status, releaseGateStatus));
  assert.equal(result.kind, 'classified');
  return result;
}

test('canonical flow exposes exactly eight ordered mutually exclusive stages', () => {
  assert.deepEqual(operationalFlowStages.map((item) => item.key), [
    'NEW',
    'NEEDS_ACTION',
    'FINANCE_REVIEW',
    'READY',
    'WAREHOUSE',
    'STAGED',
    'ROUTE',
    'DELIVERED',
  ]);
  assert.deepEqual(operationalFlowStages.map((item) => item.label), [
    'New',
    'Needs Action',
    'Finance Review',
    'Ready',
    'Warehouse',
    'Staged',
    'Route',
    'Delivered',
  ]);
});

test('pre-release orders follow exception and governed release-gate precedence', () => {
  assert.equal(stage('new', 'IMPORTED').stage, 'NEW');
  assert.equal(stage('mapping', 'MAPPING_EXCEPTION').stage, 'NEEDS_ACTION');
  assert.equal(stage('failed', 'FAILED').stage, 'NEEDS_ACTION');
  assert.equal(stage('blocked-data', 'IMPORTED', 'BLOCKED_DATA').stage, 'NEEDS_ACTION');
  assert.equal(stage('blocked-mapping', 'IMPORTED', 'BLOCKED_MAPPING').stage, 'NEEDS_ACTION');
  assert.equal(stage('blocked-stock', 'IMPORTED', 'BLOCKED_STOCK').stage, 'NEEDS_ACTION');
  assert.equal(stage('finance', 'IMPORTED', 'REVIEW_PAYMENT').stage, 'FINANCE_REVIEW');
  assert.equal(stage('ready-gate', 'IMPORTED', 'READY_TO_RELEASE').stage, 'READY');
  assert.equal(stage('ready-status', 'RELEASE_READY').stage, 'READY');
});

test('pre-go-live commissioning collapses mapping and stock dependencies without hiding real blockers', () => {
  const commissioning = { inventoryQuantityCommissioned: false };

  const mapping = classifyOperationalFlowOrder(order('mapping', 'MAPPING_EXCEPTION', 'BLOCKED_MAPPING'), commissioning);
  assert.equal(mapping.kind, 'classified');
  assert.equal(mapping.stage, 'NEW');

  const stock = classifyOperationalFlowOrder(order('stock', 'IMPORTED', 'BLOCKED_STOCK'), commissioning);
  assert.equal(stock.kind, 'classified');
  assert.equal(stock.stage, 'NEW');

  const data = classifyOperationalFlowOrder(order('data', 'IMPORTED', 'BLOCKED_DATA'), commissioning);
  assert.equal(data.kind, 'classified');
  assert.equal(data.stage, 'NEEDS_ACTION');

  const failed = classifyOperationalFlowOrder(order('failed', 'FAILED', 'BLOCKED_MAPPING'), commissioning);
  assert.equal(failed.kind, 'classified');
  assert.equal(failed.stage, 'NEEDS_ACTION');

  const finance = classifyOperationalFlowOrder(order('finance', 'IMPORTED', 'REVIEW_PAYMENT'), commissioning);
  assert.equal(finance.kind, 'classified');
  assert.equal(finance.stage, 'FINANCE_REVIEW');

  const liveMapping = classifyOperationalFlowOrder(
    order('live-mapping', 'MAPPING_EXCEPTION', 'BLOCKED_MAPPING'),
    { inventoryQuantityCommissioned: true },
  );
  assert.equal(liveMapping.kind, 'classified');
  assert.equal(liveMapping.stage, 'NEEDS_ACTION');

  const liveStock = classifyOperationalFlowOrder(
    order('live-stock', 'IMPORTED', 'BLOCKED_STOCK'),
    { inventoryQuantityCommissioned: true },
  );
  assert.equal(liveStock.kind, 'classified');
  assert.equal(liveStock.stage, 'NEEDS_ACTION');

  const flow = buildOperationalFlow([
    order('mapping', 'MAPPING_EXCEPTION', 'BLOCKED_MAPPING'),
    order('stock', 'IMPORTED', 'BLOCKED_STOCK'),
    order('data', 'IMPORTED', 'BLOCKED_DATA'),
  ], commissioning);
  assert.equal(flow.conservationOk, true);
  assert.deepEqual(flow.nodes.map((node) => node.count), [2, 1, 0, 0, 0, 0, 0, 0]);
});

test('execution status is authoritative and keeps Warehouse separate from Staged', () => {
  assert.equal(stage('released', 'RELEASED').stage, 'WAREHOUSE');
  assert.equal(stage('picking', 'PICKING').stage, 'WAREHOUSE');
  assert.equal(stage('packed', 'PACKED').stage, 'WAREHOUSE');
  assert.equal(stage('staged', 'STAGED').stage, 'STAGED');
  assert.equal(stage('route', 'OUT_FOR_DELIVERY').stage, 'ROUTE');
  assert.equal(stage('delivered', 'DELIVERED').stage, 'DELIVERED');
  assert.equal(stage('closed', 'CLOSED').stage, 'DELIVERED');
});

test('cancelled orders are excluded rather than presented as delivered', () => {
  const result = classifyOperationalFlowOrder(order('cancelled', 'CANCELLED'));
  assert.deepEqual(result, {
    kind: 'excluded',
    orderId: 'cancelled',
    reason: 'CANCELLED',
    issues: [],
  });
});

test('stale release gates never pull execution orders backwards', () => {
  const result = stage('staged-stale-gate', 'STAGED', 'BLOCKED_STOCK');
  assert.equal(result.stage, 'STAGED');
  assert.equal(result.issues[0]?.code, 'STALE_RELEASE_GATE_IGNORED');
});

test('contradictory ready status and blocking gate remains blocked and explicit', () => {
  const result = stage('ready-blocked', 'RELEASE_READY', 'BLOCKED_MAPPING');
  assert.equal(result.stage, 'NEEDS_ACTION');
  assert.ok(result.issues.some((issue) => issue.code === 'CONFLICTING_PRE_RELEASE_SIGNAL'));

  const mappingReady = stage('mapping-ready', 'MAPPING_EXCEPTION', 'READY_TO_RELEASE');
  assert.equal(mappingReady.stage, 'NEEDS_ACTION');
  assert.ok(mappingReady.issues.some((issue) => issue.code === 'CONFLICTING_PRE_RELEASE_SIGNAL'));
});

test('unknown pre-release signals fail closed instead of manufacturing a stage', () => {
  const unknownGate = classifyOperationalFlowOrder(order('unknown-gate', 'IMPORTED', 'MAGIC_GATE'));
  assert.equal(unknownGate.kind, 'unknown');
  assert.ok(unknownGate.issues.some((issue) => issue.code === 'UNKNOWN_RELEASE_GATE'));

  const unknownStatus = classifyOperationalFlowOrder(order('unknown-status', 'TELEPORTED', 'READY_TO_RELEASE'));
  assert.equal(unknownStatus.kind, 'unknown');
  assert.ok(unknownStatus.issues.some((issue) => issue.code === 'UNKNOWN_STATUS'));
});

test('flow counts conserve every source row without double-classifying orders', () => {
  const result = buildOperationalFlow([
    order('new', 'IMPORTED'),
    order('action', 'IMPORTED', 'BLOCKED_DATA'),
    order('finance', 'IMPORTED', 'REVIEW_PAYMENT'),
    order('ready', 'IMPORTED', 'READY_TO_RELEASE'),
    order('warehouse', 'PICKING'),
    order('staged', 'STAGED'),
    order('route', 'OUT_FOR_DELIVERY'),
    order('delivered', 'DELIVERED'),
    order('cancelled', 'CANCELLED'),
  ]);

  assert.equal(result.state, 'ready');
  assert.equal(result.sourceCount, 9);
  assert.equal(result.uniqueOrderCount, 9);
  assert.equal(result.classifiedCount, 8);
  assert.equal(result.excludedCount, 1);
  assert.equal(result.unknownCount, 0);
  assert.equal(result.invalidCount, 0);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.conservationOk, true);
  assert.deepEqual(result.nodes.map((node) => node.count), [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(result.assignments.map((assignment) => assignment.orderId)).size, 8);
});

test('duplicates invalid rows and unknown orders remain explicit partial coverage', () => {
  const result = buildOperationalFlow([
    order('one', 'IMPORTED'),
    order('one', 'STAGED'),
    null,
    { id: '', status: 'IMPORTED' },
    order('unknown', 'IMPORTED', 'NOT_A_GATE'),
  ]);

  assert.equal(result.state, 'partial');
  assert.equal(result.sourceCount, 5);
  assert.equal(result.uniqueOrderCount, 2);
  assert.equal(result.classifiedCount, 1);
  assert.equal(result.unknownCount, 1);
  assert.equal(result.invalidCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.conservationOk, true);
  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_ORDER_ID'));
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_ORDER'));
  assert.ok(result.issues.some((issue) => issue.code === 'INVALID_ORDER_ID'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_RELEASE_GATE'));
});

test('empty and non-array sources remain explicit without fabricated orders', () => {
  const empty = buildOperationalFlow([]);
  assert.equal(empty.state, 'empty');
  assert.equal(empty.sourceCount, 0);
  assert.deepEqual(empty.nodes.map((node) => node.count), [0, 0, 0, 0, 0, 0, 0, 0]);

  const invalid = buildOperationalFlow({ orders: [] });
  assert.equal(invalid.state, 'invalid');
  assert.equal(invalid.sourceCount, 0);
  assert.equal(invalid.issues[0]?.code, 'INVALID_COLLECTION');
});