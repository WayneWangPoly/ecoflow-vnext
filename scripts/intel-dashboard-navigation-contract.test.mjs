import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStageTarget } from '../src/features/dashboard/dashboardNavigationContract.ts';

test('operational and ready stages open Orders', () => {
  assert.equal(dashboardStageTarget('blocked', 'owner'), 'orders');
  assert.equal(dashboardStageTarget('ready', 'viewer'), 'orders');
  assert.equal(dashboardStageTarget('review', 'owner'), 'orders');
});

test('Accounts finance review opens Reconciliation', () => {
  assert.equal(dashboardStageTarget('review', 'account'), 'reconciliation');
});

test('warehouse execution stages open Delivery', () => {
  assert.equal(dashboardStageTarget('warehouse', 'owner'), 'delivery');
  assert.equal(dashboardStageTarget('route', 'account'), 'delivery');
});
