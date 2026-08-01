import { useMemo } from 'react';
import type { StoreProfile } from '@/domain/types';
import { NativePager, NativeWorkspaceEmpty, NativeWorkspaceFrame, NativeWorkspaceLoading, NativeWorkspaceUnavailable } from '@/features/navigation/NativeWorkspaceFrame';
import { paginateRows, useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';

const TABS = ['directory', 'price-matrix'] as const;
const FILTERS = ['all', 'ok', 'attention', 'credit-hold', 'missing-tier', 'needs-address'] as const;
const SORTS = ['name', 'suburb', 'tier', 'status', 'value'] as const;
const PAGE_SIZES = [12, 24, 48] as const;

function statusTone(status: StoreProfile['status']) {
  return status === 'OK' ? 'good' : status === 'CREDIT_HOLD' ? 'danger' : 'warn';
}

function money(value?: number) {
  return Number(value || 0).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  });
}

function matchesFilter(store: StoreProfile, filter: string) {
  if (filter === 'all') return true;
  if (filter === 'ok') return store.status === 'OK';
  if (filter === 'attention') return store.status !== 'OK';
  if (filter === 'credit-hold') return store.status === 'CREDIT_HOLD';
  if (filter === 'missing-tier') return store.status === 'MISSING_TIER';
  if (filter === 'needs-address') return store.status === 'NEEDS_ADDRESS';
  return true;
}

function sortStores(rows: StoreProfile[], sort: string) {
  return [...rows].sort((left, right) => {
    if (sort === 'suburb') return left.suburb.localeCompare(right.suburb) || left.name.localeCompare(right.name);
    if (sort === 'tier') return left.priceTier.localeCompare(right.priceTier) || left.name.localeCompare(right.name);
    if (sort === 'status') return left.status.localeCompare(right.status) || left.name.localeCompare(right.name);
    if (sort === 'value') return Number(right.totalValue || 0) - Number(left.totalValue || 0) || left.name.localeCompare(right.name);
    return left.name.localeCompare(right.name);
  });
}

