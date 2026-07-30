import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStageTarget } from '../src/features/dashboard/dashboardNavigationContract.ts';

test('operational and ready stages open Orders', () => {
  assert.equal(dashboardStageTarget('NEW', 'owner'), 'orders');
  assert.equal(dashboardStageTarget('NEEDS_ACTION', 'owner'), 'orders');
  assert.equal(dashboardStageTarget('READY', 'viewer'), 'orders');
  assert.equal(dashboardStageTarget('FINANCE_REVIEW', 'owner'), 'orders');
  assert.equal(dashboardStageTarget('FINANCE_REVIEW', 'admin'), 'orders');
});

test('Accounts finance review opens Reconciliation', () => {
  assert.equal(dashboardStageTarget('FINANCE_REVIEW', 'account'), 'reconciliation');
});

test('warehouse execution stages open Delivery', () => {
  assert.equal(dashboardStageTarget('WAREHOUSE', 'owner'), 'delivery');
  assert.equal(dashboardStageTarget('STAGED', 'owner'), 'delivery');
  assert.equal(dashboardStageTarget('ROUTE', 'account'), 'delivery');
  assert.equal(dashboardStageTarget('DELIVERED', 'viewer'), 'delivery');
});
