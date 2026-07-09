import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  loadOwnerCommandAttention,
  loadOwnerCommandKpis,
  type OwnerCommandAttentionRow,
  type OwnerCommandKpis,
} from '@/data/repositories/ownerCommandCenter';

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
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function tone(signal?: string | null): 'good' | 'warn' | 'danger' | 'blue' | 'neutral' {
  if (!signal) return 'neutral';
  if (signal.includes('URGENT') || signal.includes('OVERDUE') || signal.includes('HOLD') || signal.includes('BLOCKED')) return 'danger';
  if (signal.includes('NEEDS') || signal.includes('WATCH') || signal.includes('HIGH') || signal.includes('LEGACY') || signal.includes('BARCODE')) return 'warn';
  if (signal.includes('OPEN') || signal.includes('REORDER')) return 'blue';
  if (signal.includes('READY') || signal.includes('ACTIVE') || signal.includes('CLEAR')) return 'good';
  return 'neutral';
}

function Pill({ children, tone: pillTone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <span className={`owner-command-pill owner-command-pill-${pillTone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone: metricTone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <article className={`owner-command-metric owner-command-metric-${metricTone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function roleFromShell() {
  const roleText = document.querySelector<HTMLElement>('.sidebar-brand span')?.textContent?.toUpperCase() || '';
  if (roleText.includes('ACCOUNT')) return 'ACCOUNT';
  if (roleText.includes('OWNER') || roleText.includes('ADMIN')) return 'OWNER';
  const stored = window.localStorage.getItem('ecoflow-role');
  return stored === 'account' ? 'ACCOUNT' : 'OWNER';
}

function useDashboardHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [role, setRole] = useState('OWNER');

  useEffect(() => {
    function locate() {
      const hero = document.querySelector<HTMLElement>('.hero-card');
      if (!hero) { setHost(null); return; }
      const currentRole = roleFromShell();
      setRole(currentRole);
      hero.classList.add('owner-command-native-hero-hide');
      let mount = document.querySelector<HTMLElement>('.owner-command-center-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'owner-command-center-mount';
        hero.insertAdjacentElement('beforebegin', mount);
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
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return { host, role };
}

function AttentionRow({ row }: { row: OwnerCommandAttentionRow }) {
  return (
    <article className="owner-command-attention-row">
      <div><strong>{row.title || 'Untitled'}</strong><span>{row.detail || 'No detail'}</span></div>
      <Pill tone={tone(row.signal)}>{row.area} · {title(row.signal)}</Pill>
      <small>{row.action_hint}</small>
    </article>
  );
}

function CommandContent({ role }: { role: string }) {
  const [kpis, setKpis] = useState<OwnerCommandKpis | null>(null);
  const [attention, setAttention] = useState<OwnerCommandAttentionRow[]>([]);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextAttention] = await Promise.all([loadOwnerCommandKpis(), loadOwnerCommandAttention()]);
      setKpis(nextKpis);
      setAttention(nextAttention);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  const attentionCount = attention.length;
  const dataAttention = num(kpis?.address_attention_stores) + num(kpis?.price_tier_attention_stores) + num(kpis?.barcode_attention_lines) + num(kpis?.legacy_review_orders);
  const accountRisk = num(kpis?.urgent_customers) + num(kpis?.held_customers);
  const latest = loadedAt ? dateText(loadedAt) : 'loading';
  const subtitle = role === 'ACCOUNT'
    ? 'Accounts briefing across AR, statement risk and customer follow-up.'
    : 'Owner command centre across orders, stores, accounts and stock pressure.';

  const operatingSignal = useMemo(() => {
    if (accountRisk > 0) return 'Accounts risk';
    if (dataAttention > 0) return 'Data cleanup';
    if (num(kpis?.reorder_pressure_rows) > 0) return 'Reorder pressure';
    return 'Operating normally';
  }, [accountRisk, dataAttention, kpis?.reorder_pressure_rows]);

  return (
    <section className="owner-command-shell">
      <section className="owner-command-hero">
        <div>
          <span>{role === 'ACCOUNT' ? 'ACCOUNTS BRIEFING' : 'OWNER COMMAND CENTRE'}</span>
          <h1>Move faster, waste less, and know what needs attention.</h1>
          <p>{subtitle}</p>
        </div>
        <div className="owner-command-hero-card">
          <strong>{operatingSignal}</strong>
          <span>{attentionCount} active attention rows</span>
          <button type="button" onClick={() => void reload()}>Refresh command centre</button>
          <small>{latest}</small>
        </div>
      </section>

      {error ? <div className="owner-command-error">{error}</div> : null}

      <section className="owner-command-metrics">
        <Metric label="30d revenue" value={money(kpis?.order_revenue_30d)} helper={`${units(kpis?.orders_30d)} orders · ${units(kpis?.units_30d)} units`} tone="good" />
        <Metric label="Open AR" value={money(kpis?.open_ar_value)} helper={`${money(kpis?.overdue_ar_value)} overdue · worst ${units(kpis?.worst_overdue_days)} days`} tone={num(kpis?.overdue_ar_value) ? 'warn' : 'blue'} />
        <Metric label="Active stores" value={units(kpis?.active_stores_30d)} helper={`${units(kpis?.total_stores)} records · top ${kpis?.top_store_30d || '—'}`} tone="blue" />
        <Metric label="Attention" value={units(attentionCount)} helper={`${units(dataAttention)} data/order lines · ${units(kpis?.reorder_pressure_rows)} reorder rows`} tone={attentionCount ? 'warn' : 'good'} />
      </section>

      <section className="owner-command-grid">
        <section className="owner-command-panel owner-command-panel-large">
          <header><div><h3>Priority attention</h3><p>Only the owner/actionable signals across Orders, Stores and Accounts.</p></div><Pill tone={attentionCount ? 'warn' : 'good'}>{attentionCount}</Pill></header>
          <div className="owner-command-attention-list">
            {attention.slice(0, 10).map((row, index) => <AttentionRow key={`${row.area}-${row.reference_id}-${index}`} row={row} />)}
            {!attention.length ? <div className="owner-command-empty">No command-centre attention rows.</div> : null}
          </div>
        </section>

        <section className="owner-command-panel">
          <header><div><h3>Business pulse</h3><p>Best current signals for the owner.</p></div></header>
          <div className="owner-command-pulse-list">
            <article><strong>{kpis?.top_sku_30d || '—'}</strong><span>Top SKU · {kpis?.top_product_30d || 'No product'} · {units(kpis?.top_sku_units_30d)} units</span></article>
            <article><strong>{kpis?.top_store_30d || '—'}</strong><span>Top store · {money(kpis?.top_store_revenue_30d)}</span></article>
            <article><strong>{units(kpis?.lifecycle_active_orders)}</strong><span>Active workflow orders · {units(kpis?.active_internal_orders)} active internal</span></article>
            <article><strong>{units(kpis?.barcode_attention_lines)}</strong><span>Barcode attention lines</span></article>
          </div>
        </section>
      </section>
    </section>
  );
}

export function OwnerCommandCenter() {
  const { host, role } = useDashboardHost();
  return host ? createPortal(<CommandContent role={role} />, host) : null;
}
