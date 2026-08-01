import { useMemo } from 'react';
import type { CatalogRow, StockRow } from '@/domain/types';
import { NativePager, NativeWorkspaceEmpty, NativeWorkspaceFrame, NativeWorkspaceLoading, NativeWorkspaceUnavailable } from '@/features/navigation/NativeWorkspaceFrame';
import { paginateRows, useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';

const TABS = ['stock', 'catalog'] as const;
const FILTERS = ['all', 'ok', 'low', 'insufficient', 'unlocated', 'hidden'] as const;
const SORTS = ['sku', 'location', 'on-hand', 'reserved', 'signal', 'price'] as const;
const PAGE_SIZES = [15, 30, 60] as const;

function stockSignal(row: StockRow) {
  if (!row.location) return 'UNLOCATED';
  if (row.onHand < row.reserved) return 'INSUFFICIENT';
  if (row.onHand <= row.reorderPoint) return 'LOW';
  return 'OK';
}

function signalTone(signal: string) {
  if (signal === 'OK') return 'good';
  if (signal === 'LOW' || signal === 'UNLOCATED') return 'warn';
  return 'danger';
}

function sourceLabel(source: CatalogRow['source']) {
  if (source === 'order-detail') return 'Order detail';
  if (source === 'variant') return 'Variant';
  return 'Product';
}

function matchesStockFilter(row: StockRow, filter: string) {
  const signal = stockSignal(row);
  if (filter === 'all') return true;
  if (filter === 'ok') return signal === 'OK';
  if (filter === 'low') return signal === 'LOW';
  if (filter === 'insufficient') return signal === 'INSUFFICIENT';
  if (filter === 'unlocated') return signal === 'UNLOCATED';
  return true;
}

function sortStock(rows: StockRow[], sort: string) {
  return [...rows].sort((left, right) => {
    if (sort === 'location') return left.location.localeCompare(right.location) || left.sku.localeCompare(right.sku);
    if (sort === 'on-hand') return right.onHand - left.onHand || left.sku.localeCompare(right.sku);
    if (sort === 'reserved') return right.reserved - left.reserved || left.sku.localeCompare(right.sku);
    if (sort === 'signal') return stockSignal(left).localeCompare(stockSignal(right)) || left.sku.localeCompare(right.sku);
    return left.sku.localeCompare(right.sku);
  });
}

function sortCatalog(rows: CatalogRow[], sort: string) {
  return [...rows].sort((left, right) => {
    if (sort === 'price') return right.basePrice - left.basePrice || left.sku.localeCompare(right.sku);
    if (sort === 'signal') return Number(right.visible) - Number(left.visible) || left.sku.localeCompare(right.sku);
    return left.sku.localeCompare(right.sku);
  });
}

export function InventoryWorkspacePage({ stock, catalog, loading, available, loadError, healthNotice, onReload }: {
  stock: StockRow[];
  catalog: CatalogRow[];
  loading: boolean;
  available: boolean;
  loadError?: string;
  healthNotice?: string;
  onReload: () => Promise<void>;
}) {
  const { state, update, clear } = useWorkspaceQueryState({
    tab: 'stock', search: '', filter: 'all', sort: 'sku', page: 1, pageSize: 30,
    allowedTabs: TABS, allowedFilters: FILTERS, allowedSorts: SORTS, allowedPageSizes: PAGE_SIZES,
  });

  const filteredStock = useMemo(() => {
    const needle = state.search.toLowerCase();
    return sortStock(stock.filter((row) => {
      if (!matchesStockFilter(row, state.filter)) return false;
      if (!needle) return true;
      return [row.sku, row.name, row.location, row.source].some((value) => String(value || '').toLowerCase().includes(needle));
    }), state.sort);
  }, [state.filter, state.search, state.sort, stock]);

  const filteredCatalog = useMemo(() => {
    const needle = state.search.toLowerCase();
    return sortCatalog(catalog.filter((row) => {
      if (state.filter === 'hidden' && row.visible) return false;
      if (!needle) return true;
      return [row.sku, row.name, row.category, row.unit, row.source].some((value) => String(value || '').toLowerCase().includes(needle));
    }), state.sort);
  }, [catalog, state.filter, state.search, state.sort]);

  const stockPage = paginateRows(filteredStock, state.page, state.pageSize);
  const catalogPage = paginateRows(filteredCatalog, state.page, state.pageSize);
  const activeCount = state.tab === 'stock' ? filteredStock.length : filteredCatalog.length;
  const notice = loadError
    ? `Live inventory refresh failed. The last trusted snapshot remains visible. ${loadError}`
    : healthNotice ? `Inventory workspace is degraded: ${healthNotice}` : '';

  return (
    <NativeWorkspaceFrame
      eyebrow="NATIVE ROUTE · INVENTORY"
      title="Inventory control"
      detail="Commercial catalog records and physical stock signals are rendered by an explicit route component. Search, filter, sort, tab and page are encoded in the URL."
      notice={notice}
      noticeTone={loadError ? 'danger' : 'warning'}
      actions={<><a className="soft-button" href="/warehouse-map">Warehouse map</a><button type="button" className="soft-button" onClick={clear}>Reset view</button><button type="button" className="primary-small" disabled={loading} onClick={() => void onReload()}>{loading ? 'Refreshing…' : 'Refresh live data'}</button></>}
    >
      <nav className="native-workspace-tabs" aria-label="Inventory workspace sections">
        <button type="button" className={state.tab === 'stock' ? 'active' : ''} onClick={() => update({ tab: 'stock', filter: 'all', sort: 'sku' })}>Physical stock</button>
        <button type="button" className={state.tab === 'catalog' ? 'active' : ''} onClick={() => update({ tab: 'catalog', filter: 'all', sort: 'sku' })}>Commercial catalog</button>
      </nav>

      <section className="panel native-workspace-toolbar">
        <label><span>Search</span><input value={state.search} placeholder="SKU, product, location, category or source" onChange={(event) => update({ search: event.target.value }, { replace: true })} /></label>
        <label><span>Filter</span>{state.tab === 'stock' ? (
          <select value={state.filter} onChange={(event) => update({ filter: event.target.value })}><option value="all">All stock</option><option value="ok">Healthy</option><option value="low">Low</option><option value="insufficient">Insufficient</option><option value="unlocated">No verified location</option></select>
        ) : (
          <select value={state.filter === 'hidden' ? 'hidden' : 'all'} onChange={(event) => update({ filter: event.target.value })}><option value="all">All catalog</option><option value="hidden">Hidden products</option></select>
        )}</label>
        <label><span>Sort</span><select value={state.sort} onChange={(event) => update({ sort: event.target.value })}><option value="sku">SKU</option>{state.tab === 'stock' ? <option value="location">Location</option> : null}{state.tab === 'stock' ? <option value="on-hand">On hand</option> : null}{state.tab === 'stock' ? <option value="reserved">Reserved</option> : null}<option value="signal">Status</option>{state.tab === 'catalog' ? <option value="price">Base price</option> : null}</select></label>
        <label><span>Page size</span><select value={state.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      </section>

      {loading && !available ? <NativeWorkspaceLoading label="inventory" /> : null}
      {!loading && !available ? <NativeWorkspaceUnavailable label="Inventory" detail={loadError || 'No trusted live inventory snapshot is available. EcoFlow will not translate missing data into zero stock.'} onRetry={() => void onReload()} /> : null}
      {available && activeCount === 0 ? <NativeWorkspaceEmpty title="No inventory records match this view" detail="Change the query or filters. Missing records are not represented as zero stock." /> : null}

      {available && filteredStock.length > 0 && state.tab === 'stock' ? (
        <section className="panel">
          <div className="panel-head"><h2>Physical stock signals</h2><span>{filteredStock.length} matching · {stock.length} live</span></div>
          <div className="table-like native-workspace-table">
            <div className="table-head"><span>SKU</span><span>Location</span><span>On hand</span><span>Reserved</span><span>Reorder</span><span>Signal</span></div>
            {stockPage.rows.map((row) => {
              const signal = stockSignal(row);
              return <div className="table-row" key={`${row.sku}-${row.location}`}><span><strong><a href={`/inventory/physical/${encodeURIComponent(row.sku)}?tab=stock`}>{row.sku}</a></strong><small>{row.name}</small></span><span><strong>{row.location || 'UNVERIFIED'}</strong><small>{row.location ? <a href={`/warehouse-map?location=${encodeURIComponent(row.location)}`}>Open map</a> : 'Assign through a warehouse transaction'}</small></span><span><strong>{row.onHand}</strong><small>{row.source || 'live stock view'}</small></span><span>{row.reserved}</span><span>{row.reorderPoint}</span><span><span className={`pill pill-${signalTone(signal)}`}>{signal}</span></span></div>;
            })}
          </div>
          <NativePager page={stockPage.page} totalPages={stockPage.totalPages} totalRows={stockPage.totalRows} onPage={(next) => update({ page: next }, { preservePage: true })} />
        </section>
      ) : null}

      {available && filteredCatalog.length > 0 && state.tab === 'catalog' ? (
        <section className="panel">
          <div className="panel-head"><h2>Commercial catalog</h2><span>{filteredCatalog.length} matching · {catalog.length} retained</span></div>
          <div className="table-like native-workspace-table">
            <div className="table-head"><span>SKU</span><span>Product</span><span>Source</span><span>Unit</span><span>Base price</span><span>Visibility</span></div>
            {catalogPage.rows.map((row) => <div className="table-row" key={`${row.source}-${row.id}`}><span><strong><a href={`/inventory/commercial/${encodeURIComponent(row.id)}?tab=catalog`}>{row.sku}</a></strong><small>{row.category || 'Uncategorised'}</small></span><span><strong>{row.name}</strong><small>{Object.keys(row.tierPrices || {}).length} tier prices</small></span><span><span className="pill pill-blue">{sourceLabel(row.source)}</span></span><span>{row.unit || 'Not set'}</span><span>{row.displayPrice || row.basePrice.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</span><span><span className={`pill pill-${row.visible ? 'good' : 'warn'}`}>{row.visible ? 'VISIBLE' : 'HIDDEN'}</span></span></div>)}
          </div>
          <NativePager page={catalogPage.page} totalPages={catalogPage.totalPages} totalRows={catalogPage.totalRows} onPage={(next) => update({ page: next }, { preservePage: true })} />
        </section>
      ) : null}
    </NativeWorkspaceFrame>
  );
}
