import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canRoleAccessIntelligenceWorkspace,
  matchIntelligenceRoute,
} from '../src/features/intelligence/navigation/routeContract.ts';

const read = (path) => existsSync(path) ? readFileSync(path, 'utf8') : '';

const main = read('src/main.tsx');
const routes = read('src/features/operationalRoutes/UnifiedOperationalRoutes.tsx');
const shell = read('src/features/navigation/OperationalAppShell.tsx');
const repository = read('src/data/repositories/operationalRecords.ts');
const workspace = read('src/features/operationalRecords/OperationalRecordsWorkspace.tsx');

test('Phase 5 canonical list and detail routes are explicit', () => {
  assert.equal(matchIntelligenceRoute('/accounts').status, 'READY');
  assert.deepEqual(matchIntelligenceRoute('/accounts/STORE-1'), {
    status: 'READY',
    route: {
      workspace: 'accounts',
      canonicalPath: '/accounts/:storeId',
      entityKind: 'account',
      entityId: 'STORE-1',
      legacyDesktopTab: null,
    },
  });
  assert.deepEqual(matchIntelligenceRoute('/returns/RET-1'), {
    status: 'READY',
    route: {
      workspace: 'returns',
      canonicalPath: '/returns/:returnId',
      entityKind: 'return',
      entityId: 'RET-1',
      legacyDesktopTab: null,
    },
  });
  assert.equal(matchIntelligenceRoute('/inventory/commercial/SKU-1').status, 'READY');
  assert.equal(matchIntelligenceRoute('/customers/STORE-1').status, 'READY');
});

test('Phase 5 role matrix remains fail closed', () => {
  assert.equal(canRoleAccessIntelligenceWorkspace('owner', 'accounts'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('admin', 'returns'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('account', 'accounts'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('account', 'inventory'), false);
  assert.equal(canRoleAccessIntelligenceWorkspace('account', 'returns'), false);
  assert.equal(canRoleAccessIntelligenceWorkspace('viewer', 'inventory'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('viewer', 'customers'), true);
  assert.equal(canRoleAccessIntelligenceWorkspace('viewer', 'accounts'), false);
  assert.equal(canRoleAccessIntelligenceWorkspace('viewer', 'returns'), false);
});

test('unified shell owns Accounts and Returns without removing legacy reconciliation', () => {
  assert.match(main, /pathname === '\/accounts'/);
  assert.match(main, /pathname === '\/returns'/);
  assert.match(routes, /\| 'accounts'/);
  assert.match(routes, /\| 'returns'/);
  assert.match(routes, /OperationalRecordsWorkspace/);
  assert.match(shell, /ACCOUNTS: \{ label: 'Accounts', path: '\/accounts'/);
  assert.match(shell, /ACTION_PATHS\.RETURNS/);
  assert.doesNotMatch(shell, /label: 'Reconciliation'.*OPERATIONAL_NAVIGATION/s);
  assert.match(shell, /path: '\/reconciliation'/);
});

test('repository contract is bounded, versioned and read-only in 007A', () => {
  assert.match(repository, /type OperationalRecordsWorkspace = 'inventory' \| 'customers' \| 'accounts' \| 'returns'/);
  assert.match(repository, /pageSize: 10 \| 20 \| 25 \| 50 \| 100/);
  assert.match(repository, /ecoflow_read_operational_records_v1/);
  assert.match(repository, /ecoflow_read_operational_record_detail_v1/);
  assert.doesNotMatch(repository, /ecoflow_record_accounts_statement_action/);
  assert.doesNotMatch(repository, /ecoflow_record_return_inspection_item/);
  assert.doesNotMatch(repository, /ecoflow_complete_return_inspection/);
});

test('native surfaces expose the blueprint views and consequence evidence', () => {
  for (const label of [
    'Overview',
    'By SKU',
    'By location',
    'Below target',
    'Negative / inconsistent',
    'Movement ledger',
    'Cycle count',
  ]) assert.match(workspace, new RegExp(label.replace('/', '\\/')));

  for (const label of [
    'Orders',
    'Delivery',
    'Pricing',
    'Accounts',
    'Contacts',
    'Timeline',
  ]) assert.match(workspace, new RegExp(label));

  assert.match(workspace, /Inventory consequence/);
  assert.match(workspace, /Release authority/);
  assert.match(workspace, /ReturnCommandPanel/);
  assert.match(workspace, /007C Returns disposition\/close uses server-owned revision, idempotency, inventory consequence and audit authority/);
  assert.doesNotMatch(workspace, /Commands remain withheld until the (?:007C )?CAS gate passes/);
});
