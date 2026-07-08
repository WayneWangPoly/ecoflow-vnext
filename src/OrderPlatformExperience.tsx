import { useEffect, useMemo, useState } from 'react';
import {
  loadOrderPlatformGuardrails,
  loadOrderPlatformLatestOrders,
  type OrderPlatformGuardrailRow,
  type OrderPlatformLatestOrderRow,
} from '@/data/repositories/orderPlatform';

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
  return 'neutral';
}

function MiniPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
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

export function OrderPlatformExperience() {
  const [guardrails, setGuardrails] = useState<OrderPlatformGuardrailRow[]>([]);
  const [orders, setOrders] = useState<OrderPlatformLatestOrderRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextGuardrails, nextOrders] = await Promise.all([
        loadOrderPlatformGuardrails(),
        loadOrderPlatformLatestOrders(),
      ]);
      setGuardrails(nextGuardrails);
      setOrders(nextOrders);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  const raw = guardrail(guardrails, 'ordermentum_raw_inbox');
  const active = guardrail(guardrails, 'orders_active_workflow');
  const legacy = guardrail(guardrails, 'legacy_internal_review');
  const archive = guardrail(guardrails, 'completed_archive');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) => [
      order.order_number,
      order.invoice_number,
      order.lifecycle_id,
      order.lifecycle_status,
      order.platform_bucket,
      order.internalisation_status,
      order.warehouse_gate_status,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [orders, query]);

  const groups = useMemo(() => ({
    ready: filtered.filter((order) => order.lifecycle_status === 'READY_TO_INTERNALISE'),
    mapping: filtered.filter((order) => order.lifecycle_status === 'BLOCKED_MAPPING'),
    data: filtered.filter((order) => order.lifecycle_status === 'BLOCKED_DATA'),
    internal: filtered.filter((order) => order.lifecycle_status === 'INTERNAL_ORDER_CREATED'),
    warehouse: filtered.filter((order) => order.lifecycle_status === 'PICKING'),
    staged: filtered.filter((order) => order.lifecycle_status === 'STAGED'),
  }), [filtered]);

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
    </section>
  );
}
