export type WorkspaceQueryState = {
  businessDate?: string;
  dateFrom?: string;
  dateTo?: string;
  compare?: string;
  search?: string;
  filters: string[];
  sort?: string;
  cursor?: string;
  page?: number;
  pageSize?: number;
  selected?: string;
  primaryDrawer?: string;
  secondaryInspector?: string;
  savedView?: string;
};

export type WorkspaceQueryIssueCode =
  | 'INVALID_BUSINESS_DATE'
  | 'INVALID_DATE_FROM'
  | 'INVALID_DATE_TO'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_PAGE_SIZE'
  | 'VALUE_TOO_LONG'
  | 'TOO_MANY_FILTERS';

export type WorkspaceQueryIssue = {
  code: WorkspaceQueryIssueCode;
  key: string;
  value?: string;
};

export type ParsedWorkspaceQuery = {
  state: WorkspaceQueryState;
  issues: WorkspaceQueryIssue[];
};

const MAX_VALUE_LENGTH = 180;
const MAX_FILTERS = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

function cleanValue(value: string | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function boundedValue(
  params: URLSearchParams,
  key: string,
  issues: WorkspaceQueryIssue[],
): string | undefined {
  const value = cleanValue(params.get(key));
  if (!value) return undefined;
  if (value.length > MAX_VALUE_LENGTH) {
    issues.push({ code: 'VALUE_TOO_LONG', key, value: value.slice(0, MAX_VALUE_LENGTH) });
    return undefined;
  }
  return value;
}

function dateValue(
  params: URLSearchParams,
  key: string,
  invalidCode: WorkspaceQueryIssueCode,
  issues: WorkspaceQueryIssue[],
): string | undefined {
  const value = boundedValue(params, key, issues);
  if (!value) return undefined;
  if (!isValidDate(value)) {
    issues.push({ code: invalidCode, key, value });
    return undefined;
  }
  return value;
}

function boundedPageSize(
  params: URLSearchParams,
  issues: WorkspaceQueryIssue[],
): number | undefined {
  const raw = boundedValue(params, 'limit', issues);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_PAGE_SIZE || parsed > MAX_PAGE_SIZE) {
    issues.push({ code: 'INVALID_PAGE_SIZE', key: 'limit', value: raw });
    return undefined;
  }
  return parsed;
}

function boundedPage(params: URLSearchParams): number | undefined {
  const raw = cleanValue(params.get('page'));
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toParams(input: URLSearchParams | string): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  return new URLSearchParams(input.startsWith('?') ? input.slice(1) : input);
}

export function parseWorkspaceQuery(input: URLSearchParams | string): ParsedWorkspaceQuery {
  const params = toParams(input);
  const issues: WorkspaceQueryIssue[] = [];
  const allFilters = params.getAll('filter').map((value) => value.trim()).filter(Boolean);
  const filters = allFilters
    .filter((value) => {
      if (value.length <= MAX_VALUE_LENGTH) return true;
      issues.push({ code: 'VALUE_TOO_LONG', key: 'filter', value: value.slice(0, MAX_VALUE_LENGTH) });
      return false;
    })
    .slice(0, MAX_FILTERS);

  if (allFilters.length > MAX_FILTERS) {
    issues.push({ code: 'TOO_MANY_FILTERS', key: 'filter', value: String(allFilters.length) });
  }

  const dateFrom = dateValue(params, 'from', 'INVALID_DATE_FROM', issues);
  const dateTo = dateValue(params, 'to', 'INVALID_DATE_TO', issues);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    issues.push({ code: 'INVALID_DATE_RANGE', key: 'from,to', value: `${dateFrom},${dateTo}` });
  }

  const search = boundedValue(params, 'q', issues);
  const page = boundedPage(params);
  const pageSize = boundedPageSize(params, issues);

  return {
    state: {
      businessDate: dateValue(params, 'date', 'INVALID_BUSINESS_DATE', issues),
      dateFrom,
      dateTo,
      compare: boundedValue(params, 'compare', issues),
      ...(search ? { search } : {}),
      filters,
      sort: boundedValue(params, 'sort', issues),
      cursor: boundedValue(params, 'cursor', issues),
      ...(page ? { page } : {}),
      ...(pageSize ? { pageSize } : {}),
      selected: boundedValue(params, 'selected', issues),
      primaryDrawer: boundedValue(params, 'drawer', issues),
      secondaryInspector: boundedValue(params, 'inspector', issues),
      savedView: boundedValue(params, 'view', issues),
    },
    issues,
  };
}

function appendIfPresent(params: URLSearchParams, key: string, value?: string) {
  const cleaned = cleanValue(value ?? null);
  if (cleaned) params.set(key, cleaned);
}

export function serialiseWorkspaceQuery(state: WorkspaceQueryState): string {
  const params = new URLSearchParams();
  appendIfPresent(params, 'date', state.businessDate);
  appendIfPresent(params, 'from', state.dateFrom);
  appendIfPresent(params, 'to', state.dateTo);
  appendIfPresent(params, 'compare', state.compare);
  appendIfPresent(params, 'q', state.search);
  state.filters.slice(0, MAX_FILTERS).forEach((filter) => {
    const cleaned = cleanValue(filter);
    if (cleaned && cleaned.length <= MAX_VALUE_LENGTH) params.append('filter', cleaned);
  });
  appendIfPresent(params, 'sort', state.sort);
  appendIfPresent(params, 'cursor', state.cursor);
  if (Number.isSafeInteger(state.page) && Number(state.page) > 1) {
    params.set('page', String(state.page));
  }
  if (Number.isInteger(state.pageSize)
    && Number(state.pageSize) >= MIN_PAGE_SIZE
    && Number(state.pageSize) <= MAX_PAGE_SIZE) {
    params.set('limit', String(state.pageSize));
  }
  appendIfPresent(params, 'selected', state.selected);
  appendIfPresent(params, 'drawer', state.primaryDrawer);
  appendIfPresent(params, 'inspector', state.secondaryInspector);
  appendIfPresent(params, 'view', state.savedView);
  return params.toString();
}

export function withWorkspaceQuery(
  pathname: string,
  state: WorkspaceQueryState,
): string {
  const query = serialiseWorkspaceQuery(state);
  return query ? `${pathname}?${query}` : pathname;
}
