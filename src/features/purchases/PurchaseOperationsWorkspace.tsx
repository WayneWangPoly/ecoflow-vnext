import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  PURCHASE_OPERATIONS_COLUMN_ORDER,
  PURCHASE_OPERATIONS_FILTER_ORDER,
  PURCHASE_ORDER_FAMILIAR_STATUS_ORDER,
  readPurchaseOperationsDetail,
  readPurchaseOperationsList,
  type PurchaseOperationsDetailResult,
  type PurchaseOperationsListResult,
} from '@/data/repositories/purchaseOperations';
import { matchIntelligenceRoute } from '@/features/intelligence/navigation/routeContract';
import { parseWorkspaceQuery, withWorkspaceQuery } from '@/features/intelligence/navigation/queryState';
import '@/features/officeParity/nativeReadSurfaces.css';

function text(value: string | null | undefined) {
  return value?.trim() || 'Unavailable';
}

function number(value: number | string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === '') return 'Unavailable';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-AU') : 'Unavailable';
}

function date(value: string | null | undefined) {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-AU');
}

function filterValue(filters: string[], key: string) {
  const prefix = `${key}:`;
  return filters.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function PurchaseDetail({ detail, onBack }: { detail: PurchaseOperationsDetailResult; onBack: () => void }) {
  const order = detail.order;
  if (!order) {
    return (
      <section className="office-parity-workspace">
        <button className="soft-button" type="button" onClick={onBack}>← Purchases</button>
        <div className="office-parity-state" data-state={detail.state}><strong>{detail.state}</strong><span>{detail.issues.join(' ')}</span></div>
      </section>
    );
  }

  return (
    <section className="office-parity-workspace" aria-label="Purchase order detail">
      <div className="office-parity-heading">
        <div>
          <button className="soft-button" type="button" onClick={onBack}>← Purchases</button>
          <h1>{order.po_number}</h1>
          <p>{order.supplier_name} · read-only purchase-order authority</p>
        </div>
        <div className="office-parity-state" data-state="READY"><strong>{order.familiarStatus ?? 'STATUS UNMAPPED'}</strong><span>WAYNX {order.po_status} · {detail.metadata.source}</span></div>
      </div>

      <div className="office-parity-tabs" aria-label="Purchase detail sections"><span className="active">Details</span><span>Order lines</span><span>Receipt history</span></div>

      <section className="panel">
        <div className="panel-head"><h2>Purchase order</h2><span>No lifecycle mutation is exposed from #340A.</span></div>
        <div className="office-parity-detail-grid">
          <div><span>PO number</span><strong>{order.po_number}</strong></div>
          <div><span>Supplier</span><strong>{order.supplier_name}</strong></div>
          <div><span>Order date</span><strong>{date(order.order_date)}</strong></div>
          <div><span>Expected date</span><strong>{date(order.expected_date)}</strong></div>
          <div><span>Currency</span><strong>{order.currency}</strong></div>
          <div><span>Status</span><strong>{order.familiarStatus ?? 'Unavailable'}</strong><small>WAYNX source state: {order.po_status}</small></div>
          <div><span>Supplier reference</span><strong>Unavailable</strong></div>
          <div><span>Warehouse</span><strong>Unavailable</strong></div>
          <div><span>Total</span><strong>Unavailable</strong><small>No client-side financial calculation.</small></div>
          <div><span>Ordered units</span><strong>{number(order.ordered_units)}</strong></div>
          <div><span>Received units</span><strong>{number(order.received_units)}</strong></div>
          <div><span>Variance units</span><strong>{number(order.variance_units)}</strong></div>
          <div><span>Receipt count</span><strong>{number(order.receipt_count)}</strong></div>
          <div><span>PO note</span><strong>{text(order.po_note)}</strong></div>
          <div><span>Review note</span><strong>{text(order.review_note)}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Order lines</h2><span>{detail.lines.length} governed lines</span></div>
        <div className="office-parity-subtable">
          {detail.lines.map((line) => (
            <div className="office-parity-subrow" key={line.id}>
              <strong>{line.sku}</strong><span>{text(line.product_name)}</span><span>{line.package_level}</span><span>{number(line.ordered_packages)} pkg</span><span>{number(line.received_units)} received</span>
            </div>
          ))}
          {!detail.lines.length ? <div className="office-parity-empty">No purchase-order lines are visible in the governed read model.</div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Receipt history</h2><span>Historical evidence only</span></div>
        <div className="office-parity-detail-grid">
          {detail.receipts.map((receipt) => (
            <div key={receipt.batch_id}><span>{receipt.batch_no}</span><strong>{receipt.batch_status}</strong><small>{text(receipt.delivery_docket_ref)} · {number(receipt.posted_units)} units · {date(receipt.physically_received_at || receipt.created_at)}</small></div>
          ))}
          {!detail.receipts.length ? <div><span>Receipts</span><strong>None recorded</strong></div> : null}
        </div>
      </section>
    </section>
  );
}

export function PurchaseOperationsWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseWorkspaceQuery(location.search), [location.search]);
  const resolution = useMemo(() => matchIntelligenceRoute(location.pathname), [location.pathname]);
  const purchaseId = resolution.status === 'READY' && resolution.route.workspace === 'purchases' ? resolution.route.entityId : undefined;
  const [result, setResult] = useState<PurchaseOperationsListResult | null>(null);
  const [detail, setDetail] = useState<PurchaseOperationsDetailResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (purchaseId) return;
    let active = true;
    setError('');
    void readPurchaseOperationsList({
      search: parsed.state.search,
      filters: parsed.state.filters,
      sort: parsed.state.sort,
      page: parsed.state.page ?? 1,
      pageSize: parsed.state.pageSize ?? 50,
    }).then((next) => { if (active) setResult(next); }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { active = false; };
  }, [parsed.state.filters, parsed.state.page, parsed.state.pageSize, parsed.state.search, parsed.state.sort, purchaseId]);

  useEffect(() => {
    if (!purchaseId) {
      setDetail(null);
      return;
    }
    let active = true;
    setError('');
    void readPurchaseOperationsDetail(purchaseId).then((next) => { if (active) setDetail(next); }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { active = false; };
  }, [purchaseId]);

  function replaceFilter(key: string, nextValue: string) {
    const prefix = `${key}:`;
    let filters = parsed.state.filters.filter((item) => !item.startsWith(prefix));
    if (nextValue) filters = [...filters, `${key}:${nextValue}`];
    navigate(withWorkspaceQuery('/purchases', { ...parsed.state, filters, cursor: undefined, page: undefined }), { replace: true });
  }

  if (purchaseId && detail) return <PurchaseDetail detail={detail} onBack={() => navigate(withWorkspaceQuery('/purchases', parsed.state))} />;
  if (error) return <section className="office-parity-workspace"><div className="office-parity-state" data-state="UNAVAILABLE"><strong>UNAVAILABLE</strong><span>{error}</span></div></section>;
  if (purchaseId && !detail) return <section className="office-parity-workspace"><div className="office-parity-state"><strong>LOADING</strong><span>Loading governed purchase-order detail…</span></div></section>;

  return (
    <section className="office-parity-workspace" data-filter-contract={PURCHASE_OPERATIONS_FILTER_ORDER.join(',')} data-column-contract={PURCHASE_OPERATIONS_COLUMN_ORDER.join(',')}>
      <div className="office-parity-heading"><div><h1>Purchases</h1><p>Purchase Orders in familiar office order, backed by the existing WAYNX read RPC. This #340A surface is intentionally read-only.</p></div></div>

      {result ? <div className="office-parity-state" data-state={result.state}><strong>{result.state}</strong><span>{result.metadata.source}</span><small>Authority: {result.metadata.authority} · Freshness: {result.metadata.freshness}</small></div> : <div className="office-parity-state"><strong>LOADING</strong><span>Loading governed purchase orders…</span></div>}

      <section className="panel">
        <div className="panel-head"><h2>Purchase order search</h2><span>Filter order follows the established parity contract.</span></div>
        <div className="office-parity-filters">
          <label><span>Status</span><select value={filterValue(parsed.state.filters, 'status')} onChange={(event) => replaceFilter('status', event.currentTarget.value)}><option value="">All statuses</option>{PURCHASE_ORDER_FAMILIAR_STATUS_ORDER.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label><span>Purchase order</span><input value={parsed.state.search ?? ''} onChange={(event) => navigate(withWorkspaceQuery('/purchases', { ...parsed.state, search: event.currentTarget.value || undefined, cursor: undefined, page: undefined }), { replace: true })} placeholder="PO number / supplier" /></label>
          <label><span>Supplier</span><input value={filterValue(parsed.state.filters, 'supplier')} onChange={(event) => replaceFilter('supplier', event.currentTarget.value)} placeholder="Supplier name" /></label>
          <label><span>Warehouse</span><input disabled placeholder="Unavailable in PO summary" /></label>
          <label><span>Supplier reference</span><input disabled placeholder="Unavailable in governed summary" /></label>
          <label><span>Sales-order reference</span><input disabled placeholder="Unavailable in governed summary" /></label>
          <label><span>Printed / export</span><select disabled defaultValue=""><option value="">Unavailable</option></select></label>
          <label><span>Sort</span><select value={parsed.state.sort ?? ''} onChange={(event) => navigate(withWorkspaceQuery('/purchases', { ...parsed.state, sort: event.currentTarget.value || undefined, cursor: undefined, page: undefined }), { replace: true })}><option value="">PO number</option><option value="po-desc">PO number ↓</option><option value="supplier">Supplier</option><option value="order-date-desc">Order date ↓</option></select></label>
        </div>
      </section>

      <section className="office-parity-table-wrap" aria-label="Purchase Orders table">
        {result ? <div className="office-parity-count">{result.totalCount.toLocaleString('en-AU')} exact records · Page {result.page} of {Math.max(1, Math.ceil(result.totalCount / result.pageSize))}</div> : null}
        <div className="office-parity-row purchases header"><span>PO no.</span><span>Order date</span><span>Delivery date</span><span>Supplier</span><span>Supplier ref</span><span>Status</span><span>Warehouse</span><span>Currency</span><span>Total</span><span>Action</span></div>
        {result?.rows.map((row) => (
          <div className="office-parity-row purchases" key={row.id}>
            <strong>{row.po_number}</strong><span>{date(row.order_date)}</span><span>{date(row.expected_date)}</span><span>{row.supplier_name}</span><span>Unavailable</span><span>{row.familiarStatus ?? 'Unavailable'}<small>WAYNX {row.po_status}</small></span><span>Unavailable</span><span>{row.currency}</span><span>Unavailable</span>
            <button className="office-parity-link-button" type="button" onClick={() => navigate(`/purchases/${encodeURIComponent(row.id)}${location.search}`)}>View</button>
          </div>
        ))}
        {result && !result.rows.length ? <div className="office-parity-empty">No purchase orders match the current governed read/filter context.</div> : null}
        {result ? <nav className="native-workspace-pager" aria-label="Purchase pagination"><button type="button" disabled={result.page <= 1} onClick={() => navigate(withWorkspaceQuery('/purchases', { ...parsed.state, page: result.page - 1 }), { replace: true })}>Previous</button><button type="button" disabled={result.page >= Math.max(1, Math.ceil(result.totalCount / result.pageSize))} onClick={() => navigate(withWorkspaceQuery('/purchases', { ...parsed.state, page: result.page + 1 }), { replace: true })}>Next</button></nav> : null}
      </section>
      {parsed.issues.length ? <div className="office-parity-state" data-state="DEGRADED"><strong>QUERY NOTICE</strong><span>{parsed.issues.map((issue) => issue.code).join(', ')}</span></div> : null}
    </section>
  );
}
