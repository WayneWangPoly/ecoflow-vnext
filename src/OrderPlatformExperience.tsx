import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  loadOrderOperationsPage,
  loadOrderOperationsSummary,
  type OrderOperationRow,
  type OrderOperationsMode,
  type OrderOperationsPage,
  type OrderOperationsSummary,
} from '@/data/repositories/orderOperations';

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return numberValue(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function statusTone(value: string | null | undefined) {
  const status = String(value || '').toUpperCase();
  if (status.includes('BLOCKED') || status.includes('CANCELLED')) return 'danger';
  if (status.includes('REVIEW') || status.includes('MISSING') || status === 'UNRELEASED') return 'warn';
  if (['PICKING', 'STAGED', 'OUT_FOR_DELIVERY', 'RELEASED'].includes(status)) return 'blue';
  if (status === 'READY' || status === 'COMPLETED' || status.includes('MATCHED')) return 'good';
  return 'neutral';
}

function MiniPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`order-platform-pill order-platform-pill-${tone}`}>{children}</span>;
}

function Metric({ label, value, helper, intent = 'neutral' }: { label: string; value: string | number; helper: string; intent?: string }) {
  return (
    <article className={`order-platform-metric order-platform-metric-${intent}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{helper}</small>
    </article>
  );
}

function useOrdersPortalHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    return observeBody(() => {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2'))
        .find((node) => node.textContent?.trim() === 'Order control');
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
    });
  }, []);

  return host;
}

function modeTitle(mode: OrderOperationsMode) {
  if (mode === 'ready') return 'Ready for release';
  if (mode === 'blocked') return 'Blocked orders';
  if (mode === 'progress') return 'In fulfilment';
  if (mode === 'history') return 'Completed and historical orders';
  return 'Current orders';
}

function modeHelper(mode: OrderOperationsMode) {
  if (mode === 'ready') return 'Ordermentum detail complete, source state recognised, and no internal order has been created yet.';
  if (mode === 'blocked') return 'Current orders requiring source-status, invoice-detail, SKU, barcode, or reconciliation attention.';
  if (mode === 'progress') return 'Internal orders already moving through warehouse and delivery.';
  if (mode === 'history') return 'Completed, cancelled, and older Ordermentum records remain searchable outside the live queue.';
  return 'The live operating set only. Historical Ordermentum records do not enter this queue.';
}

function rowAction(row: OrderOperationRow) {
  if (row.release_eligible) return <MiniPill tone="good">READY TO RELEASE</MiniPill>;
  if (row.internal_order_id) return <MiniPill tone="blue">INTERNAL ORDER</MiniPill>;
  if (row.operational_scope === 'HISTORY') return <MiniPill tone="neutral">HISTORY</MiniPill>;
  if (row.fulfilment_status === 'SOURCE_REVIEW') return <MiniPill tone="warn">SOURCE REVIEW</MiniPill>;
  return <MiniPill tone={statusTone(row.data_quality_status)}>{title(row.data_quality_status)}</MiniPill>;
}

function commercialDetail(row: OrderOperationRow) {
  const orderTotal = row.order_total ?? row.order_value;
  const surcharge = numberValue(row.surcharge_amount);
  if (surcharge > 0) return `${money(orderTotal)} order + ${money(surcharge)} ${String(row.surcharge_type || 'surcharge').toLowerCase()}`;
  if (row.invoice_total != null && row.order_total != null) return `${money(orderTotal)} order · no surcharge`;
  return `${numberValue(row.line_count)} lines`;
}

function OrderTable({ pageData, mode, loading }: { pageData: OrderOperationsPage; mode: OrderOperationsMode; loading: boolean }) {
  if (loading && !pageData.rows.length) return <div className="order-platform-empty">Loading authoritative order records…</div>;
  if (!pageData.rows.length) return <div className="order-platform-empty">No orders match this work area.</div>;

  return (
    <div className="order-platform-table order-operations-table">
      <div className="order-platform-table-header">
        <span>Order</span><span>Customer</span><span>Source / finance</span><span>Fulfilment</span><span>Data</span><span>Timing</span><span>Commercial</span><span>Control</span>
      </div>
      {pageData.rows.map((row) => (
        <article className="order-platform-table-row" key={`${mode}-${row.operation_key}`}>
          <span>
            <strong>{row.order_number || row.operation_key}</strong>
            <small>{row.invoice_number || 'invoice pending'}</small>
          </span>
          <span>
            <strong>{row.store_name || 'Ordermentum customer'}</strong>
            <small>{row.line_count ? `${numberValue(row.line_count)} lines` : 'line detail pending'}</small>
          </span>
          <span>
            <MiniPill tone={row.operational_scope === 'REVIEW' ? 'warn' : 'neutral'}>{title(row.source_order_status || 'NOT SET')}</MiniPill>
            <small>{title(row.invoice_payment_status || row.source_payment_status || 'payment not set')} · {row.payment_method || 'method unavailable'}</small>
          </span>
          <span>
            <MiniPill tone={statusTone(row.fulfilment_status)}>{title(row.fulfilment_status)}</MiniPill>
            <small>{row.internal_order_id ? `internal ${row.internal_order_id.slice(0, 8)}` : 'not internalised'}</small>
          </span>
          <span>
            <MiniPill tone={statusTone(row.data_quality_status)}>{title(row.data_quality_status)}</MiniPill>
            <small>{row.classification_reason}</small>
          </span>
          <span>
            <strong>{timeText(row.requested_delivery_at || row.source_business_at)}</strong>
            <small>source observed {timeText(row.observed_at)}</small>
          </span>
          <span>
            <strong>{money(row.invoice_total ?? row.order_total ?? row.order_value)}</strong>
            <small>{commercialDetail(row)}</small>
            {row.reconciliation_status ? <MiniPill tone={statusTone(row.reconciliation_status)}>{title(row.reconciliation_status)}</MiniPill> : null}
          </span>
          <span className="order-platform-action-cell">{rowAction(row)}</span>
        </article>
      ))}
    </div>
  );
}

function OrderPlatformContent() {
  const [summary, setSummary] = useState<OrderOperationsSummary | null>(null);
  const [pageData, setPageData] = useState<OrderOperationsPage>({ rows: [], total: 0, page: 1, pageSize: 25 });
  const [mode, setMode] = useState<OrderOperationsMode>('current');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => { setPage(1); }, [mode, query, pageSize]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    void Promise.all([
      loadOrderOperationsSummary(),
      loadOrderOperationsPage({ mode, page, pageSize, query }),
    ]).then(([nextSummary, nextPage]) => {
      if (!active) return;
      setSummary(nextSummary);
      setPageData(nextPage);
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [mode, page, pageSize, query, refreshVersion]);

  const counts = useMemo(() => {
    const total = numberValue(summary?.total_orders);
    const current = numberValue(summary?.current_orders);
    const review = numberValue(summary?.source_review_orders);
    return {
      current: current + review,
      ready: numberValue(summary?.ready_to_release),
      blocked: numberValue(summary?.blocked_orders) + review,
      progress: numberValue(summary?.in_progress_orders),
      history: Math.max(0, total - current - review),
      completed: numberValue(summary?.completed_orders),
      surcharge: numberValue(summary?.surcharge_invoices),
      financeReview: numberValue(summary?.finance_review_orders),
    };
  }, [summary]);

  const pageCount = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));
  const safePage = Math.min(page, pageCount);

  const modes: Array<{ key: OrderOperationsMode; label: string; count: number }> = [
    { key: 'current', label: 'Current', count: counts.current },
    { key: 'ready', label: 'Ready', count: counts.ready },
    { key: 'blocked', label: 'Blocked', count: counts.blocked },
    { key: 'progress', label: 'In progress', count: counts.progress },
    { key: 'history', label: 'History', count: counts.history },
  ];

  return (
    <section className="order-platform-shell order-operations-v2">
      <section className="order-platform-hero order-operations-hero">
        <div>
          <span>ORDER CONTROL · VERIFIED ORDERMENTUM MIRROR</span>
          <h2>One commercial truth, from Ordermentum to delivery.</h2>
          <p>Order, invoice, payment, surcharge and fulfilment remain separate facts. EcoFlow mirrors the full source record, verifies the links, and only then exposes current work for release.</p>
        </div>
        <div className="order-platform-actions">
          <button type="button" disabled={loading} onClick={() => setRefreshVersion((value) => value + 1)}>{loading ? 'Refreshing…' : 'Refresh order state'}</button>
          <small>Latest source change {timeText(summary?.latest_source_update)}</small>
        </div>
      </section>

      {error ? <div className="order-platform-error">Order control could not load. {error}</div> : null}

      <section className="order-platform-metrics order-operations-metrics">
        <Metric label="Current orders" value={counts.current} helper="Live work and source review only" intent="good" />
        <Metric label="Ready for release" value={counts.ready} helper="Complete and explicitly eligible" intent="good" />
        <Metric label="Blocked" value={counts.blocked} helper="Current operational action" intent="warn" />
        <Metric label="In fulfilment" value={counts.progress} helper="Warehouse or delivery in progress" intent="blue" />
        <Metric label="Finance review" value={counts.financeReview} helper={`${counts.surcharge} invoices carry a verified surcharge`} intent={counts.financeReview ? 'warn' : 'neutral'} />
        <Metric label="Completed" value={counts.completed} helper="Retained in searchable history" intent="neutral" />
      </section>

      <section className="order-ops-flow-strip" aria-label="Order operating flow">
        <article><span>01</span><div><strong>Mirror</strong><small>Orders, invoices, stores, products and exact source payloads</small></div></article>
        <i>→</i>
        <article><span>02</span><div><strong>Verify</strong><small>Lines, totals, GST, surcharge, status and references</small></div></article>
        <i>→</i>
        <article><span>03</span><div><strong>Warehouse</strong><small>Release, pick, pack and stage the internal order</small></div></article>
        <i>→</i>
        <article><span>04</span><div><strong>Delivery</strong><small>Route, POD and completion</small></div></article>
      </section>

      <nav className="order-platform-mode-tabs order-operations-mode-tabs" aria-label="Order work areas">
        {modes.map((item) => (
          <button key={item.key} type="button" className={mode === item.key ? 'active' : ''} onClick={() => setMode(item.key)}>
            <strong>{item.label}</strong><span>{item.count}</span>
          </button>
        ))}
      </nav>

      <section className="order-platform-compact-table-panel">
        <div className="order-platform-table-headline">
          <div><h3>{modeTitle(mode)}</h3><p>{modeHelper(mode)}</p></div>
          <MiniPill tone={mode === 'blocked' ? 'danger' : mode === 'ready' ? 'good' : 'blue'}>{pageData.total} records</MiniPill>
        </div>

        <div className="order-platform-toolbar">
          <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search order, invoice, customer or internal ID…" />
          <select value={mode} onChange={(event) => setMode(event.target.value as OrderOperationsMode)}>
            {modes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
        </div>

        <OrderTable pageData={pageData} mode={mode} loading={loading} />

        <div className="order-platform-pagination">
          <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1 || loading}>Previous</button>
          <span>Page {safePage} of {pageCount} · {pageData.total} records</span>
          <button type="button" onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount || loading}>Next</button>
        </div>
      </section>
    </section>
  );
}

export function OrderPlatformExperience() {
  const host = useOrdersPortalHost();
  return host ? createPortal(<OrderPlatformContent />, host) : null;
}
