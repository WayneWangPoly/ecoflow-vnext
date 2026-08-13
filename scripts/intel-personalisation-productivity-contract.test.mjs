import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsvExport,
  comparisonAlignment,
  comparisonKindLimits,
  createComparisonItem,
  normaliseSavedViewRows,
  normaliseSavedViewState,
  pinComparisonItem,
  quickActionDefinitions,
  savedViewCommands,
  validateQuickActions,
} from '../src/features/intelligence/analytics/productivity/productivityContract.ts';

test('Saved Views capture all six roadmap state families', () => {
  const state = normaliseSavedViewState({ filters: ['status:ready'], sort: 'created:desc', visibleColumns: ['order', 'status'], dateRange: { from: '2026-07-01', to: '2026-07-31' }, comparisonSettings: ['previous-period'], searchTerm: 'ADE' });
  assert.deepEqual(state, { filters: ['status:ready'], sort: 'created:desc', visibleColumns: ['order', 'status'], dateRange: { from: '2026-07-01', to: '2026-07-31' }, comparisonSettings: ['previous-period'], searchTerm: 'ADE' });
  assert.deepEqual(savedViewCommands, ['CREATE', 'DUPLICATE', 'RENAME', 'DELETE', 'SET_ROLE_DEFAULT', 'CLEAR_ROLE_DEFAULT']);
});

test('Saved View rows preserve private and role-default scope without cross-shape coercion', () => {
  const normalised = normaliseSavedViewRows([{ saved_view_id: '99000000-0000-4000-8000-000000000001', workspace: 'analytics', name: 'Daily review', view_state: { filters: [], sort: null, visibleColumns: ['metric'], dateRange: null, comparisonSettings: [], searchTerm: null }, scope: 'ROLE_DEFAULT', role_scope: 'VIEWER', is_role_default: true, version: 2, can_manage_role_defaults: false, updated_at: '2026-07-31T00:00:00Z', read_at: '2026-07-31T00:00:01Z' }]);
  assert.equal(normalised.state, 'ready');
  assert.equal(normalised.rows[0].scope, 'ROLE_DEFAULT');
  assert.equal(normalised.rows[0].roleScope, 'VIEWER');
});

test('Quick Actions are unique canonical workspace routes', () => {
  assert.equal(quickActionDefinitions.length, 7);
  assert.deepEqual(validateQuickActions(), []);
});

test('Comparison Tray admits governed candidates only and enforces kind limits', () => {
  const candidate = { kind: 'COMMERCIAL_SKU', entityId: '99000000-0000-4000-8000-000000000010', label: 'CUP-12W', context: {}, permission: 'ALLOWED', readAt: '2026-08-13T09:00:00Z' };
  const product = createComparisonItem(candidate);
  assert.ok(product);
  assert.equal(createComparisonItem({ ...candidate, permission: 'DENIED' }), null);
  assert.deepEqual(comparisonKindLimits, { CUSTOMER: 2, COMMERCIAL_SKU: 2, PHYSICAL_SKU: 6, DELIVERY_RUN: 2 });
  let tray = { items: [], maximum: 8 };
  tray = pinComparisonItem(tray, product).tray;
  assert.equal(pinComparisonItem(tray, product).issue, 'DUPLICATE_ITEM');
  const second = createComparisonItem({ ...candidate, entityId: '99000000-0000-4000-8000-000000000011', label: 'CUP-16W' });
  const third = createComparisonItem({ ...candidate, entityId: '99000000-0000-4000-8000-000000000012', label: 'CUP-20W' });
  assert.ok(second && third);
  tray = pinComparisonItem(tray, second).tray;
  assert.equal(pinComparisonItem(tray, third).issue, 'COMMERCIAL_SKU_LIMIT_REACHED');
  assert.deepEqual(comparisonAlignment(tray.items), { state: 'ALIGNED', sharedDimensions: ['identity'] });
});

test('CSV export remains dormant-contract bounded and spreadsheet-formula hardened', () => {
  const result = buildCsvExport({ columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }], rows: [{ key: '1', name: '=HYPERLINK("bad")', value: 0 }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.csv, /"'=HYPERLINK/);
  assert.ok(result.csv.endsWith('\r\n'));
});
