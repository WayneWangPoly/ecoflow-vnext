import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWorkspaceQuery,
  serialiseWorkspaceQuery,
} from '../src/features/intelligence/navigation/queryState.ts';
import {
  applyListQuery,
  clearListQuery,
  withListFilter,
  withListPage,
  withListPageSize,
  withListSearch,
  withListSort,
} from '../src/features/intelligence/query/listQueryContract.ts';

const rows = [
  { id: 'A', store: 'Alpha Adelaide', suburb: 'Adelaide', status: 'READY', payment: 'PAID', amount: 50 },
  { id: 'B', store: 'Bravo Adelaide', suburb: 'Adelaide', status: 'READY', payment: 'UNPAID', amount: 30 },
  { id: 'C', store: 'Charlie Adelaide', suburb: 'Adelaide', status: 'READY', payment: 'PAID', amount: 40 },
  { id: 'D', store: 'Delta Adelaide', suburb: 'Adelaide', status: 'BLOCKED', payment: 'UNPAID', amount: 100 },
  { id: 'E', store: 'Echo Sydney', suburb: 'Sydney', status: 'READY', payment: 'PAID', amount: 90 },
];

const schema = {
  searchText: (row) => [row.id, row.store, row.suburb],
  filters: {
    status: { read: (row) => row.status },
    payment: { read: (row) => row.payment },
  },
  sorts: {
    amount: (left, right) => left.amount - right.amount,
    store: (left, right) => left.store.localeCompare(right.store, 'en-AU'),
  },
  defaultSort: { key: 'store', direction: 'asc' },
  pageSizes: [2, 4],
  defaultPageSize: 2,
};

test('workspace query preserves search, page size and existing overlay context', () => {
  const parsed = parseWorkspaceQuery('?date=2026-07-30&q=Alpha&filter=status%3AREADY&sort=amount%3Adesc&cursor=page%3A2&limit=25&selected=order-1&drawer=order%3Aorder-1&inspector=store%3Astore-1&view=morning');
  assert.equal(parsed.state.businessDate, '2026-07-30');
  assert.equal(parsed.state.search, 'Alpha');
  assert.equal(parsed.state.pageSize, 25);
  assert.equal(parsed.state.primaryDrawer, 'order:order-1');
  assert.equal(parsed.state.secondaryInspector, 'store:store-1');
  assert.equal(serialiseWorkspaceQuery(parsed.state), 'date=2026-07-30&q=Alpha&filter=status%3AREADY&sort=amount%3Adesc&cursor=page%3A2&limit=25&selected=order-1&drawer=order%3Aorder-1&inspector=store%3Astore-1&view=morning');
});

test('list query applies search, filters, stable sorting and bounded pagination', () => {
  const result = applyListQuery(rows, schema, {
    search: 'Adelaide',
    filters: ['status:READY'],
    sort: 'amount:desc',
    cursor: 'page:2',
    pageSize: 2,
  });

  assert.deepEqual(result.rows.map((row) => row.id), ['B']);
  assert.equal(result.total, 3);
  assert.equal(result.totalPages, 2);
  assert.equal(result.from, 3);
  assert.equal(result.to, 3);
  assert.deepEqual(result.query, {
    search: 'Adelaide',
    filters: { status: ['READY'] },
    sortKey: 'amount',
    direction: 'desc',
    page: 2,
    pageSize: 2,
  });
});

test('same-field values are OR while different filter fields are AND', () => {
  const result = applyListQuery(rows, schema, {
    filters: ['status:READY', 'status:BLOCKED', 'payment:UNPAID'],
    sort: 'store:asc',
  });
  assert.deepEqual(result.rows.map((row) => row.id), ['B', 'D']);
});

test('invalid query tokens fall back deterministically and report issues', () => {
  const result = applyListQuery(rows, schema, {
    filters: ['unknown:value', 'broken'],
    sort: 'unknown:sideways',
    cursor: 'offset:999',
    pageSize: 3,
  });

  assert.deepEqual(result.rows.map((row) => row.id), ['A', 'B']);
  assert.equal(result.query.sortKey, 'store');
  assert.equal(result.query.direction, 'asc');
  assert.equal(result.query.page, 1);
  assert.equal(result.query.pageSize, 2);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    'UNKNOWN_FILTER',
    'INVALID_FILTER',
    'UNKNOWN_SORT',
    'INVALID_CURSOR',
    'UNSUPPORTED_PAGE_SIZE',
  ]));
});

test('page overflow clamps to the final page without losing the requested state issue', () => {
  const result = applyListQuery(rows, schema, {
    filters: [],
    cursor: 'page:99',
    pageSize: 2,
  });
  assert.equal(result.query.page, 3);
  assert.deepEqual(result.rows.map((row) => row.id), ['E']);
  assert.equal(result.issues.some((issue) => issue.code === 'PAGE_OUT_OF_RANGE'), true);
});

test('list query mutations preserve workspace context and reset stale cursors', () => {
  const base = {
    businessDate: '2026-07-30',
    compare: 'previous-period',
    filters: ['status:READY'],
    cursor: 'page:3',
    selected: 'order-1',
    primaryDrawer: 'order:order-1',
    secondaryInspector: 'store:store-1',
    savedView: 'morning',
  };

  const searched = withListSearch(base, ' Alpha ');
  assert.equal(searched.search, 'Alpha');
  assert.equal(searched.cursor, undefined);
  assert.equal(searched.primaryDrawer, 'order:order-1');

  const filtered = withListFilter(searched, 'status', 'BLOCKED');
  assert.deepEqual(filtered.filters, ['status:BLOCKED']);
  const sorted = withListSort(filtered, 'amount', 'desc');
  assert.equal(sorted.sort, 'amount:desc');
  const sized = withListPageSize(sorted, 50);
  assert.equal(sized.pageSize, 50);
  const paged = withListPage(sized, 4);
  assert.equal(paged.cursor, 'page:4');

  const cleared = clearListQuery(paged);
  assert.equal(cleared.search, undefined);
  assert.deepEqual(cleared.filters, []);
  assert.equal(cleared.sort, undefined);
  assert.equal(cleared.cursor, undefined);
  assert.equal(cleared.pageSize, undefined);
  assert.equal(cleared.selected, 'order-1');
  assert.equal(cleared.secondaryInspector, 'store:store-1');
});

test('workspace query rejects non-integer or excessive page sizes', () => {
  const decimal = parseWorkspaceQuery('?limit=12.5');
  assert.equal(decimal.state.pageSize, undefined);
  assert.equal(decimal.issues.some((issue) => issue.code === 'INVALID_PAGE_SIZE'), true);

  const excessive = parseWorkspaceQuery('?limit=500');
  assert.equal(excessive.state.pageSize, undefined);
  assert.equal(excessive.issues.some((issue) => issue.code === 'INVALID_PAGE_SIZE'), true);
});
