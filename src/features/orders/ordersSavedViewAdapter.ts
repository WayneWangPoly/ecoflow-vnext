import * as savedViewModule from '@/data/repositories/savedViewRepository';

export type OrdersSavedView = {
  id: string;
  name: string;
  view: string;
  sort: string;
  search: string;
};

type UnknownFunction = (...args: unknown[]) => Promise<unknown>;
type SavedViewModuleShape = {
  readSavedViews?: UnknownFunction;
  createSavedView?: UnknownFunction;
  savedViewRepository?: {
    readSavedViews?: UnknownFunction;
    applyCommand?: UnknownFunction;
  };
};

function row(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function dataRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = row(value);
  if (root.ok === false) {
    const error = row(root.error);
    throw new Error(text(error.message) || 'Saved Views request failed.');
  }
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.rows)) return root.rows;
  return [];
}

function stateFrom(value: unknown) {
  const root = row(value);
  return row(root.state ?? root.view_state ?? root.viewState);
}

function normalise(value: unknown): OrdersSavedView | null {
  const root = row(value);
  const state = stateFrom(root);
  const id = text(root.savedViewId ?? root.saved_view_id ?? root.id);
  const name = text(root.name ?? root.view_name ?? root.label);
  if (!id || !name) return null;
  const filters = Array.isArray(state.filters) ? state.filters.map(text).filter(Boolean) : [];
  return {
    id,
    name,
    view: filters[0] || text(state.view ?? state.tab) || 'current',
    sort: text(state.sort) || 'operations',
    search: text(state.searchTerm ?? state.search_term ?? state.search),
  };
}

function api() {
  return savedViewModule as unknown as SavedViewModuleShape;
}

export async function readOrdersSavedViews(): Promise<OrdersSavedView[]> {
  const moduleApi = api();
  const reader = moduleApi.readSavedViews ?? moduleApi.savedViewRepository?.readSavedViews;
  if (!reader) throw new Error('Saved Views reader is unavailable.');
  const result = await reader('orders');
  return dataRows(result).flatMap((item) => {
    const next = normalise(item);
    return next ? [next] : [];
  });
}

export async function createOrdersSavedView(input: {
  name: string;
  view: string;
  sort: string;
  search: string;
}): Promise<void> {
  const moduleApi = api();
  const state = {
    filters: [input.view],
    sort: input.sort,
    visibleColumns: ['store','due','value','release','execution','exceptions','updated'],
    dateRange: null,
    comparisonSettings: [],
    searchTerm: input.search || null,
  };

  if (moduleApi.createSavedView) {
    const result = await moduleApi.createSavedView({ workspace: 'orders', name: input.name, state });
    const root = row(result);
    if (root.ok === false) throw new Error(text(row(root.error).message) || 'Saved View create failed.');
    return;
  }

  if (moduleApi.savedViewRepository?.applyCommand) {
    const result = await moduleApi.savedViewRepository.applyCommand({ action: 'CREATE', workspace: 'orders', name: input.name, state });
    const root = row(result);
    if (root.ok === false) throw new Error(text(row(root.error).message) || 'Saved View create failed.');
    return;
  }

  throw new Error('Saved Views create command is unavailable.');
}
