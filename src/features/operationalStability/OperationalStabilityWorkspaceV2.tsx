import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import type { Role } from '@/domain/types';
import { UnleashedReadonlyProbePanel } from '@/features/settings/UnleashedReadonlyProbePanel';
import { supabase } from '@/lib/supabaseClient';
import {
  NativeWorkspaceEmpty,
  NativeWorkspaceFrame,
  NativeWorkspaceLoading,
  NativeWorkspaceUnavailable,
} from '@/features/navigation/NativeWorkspaceFrame';
import { useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';
import { savedViewRepository } from '@/data/repositories/savedViewRepository';
import type {
  SavedViewRecord,
  SavedViewState,
  SavedViewWorkspace,
} from '@/features/intelligence/analytics/productivity/productivityContract';
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

type PageSize = (typeof PAGE_SIZES)[number];
type QueryController = ReturnType<typeof useWorkspaceQueryState>;
type DataRow = Record<string, unknown>;
type Column = {
  key: string;
  label: string;
  format?: (value: unknown, row: DataRow) => string;
};

type PagedWorkspaceProps = {
  resource: OperationalPageResource;
  role: Role;
  profile: EcoFlowAuthProfile;
  businessDay: string;
};

const QUICK_ACTION_OPTIONS = [
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

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatAdelaide(value: unknown) {
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

function formatAge(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return `${Math.max(0, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const COLUMNS: Record<OperationalPageResource, readonly Column[]> = {
  orders: [
    { key: 'order_number', label: 'Order' },
    { key: 'invoice_number', label: 'Invoice' },
    { key: 'order_status', label: 'Source status' },
    { key: 'payment_status', label: 'Payment' },
    { key: 'order_items_total', label: 'Order value' },
    { key: 'order_updated_at', label: 'Updated', format: formatAdelaide },
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
    { key: 'latest_location_movement_at', label: 'Latest movement', format: formatAdelaide },
  ],
  exceptions: [
    { key: 'order_number', label: 'Order' },
    { key: 'exception_type', label: 'Cause' },
    { key: 'category', label: 'Category' },
    { key: 'severity', label: 'Severity' },
    { key: 'age_seconds', label: 'Age', format: formatAge },
    { key: 'owner_team', label: 'Owner' },
    { key: 'due_at', label: 'Due', format: formatAdelaide },
    { key: 'lifecycle_status', label: 'Lifecycle' },
  ],
  logs: [
    { key: 'moved_at', label: 'Time', format: formatAdelaide },
    { key: 'movement_type', label: 'Movement' },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'from_location', label: 'From' },
    { key: 'to_location', label: 'To' },
    { key: 'reference_type', label: 'Reference type' },
    { key: 'reference_id', label: 'Reference' },
  ],
};

const TITLES: Record<OperationalPageResource, { title: string; detail: string }> = {
  orders: {
    title: 'Orders',
    detail: 'Server-paged current Ordermentum work. URL state preserves search, filter, sort and page.',
  },
  stores: {
    title: 'Customers',
    detail: 'Server-paged Store master records. Commercial facts remain read-only and Ordermentum-owned.',
  },
  inventory: {
    title: 'Inventory',
    detail: 'Server-paged approved physical balances. Counts appear only after governed supervisor approval.',
  },
  exceptions: {
    title: 'Exception Action Queue',
    detail: 'Open exceptions include age, owner, category, severity policy, due time and governed lifecycle actions.',
  },
  logs: {
    title: 'Operational Logs',
    detail: 'Server-paged immutable inventory and warehouse movement history.',
  },
};

function defaultSort(resource: OperationalPageResource) {
  if (resource === 'exceptions') return 'oldest';
  if (resource === 'inventory') return 'quantity-desc';
  if (resource === 'stores') return 'suburb';
  return 'latest';
}

function allowedFilters(resource: OperationalPageResource) {
  if (resource === 'orders') return ['', 'placed', 'processing', 'ready', 'paid', 'unpaid'] as const;
  if (resource === 'exceptions') return ['', 'open', 'acknowledged', 'snoozed'] as const;
  return [''] as const;
}

function savedWorkspace(resource: OperationalPageResource): SavedViewWorkspace | null {
  if (resource === 'orders') return 'orders';
  if (resource === 'stores') return 'customers';
  if (resource === 'inventory') return 'inventory';
  return null;
}

function currentSavedState(resource: OperationalPageResource, query: QueryController): SavedViewState {
  return {
    filters: query.state.filter ? [`filter:${query.state.filter}`] : [],
    sort: query.state.sort || null,
    visibleColumns: COLUMNS[resource].map((column) => column.key),
    dateRange: null,
    comparisonSettings: [],
    searchTerm: query.state.search || null,
  };
}

function PageControls({
  page,
  pageSize,
  totalRows,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  totalRows: number;
  onPage: (next: number) => void;
  onPageSize: (next: PageSize) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  return (
    <nav className="native-workspace-pager" aria-label="Server pagination">
      <span>{totalRows.toLocaleString()} exact records · Page {safePage} of {totalPages}</span>
      <div className="row-actions">
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} rows</option>)}
        </select>
        <button type="button" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>Previous</button>
        <button type="button" disabled={safePage >= totalPages} onClick={() => onPage(safePage + 1)}>Next</button>
      </div>
    </nav>
  );
}

function SavedViewsBar({
  resource,
  query,
}: {
  resource: OperationalPageResource;
  query: QueryController;
}) {
  const workspace = savedWorkspace(resource);
  const [views, setViews] = useState<readonly SavedViewRecord[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!workspace) return;
    const result = await savedViewRepository.readSavedViews(workspace);
    if (result.ok) {
      setViews(result.data);
      setMessage('');
    } else {
      setMessage(result.error.message);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);
  if (!workspace) return null;

  async function save() {
    const cleanName = name.trim();
    if (!cleanName) return;
    const result = await savedViewRepository.applyCommand({
      action: 'CREATE',
      workspace,
      name: cleanName,
      state: currentSavedState(resource, query),
    });
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setName('');
    setMessage('Saved to your authenticated profile.');
    await load();
  }

  function apply(viewId: string) {
    const view = views.find((candidate) => candidate.savedViewId === viewId);
    if (!view) return;
    const filter = view.state.filters.find((candidate) => candidate.startsWith('filter:'))?.slice(7) || '';
    query.update({
      search: view.state.searchTerm || '',
      filter,
      sort: view.state.sort || defaultSort(resource),
      page: 1,
    });
  }

  return (
    <section className="native-saved-views" aria-label="Saved views">
      <strong>Saved views</strong>
      <select aria-label="Apply saved view" defaultValue="" onChange={(event) => apply(event.target.value)}>
        <option value="">Choose a view…</option>
        {views.map((view) => (
          <option key={view.savedViewId} value={view.savedViewId}>
            {view.name}{view.isRoleDefault ? ' · role default' : ''}
          </option>
        ))}
      </select>
      <input value={name} maxLength={80} placeholder="New view name" onChange={(event) => setName(event.target.value)} />
      <button type="button" onClick={() => void save()}>Save current view</button>
      {message ? <small>{message}</small> : null}
    </section>
  );
}

function ExceptionActions({ row, onApplied }: { row: DataRow; onApplied: () => void }) {
  const exceptionId = text(row.exception_id);
  const [ownerTeam, setOwnerTeam] = useState(text(row.owner_team) || 'Operations queue');
  const [resolutionNote, setResolutionNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(action: 'ACKNOWLEDGE' | 'ASSIGN' | 'RESOLVE') {
    if (!exceptionId) return;
    setBusy(true);
    setMessage('');
    const result = await actionableExceptionLifecycleRepository.applyCommand({
      commandId: crypto.randomUUID(),
      exceptionId,
      action,
      ownerTeam: action === 'ASSIGN' ? ownerTeam : null,
      resolutionNote: action === 'RESOLVE' ? resolutionNote : null,
    });
    if (!result.ok) {
      setMessage(result.error.message);
      setBusy(false);
      return;
    }
    setMessage(`${action} applied.`);
    setBusy(false);
    onApplied();
  }

  if (!exceptionId) return <span>Unavailable</span>;
  return (
    <details className="native-exception-actions">
      <summary>Manage</summary>
      <div className="row-actions">
        <button type="button" disabled={busy} onClick={() => void apply('ACKNOWLEDGE')}>Acknowledge</button>
        <input aria-label="Owner team" value={ownerTeam} maxLength={80} onChange={(event) => setOwnerTeam(event.target.value)} />
        <button type="button" disabled={busy || !ownerTeam.trim()} onClick={() => void apply('ASSIGN')}>Assign</button>
      </div>
      <textarea
        aria-label="Resolution note"
        value={resolutionNote}
        maxLength={2000}
        placeholder="Mandatory resolution note"
        onChange={(event) => setResolutionNote(event.target.value)}
      />
      <button type="button" disabled={busy || !resolutionNote.trim()} onClick={() => void apply('RESOLVE')}>Resolve with note</button>
      {message ? <small>{message}</small> : null}
    </details>
  );
}

function BusinessDayClosePanel({ businessDay, role }: { businessDay: string; role: Role }) {
  const [checks, setChecks] = useState<Array<{
    check_key: string;
    check_status: string;
    detail: string;
    blocking: boolean;
    read_at: string;
  }>>([]);
  const [nextBusinessDay, setNextBusinessDay] = useState(() => {
    const date = new Date(`${businessDay}T12:00:00+09:30`);
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('Daily operational reconciliation completed');
  const [acknowledgement, setAcknowledgement] = useState('Accounts variance reviewed and acknowledged.');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mayClose = role === 'owner' || role === 'admin';

  const load = useCallback(async () => {
    try {
      setChecks(await readBusinessDayCloseReadiness(businessDay));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [businessDay]);

  useEffect(() => { void load(); }, [load]);
  const blocking = checks.some((check) => check.blocking && check.check_key !== 'ACCOUNTS_VARIANCE');

  async function closeDay() {
    setBusy(true);
    try {
      const result = await completeBusinessDayClose({
        businessDay,
        nextBusinessDay,
        expectedRevision: 0,
        reason,
        acknowledgementNote: acknowledgement,
      });
      setMessage(`Business Day Close ${display(result?.close_status)} · ${display(result?.carry_over_count)} carry-over records.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="native-close-panel">
      <header>
        <div><span className="eyebrow">ADELAIDE BUSINESS DAY</span><h2>Close readiness</h2></div>
        <button type="button" onClick={() => void load()}>Refresh checks</button>
      </header>
      <div className="native-close-checks">
        {checks.map((check) => (
          <article key={check.check_key} className={check.blocking ? 'blocking' : ''}>
            <strong>{check.check_key.replaceAll('_', ' ')}</strong>
            <span>{check.check_status}</span>
            <p>{check.detail}</p>
          </article>
        ))}
      </div>
      {mayClose ? (
        <div className="native-close-form">
          <label>Next business day<input type="date" min={businessDay} value={nextBusinessDay} onChange={(event) => setNextBusinessDay(event.target.value)} /></label>
          <label>Close reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label>Accounts variance acknowledgement<textarea value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)} /></label>
          <button
            className="primary-button"
            type="button"
            disabled={busy || blocking || !reason.trim() || !acknowledgement.trim()}
            onClick={() => void closeDay()}
          >Close and carry forward</button>
        </div>
      ) : <p>Owner or Admin approval is required to close the business day.</p>}
      {message ? <div className="native-workspace-notice">{message}</div> : null}
    </section>
  );
}

