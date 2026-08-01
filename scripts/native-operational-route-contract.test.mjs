import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateRows } from '../src/features/navigation/useWorkspaceQueryState.ts';
import {
  canRoleAccessIntelligenceWorkspace,
  matchIntelligenceRoute,
} from '../src/features/intelligence/navigation/routeContract.ts';

test('pagination clamps invalid and out-of-range pages without dropping records', () => {
  const rows = Array.from({ length: 53 }, (_, index) => index + 1);
  assert.deepEqual(paginateRows(rows, 0, 20), {
    rows: rows.slice(0, 20),
    page: 1,
    pageSize: 20,
    totalRows: 53,
    totalPages: 3,
  });
  assert.deepEqual(paginateRows(rows, 99, 20), {
    rows: rows.slice(40, 53),
    page: 3,
    pageSize: 20,
    totalRows: 53,
    totalPages: 3,
  });
});

test('typed role access does not depend on labels or branding', () => {
  assert.equal(canRoleAccessIntelligenceWorkspace('owner', 'ordermentum'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('admin', 'inventory'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('account', 'ordermentum'), false);
  assert.equal(canRoleAccessIntelligenceWorkspace('account', 'stores'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('viewer', 'inventory'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('viewer', 'settings'), false);
});

test('canonical routes resolve independently of desktop navigation copy', () => {
  assert.equal(matchIntelligenceRoute('/control-room').status, 'READY');
  assert.equal(matchIntelligenceRoute('/ordermentum').status, 'READY');
  assert.equal(matchIntelligenceRoute('/inventory/physical/SKU-1').status, 'READY');
  assert.equal(matchIntelligenceRoute('/customers/STORE-1').status, 'READY');
  assert.equal(matchIntelligenceRoute('/stores/STORE-1').status, 'READY');
});
