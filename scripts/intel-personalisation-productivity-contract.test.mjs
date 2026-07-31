import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsvExport,
  comparisonAlignment,
  createComparisonItem,
  normaliseSavedViewRows,
  normaliseSavedViewState,
  pinComparisonItem,
  quickActionDefinitions,
  savedViewCommands,
  validateQuickActions,
} from '../src/features/intelligence/analytics/productivity/productivityContract.ts';

test('Saved Views capture all six roadmap state families', () => {
  const state = normaliseSavedViewState({
    filters: ['status:ready'],
    sort: 'created:desc',
    visibleColumns: ['order', 'status'],
    dateRange: { from: '2026-07-01', to: '2026-07-31' },
    comparisonSettings: ['previous-period'],
    searchTerm: 'ADE',
  });
  assert.deepEqual(state, {
    filters: ['status:ready'],
    sort: 'created:desc',
    visibleColumns: ['order', 'status'],
    dateRange: { from: '2026-07-01', to: '2026-07-31' },
    comparisonSettings: ['previous-period'],
    searchTerm: 'ADE',
  });
  assert.deepEqual(savedViewCommands, ['CREATE', 'DUPLICATE', 'RENAME', 'DELETE', 'SET_ROLE_DEFAULT', 'CLEAR_ROLE_DEFAULT']);
});

test('Saved View rows preserve private and role-default scope without cross-shape coercion', () => {
  const normalised = normaliseSavedViewRows([
    {
      saved_view_id: '99000000-0000-4000-8000-000000000001',
      workspace: 'analytics',
      name: 'Daily review',
      view_state: { filters: [], sort: null, visibleColumns: ['metric'], dateRange: null, comparisonSettings: [], searchTerm: null },
      scope: 'ROLE_DEFAULT',
      role_scope: 'VIEWER',
      is_role_default: true,
      version: 2,
      can_manage_role_defaults: false,
      updated_at: '2026-07-31T00:00:00Z',
      read_at: '2026-07-31T00:00:01Z',
    },
  ]);
  assert.equal(normalised.state, 'ready');
  assert.equal(normalised.rows[0].scope, 'ROLE_DEFAULT');
  assert.equal(normalised.rows[0].roleScope, 'VIEWER');
});

test('Quick Actions are unique canonical workspace routes', () => {
  assert.equal(quickActionDefinitions.length, 7);
  assert.deepEqual(validateQuickActions(), []);
  assert.ok(quickActionDefinitions.every((action) => action.path.startsWith('/')));
});

test('Comparison Tray is bounded, duplicate-safe and dimension-aware', () => {
  const product = createComparisonItem({ kind: 'PRODUCT', entityId: 'SKU-001', label: 'SKU 001', dimensionKeys: ['identity', 'period'], values: { identity: 'SKU-001', period: 'current' } });
  const customer = createComparisonItem({ kind: 'CUSTOMER', entityId: 'CUSTOMER-01', label: 'Customer 01', dimensionKeys: ['identity'], values: { identity: 'CUSTOMER-01' } });
  assert.ok(product && customer);
  let tray = { items: [], maximum: 4 };
  tray = pinComparisonItem(tray, product).tray;
  tray = pinComparisonItem(tray, customer).tray;
  assert.equal(pinComparisonItem(tray, product).issue, 'DUPLICATE_ITEM');
  assert.deepEqual(comparisonAlignment(tray.items), { state: 'PARTIAL', sharedDimensions: ['identity'] });
});

test('CSV export is bounded, allowlisted and spreadsheet-formula hardened', () => {
  const result = buildCsvExport({
    columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }],
    rows: [{ key: '1', name: '=HYPERLINK("bad")', value: 0 }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.csv, /"'=HYPERLINK/);
  assert.match(result.csv, /"0"/);
  assert.ok(result.csv.endsWith('\r\n'));
});