export function OperationalPagedWorkspace({ resource, role, profile, businessDay }: PagedWorkspaceProps) {
  const query = useWorkspaceQueryState({
    tab: 'list',
    search: '',
    filter: '',
    sort: defaultSort(resource),
    page: 1,
    pageSize: 25,
    allowedTabs: ['list', 'close'],
    allowedFilters: allowedFilters(resource),
    allowedSorts: ['latest', 'oldest', 'suburb', 'quantity-desc'],
    allowedPageSizes: PAGE_SIZES,
  });
  const [result, setResult] = useState<OperationalPageResult>({ rows: [], totalCount: 0, readAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await readOperationalPage({
        resource,
        page: query.state.page,
        pageSize: query.state.pageSize as PageSize,
        search: query.state.search,
        filter: query.state.filter,
        sort: query.state.sort,
      }));
      setError('');
    } catch (loadError) {
      setResult({ rows: [], totalCount: 0, readAt: null });
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [query.state.filter, query.state.page, query.state.pageSize, query.state.search, query.state.sort, reloadKey, resource]);

  useEffect(() => { void load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil(result.totalCount / query.state.pageSize));
  useEffect(() => {
    if (!loading && query.state.page > totalPages) query.update({ page: totalPages }, { replace: true, preservePage: true });
  }, [loading, query, totalPages]);

  if (resource === 'exceptions' && query.state.tab === 'close') {
    return (
      <NativeWorkspaceFrame
        eyebrow="CONTROL & RECONCILIATION"
        title="Business Day Close"
        detail="Review sync, exception ownership, picking, staging, routes and accounts variance before explicit carry-over."
        actions={<button type="button" onClick={() => query.update({ tab: 'list' })}>Back to queue</button>}
      >
        <BusinessDayClosePanel businessDay={businessDay} role={role} />
      </NativeWorkspaceFrame>
    );
  }

  const title = TITLES[resource];
  return (
    <NativeWorkspaceFrame
      eyebrow="SERVER-AUTHORITATIVE OPERATIONS"
      title={title.title}
      detail={title.detail}
      actions={(
        <>
          <span className="status-chip">{profile.app_role}</span>
          {resource === 'exceptions' ? <button type="button" onClick={() => query.update({ tab: 'close' })}>Business Day Close</button> : null}
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Reload</button>
        </>
      )}
    >
      <div className="native-workspace-toolbar">
        <label><span>Search</span><input value={query.state.search} placeholder={`Search ${title.title.toLowerCase()}`} onChange={(event) => query.update({ search: event.target.value })} /></label>
        <label><span>Filter</span><select value={query.state.filter} onChange={(event) => query.update({ filter: event.target.value })}>{allowedFilters(resource).map((filter) => <option key={filter || 'all'} value={filter}>{filter || 'All'}</option>)}</select></label>
        <label><span>Sort</span><select value={query.state.sort} onChange={(event) => query.update({ sort: event.target.value })}><option value="latest">Latest</option><option value="oldest">Oldest</option>{resource === 'stores' ? <option value="suburb">Suburb</option> : null}{resource === 'inventory' ? <option value="quantity-desc">Quantity high to low</option> : null}</select></label>
        <button type="button" onClick={query.clear}>Clear URL state</button>
      </div>
      <SavedViewsBar resource={resource} query={query} />
      {loading ? <NativeWorkspaceLoading label={title.title.toLowerCase()} /> : null}
      {!loading && error ? <NativeWorkspaceUnavailable label={title.title} detail={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {!loading && !error && result.rows.length === 0 ? <NativeWorkspaceEmpty title="No matching records" detail="The server query completed successfully and returned an empty page." /> : null}
      {!loading && !error && result.rows.length > 0 ? (
        <div className="native-server-table" role="region" aria-label={`${title.title} results`} tabIndex={0}>
          <table>
            <caption>{result.totalCount.toLocaleString()} exact records · read {formatAdelaide(result.readAt)}</caption>
            <thead><tr>{COLUMNS[resource].map((column) => <th key={column.key} scope="col">{column.label}</th>)}{resource === 'exceptions' ? <th scope="col">Action</th> : null}</tr></thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={text(row.id) || text(row.exception_id) || `${text(row.sku)}:${text(row.location)}:${index}`}>
                  {COLUMNS[resource].map((column) => <td key={column.key}>{column.format ? column.format(row[column.key], row) : display(row[column.key])}</td>)}
                  {resource === 'exceptions' ? <td><ExceptionActions row={row} onApplied={() => setReloadKey((value) => value + 1)} /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!loading && !error ? (
        <PageControls
          page={query.state.page}
          pageSize={query.state.pageSize}
          totalRows={result.totalCount}
          onPage={(page) => query.update({ page }, { preservePage: true })}
          onPageSize={(pageSize) => query.update({ pageSize })}
        />
      ) : null}
    </NativeWorkspaceFrame>
  );
}

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
  const selectedSession = sessions.find((row) => text(row.id) === sessionId) ?? null;
  const canApprove = role === 'owner' || role === 'admin';

  const load = useCallback(async (selectedId?: string) => {
    try {
      const effectiveId = selectedId ?? sessionId;
      const next = await readWarehouseControl(effectiveId || null);
      setRecords(next);
      setMessage('');
      if (!effectiveId) {
        const firstSession = next.find((row) => row.record_kind === 'SESSION');
        const firstId = firstSession ? text(firstSession.record_data.id) : '';
        if (firstId) setSessionId(firstId);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId]);

  useEffect(() => { void load(''); }, []);
  useEffect(() => { if (sessionId) void load(sessionId); }, [sessionId]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
      setMessage('Command applied.');
      await load(sessionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await startStocktake({
      sessionType: String(form.get('sessionType')) as 'INITIAL' | 'CYCLE_COUNT',
      title: String(form.get('title') || ''),
      rackId: String(form.get('rackId') || '') || null,
      blindCount: form.get('blindCount') === 'on',
      reason: String(form.get('reason') || ''),
    });
    const createdId = result ? text(result.session_id) : '';
    if (createdId) setSessionId(createdId);
    formElement.reset();
  }

  async function addObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
    formElement.reset();
  }

  async function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
    formElement.reset();
  }

  return (
    <NativeWorkspaceFrame
      eyebrow="PHYSICAL TRUTH CONTROL"
      title="Warehouse Control"
      detail="Initial stock, cycle counts and SKU transfers use audited server transactions. Edit Layout never moves stock."
      actions={<><a className="soft-button" href="/warehouse-map">Warehouse Map</a><button type="button" onClick={() => void load(sessionId)}>Reload</button></>}
    >
      <div className="native-workspace-tabs">
        <button className={tab === 'stocktake' ? 'active' : ''} type="button" onClick={() => setTab('stocktake')}>Initial / Cycle Count</button>
        <button className={tab === 'move' ? 'active' : ''} type="button" onClick={() => setTab('move')}>Move SKU</button>
      </div>
      {message ? <div className="native-workspace-notice">{message}</div> : null}
      {tab === 'stocktake' ? (
        <>
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
              <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
                <option value="">Select session…</option>
                {sessions.map((session) => <option key={text(session.id)} value={text(session.id)}>{text(session.title)} · {text(session.session_status)}</option>)}
              </select>
              {selectedSession ? (
                <dl>
                  <dt>Type</dt><dd>{display(selectedSession.session_type)}</dd>
                  <dt>Status</dt><dd>{display(selectedSession.session_status)}</dd>
                  <dt>Revision</dt><dd>{display(selectedSession.revision)}</dd>
                  <dt>Blind count</dt><dd>{display(selectedSession.blind_count)}</dd>
                </dl>
              ) : <p>No session selected.</p>}
            </section>
          </section>
          {sessionId ? (
            <>
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
                <div className="native-progress-list">
                  {locations.map((location) => {
                    const locationCode = text(location.location_code);
                    const status = text(location.progress_status);
                    return (
                      <article key={locationCode}>
                        <div><strong>{locationCode}</strong><span>{status}</span><small>{numberValue(location.observation_count)} observations · {numberValue(location.exception_count)} exceptions</small></div>
                        <div className="row-actions">
                          <button type="button" disabled={busy || status === 'COMPLETE' || status === 'APPROVED'} onClick={() => void run(() => completeStocktakeLocation({ sessionId, locationCode, reason: 'Physical location count completed' }))}>Complete</button>
                          {canApprove && (status === 'COMPLETE' || status === 'APPROVED') ? <button type="button" onClick={() => { const reason = window.prompt('Mandatory reopen reason'); if (reason) void run(() => reopenStocktakeLocation({ sessionId, locationCode, reason })); }}>Reopen</button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
              <section className="native-control-card">
                <h2>4. Exception review</h2>
                <div className="native-progress-list">
                  {observations.filter((observation) => Array.isArray(observation.exception_codes) && observation.exception_codes.length > 0).map((observation) => {
                    const observationId = text(observation.id);
                    return (
                      <article key={observationId}>
                        <div><strong>{text(observation.location_code)} · {text(observation.sku)}</strong><span>{display(observation.exception_codes)}</span><small>{text(observation.review_status)}</small></div>
                        {canApprove ? <div className="row-actions"><button type="button" onClick={() => { const note = window.prompt('Supervisor review note'); if (note) void run(() => reviewStocktakeObservation({ observationId, accept: true, note })); }}>Accept evidence</button><button type="button" onClick={() => { const note = window.prompt('Recount instruction'); if (note) void run(() => reviewStocktakeObservation({ observationId, accept: false, note })); }}>Require recount</button></div> : null}
                      </article>
                    );
                  })}
                </div>
              </section>
              <section className="native-control-card native-approval-card">
                <h2>5. Submit and approve one batch</h2>
                <p>Submission requires all started locations complete. Approval posts audited opening or cycle-count adjustments.</p>
                <div className="row-actions">
                  <button type="button" disabled={busy || !selectedSession || text(selectedSession.session_status) !== 'IN_PROGRESS'} onClick={() => void run(() => submitStocktake(sessionId, 'All location counts completed and submitted for supervisor review'))}>Submit for review</button>
                  {canApprove ? <button className="primary-button" type="button" disabled={busy || !selectedSession || text(selectedSession.session_status) !== 'REVIEW'} onClick={() => { if (!selectedSession) return; const note = window.prompt('Mandatory supervisor approval note'); if (note) void run(() => approveStocktake({ sessionId, expectedRevision: numberValue(selectedSession.revision), approvalNote: note })); }}>Approve and post balances</button> : null}
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : (
        <>
          <form className="native-control-card native-move-form" onSubmit={(event) => void run(() => move(event))}>
            <h2>Move SKU transaction</h2>
            <p>One transfer reference links source and destination legs. The command fails if the source balance changed after loading.</p>
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
          <section className="native-control-card">
            <h2>Live approved balances</h2>
            <div className="native-server-table"><table><thead><tr><th>Location</th><th>SKU</th><th>Product</th><th>On hand</th></tr></thead><tbody>{balances.slice(0, 100).map((balance, index) => <tr key={`${text(balance.location)}:${text(balance.sku)}:${index}`}><td>{display(balance.location)}</td><td>{display(balance.sku)}</td><td>{display(balance.product_name)}</td><td>{display(balance.on_hand_location)}</td></tr>)}</tbody></table></div>
          </section>
        </>
      )}
    </NativeWorkspaceFrame>
  );
}

export function OperationalSettingsWorkspace({ profile }: { profile: EcoFlowAuthProfile }) {
  const [effective, setEffective] = useState<QuickActionState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await readQuickActions();
      setEffective(next);
      setSelected(next.actionKeys);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(key: string) {
    setSelected((current) => {
      if (current.includes(key)) return current.filter((candidate) => candidate !== key);
      return current.length < 4 ? [...current, key] : current;
    });
  }

  async function save() {
    try {
      await setQuickActions(selected, effective?.source === 'USER' ? effective.revision : 0);
      setMessage('Quick Actions saved to your authenticated user profile.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const name = String(profile.display_name || profile.email || 'EcoFlow user');
  const canTestUnleashed = profile.is_active
    && profile.team_status === 'ACTIVE'
    && (profile.app_role === 'OWNER' || profile.app_role === 'ADMIN');
  return (
    <NativeWorkspaceFrame
      eyebrow="PERSONAL OPERATIONS"
      title="Profile & Quick Actions"
      detail="Preferences are tied to the authenticated user and filtered through typed route capabilities."
    >
      <section className="native-profile-card">
        <div className="native-profile-avatar">{name.slice(0, 1).toUpperCase()}</div>
        <div><h2>{name}</h2><p>{profile.email}</p><span className="status-chip">{profile.app_role}</span><span className="status-chip">{profile.team_status}</span></div>
      </section>
      <section className="native-control-card">
        <header><div><h2>Quick Actions</h2><p>Select up to four navigation shortcuts.</p></div><span>{selected.length}/4</span></header>
        <div className="native-quick-action-grid">
          {QUICK_ACTION_OPTIONS.map(([key, label]) => <label key={key} className={selected.includes(key) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(key)} disabled={!selected.includes(key) && selected.length >= 4} onChange={() => toggle(key)} />{label}</label>)}
        </div>
        <button className="primary-button" type="button" onClick={() => void save()}>Save my Quick Actions</button>
        <small>{effective ? `${effective.source.replace('_', ' ')} · revision ${effective.revision}` : 'Loading effective preferences…'}</small>
        {message ? <div className="native-workspace-notice">{message}</div> : null}
      </section>
      {canTestUnleashed && supabase ? <UnleashedReadonlyProbePanel supabase={supabase} /> : null}
    </NativeWorkspaceFrame>
  );
}
