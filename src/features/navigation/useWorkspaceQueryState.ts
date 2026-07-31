import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type WorkspaceQueryState = {
  tab: string;
  search: string;
  filter: string;
  sort: string;
  page: number;
  pageSize: number;
};

export type WorkspaceQueryDefaults = WorkspaceQueryState & {
  allowedTabs?: readonly string[];
  allowedFilters?: readonly string[];
  allowedSorts?: readonly string[];
  allowedPageSizes?: readonly number[];
};

type WorkspaceQueryPatch = Partial<WorkspaceQueryState>;

type UpdateOptions = {
  replace?: boolean;
  preservePage?: boolean;
};

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function allowedString(value: string | null, fallback: string, allowed?: readonly string[]) {
  const clean = String(value || '').trim();
  if (!clean) return fallback;
  if (allowed?.length && !allowed.includes(clean)) return fallback;
  return clean;
}

function writeParam(params: URLSearchParams, key: string, value: string | number, defaultValue: string | number) {
  if (String(value) === String(defaultValue) || value === '') params.delete(key);
  else params.set(key, String(value));
}

export function useWorkspaceQueryState(defaults: WorkspaceQueryDefaults) {
  const [params, setParams] = useSearchParams();

  const state = useMemo<WorkspaceQueryState>(() => {
    const allowedPageSizes = defaults.allowedPageSizes?.length
      ? defaults.allowedPageSizes
      : [defaults.pageSize];
    const requestedPageSize = positiveInteger(params.get('size'), defaults.pageSize);
    const pageSize = allowedPageSizes.includes(requestedPageSize)
      ? requestedPageSize
      : defaults.pageSize;

    return {
      tab: allowedString(params.get('tab'), defaults.tab, defaults.allowedTabs),
      search: String(params.get('q') || '').trim(),
      filter: allowedString(params.get('filter'), defaults.filter, defaults.allowedFilters),
      sort: allowedString(params.get('sort'), defaults.sort, defaults.allowedSorts),
      page: positiveInteger(params.get('page'), defaults.page),
      pageSize,
    };
  }, [
    defaults.allowedFilters,
    defaults.allowedPageSizes,
    defaults.allowedSorts,
    defaults.allowedTabs,
    defaults.filter,
    defaults.page,
    defaults.pageSize,
    defaults.sort,
    defaults.tab,
    params,
  ]);

  const update = useCallback((patch: WorkspaceQueryPatch, options: UpdateOptions = {}) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      const changesView = patch.tab !== undefined
        || patch.search !== undefined
        || patch.filter !== undefined
        || patch.sort !== undefined
        || patch.pageSize !== undefined;
      const nextPage = patch.page ?? (changesView && !options.preservePage ? 1 : state.page);

      writeParam(next, 'tab', patch.tab ?? state.tab, defaults.tab);
      writeParam(next, 'q', patch.search ?? state.search, defaults.search);
      writeParam(next, 'filter', patch.filter ?? state.filter, defaults.filter);
      writeParam(next, 'sort', patch.sort ?? state.sort, defaults.sort);
      writeParam(next, 'page', nextPage, defaults.page);
      writeParam(next, 'size', patch.pageSize ?? state.pageSize, defaults.pageSize);
      return next;
    }, { replace: options.replace ?? false });
  }, [defaults.filter, defaults.page, defaults.pageSize, defaults.search, defaults.sort, defaults.tab, setParams, state]);

  const clear = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      ['tab', 'q', 'filter', 'sort', 'page', 'size'].forEach((key) => next.delete(key));
      return next;
    });
  }, [setParams]);

  return { state, update, clear };
}

export function paginateRows<T>(rows: readonly T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalRows: rows.length,
    totalPages,
  };
}
