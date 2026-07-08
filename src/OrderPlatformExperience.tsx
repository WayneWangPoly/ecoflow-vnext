import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  loadCompletedArchivePreview,
  loadLegacyInternalReviewOrders,
  loadOrderPlatformGuardrails,
  loadOrderPlatformLatestOrders,
  type OrderPlatformGuardrailRow,
  type OrderPlatformLatestOrderRow,
} from '@/data/repositories/orderPlatform';

type PlatformMode = 'active' | 'legacy' | 'archive';

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  const parsed = numberValue(value);
  return parsed.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function guardrail(guardrails: OrderPlatformGuardrailRow[], name: string) {
  return guardrails.find((row) => row.check_name === name);
}

function statusTone(status: string | null | undefined) {
  if (status === 'READY_TO_INTERNALISE') return 'good';
  if (status === 'BLOCKED_MAPPING' || status === 'BLOCKED_DATA') return 'danger';
  if (status === 'PICKING' || status === 'STAGED') return 'blue';
  if (status === 'INTERNAL_ORDER_CREATED') return 'warn';
  if (status === 'COMPLETED') return 'blue';
  return 'neutral';
}

function modeTitle(mode: PlatformMode) {
  if (mode === 'legacy') return 'Legacy internal review';
  if (mode === 'archive') return 'Archive / history preview';
  return 'Active workflow';
}

function modeHelper(mode: PlatformMode) {
  if (mode === 'legacy') return 'Quarantined historical internal drafts. Review before archive, cancel, or rebuild.';
  if (mode === 'archive') return 'Completed and historical orders stay searchable but outside the hot path.';
  return 'Live operational orders only. This is the table operators should work from.';
}

function MiniPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`order-platform-pill order-platform-pill-${tone}`}>{children}</span>;
}

