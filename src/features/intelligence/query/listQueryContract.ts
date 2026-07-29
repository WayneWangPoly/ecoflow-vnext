import type { WorkspaceQueryState } from '../navigation/queryState';

export type ListQueryDirection = 'asc' | 'desc';

export type ListQueryIssueCode =
  | 'INVALID_FILTER'
  | 'UNKNOWN_FILTER'
  | 'UNKNOWN_SORT'
  | 'INVALID_SORT_DIRECTION'
  | 'INVALID_CURSOR'
  | 'UNSUPPORTED_PAGE_SIZE'
  | 'PAGE_OUT_OF_RANGE';

export type ListQueryIssue = {
  code: ListQueryIssueCode;
  value?: string;
};

export type ListFilterDefinition<Row> = {
  read: (row: Row) => unknown;
  match?: (candidate: unknown, expected: string, row: Row) => boolean;
};

export type ListQuerySchema<Row, FilterKey extends string, SortKey extends string> = {
  searchText: (row: Row) => readonly unknown[];
  filters: Record<FilterKey, ListFilterDefinition<Row>>;
  sorts: Record<SortKey, (left: Row, right: Row) => number>;
  defaultSort: {
    key: SortKey;
    direction: ListQueryDirection;
  };
  pageSizes: readonly number[];
  defaultPageSize: number;
};

export type ResolvedListQuery<FilterKey extends string, SortKey extends string> = {
  search: string;
  filters: Partial<Record<FilterKey, readonly string[]>>;
  sortKey: SortKey;
  direction: ListQueryDirection;
  page: number;
  pageSize: number;
};

export type ListQueryResult<Row, FilterKey extends string, SortKey extends string> = {
  rows: readonly Row[];
  total: number;
  totalPages: number;
  from: number;
  to: number;
  query: ResolvedListQuery<FilterKey, SortKey>;
  issues: readonly ListQueryIssue[];
};

const PAGE_CURSOR = /^page:(\d+)$/;

function clean(value: string): string {
  return value.trim();
}

function normaliseText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(normaliseText).filter(Boolean).join(' ');
  return String(value).trim().toLocaleLowerCase('en-AU');
}

