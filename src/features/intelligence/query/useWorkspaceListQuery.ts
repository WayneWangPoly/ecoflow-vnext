import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  parseWorkspaceQuery,
  serialiseWorkspaceQuery,
  type WorkspaceQueryState,
} from '../navigation/queryState';
import {
  applyListQuery,
  clearListQuery,
  withListFilter,
  withListFilters,
  withListPage,
  withListPageSize,
  withListSearch,
  withListSort,
  type ListQueryDirection,
  type ListQueryResult,
  type ListQuerySchema,
} from './listQueryContract';

export type WorkspaceListQueryApi<Row, FilterKey extends string, SortKey extends string> = {
  result: ListQueryResult<Row, FilterKey, SortKey>;
  workspaceIssues: ReturnType<typeof parseWorkspaceQuery>['issues'];
  setSearch: (value?: string | null) => void;
  setFilter: (key: FilterKey, value?: string | null) => void;
  setFilters: (key: FilterKey, values: readonly string[]) => void;
  setSort: (key: SortKey, direction: ListQueryDirection) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  clear: () => void;
};

type NavigationMode = 'replace' | 'push';

export function useWorkspaceListQuery<Row, FilterKey extends string, SortKey extends string>(
  rows: readonly Row[],
  schema: ListQuerySchema<Row, FilterKey, SortKey>,
  navigationMode: NavigationMode = 'replace',
): WorkspaceListQueryApi<Row, FilterKey, SortKey> {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseWorkspaceQuery(location.search), [location.search]);
  const result = useMemo(
    () => applyListQuery(rows, schema, parsed.state),
    [parsed.state, rows, schema],
  );

  const commit = useCallback((state: WorkspaceQueryState) => {
    const query = serialiseWorkspaceQuery(state);
    const current = location.search.startsWith('?') ? location.search.slice(1) : location.search;
    if (query === current) return;
    navigate(
      { pathname: location.pathname, search: query ? `?${query}` : '' },
      { replace: navigationMode === 'replace' },
    );
  }, [location.pathname, location.search, navigate, navigationMode]);

  const setSearch = useCallback((value?: string | null) => {
    commit(withListSearch(parsed.state, value));
  }, [commit, parsed.state]);

  const setFilter = useCallback((key: FilterKey, value?: string | null) => {
    commit(withListFilter(parsed.state, key, value));
  }, [commit, parsed.state]);

  const setFilters = useCallback((key: FilterKey, values: readonly string[]) => {
    commit(withListFilters(parsed.state, key, values));
  }, [commit, parsed.state]);

  const setSort = useCallback((key: SortKey, direction: ListQueryDirection) => {
    commit(withListSort(parsed.state, key, direction));
  }, [commit, parsed.state]);

  const setPage = useCallback((page: number) => {
    commit(withListPage(parsed.state, page));
  }, [commit, parsed.state]);

  const setPageSize = useCallback((pageSize: number) => {
    commit(withListPageSize(parsed.state, pageSize));
  }, [commit, parsed.state]);

  const clear = useCallback(() => {
    commit(clearListQuery(parsed.state));
  }, [commit, parsed.state]);

  return {
    result,
    workspaceIssues: parsed.issues,
    setSearch,
    setFilter,
    setFilters,
    setSort,
    setPage,
    setPageSize,
    clear,
  };
}
