import { useEffect, useMemo, useState } from 'react';
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

function InsightPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
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
        panel.insertAdjacentElement('beforebegin', mount);
      }
      setHost(mount);
    }

    locate();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; locate(); }, 140);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return host;
}

function HotSkuRow({ row, index }: { row: OwnerSkuVelocityRow; index: number }) {
  const attention = num(row.barcode_attention_lines);
  return (
    <article className="owner-hot-sku-row">
      <b>{index + 1}</b>
      <div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Unknown product'}</span></div>
      <div><strong>{units(row.units_30d)}</strong><span>30d units</span></div>
      <div><strong>{money(row.revenue_30d)}</strong><span>30d value</span></div>
      <InsightPill tone={attention ? 'warn' : 'good'}>{attention ? `${attention} barcode checks` : 'barcode ready'}</InsightPill>
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

  const topSku = skus[0];
  const barcodeAttention = useMemo(() => skus.reduce((sum, row) => sum + num(row.barcode_attention_lines), 0), [skus]);
  const latest = loadedAt ? new Date(loadedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'loading';

  return (
    <section className="owner-insight-shell">
      <section className="owner-insight-hero">
        <div>
          <span>OWNER ORDER INTELLIGENCE</span>
          <h2>Sales, stock pressure and hot products in one clean operating view.</h2>
          <p>Built from internal orders and SKU lines, not the raw Ordermentum history table.</p>
        </div>
        <div className="owner-insight-actions"><button type="button" onClick={() => void reload()}>Refresh reports</button><small>{latest}</small></div>
      </section>

      {error ? <div className="owner-insight-error">{error}</div> : null}

      <section className="owner-insight-metrics">
        <Metric label="30d revenue" value={money(kpis?.revenue_30d)} helper={`${units(kpis?.orders_30d)} orders · avg ${money(kpis?.avg_order_value_30d)}`} tone="good" />
        <Metric label="30d units" value={units(kpis?.units_30d)} helper={topSku ? `top: ${topSku.sku}` : 'waiting for SKU data'} tone="blue" />
        <Metric label="Active workflow" value={units(kpis?.lifecycle_active_orders)} helper={`${units(kpis?.active_internal_orders)} internal orders active`} tone="neutral" />
        <Metric label="Barcode attention" value={units(barcodeAttention)} helper="SKU lines needing barcode cleanup" tone={barcodeAttention ? 'warn' : 'good'} />
      </section>

      <section className="owner-insight-grid">
        <section className="owner-insight-panel owner-insight-panel-large">
          <header><div><h3>Hot sellers</h3><p>Top SKU velocity over the last 30 days.</p></div><InsightPill tone="blue">{skus.length}</InsightPill></header>
          <div className="owner-hot-sku-list">
            {skus.slice(0, 10).map((row, index) => <HotSkuRow key={`${row.sku}-${index}`} row={row} index={index} />)}
            {!skus.length ? <div className="owner-insight-empty">No SKU sales data yet.</div> : null}
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

      <section className="owner-insight-grid owner-insight-grid-bottom">
        <section className="owner-insight-panel">
          <header><div><h3>Top product now</h3><p>Fastest moving item by 30-day unit count.</p></div><InsightPill tone="good">{units(kpis?.top_sku_units_30d)} units</InsightPill></header>
          <article className="owner-top-product-card"><strong>{kpis?.top_sku_30d || '—'}</strong><span>{kpis?.top_product_30d || 'No top seller yet'}</span><small>Latest order: {dateText(kpis?.latest_order_at)}</small></article>
        </section>
        <section className="owner-insight-panel">
          <header><div><h3>Status mix</h3><p>Watch for blocked, legacy, and warehouse gate pressure.</p></div></header>
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