function owns<Key extends string>(record: Record<Key, unknown>, key: string): key is Key {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function defaultFilterMatch(candidate: unknown, expected: string): boolean {
  if (Array.isArray(candidate)) return candidate.some((value) => defaultFilterMatch(value, expected));
  return normaliseText(candidate) === normaliseText(expected);
}

export function encodeListFilter(key: string, value: string): string {
  return `${clean(key)}:${clean(value)}`;
}

export function decodeListFilter(token: string): { key: string; value: string } | null {
  const separator = token.indexOf(':');
  if (separator <= 0 || separator === token.length - 1) return null;
  const key = clean(token.slice(0, separator));
  const value = clean(token.slice(separator + 1));
  return key && value ? { key, value } : null;
}

export function encodeListSort(key: string, direction: ListQueryDirection): string {
  return `${clean(key)}:${direction}`;
}

export function decodeListSort(token: string): { key: string; direction?: string } | null {
  const cleaned = clean(token);
  if (!cleaned) return null;
  const separator = cleaned.lastIndexOf(':');
  if (separator <= 0) return { key: cleaned };
  return {
    key: clean(cleaned.slice(0, separator)),
    direction: clean(cleaned.slice(separator + 1)),
  };
}

export function encodePageCursor(page: number): string | undefined {
  const bounded = Math.max(1, Math.trunc(page));
  return bounded > 1 ? `page:${bounded}` : undefined;
}

export function decodePageCursor(cursor?: string): number | null {
  if (!cursor) return 1;
  const match = PAGE_CURSOR.exec(cursor.trim());
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

export function withListSearch(state: WorkspaceQueryState, search?: string | null): WorkspaceQueryState {
  const cleaned = clean(search ?? '');
  return {
    ...state,
    search: cleaned || undefined,
    cursor: undefined,
  };
}

export function withListFilters(
  state: WorkspaceQueryState,
  key: string,
  values: readonly string[],
): WorkspaceQueryState {
  const prefix = `${clean(key)}:`;
  const retained = state.filters.filter((filter) => !filter.startsWith(prefix));
  const next = values
    .map((value) => clean(value))
    .filter(Boolean)
    .map((value) => encodeListFilter(key, value));
  return {
    ...state,
    filters: [...retained, ...next],
    cursor: undefined,
  };
}

export function withListFilter(
  state: WorkspaceQueryState,
  key: string,
  value?: string | null,
): WorkspaceQueryState {
  return withListFilters(state, key, value ? [value] : []);
}

export function withListSort(
  state: WorkspaceQueryState,
  key: string,
  direction: ListQueryDirection,
): WorkspaceQueryState {
  return {
    ...state,
    sort: encodeListSort(key, direction),
    cursor: undefined,
  };
}

export function withListPage(state: WorkspaceQueryState, page: number): WorkspaceQueryState {
  return {
    ...state,
    cursor: encodePageCursor(page),
  };
}

export function withListPageSize(state: WorkspaceQueryState, pageSize: number): WorkspaceQueryState {
  return {
    ...state,
    pageSize: Math.trunc(pageSize),
    cursor: undefined,
  };
}

export function clearListQuery(state: WorkspaceQueryState): WorkspaceQueryState {
  return {
    ...state,
    search: undefined,
    filters: [],
    sort: undefined,
    cursor: undefined,
    pageSize: undefined,
  };
}

export function applyListQuery<Row, FilterKey extends string, SortKey extends string>(
  sourceRows: readonly Row[],
  schema: ListQuerySchema<Row, FilterKey, SortKey>,
  state: WorkspaceQueryState,
): ListQueryResult<Row, FilterKey, SortKey> {
  const issues: ListQueryIssue[] = [];
  const filters: Partial<Record<FilterKey, string[]>> = {};

  state.filters.forEach((token) => {
    const parsed = decodeListFilter(token);
    if (!parsed) {
      issues.push({ code: 'INVALID_FILTER', value: token });
      return;
    }
    if (!owns(schema.filters, parsed.key)) {
      issues.push({ code: 'UNKNOWN_FILTER', value: token });
      return;
    }
    const values = filters[parsed.key] ?? [];
    filters[parsed.key] = [...values, parsed.value];
  });

  let sortKey = schema.defaultSort.key;
  let direction = schema.defaultSort.direction;
  if (state.sort) {
    const parsedSort = decodeListSort(state.sort);
    if (!parsedSort || !owns(schema.sorts, parsedSort.key)) {
      issues.push({ code: 'UNKNOWN_SORT', value: state.sort });
    } else if (parsedSort.direction && parsedSort.direction !== 'asc' && parsedSort.direction !== 'desc') {
      issues.push({ code: 'INVALID_SORT_DIRECTION', value: state.sort });
    } else {
      sortKey = parsedSort.key;
      direction = parsedSort.direction ?? schema.defaultSort.direction;
    }
  }

  const configuredPageSizes = Array.from(new Set(schema.pageSizes.filter((size) => Number.isInteger(size) && size > 0)));
  const defaultPageSize = configuredPageSizes.includes(schema.defaultPageSize)
    ? schema.defaultPageSize
    : configuredPageSizes[0] ?? 25;
  const pageSize = state.pageSize && configuredPageSizes.includes(state.pageSize)
    ? state.pageSize
    : defaultPageSize;
  if (state.pageSize !== undefined && !configuredPageSizes.includes(state.pageSize)) {
    issues.push({ code: 'UNSUPPORTED_PAGE_SIZE', value: String(state.pageSize) });
  }

  const requestedPage = decodePageCursor(state.cursor);
  if (requestedPage === null) issues.push({ code: 'INVALID_CURSOR', value: state.cursor });

  const search = clean(state.search ?? '');
  const searchNeedle = normaliseText(search);
  const filtered = sourceRows.filter((row) => {
    if (searchNeedle) {
      const haystack = normaliseText(schema.searchText(row));
      if (!haystack.includes(searchNeedle)) return false;
    }

    return (Object.entries(filters) as Array<[FilterKey, string[]]>).every(([key, values]) => {
      const definition = schema.filters[key];
      const candidate = definition.read(row);
      return values.some((expected) => (
        definition.match
          ? definition.match(candidate, expected, row)
          : defaultFilterMatch(candidate, expected)
      ));
    });
  });

  const comparator = schema.sorts[sortKey];
  const sorted = filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = comparator(left.row, right.row);
      const directed = direction === 'desc' ? -compared : compared;
      return directed || left.index - right.index;
    })
    .map(({ row }) => row);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rawPage = requestedPage ?? 1;
  const page = Math.min(rawPage, totalPages);
  if (rawPage > totalPages) issues.push({ code: 'PAGE_OUT_OF_RANGE', value: String(rawPage) });
  const start = (page - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize);

  return {
    rows,
    total,
    totalPages,
    from: total ? start + 1 : 0,
    to: total ? start + rows.length : 0,
    query: {
      search,
      filters,
      sortKey,
      direction,
      page,
      pageSize,
    },
    issues,
  };
}
