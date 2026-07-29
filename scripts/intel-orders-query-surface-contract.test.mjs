import test from 'node:test';
import assert from 'node:assert/strict';
import { applyListQuery } from '../src/features/intelligence/query/listQueryContract.ts';
import {
  buildOrderOverlayRecord,
  orderStatusTone,
  ordersListQuerySchema,
  paymentStatusTone,
  podStatusTone,
} from '../src/features/orders/ordersQueryContract.ts';

function order(overrides = {}) {
  return {
    id: 'order-1',
    orderNo: 'ORD-001',
    invoiceNo: 'INV-001',
    store: 'Alpha Kitchen',
    account: 'Alpha Group',
    priceTier: 'Tier A',
    address: '1 King Street',
    suburb: 'Adelaide',
    eta: '',
    status: 'IMPORTED',
    paymentStatus: 'UNPAID',
    selected: false,
    sequence: 1,
    amount: 120,
    packageCount: 2,
    podStatus: 'missing',
    mappingNotes: [],
    externalOrderId: 'external-1',
    firstSeenAt: '2026-07-30T00:00:00Z',
    lastSeenAt: '2026-07-30T01:00:00Z',
    lastSyncedAt: '2026-07-30T01:00:00Z',
    businessDay: '2026-07-30',
    requestedDeliveryBusinessDay: '2026-07-30',
    firstSeenBusinessDay: '2026-07-30',
    lastUpdatedBusinessDay: '2026-07-30',
    syncStatus: 'NEW',
    changeImpact: 'NO_CHANGE',
    changeSummary: 'Imported',
    openExceptionCount: 0,
    lines: [{ sku: 'CUP-12W', name: 'Cup', qty: 2, unit: 'carton', stock: 10, location: 'A1' }],
    ...overrides,
  };
}

test('Orders query schema searches verified identifiers and applies typed filters', () => {
  const rows = [
    order({ id: 'one', orderNo: 'ORD-100', store: 'Adelaide Cafe', status: 'RELEASE_READY', paymentStatus: 'PAID', amount: 90 }),
    order({ id: 'two', orderNo: 'ORD-200', store: 'Sydney Cafe', suburb: 'Sydney', status: 'RELEASE_READY', paymentStatus: 'UNPAID', amount: 200 }),
    order({ id: 'three', orderNo: 'ORD-300', store: 'Adelaide Deli', status: 'PACKED', paymentStatus: 'PAID', amount: 150 }),
  ];

  const result = applyListQuery(rows, ordersListQuerySchema, {
    search: 'Adelaide',
    filters: ['payment:PAID'],
    sort: 'value:desc',
    pageSize: 25,
  });

  assert.deepEqual(result.rows.map((row) => row.id), ['three', 'one']);
  assert.equal(result.total, 2);
  assert.equal(result.query.sortKey, 'value');
  assert.equal(result.query.direction, 'desc');
});

test('Orders query pagination remains bounded to configured page sizes', () => {
  const rows = Array.from({ length: 60 }, (_, index) => order({
    id: `order-${index}`,
    orderNo: `ORD-${String(index).padStart(3, '0')}`,
    lastSeenAt: `2026-07-30T${String(index % 24).padStart(2, '0')}:00:00Z`,
  }));
  const result = applyListQuery(rows, ordersListQuerySchema, {
    filters: [],
    cursor: 'page:2',
    pageSize: 25,
  });
  assert.equal(result.rows.length, 25);
  assert.equal(result.from, 26);
  assert.equal(result.to, 50);
  assert.equal(result.totalPages, 3);
});

test('Order signal tones distinguish completed, active and blocked states', () => {
  assert.equal(orderStatusTone('DELIVERED'), 'success');
  assert.equal(orderStatusTone('FAILED'), 'danger');
  assert.equal(orderStatusTone('PICKING'), 'information');
  assert.equal(orderStatusTone('RELEASE_READY'), 'warning');
  assert.equal(paymentStatusTone('CREDIT_HOLD'), 'danger');
  assert.equal(paymentStatusTone('PAID'), 'success');
  assert.equal(podStatusTone('captured'), 'success');
  assert.equal(podStatusTone('missing'), 'warning');
});

test('Order drawer record preserves operational fields without write actions', () => {
  const record = buildOrderOverlayRecord(order({
    status: 'RELEASE_READY',
    releaseGateStatus: 'READY_TO_RELEASE',
    releaseBlockers: '',
    changeSummary: 'Ready',
  }));
  assert.deepEqual(record.entity, { kind: 'order', id: 'order-1' });
  assert.equal(record.title, 'ORD-001');
  assert.equal(record.width, 'wide');
  const fields = Object.fromEntries(record.fields.map((field) => [field.label, field.value]));
  assert.equal(fields.Store, 'Alpha Kitchen');
  assert.equal(fields.Status, 'RELEASE READY');
  assert.equal(fields['Release gate'], 'READY TO RELEASE');
  assert.equal(fields.Value, '$120.00');
  assert.equal(fields.Lines, 'CUP-12W × 2 carton');
  assert.equal(record.fields.some((field) => /release|update|save/i.test(field.label) && field.label !== 'Release gate' && field.label !== 'Updated'), false);
});
