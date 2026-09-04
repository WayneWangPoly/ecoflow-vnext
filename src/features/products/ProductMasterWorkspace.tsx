import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CatalogRow } from '@/domain/types';
import {
  PRODUCT_MASTER_COLUMN_ORDER,
  PRODUCT_MASTER_FILTER_ORDER,
  createProductMasterReader,
  type ProductMasterListResult,
  type ProductMasterRow,
} from '@/data/repositories/productMaster';
import { matchIntelligenceRoute } from '@/features/intelligence/navigation/routeContract';
import { parseWorkspaceQuery, withWorkspaceQuery } from '@/features/intelligence/navigation/queryState';
import '@/features/officeParity/nativeReadSurfaces.css';

const DETAIL_TABS = ['Details', 'Inventory', 'Purchase', 'Sale', 'Transactions', 'References', 'Production', 'Costs'] as const;

function text(value: string | null | undefined) {
  return value?.trim() || 'Unavailable';
}

function quantity(value: number | null) {
  return value === null ? 'Unavailable' : value.toLocaleString('en-AU');
}

function booleanLabel(value: boolean | null) {
  if (value === null) return 'Unavailable';
  return value ? 'Yes' : 'No';
}

function filterValue(filters: string[], key: string) {
  const prefix = `${key}:`;
  return filters.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function ProductDetail({ row, onBack }: { row: ProductMasterRow; onBack: () => void }) {
  return (
    <section className="office-parity-workspace" aria-label="Product detail">
      <div className="office-parity-heading">
        <div>
          <button className="soft-button" type="button" onClick={onBack}>← Products</button>
          <h1>{row.productCode}</h1>
          <p>{row.description}</p>
        </div>
        <div className="office-parity-state" data-state="DEGRADED">
          <strong>COMMERCIAL READ</strong>
          <span>Product Identity and inventory authority remain separate.</span>
        </div>
      </div>

      <div className="office-parity-tabs" aria-label="Product detail sections">
        {DETAIL_TABS.map((tab, index) => <span className={index === 0 ? 'active' : undefined} key={tab}>{tab}</span>)}
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Details</h2><span>Read-only commercial product master</span></div>
        <div className="office-parity-detail-grid">
          <div><span>Product code</span><strong>{row.productCode}</strong></div>
          <div><span>Description</span><strong>{row.description}</strong></div>
          <div><span>Product group</span><strong>{text(row.productGroup)}</strong></div>
          <div><span>Brand</span><strong>{text(row.brand)}</strong></div>
          <div><span>Supplier</span><strong>{text(row.supplierName)}</strong></div>
          <div><span>Supplier product code</span><strong>{text(row.supplierProductCode)}</strong></div>
          <div><span>Base pack</span><strong>{text(row.basePack)}</strong></div>
          <div><span>Base unit</span><strong>{text(row.baseUnit)}</strong></div>
          <div><span>Barcode</span><strong>{text(row.barcode)}</strong></div>
          <div><span>Sellable</span><strong>{booleanLabel(row.isSellable)}</strong></div>
          <div><span>Purchasable</span><strong>{booleanLabel(row.isPurchasable)}</strong></div>
          <div><span>Obsolete</span><strong>{booleanLabel(row.isObsolete)}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Inventory boundary</h2><span>{row.inventoryAuthority}</span></div>
        <div className="office-parity-detail-grid">
          <div><span>Allocated</span><strong>{quantity(row.allocated)}</strong><small>Not inferred from commercial catalog.</small></div>
          <div><span>On hand</span><strong>{quantity(row.onHand)}</strong><small>Requires approved location-ledger read authority.</small></div>
        </div>
      </section>
    </section>
  );
}

export function ProductMasterWorkspace({
  catalog,
  sourceObservedAt,
  loading,
  available,
  loadError,
  onReload,
}: {
  catalog: readonly CatalogRow[];
  sourceObservedAt?: string | null;
  loading: boolean;
  available: boolean;
  loadError?: string;
  onReload: () => Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseWorkspaceQuery(location.search), [location.search]);
  const reader = useMemo(() => createProductMasterReader({ catalog, sourceObservedAt }), [catalog, sourceObservedAt]);
  const [result, setResult] = useState<ProductMasterListResult | null>(null);
  const [detail, setDetail] = useState<ProductMasterRow | null>(null);
  const resolution = useMemo(() => matchIntelligenceRoute(location.pathname), [location.pathname]);
  const productId = resolution.status === 'READY' && resolution.route.workspace === 'products' ? resolution.route.entityId : undefined;

  useEffect(() => {
    let active = true;
    void reader.readList({
      search: parsed.state.search,
      filters: parsed.state.filters,
      sort: parsed.state.sort,
      pageSize: parsed.state.pageSize ?? 50,
    }).then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, [reader, parsed.state.filters, parsed.state.pageSize, parsed.state.search, parsed.state.sort]);

  useEffect(() => {
    if (!productId) {
      setDetail(null);
      return;
    }
    let active = true;
    void reader.readList({ search: productId, pageSize: 100 }).then((next) => {
      if (!active) return;
      setDetail(next.rows.find((row) => row.productCode === productId) ?? null);
    });
    return () => { active = false; };
  }, [productId, reader]);

  const groups = useMemo(() => [...new Set(catalog.map((row) => row.category?.trim()).filter((value): value is string => Boolean(value)))].sort(), [catalog]);

  function updateQuery(input: { search?: string; filterKey?: string; filterValue?: string; sort?: string }) {
    let filters = parsed.state.filters;
    if (input.filterKey) {
      const prefix = `${input.filterKey}:`;
      filters = filters.filter((item) => !item.startsWith(prefix));
      if (input.filterValue) filters = [...filters, `${input.filterKey}:${input.filterValue}`];
    }
    navigate(withWorkspaceQuery('/products', {
      ...parsed.state,
      ...(input.search !== undefined ? { search: input.search || undefined } : {}),
      ...(input.sort !== undefined ? { sort: input.sort || undefined } : {}),
      filters,
      cursor: undefined,
    }), { replace: true });
  }

  if (productId && detail) {
    return <ProductDetail row={detail} onBack={() => navigate(withWorkspaceQuery('/products', parsed.state))} />;
  }

  if (loading && !available) {
    return <section className="office-parity-workspace"><div className="office-parity-state"><strong>LOADING</strong><span>Loading governed commercial Product Master…</span></div></section>;
  }

  if (loadError && !available) {
    return (
      <section className="office-parity-workspace">
        <div className="office-parity-state" data-state="UNAVAILABLE"><strong>UNAVAILABLE</strong><span>{loadError}</span><button type="button" onClick={() => void onReload()}>Retry</button></div>
      </section>
    );
  }

  return (
    <section className="office-parity-workspace" data-filter-contract={PRODUCT_MASTER_FILTER_ORDER.join(',')} data-column-contract={PRODUCT_MASTER_COLUMN_ORDER.join(',')}>
      <div className="office-parity-heading">
        <div><h1>Products</h1><p>Commercial Product Master in the familiar office order. Physical SKU identity and location stock remain separate authorities.</p></div>
        <button className="soft-button" type="button" onClick={() => void onReload()}>Refresh commercial source</button>
      </div>

      {result ? (
        <>
          <div className="office-parity-state" data-state={result.state}>
            <strong>{result.state}</strong>
            <span>{result.metadata.source}</span>
            <small>Authority: {result.metadata.authority} · Freshness: {result.metadata.freshness}</small>
          </div>
          {result.issues.length ? <ul className="office-parity-issues">{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        </>
      ) : null}

      <section className="panel">
        <div className="panel-head"><h2>Product search</h2><span>Unleashed-familiar filter order; unsupported facts stay disabled.</span></div>
        <div className="office-parity-filters">
          <label><span>Search</span><input value={parsed.state.search ?? ''} onChange={(event) => updateQuery({ search: event.currentTarget.value })} placeholder="Code or description" /></label>
          <label><span>Product group</span><select value={filterValue(parsed.state.filters, 'product-group')} onChange={(event) => updateQuery({ filterKey: 'product-group', filterValue: event.currentTarget.value })}><option value="">All groups</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label><span>Brand</span><input disabled placeholder="Unavailable" /></label>
          <label><span>Supplier</span><input disabled placeholder="Unavailable" /></label>
          <label><span>Supplier product</span><input disabled placeholder="Unavailable" /></label>
          <label><span>Barcode</span><input disabled placeholder="Unavailable" /></label>
          <label><span>Obsolete</span><select disabled defaultValue=""><option value="">Unavailable</option></select></label>
          <label><span>Sellable</span><select value={filterValue(parsed.state.filters, 'sellable')} onChange={(event) => updateQuery({ filterKey: 'sellable', filterValue: event.currentTarget.value })}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
          <label><span>Purchasable</span><select disabled defaultValue=""><option value="">Unavailable</option></select></label>
          <label><span>Sort</span><select value={parsed.state.sort ?? ''} onChange={(event) => updateQuery({ sort: event.currentTarget.value })}><option value="">Product code</option><option value="product-code-desc">Product code ↓</option><option value="description">Description</option><option value="product-group">Product group</option></select></label>
        </div>
      </section>

      <section className="office-parity-table-wrap" aria-label="Product Master table">
        <div className="office-parity-row products header"><span>Image</span><span>Product code</span><span>Description</span><span>Group</span><span>Base pack</span><span>Allocated</span><span>On hand</span><span>Base unit</span><span>Status / action</span></div>
        {result?.rows.map((row) => (
          <div className="office-parity-row products" key={row.productId}>
            <span>—</span>
            <button className="office-parity-link-button" type="button" onClick={() => navigate(`/products/${encodeURIComponent(row.productId)}${location.search}`)}>{row.productCode}</button>
            <span>{row.description}</span><span>{text(row.productGroup)}</span><span>{text(row.basePack)}</span><span>{quantity(row.allocated)}</span><span>{quantity(row.onHand)}</span><span>{text(row.baseUnit)}</span><span>{booleanLabel(row.isSellable)} · View</span>
          </div>
        ))}
        {result && !result.rows.length ? <div className="office-parity-empty">No products match the current governed read/filter context.</div> : null}
      </section>
      {parsed.issues.length ? <div className="office-parity-state" data-state="DEGRADED"><strong>QUERY NOTICE</strong><span>{parsed.issues.map((issue) => issue.code).join(', ')}</span></div> : null}
    </section>
  );
}
