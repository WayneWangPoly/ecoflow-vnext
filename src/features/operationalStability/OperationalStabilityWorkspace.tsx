import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import type { Role } from '@/domain/types';
import { useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';
import { NativeWorkspaceFrame, NativeWorkspaceState } from '@/features/navigation/NativeWorkspaceFrame';
import { savedViewRepository } from '@/data/repositories/savedViewRepository';
import type { SavedViewRecord, SavedViewWorkspace } from '@/features/intelligence/analytics/productivity/productivityContract';
import { actionableExceptionLifecycleRepository } from '@/data/repositories/actionableExceptionLifecycleRepository';
import {
  approveStocktake,
  completeBusinessDayClose,
  completeStocktakeLocation,
  moveWarehouseSku,
  readBusinessDayCloseReadiness,
  readOperationalPage,
  readQuickActions,
  readWarehouseControl,
  recordStocktakeObservation,
  reopenStocktakeLocation,
  reviewStocktakeObservation,
  setQuickActions,
  startStocktake,
  submitStocktake,
  type OperationalPageResource,
  type OperationalPageResult,
  type QuickActionState,
  type WarehouseControlRecord,
} from '@/data/repositories/operationalStability';
import './operationalStabilityWorkspace.css';

const PAGE_SIZES = [10, 20, 25, 50, 100] as const;
const QUICK_ACTIONS = [
  ['CONTROL_ROOM', 'Control Room'],
  ['ORDERS', 'Orders'],
  ['INVENTORY', 'Inventory'],
  ['CUSTOMERS', 'Customers'],
  ['DELIVERY', 'Delivery'],
  ['RETURNS', 'Returns'],
  ['ANALYTICS', 'Analytics'],
  ['EXCEPTIONS', 'Exceptions'],
  ['LOGS', 'Logs'],
  ['SETTINGS', 'Settings'],
] as const;

type PagedWorkspaceProps = {
  resource: OperationalPageResource;
  role: Role;
  profile: EcoFlowAuthProfile;
  businessDay: string;
};

type Column = { key: string; label: string; format?: (value: unknown, row: Record<string, unknown>) => string };

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function dateTime(value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function duration(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return `${Math.max(0, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const COLUMNS: Record<OperationalPageResource, Column[]> = {
  orders: [
    { key: 'order_number', label: 'Order' },
    { key: 'invoice_number', label: 'Invoice' },
    { key: 'order_status', label: 'Source status' },
    { key: 'payment_status', label: 'Payment' },
    { key: 'order_items_total', label: 'Order value' },
    { key: 'order_updated_at', label: 'Updated', format: dateTime },
  ],
  stores: [
    { key: 'store_name', label: 'Store' },
    { key: 'suburb', label: 'Suburb' },
    { key: 'formatted_address', label: 'Address' },
    { key: 'contact_phone', label: 'Phone' },
    { key: 'price_group_id', label: 'Price group' },
    { key: 'verified', label: 'Verified' },
  ],
  inventory: [
    { key: 'sku', label: 'SKU' },
    { key: 'product_name', label: 'Product' },
    { key: 'location', label: 'Location' },
    { key: 'on_hand_location', label: 'On hand' },
    { key: 'latest_location_movement_at', label: 'Latest movement', format: dateTime },
  ],
  exceptions: [
    { key: 'order_number', label: 'Order' },
    { key: 'exception_type', label: 'Cause' },
    { key: 'category', label: 'Category' },
    { key: 'severity', label: 'Severity' },
    { key: 'age_seconds', label: 'Age', format: duration },
    { key: 'owner_team', label: 'Owner' },
    { key: 'due_at', label: 'Due', format: dateTime },
    { key: 'lifecycle_status', label: 'Lifecycle' },
  ],
  logs: [
    { key: 'moved_at', label: 'Time', format: dateTime },
    { key: 'movement_type', label: 'Movement' },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'from_location', label: 'From' },
    { key: 'to_location', label: 'To' },
    { key: 'reference_type', label: 'Reference type' },
    { key: 'reference_id', label: 'Reference' },
  ],
};

const TITLES: Record<OperationalPageResource, [string, string]> = {
  orders: ['Orders', 'Server-paged current Ordermentum work. Search, filter, sort and page state are shareable in the URL.'],
  stores: ['Customers', 'Server-paged Store master records. Commercial facts remain read-only and owned by Ordermentum.'],
  inventory: ['Inventory', 'Server-paged approved physical location balances. Opening and cycle counts appear only after supervisor approval.'],
  exceptions: ['Exception Action Queue', 'Every open item shows age, governed owner, category, severity policy, due time and a direct lifecycle action.'],
  logs: ['Operational Logs', 'Server-paged immutable inventory and warehouse movement history.'],
};

function workspaceFor(resource: OperationalPageResource): SavedViewWorkspace | null {
  if (resource === 'orders') return 'orders';
  if (resource === 'stores') return 'customers';
  if (resource === 'inventory') return 'inventory';
  return null;
}

function defaultSort(resource: OperationalPageResource) {
  if (resource === 'exceptions') return 'oldest';
  if (resource === 'inventory') return 'quantity-desc';
  if (resource === 'stores') return 'suburb';
  return 'latest';
}

function filtersFor(resource: OperationalPageResource) {
  if (resource === 'orders') return ['', 'placed', 'processing', 'ready', 'paid', 'unpaid'];
  if (resource === 'exceptions') return ['', 'open', 'acknowledged', 'snoozed'];
  return [''];
}

function savedState(resource: OperationalPageResource, state: ReturnType<typeof useWorkspaceQueryState>['state']) {
  return {
    filters: state.filter ? [`filter:${state.filter}`] : [],
    sort: state.sort || null,
    visibleColumns: COLUMNS[resource].map((column) => column.key),
    dateRange: null,
    comparisonSettings: [],
    searchTerm: state.search || null,
  };
}

function PageControls({ page, pageSize, total, onPage, onPageSize }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="native-workspace-pager">
      <span>{total.toLocaleString()} exact records · Page {Math.min(page, pages)} of {pages}</span>
      <div className="row-actions">
        <select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} rows</option>)}
        </select>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function SavedViewsBar({ resource, query, onApply }: {
  resource: OperationalPageResource;
  query: ReturnType<typeof useWorkspaceQueryState>;
  onApply: (view: SavedViewRecord) => void;
}) {
  const workspace = workspaceFor(resource);
  const [views, setViews] = useState<readonly SavedViewRecord[]>([]);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!workspace) return;
    const result = await savedViewRepository.readSavedViews(workspace);
    if (result.ok) setViews(result.data);
    else setNotice(result.error.message);
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);
  if (!workspace) return null;

  async function create() {
    const clean = name.trim();
    if (!clean) return;
    const result = await savedViewRepository.applyCommand({
      action: 'CREATE',
      workspace,
      name: clean,
      state: savedState(resource, query.state),
    });
    if (!result.ok) setNotice(result.error.message);
    else {
      setName('');
      setNotice('Saved to your authenticated profile.');
      await load();
    }
  }

  return (
    <section className="native-saved-views" aria-label="Saved views">
      <strong>Saved views</strong>
      <select aria-label="Apply saved view" defaultValue="" onChange={(event) => {
        const view = views.find((item) => item.savedViewId === event.target.value);
        if (view) onApply(view);
      }}>
        <option value="">Choose a view…</option>
        {views.map((view) => <option key={view.savedViewId} value={view.savedViewId}>{view.name}{view.isRoleDefault ? ' · role default' : ''}</option>)}
      </select>
      <input value={name} maxLength={80} placeholder="New view name" onChange={(event) => setName(event.target.value)} />
      <button type="button" onClick={() => void create()}>Save current view</button>
      {notice ? <small>{notice}</small> : null}
    </section>
  );
}

function ExceptionActions({ row, onDone }: { row: Record<string, unknown>; onDone: () => void }) {
  const [owner, setOwner] = useState(String(row.owner_team || 'Operations queue'));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const id = String(row.exception_id || '');

  async function command(action: 'ACKNOWLEDGE' | 'ASSIGN' | 'RESOLVE') {
    setBusy(true);
    setMessage('');
    try {
      const result = await actionableExceptionLifecycleRepository.applyCommand({
        commandId: crypto.randomUUID(),
        exceptionId: id,
        action,
        ownerTeam: action === 'ASSIGN' ? owner : null,
        resolutionNote: action === 'RESOLVE' ? note : null,
      });
      if (!result.ok) throw new Error(result.error.message);
      setMessage(`${action} applied.`);
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="native-exception-actions">
      <summary>Manage</summary>
      <div className="row-actions">
        <button type="button" disabled={busy} onClick={() => void command('ACKNOWLEDGE')}>Acknowledge</button>
        <input value={owner} maxLength={80} aria-label="Owner team" onChange={(event) => setOwner(event.target.value)} />
        <button type="button" disabled={busy || !owner.trim()} onClick={() => void command('ASSIGN')}>Assign</button>
      </div>
      <textarea value={note} maxLength={2000} placeholder="Resolution note" onChange={(event) => setNote(event.target.value)} />
      <button type="button" disabled={busy || !note.trim()} onClick={() => void command('RESOLVE')}>Resolve with note</button>
      {message ? <small>{message}</small> : null}
    </details>
  );
}

function BusinessDayClosePanel({ businessDay, role }: { businessDay: string; role: Role }) {
  const [checks, setChecks] = useState<Array<{ check_key: string; check_status: string; detail: string; blocking: boolean }>>([]);
  const [nextDay, setNextDay] = useState(() => {
    const value = new Date(`${businessDay}T12:00:00+09:30`);
    value.setDate(value.getDate() + 1);
    return value.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('Daily operational reconciliation completed');
  const [note, setNote] = useState('Accounts variance reviewed and acknowledged.');
  const [message, setMessage] = useState('');
  const canClose = role === 'owner' || role === 'admin';

  const load = useCallback(async () => {
    try {
      setChecks(await readBusinessDayCloseReadiness(businessDay));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [businessDay]);
  useEffect(() => { void load(); }, [load]);

  async function close() {
    try {
      const result = await completeBusinessDayClose({
        businessDay,
        nextBusinessDay: nextDay,
        expectedRevision: 0,
        reason,
        acknowledgementNote: note,
      });
      setMessage(`Business Day Close ${String(result?.close_status || 'completed')} · ${String(result?.carry_over_count ?? 0)} carry-over records.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="native-close-panel">
      <header><div><span className="eyebrow">ADELAIDE BUSINESS DAY</span><h2>Business Day Close</h2></div><button type="button" onClick={() => void load()}>Refresh checks</button></header>
      <div className="native-close-checks">
        {checks.map((check) => <article key={check.check_key} className={check.blocking ? 'blocking' : ''}><strong>{check.check_key.replaceAll('_', ' ')}</strong><span>{check.check_status}</span><p>{check.detail}</p></article>)}
      </div>
      {canClose ? <div className="native-close-form">
        <label>Next business day<input type="date" value={nextDay} min={businessDay} onChange={(event) => setNextDay(event.target.value)} /></label>
        <label>Close reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label>Accounts variance acknowledgement<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={checks.some((check) => check.blocking && check.check_key !== 'ACCOUNTS_VARIANCE') || !reason.trim() || !note.trim()} onClick={() => void close()}>Close and carry forward</button>
      </div> : <p>Owner or Admin approval is required to close the business day.</p>}
      {message ? <div className="native-workspace-notice">{message}</div> : null}
    </section>
  );
}

export function OperationalPagedWorkspace({ resource, role, profile, businessDay }: PagedWorkspaceProps) {
  const query = useWorkspaceQueryState({
    tab: 'list', search: '', filter: '', sort: defaultSort(resource), page: 1, pageSize: 25,
    allowedTabs: ['list', 'close'],
    allowedFilters: filtersFor(resource),
    allowedSorts: ['latest', 'oldest', 'suburb', 'quantity-desc'],
    allowedPageSizes: PAGE_SIZES,
  });
  const [result, setResult] = useState<OperationalPageResult>({ rows: [], totalCount: 0, readAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await readOperationalPage({
        resource,
        page: query.state.page,
        pageSize: query.state.pageSize as 10 | 20 | 25 | 50 | 100,
        search: query.state.search,
        filter: query.state.filter,
        sort: query.state.sort,
      });
      setResult(next);
      setError('');
    } catch (loadError) {
      setResult({ rows: [], totalCount: 0, readAt: null });
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [query.state.filter, query.state.page, query.state.pageSize, query.state.search, query.state.sort, reloadToken, resource]);
  useEffect(() => { void load(); }, [load]);

  const [title, subtitle] = TITLES[resource];
  const pages = Math.max(1, Math.ceil(result.totalCount / query.state.pageSize));
  useEffect(() => {
    if (!loading && query.state.page > pages) query.update({ page: pages }, { replace: true, preservePage: true });
  }, [loading, pages, query]);

  function applyView(view: SavedViewRecord) {
    const filter = view.state.filters.find((item) => item.startsWith('filter:'))?.slice(7) || '';
    query.update({ search: view.state.searchTerm || '', filter, sort: view.state.sort || defaultSort(resource), page: 1 });
  }

  if (resource === 'exceptions' && query.state.tab === 'close') {
    return <NativeWorkspaceFrame eyebrow="CONTROL & RECONCILIATION" title="Business Day Close" description="Reconcile source sync, exceptions, picking, staging, route and accounts variance before explicit carry-over." actions={<button type="button" onClick={() => query.update({ tab: 'list' })}>Back to queue</button>}><BusinessDayClosePanel businessDay={businessDay} role={role} /></NativeWorkspaceFrame>;
  }

  return (
    <NativeWorkspaceFrame
      eyebrow="SERVER-AUTHORITATIVE OPERATIONS"
      title={title}
      description={subtitle}
      actions={<><span className="status-chip">{profile.app_role}</span>{resource === 'exceptions' ? <button type="button" onClick={() => query.update({ tab: 'close' })}>Business Day Close</button> : null}<button type="button" onClick={() => setReloadToken((value) => value + 1)}>Reload</button></>}
    >
      <div className="native-workspace-toolbar">
        <label><span>Search</span><input value={query.state.search} placeholder={`Search ${title.toLowerCase()}`} onChange={(event) => query.update({ search: event.target.value })} /></label>
        <label><span>Filter</span><select value={query.state.filter} onChange={(event) => query.update({ filter: event.target.value })}>{filtersFor(resource).map((filter) => <option key={filter || 'all'} value={filter}>{filter || 'All'}</option>)}</select></label>
        <label><span>Sort</span><select value={query.state.sort} onChange={(event) => query.update({ sort: event.target.value })}><option value="latest">Latest</option><option value="oldest">Oldest</option>{resource === 'stores' ? <option value="suburb">Suburb</option> : null}{resource === 'inventory' ? <option value="quantity-desc">Quantity high to low</option> : null}</select></label>
        <button type="button" onClick={query.clear}>Clear URL state</button>
      </div>
      <SavedViewsBar resource={resource} query={query} onApply={applyView} />
      {loading ? <NativeWorkspaceState title="Loading server page" detail="EcoFlow is reading only the requested page and exact total." /> : null}
      {!loading && error ? <NativeWorkspaceState title="Operational page unavailable" detail={error} action={<button type="button" onClick={() => setReloadToken((value) => value + 1)}>Retry</button>} /> : null}
      {!loading && !error && result.rows.length === 0 ? <NativeWorkspaceState title="No matching records" detail="The server query completed successfully and returned an empty page." /> : null}
      {!loading && !error && result.rows.length > 0 ? <div className="native-server-table" role="region" aria-label={`${title} results`} tabIndex={0}>
        <table><caption>{result.totalCount.toLocaleString()} exact records · read {dateTime(result.readAt)}</caption><thead><tr>{COLUMNS[resource].map((column) => <th key={column.key} scope="col">{column.label}</th>)}{resource === 'exceptions' ? <th scope="col">Action</th> : null}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={String(row.id || row.exception_id || row.sku || row.order_number || index)}>{COLUMNS[resource].map((column) => <td key={column.key}>{column.format ? column.format(row[column.key], row) : display(row[column.key])}</td>)}{resource === 'exceptions' ? <td><ExceptionActions row={row} onDone={() => setReloadToken((value) => value + 1)} /></td> : null}</tr>)}</tbody></table>
      </div> : null}
      {!loading && !error ? <PageControls page={query.state.page} pageSize={query.state.pageSize} total={result.totalCount} onPage={(page) => query.update({ page }, { preservePage: true })} onPageSize={(pageSize) => query.update({ pageSize })} /> : null}
    </NativeWorkspaceFrame>
  );
}

