import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionHandoffDefinitions,
  actionHandoffKeys,
  buildActionHandoff,
  validateActionHandoffRegistry,
} from '../src/features/intelligence/analytics/actionIntegration/actionHandoffContract.ts';

test('Action Handoff publishes exactly five read-only operational destinations', () => {
  assert.deepEqual(actionHandoffKeys, [
    'OPEN_ORDER',
    'OPEN_INVENTORY',
    'OPEN_CUSTOMER',
    'OPEN_ROUTE',
    'OPEN_EXCEPTION',
  ]);
  assert.equal(actionHandoffDefinitions.length, 5);
  assert.deepEqual(validateActionHandoffRegistry(), []);
});

test('Action Handoff carries bounded analysis context into the destination URL', () => {
  const result = buildActionHandoff('OPEN_ORDER', {
    domainId: 'inventory',
    breakdownKey: 'stockout-risk',
    entityId: 'order-123',
    sourceAsOfAt: '2026-07-31T05:00:00.000Z',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const url = new URL(result.handoff.href, 'https://ecoflow.local');
  assert.equal(url.pathname, '/orders');
  assert.equal(url.searchParams.get('source'), 'domain-intelligence');
  assert.equal(url.searchParams.get('domain'), 'inventory');
  assert.equal(url.searchParams.get('handoff'), 'OPEN_ORDER');
  assert.equal(url.searchParams.get('breakdown'), 'stockout-risk');
  assert.equal(url.searchParams.get('selected'), 'order-123');
  assert.equal(url.searchParams.get('asOf'), '2026-07-31T05:00:00.000Z');
});

test('Action Handoff preserves workspace navigation when no entity identity is supplied', () => {
  const result = buildActionHandoff('OPEN_CUSTOMER', { domainId: 'customers' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const url = new URL(result.handoff.href, 'https://ecoflow.local');
  assert.equal(url.pathname, '/customers');
  assert.equal(url.searchParams.has('selected'), false);
  assert.equal(url.searchParams.get('domain'), 'customers');
});

test('invalid handoff context fails closed instead of inventing an operational identity', () => {
  const result = buildActionHandoff('OPEN_ROUTE', {
    domainId: 'delivery',
    entityId: '../unsafe',
    sourceAsOfAt: 'not-a-time',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'INVALID_ENTITY_ID',
    'INVALID_SOURCE_TIMESTAMP',
  ]);
});

test('exception handoff keeps exception identity separate from selected entity identity', () => {
  const result = buildActionHandoff('OPEN_EXCEPTION', {
    domainId: 'data-quality',
    exceptionId: 'ORDERMENTUM_ACTIVE:abcdef123456',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const url = new URL(result.handoff.href, 'https://ecoflow.local');
  assert.equal(url.pathname, '/analytics');
  assert.equal(url.searchParams.get('exception'), 'ORDERMENTUM_ACTIVE:abcdef123456');
  assert.equal(url.searchParams.has('selected'), false);
});