export function StoresWorkspacePage({
  stores,
  loading,
  available,
  loadError,
  healthNotice,
  onReload,
}: {
  stores: StoreProfile[];
  loading: boolean;
  available: boolean;
  loadError?: string;
  healthNotice?: string;
  onReload: () => Promise<void>;
}) {
  const { state, update, clear } = useWorkspaceQueryState({
    tab: 'directory',
    search: '',
    filter: 'all',
    sort: 'name',
    page: 1,
    pageSize: 24,
    allowedTabs: TABS,
    allowedFilters: FILTERS,
    allowedSorts: SORTS,
    allowedPageSizes: PAGE_SIZES,
  });

  const filtered = useMemo(() => {
    const needle = state.search.toLowerCase();
    return sortStores(
      stores.filter((store) => {
        if (!matchesFilter(store, state.filter)) return false;
        if (!needle) return true;
        return [store.name, store.account, store.suburb, store.address, store.priceTier, store.statementGroup, store.phone]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      }),
      state.sort,
    );
  }, [state.filter, state.search, state.sort, stores]);

  const page = paginateRows(filtered, state.page, state.pageSize);
  const tiers = useMemo(() => {
    const groups = new Map<string, StoreProfile[]>();
    filtered.forEach((store) => {
      const key = store.priceTier || 'Unmapped';
      groups.set(key, [...(groups.get(key) || []), store]);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filtered]);

  const notice = loadError
    ? `Live store refresh failed. The last trusted store snapshot remains visible. ${loadError}`
    : healthNotice
      ? `Store workspace is degraded: ${healthNotice}`
      : '';

  return (
    <NativeWorkspaceFrame
      eyebrow="NATIVE ROUTE · STORES"
      title="Stores and price matrix"
      detail="Store master, price tier and statement ownership are rendered directly from typed application state. Branding text does not control access or capability."
      notice={notice}
      noticeTone={loadError ? 'danger' : 'warning'}
      actions={(
        <>
          <button type="button" className="soft-button" onClick={clear}>Reset view</button>
          <button type="button" className="primary-small" disabled={loading} onClick={() => void onReload()}>{loading ? 'Refreshing…' : 'Refresh live data'}</button>
        </>
      )}
    >
      <nav className="native-workspace-tabs" aria-label="Stores workspace sections">
        <button type="button" className={state.tab === 'directory' ? 'active' : ''} onClick={() => update({ tab: 'directory' })}>Store directory</button>
        <button type="button" className={state.tab === 'price-matrix' ? 'active' : ''} onClick={() => update({ tab: 'price-matrix' })}>Price matrix</button>
      </nav>

      <section className="panel native-workspace-toolbar">
        <label>
          <span>Search</span>
          <input value={state.search} placeholder="Store, account, suburb, tier or phone" onChange={(event) => update({ search: event.target.value }, { replace: true })} />
        </label>
        <label>
          <span>Filter</span>
          <select value={state.filter} onChange={(event) => update({ filter: event.target.value })}>
            <option value="all">All stores</option>
            <option value="ok">Operationally ready</option>
            <option value="attention">Needs attention</option>
            <option value="credit-hold">Credit hold</option>
            <option value="missing-tier">Missing tier</option>
            <option value="needs-address">Needs address</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={state.sort} onChange={(event) => update({ sort: event.target.value })}>
            <option value="name">Store name</option>
            <option value="suburb">Suburb</option>
            <option value="tier">Price tier</option>
            <option value="status">Status</option>
            <option value="value">Total value</option>
          </select>
        </label>
        <label>
          <span>Page size</span>
          <select value={state.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </section>

      {loading && !available ? <NativeWorkspaceLoading label="stores" /> : null}
      {!loading && !available ? <NativeWorkspaceUnavailable label="Store master" detail={loadError || 'No trusted live store snapshot is available. EcoFlow will not substitute demo stores.'} onRetry={() => void onReload()} /> : null}
      {available && !filtered.length ? <NativeWorkspaceEmpty title="No stores match this view" detail="Change the search or filter. The URL preserves the current view for copied links and browser navigation." /> : null}

      {available && filtered.length && state.tab === 'directory' ? (
        <section className="panel">
          <div className="panel-head"><h2>Store directory</h2><span>{filtered.length} matching · {stores.length} live</span></div>
          <div className="table-like native-workspace-table">
            <div className="table-head"><span>Store</span><span>Account / address</span><span>Price tier</span><span>Terms</span><span>Activity</span><span>Status</span></div>
            {page.rows.map((store) => (
              <div className="table-row" key={store.id}>
                <span><strong><a href={`/stores/${encodeURIComponent(store.id)}?tab=overview`}>{store.name}</a></strong><small>{store.suburb}</small></span>
                <span><strong>{store.account || 'Account pending'}</strong><small>{store.address || 'Address pending'}</small></span>
                <span><strong>{store.priceTier || 'Unmapped'}</strong><small>{store.statementGroup || 'No statement group'}</small></span>
                <span><strong>{store.paymentTerms || 'Not set'}</strong><small>{store.phone || 'Phone missing'}</small></span>
                <span><strong>{Number(store.orderCount || 0).toLocaleString('en-AU')} orders</strong><small>{money(store.totalValue)}</small></span>
                <span><span className={`pill pill-${statusTone(store.status)}`}>{store.status.replace(/_/g, ' ')}</span></span>
              </div>
            ))}
          </div>
          <NativePager page={page.page} totalPages={page.totalPages} totalRows={page.totalRows} onPage={(next) => update({ page: next }, { preservePage: true })} />
        </section>
      ) : null}

      {available && filtered.length && state.tab === 'price-matrix' ? (
        <section className="panel">
          <div className="panel-head"><h2>Price matrix</h2><span>{tiers.length} live price tiers</span></div>
          <div className="native-price-matrix">
            {tiers.map(([tier, tierStores]) => (
              <article className="native-price-tier-card" key={tier}>
                <header><strong>{tier}</strong><span className="pill pill-blue">{tierStores.length} stores</span></header>
                <ul>
                  {tierStores.slice(0, 8).map((store) => <li key={store.id}>{store.name} · {store.suburb}</li>)}
                </ul>
                <footer><span>{tierStores.filter((store) => store.status !== 'OK').length} attention</span><strong>{money(tierStores.reduce((sum, store) => sum + Number(store.totalValue || 0), 0))}</strong></footer>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </NativeWorkspaceFrame>
  );
}