function rowString(row: Record<string, unknown>, key: string) { return typeof row[key] === 'string' ? row[key] as string : ''; }
function rowNumber(row: Record<string, unknown>, key: string) { const value = Number(row[key]); return Number.isFinite(value) ? value : 0; }

export function WarehouseControlWorkspace({ role }: { role: Role }) {
  const [records, setRecords] = useState<WarehouseControlRecord[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [tab, setTab] = useState<'stocktake' | 'move'>('stocktake');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const sessions = useMemo(() => records.filter((row) => row.record_kind === 'SESSION').map((row) => row.record_data), [records]);
  const locations = useMemo(() => records.filter((row) => row.record_kind === 'LOCATION').map((row) => row.record_data), [records]);
  const observations = useMemo(() => records.filter((row) => row.record_kind === 'OBSERVATION').map((row) => row.record_data), [records]);
  const balances = useMemo(() => records.filter((row) => row.record_kind === 'BALANCE').map((row) => row.record_data), [records]);
  const selectedSession = sessions.find((row) => rowString(row, 'id') === sessionId);
  const canApprove = role === 'owner' || role === 'admin';

  const load = useCallback(async (selected = sessionId) => {
    try {
      const next = await readWarehouseControl(selected || null);
      setRecords(next);
      setMessage('');
      if (!selected) {
        const first = next.find((row) => row.record_kind === 'SESSION');
        if (first) setSessionId(rowString(first.record_data, 'id'));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId]);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (sessionId) void load(sessionId); }, [sessionId]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try { await task(); setMessage('Command applied.'); await load(sessionId); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await startStocktake({
      sessionType: String(form.get('sessionType')) as 'INITIAL' | 'CYCLE_COUNT',
      title: String(form.get('title') || ''),
      rackId: String(form.get('rackId') || '') || null,
      blindCount: form.get('blindCount') === 'on',
      reason: String(form.get('reason') || ''),
    });
    if (result?.session_id) setSessionId(String(result.session_id));
  }

  async function addObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await recordStocktakeObservation({
      sessionId,
      locationCode: String(form.get('locationCode') || ''),
      sku: String(form.get('sku') || ''),
      productName: String(form.get('productName') || '') || null,
      barcode: String(form.get('barcode') || '') || null,
      unitLevel: String(form.get('unitLevel')) as 'carton' | 'sleeve' | 'each',
      unitsPerPackage: Number(form.get('unitsPerPackage')),
      quantityPackages: Number(form.get('quantityPackages')),
      note: String(form.get('note') || '') || null,
    });
    event.currentTarget.reset();
  }

  async function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await moveWarehouseSku({
      sourceLocation: String(form.get('sourceLocation') || ''),
      destinationLocation: String(form.get('destinationLocation') || ''),
      sku: String(form.get('sku') || ''),
      unitLevel: String(form.get('unitLevel')) as 'carton' | 'sleeve' | 'each',
      quantity: Number(form.get('quantity')),
      moveAll: form.get('moveAll') === 'on',
      expectedSourceQuantity: Number(form.get('expectedSourceQuantity')),
      reason: String(form.get('reason') || ''),
    });
    event.currentTarget.reset();
  }

  return (
    <NativeWorkspaceFrame eyebrow="PHYSICAL TRUTH CONTROL" title="Warehouse Control" description="Initial opening stock, cycle counts and SKU transfers use audited server transactions. Layout editing never moves stock." actions={<><a className="soft-button" href="/warehouse-map">Warehouse Map</a><button type="button" onClick={() => void load(sessionId)}>Reload</button></>}>
      <div className="native-workspace-tabs"><button className={tab === 'stocktake' ? 'active' : ''} type="button" onClick={() => setTab('stocktake')}>Initial / Cycle Count</button><button className={tab === 'move' ? 'active' : ''} type="button" onClick={() => setTab('move')}>Move SKU</button></div>
      {message ? <div className="native-workspace-notice">{message}</div> : null}
      {tab === 'stocktake' ? <>
        <section className="native-control-grid">
          <form className="native-control-card" onSubmit={(event) => void run(() => createSession(event))}>
            <h2>1. Start count session</h2>
            <label>Type<select name="sessionType"><option value="INITIAL">Initial opening stocktake</option><option value="CYCLE_COUNT">Cycle count</option></select></label>
            <label>Title<input name="title" required maxLength={160} placeholder="Rack A3 opening count" /></label>
            <label>Rack / area<input name="rackId" maxLength={80} /></label>
            <label className="check-row"><input name="blindCount" type="checkbox" /> Blind count</label>
            <label>Reason<textarea name="reason" required /></label>
            <button className="primary-button" disabled={busy}>Start session</button>
          </form>
          <section className="native-control-card">
            <h2>Active session</h2>
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Select session…</option>{sessions.map((session) => <option key={rowString(session, 'id')} value={rowString(session, 'id')}>{rowString(session, 'title')} · {rowString(session, 'session_status')}</option>)}</select>
            {selectedSession ? <dl><dt>Type</dt><dd>{display(selectedSession.session_type)}</dd><dt>Status</dt><dd>{display(selectedSession.session_status)}</dd><dt>Revision</dt><dd>{display(selectedSession.revision)}</dd><dt>Blind count</dt><dd>{display(selectedSession.blind_count)}</dd></dl> : <p>No session selected.</p>}
          </section>
        </section>
        {sessionId ? <>
          <form className="native-control-card native-observation-form" onSubmit={(event) => void run(() => addObservation(event))}>
            <h2>2. Record physical observation</h2>
            <label>Location<input name="locationCode" required placeholder="A3-01-03A-L" /></label>
            <label>SKU<input name="sku" required /></label>
            <label>Product<input name="productName" /></label>
            <label>Barcode<input name="barcode" /></label>
            <label>Package level<select name="unitLevel"><option value="carton">Carton</option><option value="sleeve">Sleeve</option><option value="each">Each</option></select></label>
            <label>Units per package<input name="unitsPerPackage" type="number" min="1" step="1" defaultValue="1" required /></label>
            <label>Packages counted<input name="quantityPackages" type="number" min="0" step="1" required /></label>
            <label>Note<input name="note" /></label>
            <button className="primary-button" disabled={busy}>Save observation only</button>
          </form>
          <section className="native-control-card">
            <h2>3. Location progress</h2>
            <div className="native-progress-list">{locations.map((location) => <article key={rowString(location, 'location_code')}><div><strong>{rowString(location, 'location_code')}</strong><span>{rowString(location, 'progress_status')}</span><small>{rowNumber(location, 'observation_count')} observations · {rowNumber(location, 'exception_count')} exceptions</small></div><div className="row-actions"><button type="button" disabled={busy || rowString(location, 'progress_status') === 'COMPLETE'} onClick={() => void run(() => completeStocktakeLocation({ sessionId, locationCode: rowString(location, 'location_code'), reason: 'Physical location count completed' }))}>Complete</button>{canApprove && ['COMPLETE', 'APPROVED'].includes(rowString(location, 'progress_status')) ? <button type="button" onClick={() => { const reason = window.prompt('Mandatory reopen reason'); if (reason) void run(() => reopenStocktakeLocation({ sessionId, locationCode: rowString(location, 'location_code'), reason })); }}>Reopen</button> : null}</div></article>)}</div>
          </section>
          <section className="native-control-card">
            <h2>4. Exception review</h2>
            <div className="native-progress-list">{observations.filter((row) => Array.isArray(row.exception_codes) && row.exception_codes.length > 0).map((observation) => <article key={rowString(observation, 'id')}><div><strong>{rowString(observation, 'location_code')} · {rowString(observation, 'sku')}</strong><span>{display(observation.exception_codes)}</span><small>{rowString(observation, 'review_status')}</small></div>{canApprove ? <div className="row-actions"><button type="button" onClick={() => { const note = window.prompt('Supervisor review note'); if (note) void run(() => reviewStocktakeObservation({ observationId: rowString(observation, 'id'), accept: true, note })); }}>Accept evidence</button><button type="button" onClick={() => { const note = window.prompt('Recount instruction'); if (note) void run(() => reviewStocktakeObservation({ observationId: rowString(observation, 'id'), accept: false, note })); }}>Require recount</button></div> : null}</article>)}</div>
          </section>
          <section className="native-control-card native-approval-card">
            <h2>5. Submit and approve one batch</h2>
            <p>Submission requires every started location to be complete. Approval writes the audited opening or cycle-count adjustments.</p>
            <div className="row-actions"><button type="button" disabled={busy || !selectedSession || rowString(selectedSession, 'session_status') !== 'IN_PROGRESS'} onClick={() => void run(() => submitStocktake(sessionId, 'All location counts completed and submitted for supervisor review'))}>Submit for review</button>{canApprove ? <button className="primary-button" type="button" disabled={busy || !selectedSession || rowString(selectedSession, 'session_status') !== 'REVIEW'} onClick={() => { const note = window.prompt('Mandatory supervisor approval note'); if (note) void run(() => approveStocktake({ sessionId, expectedRevision: rowNumber(selectedSession, 'revision'), approvalNote: note })); }}>Approve and post balances</button> : null}</div>
          </section>
        </> : null}
      </> : <>
        <form className="native-control-card native-move-form" onSubmit={(event) => void run(() => move(event))}>
          <h2>Move SKU transaction</h2>
          <p>One transfer reference links the source and destination legs. The command fails if the source balance changed after you loaded it.</p>
          <label>Source location<input name="sourceLocation" required /></label>
          <label>Destination location<input name="destinationLocation" required /></label>
          <label>SKU<input name="sku" required /></label>
          <label>Unit<select name="unitLevel"><option value="carton">Carton</option><option value="sleeve">Sleeve</option><option value="each">Each</option></select></label>
          <label>Expected source quantity<input name="expectedSourceQuantity" type="number" min="0" step="1" required /></label>
          <label>Quantity to move<input name="quantity" type="number" min="1" step="1" required /></label>
          <label className="check-row"><input name="moveAll" type="checkbox" /> Move all current source quantity</label>
          <label>Mandatory reason<textarea name="reason" required /></label>
          <button className="primary-button" disabled={busy}>Apply paired transfer</button>
        </form>
        <section className="native-control-card"><h2>Live approved balances</h2><div className="native-server-table"><table><thead><tr><th>Location</th><th>SKU</th><th>Product</th><th>On hand</th></tr></thead><tbody>{balances.slice(0, 100).map((balance, index) => <tr key={`${rowString(balance, 'location')}:${rowString(balance, 'sku')}:${index}`}><td>{display(balance.location)}</td><td>{display(balance.sku)}</td><td>{display(balance.product_name)}</td><td>{display(balance.on_hand_location)}</td></tr>)}</tbody></table></div></section>
      </>}
    </NativeWorkspaceFrame>
  );
}