function PlatformMetric({ label, value, helper, intent = 'neutral' }: { label: string; value: string | number; helper: string; intent?: string }) {
  return (
    <article className={`order-platform-metric order-platform-metric-${intent}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{helper}</small>
    </article>
  );
}

function OrderCard({ order }: { order: OrderPlatformLatestOrderRow }) {
  return (
    <article className={`order-platform-order order-platform-order-${String(order.lifecycle_status || '').toLowerCase()}`}>
      <div>
        <strong>{order.order_number || order.lifecycle_id || 'Unknown order'}</strong>
        <span>{order.invoice_number || 'invoice pending'} · {money(order.invoice_total)}</span>
      </div>
      <MiniPill tone={statusTone(order.lifecycle_status)}>{title(order.lifecycle_status)}</MiniPill>
      <small>{[order.ordermentum_order_status, order.internalisation_status, order.warehouse_gate_status].filter(Boolean).join(' · ') || 'No lifecycle detail'} · {timeText(order.lifecycle_updated_at)}</small>
    </article>
  );
}

function orderSearchText(order: OrderPlatformLatestOrderRow) {
  return [
    order.lifecycle_id,
    order.order_number,
    order.invoice_number,
    order.ordermentum_order_status,
    order.ordermentum_invoice_status,
    order.internalisation_status,
    order.warehouse_gate_status,
    order.lifecycle_status,
    order.internal_order_id,
    order.platform_bucket,
  ].filter(Boolean).join(' ').toLowerCase();
}

function useOrdersPortalHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function locate() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Order control');
      const panel = heading?.closest<HTMLElement>('.panel');
      if (!panel) {
        setHost(null);
        return;
      }
      panel.classList.add('orders-control-native-panel-hidden');
      let mount = document.querySelector<HTMLElement>('.order-platform-react-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'order-platform-react-mount';
        panel.insertAdjacentElement('beforebegin', mount);
      }
      setHost(mount);
    }

    locate();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; locate(); }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return host;
}

function ReviewStrip({ title, helper, rows, tone }: { title: string; helper: string; rows: OrderPlatformLatestOrderRow[]; tone: 'warn' | 'blue' }) {
  return (
    <section className={`order-platform-review-panel order-platform-review-${tone}`}>
      <header>
        <div>
          <h3>{title}</h3>
          <p>{helper}</p>
        </div>
        <MiniPill tone={tone}>{rows.length}</MiniPill>
      </header>
      <div className="order-platform-review-list">
        {rows.slice(0, 8).map((order) => <OrderCard key={`${title}-${order.lifecycle_id}-${order.order_number}`} order={order} />)}
        {!rows.length ? <div className="order-platform-empty">No rows in this bucket.</div> : null}
      </div>
    </section>
  );
}

function CompactOrderTable({
  mode,
  rows,
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  pageSize,
  onPageSizeChange,
  page,
  onPageChange,
}: {
  mode: PlatformMode;
  rows: OrderPlatformLatestOrderRow[];
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  statusOptions: string[];
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  page: number;
  onPageChange: (value: number) => void;
}) {
  const filtered = rows.filter((order) => {
    const matchesText = !query.trim() || orderSearchText(order).includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || order.lifecycle_status === statusFilter;
    return matchesText && matchesStatus;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  return (
    <section className="order-platform-compact-table-panel">
      <div className="order-platform-table-headline">
        <div>
          <h3>{modeTitle(mode)}</h3>
          <p>{modeHelper(mode)}</p>
        </div>
        <MiniPill tone={mode === 'active' ? 'good' : mode === 'legacy' ? 'warn' : 'blue'}>{filtered.length} shown</MiniPill>
      </div>

      <div className="order-platform-toolbar">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search order, invoice, status, internal ID…" />
        <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          <option value="ALL">All statuses</option>
          {statusOptions.map((status) => <option value={status} key={status}>{title(status)}</option>)}
        </select>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          <option value={25}>25 rows</option>
          <option value={50}>50 rows</option>
          <option value={100}>100 rows</option>
        </select>
      </div>

      <div className="order-platform-table">
        <div className="order-platform-table-header">
          <span>Order</span><span>Bucket</span><span>Lifecycle</span><span>Internal</span><span>Updated</span><span>Value</span><span>Gate</span>
        </div>
        {pageRows.map((order) => (
          <article className="order-platform-table-row" key={`${mode}-${order.lifecycle_id}-${order.order_number}-${order.invoice_number}`}>
            <span><strong>{order.order_number || order.lifecycle_id || 'Unknown'}</strong><small>{order.invoice_number || 'invoice pending'}</small></span>
            <span><MiniPill tone={mode === 'active' ? 'good' : mode === 'legacy' ? 'warn' : 'blue'}>{order.platform_bucket || (mode === 'legacy' ? 'LEGACY_REVIEW' : mode === 'archive' ? 'ARCHIVE' : 'ACTIVE')}</MiniPill></span>
            <span><MiniPill tone={statusTone(order.lifecycle_status)}>{title(order.lifecycle_status)}</MiniPill><small>{[order.internalisation_status, order.warehouse_gate_status].filter(Boolean).join(' · ') || 'no detail'}</small></span>
            <span><strong>{order.internal_order_id ? 'Created' : 'Not created'}</strong><small>{order.internal_order_id || '—'}</small></span>
            <span>{timeText(order.lifecycle_updated_at)}</span>
            <span>{money(order.invoice_total)}</span>
            <span><MiniPill tone={order.can_internalise ? 'good' : 'neutral'}>{order.can_internalise ? 'CAN INTERNALISE' : 'LOCKED'}</MiniPill></span>
          </article>
        ))}
        {!pageRows.length ? <div className="order-platform-empty">No matching orders.</div> : null}
      </div>

      <div className="order-platform-pagination">
        <button type="button" onClick={() => onPageChange(Math.max(1, safePage - 1))} disabled={safePage <= 1}>Previous</button>
        <span>Page {safePage} of {pageCount} · {filtered.length} rows</span>
        <button type="button" onClick={() => onPageChange(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount}>Next</button>
      </div>
    </section>
  );
}

function OrderPlatformContent() {
  const [guardrails, setGuardrails] = useState<OrderPlatformGuardrailRow[]>([]);
  const [orders, setOrders] = useState<OrderPlatformLatestOrderRow[]>([]);
  const [legacyRows, setLegacyRows] = useState<OrderPlatformLatestOrderRow[]>([]);
  const [archiveRows, setArchiveRows] = useState<OrderPlatformLatestOrderRow[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mode, setMode] = useState<PlatformMode>('active');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextGuardrails, nextOrders, nextLegacy, nextArchive] = await Promise.all([
        loadOrderPlatformGuardrails(),
        loadOrderPlatformLatestOrders(),
        loadLegacyInternalReviewOrders(),
        loadCompletedArchivePreview(),
      ]);
      setGuardrails(nextGuardrails);
      setOrders(nextOrders);
      setLegacyRows(nextLegacy);
      setArchiveRows(nextArchive);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);
  useEffect(() => { setPage(1); }, [mode, query, statusFilter, pageSize]);

  const raw = guardrail(guardrails, 'ordermentum_raw_inbox');
  const active = guardrail(guardrails, 'orders_active_workflow');
  const legacy = guardrail(guardrails, 'legacy_internal_review');
  const archive = guardrail(guardrails, 'completed_archive');

  const activeSearchRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => orderSearchText(order).includes(needle));
  }, [orders, query]);

  const groups = useMemo(() => ({
    ready: activeSearchRows.filter((order) => order.lifecycle_status === 'READY_TO_INTERNALISE'),
    mapping: activeSearchRows.filter((order) => order.lifecycle_status === 'BLOCKED_MAPPING'),
    data: activeSearchRows.filter((order) => order.lifecycle_status === 'BLOCKED_DATA'),
    internal: activeSearchRows.filter((order) => order.lifecycle_status === 'INTERNAL_ORDER_CREATED'),
    warehouse: activeSearchRows.filter((order) => order.lifecycle_status === 'PICKING'),
    staged: activeSearchRows.filter((order) => order.lifecycle_status === 'STAGED'),
  }), [activeSearchRows]);

  const tableRows = mode === 'legacy' ? legacyRows : mode === 'archive' ? archiveRows : orders;
  const statusOptions = useMemo(() => Array.from(new Set(tableRows.map((row) => row.lifecycle_status).filter((status): status is string => Boolean(status)))).sort(), [tableRows]);

  return (
    <section className="order-platform-shell">
      <section className="order-platform-hero">
        <div>
          <span>ORDER PLATFORM CONTROL</span>
          <h2>Ordermentum intake stays broad. EcoFlow workflow stays clean.</h2>
          <p>Raw Ordermentum history is retained for audit/search. Active Orders only use lifecycle-gated rows that are safe for accounts, warehouse, and driver operations.</p>
        </div>
        <div className="order-platform-actions">
          <button type="button" onClick={() => void reload()}>Refresh platform state</button>
          <small>{loadedAt ? `checked ${timeText(loadedAt)}` : 'checking platform state'}</small>
        </div>
      </section>

      {error ? <div className="order-platform-error">{error}</div> : null}

      <section className="order-platform-metrics">
        <PlatformMetric label="Raw Ordermentum" value={numberValue(raw?.row_count)} helper="retained history; not a work queue" intent="neutral" />
        <PlatformMetric label="Active workflow" value={numberValue(active?.row_count)} helper={`${money(active?.total_value)} currently actionable`} intent="good" />
        <PlatformMetric label="Legacy review" value={numberValue(legacy?.row_count)} helper="held outside pick/route until owner review" intent="warn" />
        <PlatformMetric label="Archive" value={numberValue(archive?.row_count)} helper="completed/history out of hot path" intent="blue" />
      </section>

      <section className="order-platform-board">
        <div className="order-platform-board-head">
          <div>
            <h3>Active workflow lanes</h3>
            <p>Designed for a growing daily feed: search/filter the hot path, not the full archive.</p>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, invoice, status…" />
        </div>
        <div className="order-platform-lanes">
          {[
            ['ready', 'Ready to internalise', groups.ready, 'Safe to create internal order.'],
            ['mapping', 'Mapping blocked', groups.mapping, 'SKU/barcode/store mapping needs fixing.'],
            ['data', 'Data blocked', groups.data, 'Ordermentum detail is incomplete.'],
            ['internal', 'Internal order', groups.internal, 'Created internally; not yet warehouse work.'],
            ['warehouse', 'Picking', groups.warehouse, 'Warehouse is working.'],
            ['staged', 'Staged', groups.staged, 'Ready for driver route.'],
          ].map(([key, label, rows, helper]) => (
            <section className={`order-platform-lane order-platform-lane-${key}`} key={String(key)}>
              <header><strong>{String(label)}</strong><span>{(rows as OrderPlatformLatestOrderRow[]).length}</span></header>
              <small>{String(helper)}</small>
              <div className="order-platform-order-list">
                {(rows as OrderPlatformLatestOrderRow[]).slice(0, 5).map((order) => <OrderCard key={`${order.lifecycle_id}-${order.lifecycle_status}`} order={order} />)}
                {!(rows as OrderPlatformLatestOrderRow[]).length ? <div className="order-platform-empty">Clear</div> : null}
                {(rows as OrderPlatformLatestOrderRow[]).length > 5 ? <div className="order-platform-more">+{(rows as OrderPlatformLatestOrderRow[]).length - 5} more</div> : null}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="order-platform-mode-tabs" aria-label="Order platform work areas">
        <button type="button" className={mode === 'active' ? 'active' : ''} onClick={() => setMode('active')}><strong>Active</strong><span>{orders.length}</span></button>
        <button type="button" className={mode === 'legacy' ? 'active' : ''} onClick={() => setMode('legacy')}><strong>Legacy Review</strong><span>{legacyRows.length}</span></button>
        <button type="button" className={mode === 'archive' ? 'active' : ''} onClick={() => setMode('archive')}><strong>Archive</strong><span>{archiveRows.length}</span></button>
      </section>

      <CompactOrderTable
        mode={mode}
        rows={tableRows}
        query={query}
        onQueryChange={setQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        statusOptions={statusOptions}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        page={page}
        onPageChange={setPage}
      />

      <section className="order-platform-review-grid">
        <ReviewStrip
          title="Legacy internal review"
          helper="Quarantined historical internal drafts. Do not pick, route, or driver-release until owner/accounts decide archive, cancel, or rebuild."
          rows={legacyRows}
          tone="warn"
        />
        <ReviewStrip
          title="Archive preview"
          helper="Completed and historical imports stay searchable, but outside the active workflow hot path."
          rows={archiveRows}
          tone="blue"
        />
      </section>
    </section>
  );
}

export function OrderPlatformExperience() {
  const host = useOrdersPortalHost();
  return host ? createPortal(<OrderPlatformContent />, host) : null;
}
