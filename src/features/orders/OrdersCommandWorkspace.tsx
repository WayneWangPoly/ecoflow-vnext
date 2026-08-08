import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Filter,
  Landmark,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Truck,
  X,
} from 'lucide-react';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { loadDriverDayState, saveDriverDayState, type DriverDayState } from '@/domain/driverRun';
import { usePickSync } from '@/app/usePickSync';
import { useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';
import {
  readOrderOperationsDetail,
  readOrdersOperationsPage,
  type OrdersDeskDetail,
  type OrdersDeskException,
  type OrdersDeskPage,
  type OrdersDeskReleaseState,
  type OrdersDeskRow,
  type OrdersDeskSort,
  type OrdersDeskView,
} from '@/data/repositories/ordersOperationsDesk';
import { savedViewRepository } from '@/data/repositories/savedViewRepository';
import { actionableExceptionLifecycleRepository } from '@/data/repositories/actionableExceptionLifecycleRepository';
import type { SavedViewRecord } from '@/features/intelligence/analytics/productivity/productivityContract';
import { operationalCommandId } from '@/data/repositories/pickSync';
import './ordersCommandWorkspace.css';

const VIEWS: Array<{ key: OrdersDeskView; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: 'today', label: 'Today' },
  { key: 'decision', label: 'Needs decision' },
  { key: 'ready', label: 'Ready' },
  { key: 'warehouse', label: 'In execution' },
  { key: 'delivered', label: 'Delivered' },
];
const SORTS: Array<{ key: OrdersDeskSort; label: string }> = [
  { key: 'operations', label: 'Operational priority' },
  { key: 'due', label: 'Due first' },
  { key: 'latest', label: 'Latest update' },
  { key: 'oldest', label: 'Oldest update' },
  { key: 'store', label: 'Store' },
  { key: 'value', label: 'Highest value' },
];
const PAGE_SIZES = [25, 50, 100] as const;