export function OperationalSettingsWorkspace({ profile }: { profile: EcoFlowAuthProfile }) {
  const [state, setState] = useState<QuickActionState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try { const next = await readQuickActions(); setState(next); setSelected(next.actionKeys); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function toggle(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : current.length < 4 ? [...current, key] : current);
  }

  async function save() {
    try { await setQuickActions(selected, state?.source === 'USER' ? state.revision : 0); setMessage('Quick Actions saved to your authenticated user profile.'); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <NativeWorkspaceFrame eyebrow="PERSONAL OPERATIONS" title="Profile & Quick Actions" description="Preferences are stored against the authenticated user. They are not shared browser state and cannot bypass route capabilities.">
    <section className="native-profile-card"><div className="native-profile-avatar">{(profile.display_name || profile.email).slice(0, 1).toUpperCase()}</div><div><h2>{profile.display_name || profile.email}</h2><p>{profile.email}</p><span className="status-chip">{profile.app_role}</span><span className="status-chip">{profile.team_status}</span></div></section>
    <section className="native-control-card"><header><div><h2>Quick Actions</h2><p>Select up to four navigation shortcuts.</p></div><span>{selected.length}/4</span></header><div className="native-quick-action-grid">{QUICK_ACTIONS.map(([key, label]) => <label key={key} className={selected.includes(key) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(key)} disabled={!selected.includes(key) && selected.length >= 4} onChange={() => toggle(key)} />{label}</label>)}</div><button className="primary-button" type="button" onClick={() => void save()}>Save my Quick Actions</button><small>{state ? `${state.source.replace('_', ' ')} · revision ${state.revision}` : 'Loading effective preferences…'}</small>{message ? <div className="native-workspace-notice">{message}</div> : null}</section>
  </NativeWorkspaceFrame>;
}
