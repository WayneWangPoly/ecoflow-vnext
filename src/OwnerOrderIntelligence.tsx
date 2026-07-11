import { useEffect, useMemo, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  loadOwnerDailyOrderReport,
  loadOwnerOrderKpis,
  loadOwnerOrderStatusReport,
  loadOwnerSkuVelocity,
  type OwnerDailyOrderReportRow,
  type OwnerOrderKpis,
  type OwnerOrderStatusReportRow,
  type OwnerSkuVelocityRow,
} from '@/data/repositories/orderIntelligence';

type SalesWindow = '7d' | '30d';
type SkuSort = 'units' | 'revenue' | 'attention' | 'recent';

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return num(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

function units(value: unknown) {
  return num(value).toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function windowUnits(row: OwnerSkuVelocityRow, window: SalesWindow) {
  return window === '7d' ? num(row.units_7d) : num(row.units_30d);
}

function windowRevenue(row: OwnerSkuVelocityRow, window: SalesWindow) {
  return window === '7d' ? num(row.revenue_7d) : num(row.revenue_30d);
}

function InsightPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <span className={`owner-insight-pill owner-insight-pill-${tone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <article className={`owner-insight-metric owner-insight-metric-${tone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function useOrdersHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function locate() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Order control');
      const panel = heading?.closest<HTMLElement>('.panel');
      if (!panel) {
        setHost(null);
        return;
      }
      let mount = document.querySelector<HTMLElement>('.owner-order-intelligence-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'owner-order-intelligence-mount';
        // Sales analytics render BELOW the operational Order Platform - operations stay above the fold.
        panel.insertAdjacentElement('afterend', mount);
      }
      setHost(mount);
    }

    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  return host;
}

function HotSkuRow({ row, index, window }: { row: OwnerSkuVelocityRow; index: number; window: SalesWindow }) {
  const attention = num(row.barcode_attention_lines);
  return (
    <article className="owner-hot-sku-row">
      <b>{index + 1}</b>
      <div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Unknown product'}</span></div>
      <div><strong>{units(windowUnits(row, window))}</strong><span>{window} units</span></div>
      <div><strong>{money(windowRevenue(row, window))}</strong><span>{window} value</span></div>
      <InsightPill tone={attention ? 'warn' : 'good'}>{attention ? `${attention} barcode checks` : 'barcode ready'}</InsightPill>
    </article>
  );
}

function SkuReportRow({ row, index, window }: { row: OwnerSkuVelocityRow; index: number; window: SalesWindow }) {
  const attention = num(row.barcode_attention_lines);
  return (
    <article className="owner-sku-report-row">
      <b>{index + 1}</b>
      <span><strong>{row.sku || 'UNKNOWN'}</strong><small>{row.product_name || 'Unknown product'}</small></span>
      <span><strong>{units(windowUnits(row, window))}</strong><small>{window} units</small></span>
      <span><strong>{money(windowRevenue(row, window))}</strong><small>{window} value</small></span>
      <span><strong>{money(row.avg_unit_price)}</strong><small>avg price</small></span>
      <span><strong>{dateText(row.last_sold_at)}</strong><small>last sold</small></span>
      <InsightPill tone={attention ? 'warn' : 'good'}>{attention ? 'barcode cleanup' : 'ready'}</InsightPill>
    </article>
  );
}

function DailyRow({ row }: { row: OwnerDailyOrderReportRow }) {
  return (
    <article className="owner-daily-row">
      <strong>{dateText(row.order_day)}</strong>
      <span>{units(row.order_count)} orders</span>
      <span>{units(row.units)} units</span>
      <span>{money(row.revenue)}</span>
    </article>
  );
}

function StatusRow({ row }: { row: OwnerOrderStatusReportRow }) {
  const status = title(row.status);
  const risky = status.includes('LEGACY') || status.includes('CANCEL') || title(row.warehouse_gate_status).includes('BLOCK');
  return (
    <article className="owner-status-row">
      <div><strong>{status}</strong><span>{title(row.account_release_status)} · {title(row.warehouse_gate_status)}</span></div>
      <InsightPill tone={risky ? 'warn' : 'blue'}>{units(row.order_count)}</InsightPill>
      <span>{money(row.total_value)}</span>
    </article>
  );
}

function IntelligenceContent() {
  const [kpis, setKpis] = useState<OwnerOrderKpis | null>(null);
  const [skus, setSkus] = useState<OwnerSkuVelocityRow[]>([]);
  const [daily, setDaily] = useState<OwnerDailyOrderReportRow[]>([]);
  const [statusRows, setStatusRows] = useState<OwnerOrderStatusReportRow[]>([]);
  const [window, setWindow] = useState<SalesWindow>('30d');
  const [sort, setSort] = useState<SkuSort>('units');
  const [skuQuery, setSkuQuery] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextSkus, nextDaily, nextStatuses] = await Promise.all([
        loadOwnerOrderKpis(),
        loadOwnerSkuVelocity(),
        loadOwnerDailyOrderReport(),
        loadOwnerOrderStatusReport(),
      ]);
      setKpis(nextKpis);
      setSkus(nextSkus);
      setDaily(nextDaily);
      setStatusRows(nextStatuses);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  const visibleSkus = useMemo(() => {
    const needle = skuQuery.trim().toLowerCase();
    const filtered = needle ? skus.filter((row) => [row.sku, row.product_name, row.warehouse_barcode, row.latest_barcode_status].filter(Boolean).join(' ').toLowerCase().includes(needle)) : skus;
    return [...filtered].sort((a, b) => {
      if (sort === 'revenue') return windowRevenue(b, window) - windowRevenue(a, window);
      if (sort === 'attention') return num(b.barcode_attention_lines) - num(a.barcode_attention_lines) || windowUnits(b, window) - windowUnits(a, window);
      if (sort === 'recent') return new Date(b.last_sold_at || 0).getTime() - new Date(a.last_sold_at || 0).getTime();
      return windowUnits(b, window) - windowUnits(a, window);
    });
  }, [skus, skuQuery, sort, window]);

  const topSku = visibleSkus[0];
  const barcodeAttention = useMemo(() => skus.reduce((sum, row) => sum + num(row.barcode_attention_lines), 0), [skus]);
  const latest = loadedAt ? new Date(loadedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'loading';
  const revenue = window === '7d' ? kpis?.revenue_7d : kpis?.revenue_30d;
  const orderCount = window === '7d' ? kpis?.orders_7d : kpis?.orders_30d;
  const totalUnits = visibleSkus.reduce((sum, row) => sum + windowUnits(row, window), 0);

  return (
    <section className="owner-insight-shell">
      <section className="owner-insight-hero">
        <div>
          <span>OWNER ORDER INTELLIGENCE</span>
          <h2>Sales, SKU velocity and order pressure.</h2>
          <p>Owner view built from internal orders and SKU lines.</p>
        </div>
        <div className="owner-insight-actions"><button type="button" onClick={() => void reload()}>Refresh reports</button><small>{latest}</small></div>
      </section>

      <section className="owner-insight-controlbar">
        <div className="owner-window-toggle">
          <button type="button" className={window === '7d' ? 'active' : ''} onClick={() => setWindow('7d')}>7 days</button>
          <button type="button" className={window === '30d' ? 'active' : ''} onClick={() => setWindow('30d')}>30 days</button>
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as SkuSort)}>
          <option value="units">Sort by units</option>
          <option value="revenue">Sort by revenue</option>
          <option value="attention">Barcode attention first</option>
          <option value="recent">Most recent sold</option>
        </select>
        <input value={skuQuery} onChange={(event) => setSkuQuery(event.target.value)} placeholder="Search SKU, product, barcode…" />
      </section>

      {error ? <div className="owner-insight-error">{error}</div> : null}

      <section className="owner-insight-metrics">
        <Metric label={`${window} revenue`} value={money(revenue)} helper={`${units(orderCount)} orders · avg ${money(kpis?.avg_order_value_30d)}`} tone="good" />
        <Metric label={`${window} units`} value={units(totalUnits)} helper={topSku ? `top: ${topSku.sku}` : 'waiting for SKU data'} tone="blue" />
        <Metric label="Active workflow" value={units(kpis?.lifecycle_active_orders)} helper={`${units(kpis?.active_internal_orders)} internal orders active`} tone="neutral" />
        <Metric label="Barcode attention" value={units(barcodeAttention)} helper="SKU lines needing barcode cleanup" tone={barcodeAttention ? 'warn' : 'good'} />
      </section>

      <section className="owner-insight-grid">
        <section className="owner-insight-panel owner-insight-panel-large">
          <header><div><h3>Hot sellers</h3><p>Top moving SKUs in the selected window.</p></div><InsightPill tone="blue">{visibleSkus.length}</InsightPill></header>
          <div className="owner-hot-sku-list">
            {visibleSkus.slice(0, 10).map((row, index) => <HotSkuRow key={`${row.sku}-${index}`} row={row} index={index} window={window} />)}
            {!visibleSkus.length ? <div className="owner-insight-empty">No matching SKU sales data.</div> : null}
          </div>
        </section>

        <section className="owner-insight-panel">
          <header><div><h3>Daily report</h3><p>Recent order value and unit movement.</p></div></header>
          <div className="owner-daily-list">
            {daily.slice(0, 10).map((row) => <DailyRow key={row.order_day || Math.random()} row={row} />)}
            {!daily.length ? <div className="owner-insight-empty">No daily report data yet.</div> : null}
          </div>
        </section>
      </section>

      <section className="owner-insight-panel">
        <header><div><h3>SKU report</h3><p>Velocity, revenue, barcode readiness and last sold date.</p></div><InsightPill tone="blue">{visibleSkus.length}</InsightPill></header>
        <div className="owner-sku-report-list">
          {visibleSkus.slice(0, 16).map((row, index) => <SkuReportRow key={`${row.sku}-${index}`} row={row} index={index} window={window} />)}
          {!visibleSkus.length ? <div className="owner-insight-empty">No SKU rows match the current filter.</div> : null}
        </div>
      </section>

      <section className="owner-insight-grid owner-insight-grid-bottom">
        <section className="owner-insight-panel">
          <header><div><h3>Top product now</h3><p>Fastest moving item in the selected window.</p></div><InsightPill tone="good">{topSku ? units(windowUnits(topSku, window)) : 0} units</InsightPill></header>
          <article className="owner-top-product-card"><strong>{topSku?.sku || '—'}</strong><span>{topSku?.product_name || 'No top seller yet'}</span><small>Latest sold: {dateText(topSku?.last_sold_at)}</small></article>
        </section>
        <section className="owner-insight-panel">
          <header><div><h3>Status mix</h3><p>Blocked, legacy and warehouse gate pressure.</p></div></header>
          <div className="owner-status-list">
            {statusRows.slice(0, 8).map((row) => <StatusRow key={`${row.status}-${row.account_release_status}-${row.warehouse_gate_status}`} row={row} />)}
            {!statusRows.length ? <div className="owner-insight-empty">No status data yet.</div> : null}
          </div>
        </section>
      </section>
    </section>
  );
}

export function OwnerOrderIntelligence() {
  const host = useOrdersHost();
  return host ? createPortal(<IntelligenceContent />, host) : null;
}