function money(value: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(value);
}
function moment(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function due(value?: string | null) {
  if (!value) return 'Due not supplied';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function releaseLabel(value: OrdersDeskReleaseState) {
  if (value === 'READY_TO_RELEASE') return 'Ready to release';
  if (value === 'INTERNALISE_REQUIRED') return 'Internalise required';
  if (value === 'REVIEW_PAYMENT') return 'Finance review';
  if (value === 'BLOCKED_DATA') return 'Data blocked';
  if (value === 'BLOCKED_MAPPING') return 'Mapping blocked';
  if (value === 'BLOCKED_BARCODE') return 'Barcode blocked';
  if (value === 'BLOCKED_STOCK') return 'Stock blocked';
  if (value === 'COMPLETED') return 'Completed';
  return 'Unknown';
}
function releaseTone(value: OrdersDeskReleaseState) {
  if (value === 'READY_TO_RELEASE' || value === 'COMPLETED') return 'good';
  if (value === 'REVIEW_PAYMENT' || value === 'INTERNALISE_REQUIRED') return 'warn';
  if (value.startsWith('BLOCKED_')) return 'danger';
  return 'neutral';
}
function executionLabel(value: OrdersDeskRow['executionState']) {
  if (value === 'PICKING') return 'Picking';
  if (value === 'STAGED') return 'Staged';
  if (value === 'ROUTE') return 'On route';
  if (value === 'DELIVERED') return 'Delivered';
  if (value === 'NOT_STARTED') return 'Not started';
  return 'Unknown';
}
function handoffFor(state: OrdersDeskReleaseState) {
  if (state === 'REVIEW_PAYMENT') return { label: 'Open Reconciliation', path: '/reconciliation', icon: Landmark };
  if (state === 'BLOCKED_STOCK') return { label: 'Open Inventory', path: '/inventory', icon: Boxes };
  if (['BLOCKED_DATA','BLOCKED_MAPPING','BLOCKED_BARCODE','INTERNALISE_REQUIRED'].includes(state)) {
    return { label: 'Open Ordermentum', path: '/ordermentum', icon: ClipboardList };
  }
  return null;
}
function selectedOrderKey(pathname: string) {
  if (!pathname.startsWith('/orders/')) return null;
  const encoded = pathname.slice('/orders/'.length).split('/')[0];
  try { return decodeURIComponent(encoded); } catch { return encoded; }
}
function releaseIdentity(row: OrdersDeskRow) {
  return row.rawOrderId || row.externalOrderId || row.orderKey;
}
function canRelease(role: Role, row: OrdersDeskRow) {
  return (role === 'owner' || role === 'admin') && row.releaseState === 'READY_TO_RELEASE' && row.executionState === 'NOT_STARTED';
}

export function OrdersCommandWorkspace({ role, profile, businessDay }: { role: Role; profile: EcoFlowAuthProfile; businessDay: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = selectedOrderKey(location.pathname);
  const { state, update, clear } = useWorkspaceQueryState({
    tab: 'current',
    search: '',
    filter: 'all',
    sort: 'operations',
    page: 1,
    pageSize: 25,
    allowedTabs: VIEWS.map((item) => item.key),
    allowedFilters: ['all'],
    allowedSorts: SORTS.map((item) => item.key),
    allowedPageSizes: PAGE_SIZES,
  });
  const view = state.tab as OrdersDeskView;
  const sort = state.sort as OrdersDeskSort;
  const [searchDraft, setSearchDraft] = useState(state.search);
  const [pageData, setPageData] = useState<OrdersDeskPage | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [detail, setDetail] = useState<OrdersDeskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(businessDay));
  const pickSyncStatus = usePickSync(businessDay, day, setDay, profile.display_name || profile.email || 'Orders desk');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandNotice, setCommandNotice] = useState('');
  const [savedViews, setSavedViews] = useState<readonly SavedViewRecord[]>([]);
  const [savedViewNotice, setSavedViewNotice] = useState('');
  const [savePanel, setSavePanel] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  useEffect(() => saveDriverDayState(day), [day]);
  useEffect(() => setSearchDraft(state.search), [state.search]);

  const loadPage = useCallback(async () => {
    setPageLoading(true);
    setPageError('');
    try {
      const next = await readOrdersOperationsPage({
        page: state.page,
        pageSize: state.pageSize as 25 | 50 | 100,
        search: state.search,
        view,
        sort,
      });
      setPageData(next);
      setSelected((current) => new Set([...current].filter((key) => next.rows.some((row) => row.orderKey === key))));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error));
    } finally {
      setPageLoading(false);
    }
  }, [sort, state.page, state.pageSize, state.search, view]);

  const loadDetail = useCallback(async (key: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await readOrderOperationsDetail(key));
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadPage(); }, [loadPage]);
  useEffect(() => {
    if (selectedKey) void loadDetail(selectedKey);
    else {
      setDetail(null);
      setDetailError('');
    }
  }, [loadDetail, selectedKey]);
  useEffect(() => {
    void savedViewRepository.readSavedViews('orders').then((result) => {
      if (result.ok) setSavedViews(result.data);
      else setSavedViewNotice(result.error.message);
    });
  }, []);

  const rows = pageData?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((pageData?.totalCount ?? 0) / state.pageSize));
  const readyRows = rows.filter((row) => canRelease(role, row));
  const selectedRows = rows.filter((row) => selected.has(row.orderKey));
  const releasableSelected = selectedRows.filter((row) => canRelease(role, row));
  const allReadySelected = readyRows.length > 0 && readyRows.every((row) => selected.has(row.orderKey));
  const releasedIds = day.releasedOrders;
  const currentView = VIEWS.find((item) => item.key === view)?.label ?? view;

  function openOrder(row: OrdersDeskRow) {
    navigate(`/orders/${encodeURIComponent(row.orderKey)}${location.search}`);
  }
  function closeOrder() {
    navigate(`/orders${location.search}`);
  }
  function toggle(row: OrdersDeskRow) {
    if (!canRelease(role, row)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.orderKey)) next.delete(row.orderKey); else next.add(row.orderKey);
      return next;
    });
  }
  function toggleAllReady() {
    setSelected((current) => {
      const next = new Set(current);
      if (allReadySelected) readyRows.forEach((row) => next.delete(row.orderKey));
      else readyRows.forEach((row) => next.add(row.orderKey));
      return next;
    });
  }
  async function release(rowsToRelease: OrdersDeskRow[]) {
    if (!rowsToRelease.length || !['owner','admin'].includes(role)) return;
    setCommandBusy(true);
    setCommandNotice('');
    const releasedAt = new Date().toISOString();
    setDay((current) => ({
      ...current,
      releasedOrders: {
        ...current.releasedOrders,
        ...Object.fromEntries(rowsToRelease.map((row) => [releaseIdentity(row), releasedAt])),
      },
    }));
    setSelected(new Set());
    setCommandNotice(`${rowsToRelease.length} order${rowsToRelease.length === 1 ? '' : 's'} queued for governed release sync.`);
    window.setTimeout(() => setCommandBusy(false), 500);
  }
  async function saveCurrentView() {
    const name = saveName.trim();
    if (!name) return;
    setSavedViewNotice('');
    const result = await savedViewRepository.applyCommand({
      action: 'CREATE',
      workspace: 'orders',
      name,
      state: {
        filters: [view],
        sort,
        visibleColumns: ['store','due','value','release','execution','exceptions','updated'],
        dateRange: null,
        comparisonSettings: [],
        searchTerm: state.search || null,
      },
    });
    if (!result.ok) {
      setSavedViewNotice(result.error.message);
      return;
    }
    setSaveName('');
    setSavePanel(false);
    const refreshed = await savedViewRepository.readSavedViews('orders');
    if (refreshed.ok) setSavedViews(refreshed.data);
    setSavedViewNotice('View saved.');
  }
  function applySavedView(item: SavedViewRecord) {
    const savedView = (item.state.filters.find((candidate) => VIEWS.some((viewItem) => viewItem.key === candidate)) || 'current') as OrdersDeskView;
    const savedSort = SORTS.some((sortItem) => sortItem.key === item.state.sort) ? item.state.sort as OrdersDeskSort : 'operations';
    update({ tab: savedView, sort: savedSort, search: item.state.searchTerm || '' });
  }
  async function exceptionCommand(exception: OrdersDeskException, action: 'ACKNOWLEDGE' | 'RESOLVE') {
    setCommandBusy(true);
    setCommandNotice('');
    const note = (resolutionNotes[exception.exceptionId] || '').trim();
    if (action === 'RESOLVE' && !note) {
      setCommandBusy(false);
      setCommandNotice('Resolution note is required before resolving an exception.');
      return;
    }
    const commandId = await operationalCommandId(`${exception.exceptionId}\n${action}\n${exception.version}\n${note}`);
    const result = await actionableExceptionLifecycleRepository.applyCommand({
      commandId,
      exceptionId: exception.exceptionId,
      action,
      resolutionNote: action === 'RESOLVE' ? note : null,
      note: action === 'ACKNOWLEDGE' && note ? note : null,
    });
    if (!result.ok) setCommandNotice(`${result.error.code} · ${result.error.message}`);
    else {
      setCommandNotice(`${action === 'RESOLVE' ? 'Resolved' : 'Acknowledged'} · ${exception.exceptionId}`);
      if (selectedKey) await loadDetail(selectedKey);
      await loadPage();
    }
    setCommandBusy(false);
  }

  return (
    <section className="orders-desk" data-view={view}>
      <header className="orders-desk__hero">
        <div>
          <span>ORDER OPERATIONS</span>
          <h1>Orders</h1>
          <p>Decide, release and hand work into execution without losing the source context.</p>
        </div>
        <div className="orders-desk__hero-signals">
          <div><span>View</span><strong>{currentView}</strong></div>
          <div><span>Orders</span><strong>{pageData ? pageData.totalCount : '—'}</strong></div>
          <div><span>Release sync</span><strong>{pickSyncStatus.toUpperCase()}</strong></div>
          <div><span>Read</span><strong>{pageData?.readAt ? moment(pageData.readAt) : '—'}</strong></div>
        </div>
      </header>

      <div className="orders-desk__views" role="tablist" aria-label="Order views">
        {VIEWS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={view === item.key} className={view === item.key ? 'active' : ''} onClick={() => update({ tab: item.key })}>
            {item.label}
          </button>
        ))}
      </div>

      <section className="orders-desk__commandbar">
        <form onSubmit={(event) => { event.preventDefault(); update({ search: searchDraft }); }} className="orders-desk__search">
          <Search aria-hidden="true" />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Order, invoice, store, suburb or status" aria-label="Search orders" />
          {searchDraft ? <button type="button" aria-label="Clear search" onClick={() => { setSearchDraft(''); update({ search: '' }); }}><X /></button> : null}
        </form>
        <label className="orders-desk__sort"><Filter /><span>Sort</span><select value={sort} onChange={(event) => update({ sort: event.target.value as OrdersDeskSort })}>{SORTS.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
        <label className="orders-desk__saved"><span>Saved view</span><select defaultValue="" onChange={(event) => { const item = savedViews.find((candidate) => candidate.savedViewId === event.target.value); if (item) applySavedView(item); event.currentTarget.value = ''; }}><option value="">Choose…</option>{savedViews.map((item) => <option key={item.savedViewId} value={item.savedViewId}>{item.name}</option>)}</select></label>
        <button type="button" className="orders-desk__soft" onClick={() => setSavePanel((value) => !value)}><Save /> Save view</button>
        <button type="button" className="orders-desk__soft" disabled={pageLoading} onClick={() => void loadPage()}><RefreshCw className={pageLoading ? 'spin' : ''} /> Refresh</button>
        <button type="button" className="orders-desk__quiet" onClick={() => { clear(); setSearchDraft(''); }}>Reset</button>
        {savePanel ? <div className="orders-desk__save-popover"><strong>Save current view</strong><input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="e.g. Morning release queue" /><div><button type="button" onClick={() => setSavePanel(false)}>Cancel</button><button type="button" disabled={!saveName.trim()} onClick={() => void saveCurrentView()}>Save</button></div></div> : null}
      </section>

      {savedViewNotice ? <div className="orders-desk__notice">{savedViewNotice}</div> : null}
      {commandNotice ? <div className="orders-desk__notice" data-command="true">{commandNotice}</div> : null}
      {pageError ? <div className="orders-desk__error"><AlertTriangle /> <span><strong>Orders unavailable</strong>{pageError}</span><button type="button" onClick={() => void loadPage()}>Retry</button></div> : null}

      {selected.size ? (
        <div className="orders-desk__bulkbar">
          <span><strong>{selected.size}</strong> selected</span>
          <span>{releasableSelected.length} ready to release</span>
          <button type="button" disabled={!releasableSelected.length || commandBusy} onClick={() => void release(releasableSelected)}><BadgeCheck /> Release selected</button>
          <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      <section className="orders-desk__table-shell" aria-busy={pageLoading}>
        <div className="orders-desk__table-head">
          <label><input type="checkbox" checked={allReadySelected} disabled={!readyRows.length} onChange={toggleAllReady} /><span className="sr-only">Select all releasable orders on page</span></label>
          <span>Store / order</span><span>Due</span><span>Value</span><span>Release</span><span>Execution</span><span>Exceptions</span><span>Updated</span><span />
        </div>
        {pageLoading && !pageData ? <div className="orders-desk__loading"><LoaderCircle className="spin" /><strong>Loading operational order page…</strong><span>Server paging stays exact; the browser does not download the whole current workload.</span></div> : null}
        {!pageLoading && !pageError && rows.length === 0 ? <div className="orders-desk__empty"><CheckCircle2 /><strong>No orders in this view</strong><span>Change the view or search; no zero is inferred from a failed read.</span></div> : null}
        <div className="orders-desk__rows">
          {rows.map((row) => {
            const isReleased = Boolean(releasedIds[releaseIdentity(row)]);
            const selectable = canRelease(role, row) && !isReleased;
            const exceptionText = row.exceptionSnapshotFresh ? String(row.activeExceptionCount ?? 0) : 'STALE';
            return (
              <article key={row.orderKey} className="orders-desk__row" data-release={releaseTone(row.releaseState)} data-selected={selected.has(row.orderKey) ? 'true' : undefined}>
                <label className="orders-desk__select"><input type="checkbox" checked={selected.has(row.orderKey)} disabled={!selectable} onChange={() => toggle(row)} /><span className="sr-only">Select {row.orderNumber}</span></label>
                <button type="button" className="orders-desk__identity" onClick={() => openOrder(row)}><strong>{row.storeName}</strong><span>{row.orderNumber} · {row.invoiceNumber}</span><small>{row.suburb || 'Suburb unavailable'} · {row.lineCount} lines · {row.totalUnits} units</small></button>
                <div className="orders-desk__due"><strong>{due(row.dueAt || row.deliveryDate)}</strong><span>{row.operatingDay || 'No operating day'}</span></div>
                <strong className="orders-desk__value">{money(row.orderValue)}</strong>
                <div className="orders-desk__status"><span className={`orders-desk__pill ${releaseTone(row.releaseState)}`}>{isReleased ? 'Released' : releaseLabel(row.releaseState)}</span>{row.unmappedLineCount ? <small>{row.unmappedLineCount} unmapped</small> : row.barcodeBlockedLineCount ? <small>{row.barcodeBlockedLineCount} barcode blocked</small> : null}</div>
                <div className="orders-desk__execution"><strong>{executionLabel(row.executionState)}</strong><span>{row.internalOrderId ? 'Internal order linked' : 'No internal order'}</span></div>
                <div className="orders-desk__exceptions" data-stale={!row.exceptionSnapshotFresh ? 'true' : undefined}><ShieldAlert /><strong>{exceptionText}</strong><span>{row.exceptionSnapshotFresh ? 'active' : 'refresh required'}</span></div>
                <div className="orders-desk__updated"><Clock3 /><span>{moment(row.updatedAt)}</span></div>
                <button type="button" className="orders-desk__open" onClick={() => openOrder(row)} aria-label={`Open ${row.orderNumber}`}><ArrowRight /></button>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="orders-desk__pagination">
        <span>{pageData ? `${Math.min((state.page - 1) * state.pageSize + 1, pageData.totalCount)}–${Math.min(state.page * state.pageSize, pageData.totalCount)} of ${pageData.totalCount}` : '—'}</span>
        <label>Rows <select value={state.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
        <div><button type="button" disabled={state.page <= 1 || pageLoading} onClick={() => update({ page: state.page - 1 }, { preservePage: true })}><ChevronLeft /> Previous</button><span>Page {state.page} / {totalPages}</span><button type="button" disabled={state.page >= totalPages || pageLoading} onClick={() => update({ page: state.page + 1 }, { preservePage: true })}>Next <ChevronRight /></button></div>
      </footer>

      {selectedKey ? <div className="orders-desk__drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrder(); }}>
        <aside className="orders-desk__drawer" role="dialog" aria-modal="true" aria-label="Order operations detail">
          <header><button type="button" onClick={closeOrder} aria-label="Close order"><ArrowLeft /></button><div><span>ORDER OPERATIONS</span><strong>{detail?.order.orderNumber || selectedKey}</strong><small>{detail?.order.storeName || 'Loading current order…'}</small></div><button type="button" onClick={() => selectedKey && void loadDetail(selectedKey)} disabled={detailLoading}><RefreshCw className={detailLoading ? 'spin' : ''} /></button></header>
          {detailLoading && !detail ? <div className="orders-desk__drawer-loading"><LoaderCircle className="spin" /> Loading current order authority…</div> : null}
          {detailError ? <div className="orders-desk__drawer-error"><AlertTriangle />{detailError}</div> : null}
          {detail ? <div className="orders-desk__drawer-body">
            <section className="orders-desk__drawer-summary"><div><span>{detail.order.suburb || 'Suburb unavailable'}</span><h2>{detail.order.storeName}</h2><p>{detail.order.address || 'Address not available in current site master.'}</p></div><div><strong>{money(detail.order.orderValue)}</strong><span>{detail.order.lineCount} lines · {detail.order.totalUnits} units</span></div></section>

            <section className="orders-desk__gate" data-tone={releaseTone(detail.order.releaseState)}><div><span>RELEASE GATE</span><strong>{releaseLabel(detail.order.releaseState)}</strong><small>{detail.order.executionState === 'NOT_STARTED' ? 'Execution has not started.' : `Execution: ${executionLabel(detail.order.executionState)}`}</small></div>{detail.order.releaseState === 'READY_TO_RELEASE' && ['owner','admin'].includes(role) && detail.order.executionState === 'NOT_STARTED' ? <button type="button" disabled={commandBusy || Boolean(releasedIds[detail.order.rawOrderId || detail.order.externalOrderId || detail.order.orderKey])} onClick={() => void release([{ orderKey: detail.order.orderKey, rawOrderId: detail.order.rawOrderId, externalOrderId: detail.order.externalOrderId, orderNumber: detail.order.orderNumber, invoiceNumber: detail.order.invoiceNumber, storeName: detail.order.storeName, suburb: detail.order.suburb, deliveryDate: detail.order.deliveryDate, dueAt: detail.order.dueAt, sourceStatus: detail.order.sourceStatus, paymentStatus: detail.order.paymentStatus, orderValue: detail.order.orderValue, lineCount: detail.order.lineCount, totalUnits: detail.order.totalUnits, releaseState: detail.order.releaseState, executionState: detail.order.executionState, internalOrderId: detail.order.internalOrderId, unmappedLineCount: detail.order.unmappedLineCount, barcodeBlockedLineCount: detail.order.barcodeBlockedLineCount, activeExceptionCount: detail.exceptions?.length ?? null, exceptionSnapshotFresh: detail.exceptionSnapshotFresh, exceptionRefreshedAt: detail.exceptionRefreshedAt, updatedAt: detail.order.updatedAt, operatingDay: detail.order.deliveryDate?.slice(0,10) || null }])}><BadgeCheck /> Release order</button> : (() => { const handoff = handoffFor(detail.order.releaseState); if (!handoff) return null; const Icon = handoff.icon; return <button type="button" onClick={() => navigate(handoff.path)}><Icon /> {handoff.label}</button>; })()}</section>

            <section className="orders-desk__facts"><div><span>Due</span><strong>{due(detail.order.dueAt || detail.order.deliveryDate)}</strong></div><div><span>Source</span><strong>{detail.order.sourceStatus || '—'}</strong></div><div><span>Payment</span><strong>{detail.order.paymentStatus || '—'}</strong></div><div><span>Internal order</span><strong>{detail.order.internalOrderId || 'Not created'}</strong></div><div><span>Warehouse gate</span><strong>{detail.order.warehouseGateStatus || '—'}</strong></div><div><span>Synced</span><strong>{moment(detail.order.lastSyncedAt)}</strong></div></section>

            {(detail.order.unmappedLineCount || detail.order.barcodeBlockedLineCount || detail.order.invoiceDetailMissing || detail.order.lineItemsMissing) ? <section className="orders-desk__blockers"><h3><ShieldAlert /> Current blockers</h3>{detail.order.invoiceDetailMissing ? <p>Invoice detail is missing from the current source projection.</p> : null}{detail.order.lineItemsMissing ? <p>Order item lines are missing from the current source projection.</p> : null}{detail.order.unmappedLineCount ? <p>{detail.order.unmappedLineCount} line{detail.order.unmappedLineCount === 1 ? '' : 's'} require SKU mapping.</p> : null}{detail.order.barcodeBlockedLineCount ? <p>{detail.order.barcodeBlockedLineCount} line{detail.order.barcodeBlockedLineCount === 1 ? '' : 's'} are blocked by barcode controls.</p> : null}</section> : null}

            <section className="orders-desk__drawer-section"><header><div><span>LINE DETAIL</span><h3>Products</h3></div><span>{detail.lines.length} loaded</span></header><div className="orders-desk__lines">{detail.lines.length ? detail.lines.map((line, index) => <div key={`${line.source_line_id || index}`}><span><strong>{line.external_sku_code || 'SKU pending'}</strong><small>{line.external_product_name || 'Ordermentum line'}</small></span><span>{Number(line.quantity || 0)} {line.unit || line.uom || ''}</span><strong>{money(Number(line.total || line.subtotal || 0))}</strong></div>) : <p>No current line detail returned.</p>}</div></section>

            <section className="orders-desk__drawer-section"><header><div><span>CURRENT EXCEPTIONS</span><h3>Decision history</h3></div><span>{detail.exceptionSnapshotFresh ? `${detail.exceptions?.length ?? 0} active` : 'STALE'}</span></header>{!detail.exceptionSnapshotFresh || detail.exceptions === null ? <div className="orders-desk__exception-stale"><AlertTriangle /><span><strong>Exception snapshot is not current.</strong>Order facts remain available, but lifecycle actions are withheld until the governed exception snapshot refreshes.</span></div> : detail.exceptions.length ? <div className="orders-desk__exception-list">{detail.exceptions.map((exception) => <article key={exception.exceptionId}><div><ShieldAlert /><span><strong>{exception.exceptionType || 'Order exception'}</strong><small>{exception.message || 'Review required'} · {moment(exception.detectedAt)}</small></span><span className="orders-desk__pill warn">{exception.lifecycleStatus}</span></div><div className="orders-desk__exception-meta"><span>Owner: {exception.ownerTeam}</span>{exception.snoozedUntil ? <span>Snoozed to {moment(exception.snoozedUntil)}</span> : null}</div>{role !== 'viewer' ? <div className="orders-desk__exception-actions"><textarea value={resolutionNotes[exception.exceptionId] || ''} onChange={(event) => setResolutionNotes((current) => ({ ...current, [exception.exceptionId]: event.target.value }))} placeholder="Decision note (required to resolve)" /><button type="button" disabled={commandBusy || exception.lifecycleStatus === 'ACKNOWLEDGED'} onClick={() => void exceptionCommand(exception, 'ACKNOWLEDGE')}><Check /> Acknowledge</button><button type="button" disabled={commandBusy || exception.lifecycleStatus === 'RESOLVED'} onClick={() => void exceptionCommand(exception, 'RESOLVE')}><CheckCircle2 /> Resolve</button></div> : null}</article>)}</div> : <div className="orders-desk__drawer-empty"><CheckCircle2 /> No current exceptions are linked to this order.</div>}</section>

            <section className="orders-desk__handoffs"><button type="button" onClick={() => navigate('/ordermentum')}><ClipboardList /> Ordermentum source <ArrowRight /></button><button type="button" onClick={() => navigate('/reconciliation')}><CircleDollarSign /> Reconciliation <ArrowRight /></button><button type="button" onClick={() => navigate('/inventory')}><Boxes /> Inventory <ArrowRight /></button><button type="button" onClick={() => navigate('/delivery')}><Truck /> Delivery <ArrowRight /></button></section>
          </div> : null}
        </aside>
      </div> : null}
    </section>
  );
}
