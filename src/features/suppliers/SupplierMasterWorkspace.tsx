import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  SUPPLIER_MASTER_COLUMN_ORDER,
  SUPPLIER_MASTER_FILTER_ORDER,
  createSupplierMasterReader,
  type SupplierMasterListResult,
  type SupplierMasterRow,
} from '@/data/repositories/supplierMaster';
import { matchIntelligenceRoute } from '@/features/intelligence/navigation/routeContract';
import { parseWorkspaceQuery, withWorkspaceQuery } from '@/features/intelligence/navigation/queryState';
import { supabase } from '@/lib/supabaseClient';
import '@/features/officeParity/nativeReadSurfaces.css';

const DETAIL_TABS = ['Details', 'Address', 'Contacts', 'Purchases', 'Returns', 'Costings'] as const;

function value(input: string | null | undefined) {
  return input?.trim() || 'Unavailable';
}

function filterValue(filters: string[], key: string) {
  const prefix = `${key}:`;
  return filters.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function SupplierDetail({ row, onBack }: { row: SupplierMasterRow; onBack: () => void }) {
  return (
    <section className="office-parity-workspace" aria-label="Supplier detail">
      <div className="office-parity-heading">
        <div>
          <button className="soft-button" type="button" onClick={onBack}>← Suppliers</button>
          <h1>{row.code}</h1>
          <p>Governed migration reference only. EcoFlow will not promote this evidence into a canonical Supplier master.</p>
        </div>
        <div className="office-parity-state" data-state="DEGRADED"><strong>DEGRADED</strong><span>{row.mappingStatus}</span></div>
      </div>
      <div className="office-parity-tabs" aria-label="Supplier detail sections">
        {DETAIL_TABS.map((tab, index) => <span className={index === 0 ? 'active' : undefined} key={tab}>{tab}</span>)}
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Details</h2><span>Read-only governed reference</span></div>
        <div className="office-parity-detail-grid">
          <div><span>Supplier code</span><strong>{row.code}</strong></div>
          <div><span>Name</span><strong>{value(row.name)}</strong></div>
          <div><span>City</span><strong>{value(row.city)}</strong></div>
          <div><span>Country</span><strong>{value(row.country)}</strong></div>
          <div><span>Currency</span><strong>{value(row.currency)}</strong></div>
          <div><span>Mapping status</span><strong>{row.mappingStatus}</strong></div>
          <div><span>Source observed</span><strong>{value(row.sourceObservedAt)}</strong></div>
          <div><span>Obsolete</span><strong>{row.isObsolete === null ? 'Unavailable' : row.isObsolete ? 'Yes' : 'No'}</strong></div>
        </div>
      </section>
      <div className="office-parity-state" data-state="UNAVAILABLE">
        <strong>CANONICAL PROFILE UNAVAILABLE</strong>
        <span>Address, contacts, purchases, returns and costings are not inferred from mapping evidence.</span>
      </div>
    </section>
  );
}

export function SupplierMasterWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseWorkspaceQuery(location.search), [location.search]);
  const reader = useMemo(() => supabase ? createSupplierMasterReader(supabase) : null, []);
  const [result, setResult] = useState<SupplierMasterListResult | null>(null);
  const [detail, setDetail] = useState<SupplierMasterListResult | null>(null);
  const resolution = useMemo(() => matchIntelligenceRoute(location.pathname), [location.pathname]);
  const supplierId = resolution.status === 'READY' && resolution.route.workspace === 'suppliers' ? resolution.route.entityId : undefined;

  useEffect(() => {
    if (!reader) {
      setResult(null);
      return;
    }
    let active = true;
    void reader.readList({
      search: parsed.state.search,
      filters: parsed.state.filters,
      sort: parsed.state.sort,
      page: parsed.state.page ?? 1,
      pageSize: parsed.state.pageSize ?? 50,
    }).then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, [reader, parsed.state.filters, parsed.state.page, parsed.state.pageSize, parsed.state.search, parsed.state.sort]);

  useEffect(() => {
    if (!reader || !supplierId) {
      setDetail(null);
      return;
    }
    let active = true;
    void reader.readDetail(supplierId).then((next) => { if (active) setDetail(next); });
    return () => { active = false; };
  }, [reader, supplierId]);

  function updateQuery(input: { search?: string; obsolete?: string; sort?: string }) {
    let filters = parsed.state.filters.filter((item) => !item.startsWith('obsolete:'));
    if (input.obsolete) filters = [...filters, `obsolete:${input.obsolete}`];
    else if (input.obsolete === undefined) filters = parsed.state.filters;
    navigate(withWorkspaceQuery('/suppliers', {
      ...parsed.state,
      ...(input.search !== undefined ? { search: input.search || undefined } : {}),
      ...(input.sort !== undefined ? { sort: input.sort || undefined } : {}),
      filters,
      cursor: undefined,
      page: undefined,
    }), { replace: true });
  }

  if (supplierId && detail?.rows[0]) {
    return <SupplierDetail row={detail.rows[0]} onBack={() => navigate(withWorkspaceQuery('/suppliers', parsed.state))} />;
  }
  if (supplierId && detail && !detail.rows.length) {
    return (
      <section className="office-parity-workspace">
        <button className="soft-button" type="button" onClick={() => navigate('/suppliers')}>← Suppliers</button>
        <div className="office-parity-state" data-state={detail.state}><strong>{detail.state}</strong><span>{detail.issues.join(' ')}</span></div>
      </section>
    );
  }

  if (!reader) {
    return <section className="office-parity-workspace"><div className="office-parity-state" data-state="UNAVAILABLE"><strong>UNAVAILABLE</strong><span>Secure Supabase read connection is not configured.</span></div></section>;
  }

  return (
    <section className="office-parity-workspace" data-filter-contract={SUPPLIER_MASTER_FILTER_ORDER.join(',')} data-column-contract={SUPPLIER_MASTER_COLUMN_ORDER.join(',')}>
      <div className="office-parity-heading">
        <div><h1>Suppliers</h1><p>Supplier office surface with a fail-closed authority boundary. Mapping references are visible only as evidence, never as a fabricated canonical directory.</p></div>
      </div>

      {result ? (
        <>
          <div className="office-parity-state" data-state={result.state}>
            <strong>{result.state}</strong>
            <span>{result.metadata.source}</span>
            <small>Authority: {result.metadata.authority} · Authoritative master: {result.metadata.isAuthoritative ? 'yes' : 'no'}</small>
          </div>
          {result.issues.length ? <ul className="office-parity-issues">{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        </>
      ) : <div className="office-parity-state"><strong>LOADING</strong><span>Loading governed Supplier references…</span></div>}

      <section className="panel">
        <div className="panel-head"><h2>Supplier search</h2><span>Canonical-only fields stay unavailable rather than inferred.</span></div>
        <div className="office-parity-filters">
          <label><span>Supplier</span><input value={parsed.state.search ?? ''} onChange={(event) => updateQuery({ search: event.currentTarget.value })} placeholder="Supplier code" /></label>
          <label><span>Obsolete</span><select value={filterValue(parsed.state.filters, 'obsolete')} onChange={(event) => updateQuery({ obsolete: event.currentTarget.value })}><option value="">All / unknown</option><option value="true">Retired reference</option><option value="unknown">Unknown</option></select></label>
          <label><span>Sort</span><select value={parsed.state.sort ?? ''} onChange={(event) => updateQuery({ sort: event.currentTarget.value })}><option value="">Code</option><option value="code-desc">Code ↓</option></select></label>
        </div>
      </section>

      <section className="office-parity-table-wrap" aria-label="Supplier Master table">
        {result ? <div className="office-parity-count">{result.totalCount.toLocaleString('en-AU')} exact records · Page {result.page} of {Math.max(1, Math.ceil(result.totalCount / result.pageSize))}</div> : null}
        <div className="office-parity-row suppliers header"><span>Code</span><span>Name</span><span>City</span><span>Country</span><span>Currency</span><span>Action</span></div>
        {result?.rows.map((row) => (
          <div className="office-parity-row suppliers" key={row.supplierId ?? row.code}>
            <span>{row.code}</span><span>{value(row.name)}</span><span>{value(row.city)}</span><span>{value(row.country)}</span><span>{value(row.currency)}</span>
            {row.supplierId ? <button className="office-parity-link-button" type="button" onClick={() => navigate(`/suppliers/${encodeURIComponent(row.supplierId ?? '')}${location.search}`)}>View reference</button> : <span>Unavailable</span>}
          </div>
        ))}
        {result && !result.rows.length ? <div className="office-parity-empty">No canonical Supplier master is available. EcoFlow is deliberately not substituting PO supplier strings or raw Unleashed staging data.</div> : null}
        {result ? <nav className="native-workspace-pager" aria-label="Supplier pagination"><button type="button" disabled={result.page <= 1} onClick={() => navigate(withWorkspaceQuery('/suppliers', { ...parsed.state, page: result.page - 1 }), { replace: true })}>Previous</button><button type="button" disabled={result.page >= Math.max(1, Math.ceil(result.totalCount / result.pageSize))} onClick={() => navigate(withWorkspaceQuery('/suppliers', { ...parsed.state, page: result.page + 1 }), { replace: true })}>Next</button></nav> : null}
      </section>
      {parsed.issues.length ? <div className="office-parity-state" data-state="DEGRADED"><strong>QUERY NOTICE</strong><span>{parsed.issues.map((issue) => issue.code).join(', ')}</span></div> : null}
    </section>
  );
}
