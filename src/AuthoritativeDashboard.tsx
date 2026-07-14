import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { loadOrderOperationsSummary, type OrderOperationsSummary } from '@/data/repositories/orderOperations';
import { supabase } from '@/lib/supabaseClient';

interface MirrorHealth {
  overall_status: string | null;
  raw_order_count: number | string | null;
  projected_order_count: number | string | null;
  order_projection_missing: number | string | null;
  invoice_projection_missing: number | string | null;
  active_source_missing_orders?: number | string | null;
  latest_raw_order_sync: string | null;
  checked_at: string | null;
}

interface AccountsKpis {
  open_ar_value: number | string | null;
  overdue_ar_value: number | string | null;
  overdue_customers: number | string | null;
}

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return n(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function time(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function missingRelation(error: unknown) {
  const text = error && typeof error === 'object'
    ? Object.values(error as Record<string, unknown>).filter(Boolean).join(' ').toLowerCase()
    : String(error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache') || text.includes('pgrst205') || text.includes('42p01');
}

async function loadMirrorHealth(): Promise<MirrorHealth | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  for (const view of ['v_ecoflow_ordermentum_mirror_health_v2', 'v_ecoflow_ordermentum_mirror_health_v1']) {
    const { data, error } = await supabase.from(view).select('*').maybeSingle();
    if (!error) return (data ?? null) as MirrorHealth | null;
    if (!missingRelation(error)) throw error;
  }
  return null;
}

async function loadAccountsKpis(): Promise<AccountsKpis | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('v_ecoflow_accounts_live_ar_kpis').select('open_ar_value,overdue_ar_value,overdue_customers').maybeSingle();
  if (error) throw error;
  return (data ?? null) as AccountsKpis | null;
}

function metricTone(value: string) {
  if (value === 'COMPLETE') return 'good';
  if (value === 'DEGRADED') return 'warn';
  return 'danger';
}

function Metric({ label, value, helper, tone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: string }) {
  return (
    <article className={`authoritative-dashboard-metric authoritative-dashboard-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function useDashboardHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    const active = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button, .desktop-mobile-nav button'))
      .some((button) => button.classList.contains('active') && button.textContent?.trim() === 'Dashboard');
    const hero = document.querySelector<HTMLElement>('.desktop-content .hero-card');
    if (!active || !hero) {
      setHost(null);
      return;
    }

    hero.hidden = true;
    const quick = hero.nextElementSibling;
    if (quick instanceof HTMLElement && quick.classList.contains('quick-stats')) quick.hidden = true;

    let mount = document.querySelector<HTMLElement>('.authoritative-dashboard-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'authoritative-dashboard-mount';
      hero.insertAdjacentElement('beforebegin', mount);
    }
    setHost(mount);
  }), []);
  return host;
}

function DashboardContent() {
  const [orders, setOrders] = useState<OrderOperationsSummary | null>(null);
  const [mirror, setMirror] = useState<MirrorHealth | null>(null);
  const [accounts, setAccounts] = useState<AccountsKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [orderSummary, mirrorHealth, accountKpis] = await Promise.all([
        loadOrderOperationsSummary(),
        loadMirrorHealth(),
        loadAccountsKpis(),
      ]);
      setOrders(orderSummary);
      setMirror(mirrorHealth);
      setAccounts(accountKpis);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const current = n(orders?.current_orders) + n(orders?.source_review_orders);
  const blocked = n(orders?.blocked_orders) + n(orders?.source_review_orders);
  const mirrorStatus = mirror?.overall_status || 'UNAVAILABLE';
  const rawOrders = n(mirror?.raw_order_count);
  const projectedOrders = n(mirror?.projected_order_count);
  const activeMissing = n(mirror?.active_source_missing_orders);

  return (
    <section className="authoritative-dashboard-shell">
      <header className="authoritative-dashboard-hero">
        <div>
          <span>ECOFLOW CONTROL ROOM · AUTHORITATIVE DATA</span>
          <h1>Build the supply chain behind a cleaner food future.</h1>
          <p>Ordermentum commercial source → verified EcoFlow mirror → warehouse and delivery execution.</p>
        </div>
        <div className="authoritative-dashboard-actions">
          <button type="button" onClick={() => void reload()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh control room'}</button>
          <small>Latest source update {time(orders?.latest_source_update || mirror?.latest_raw_order_sync)}</small>
        </div>
      </header>

      {error ? <div className="authoritative-dashboard-error">Authoritative dashboard unavailable · {error}</div> : null}
      {mirrorStatus !== 'COMPLETE' ? (
        <div className="authoritative-dashboard-warning">
          MIRROR {mirrorStatus} · Release decisions remain fail-closed until projection, detail, classification and source-presence controls pass.
        </div>
      ) : null}

      <section className="authoritative-dashboard-metrics">
        <Metric label="Current orders" value={current} helper="Exact server classification" tone="good" />
        <Metric label="Ready for release" value={n(orders?.ready_to_release)} helper="Internalisation/run gates applied" tone="good" />
        <Metric label="Blocked" value={blocked} helper="Source, mapping, finance or hold" tone={blocked ? 'warn' : 'good'} />
        <Metric label="In fulfilment" value={n(orders?.in_progress_orders)} helper="Released, picking, staged or on route" tone="blue" />
        <Metric label="Open AR" value={money(accounts?.open_ar_value)} helper={`${n(accounts?.overdue_customers)} overdue customers`} tone={n(accounts?.overdue_ar_value) ? 'warn' : 'neutral'} />
        <Metric label="Mirror contract" value={mirrorStatus} helper={`${projectedOrders} projected / ${rawOrders} raw orders`} tone={metricTone(mirrorStatus)} />
      </section>

      <section className="authoritative-dashboard-controls">
        <article><span>ORDER PROJECTION GAPS</span><strong>{n(mirror?.order_projection_missing)}</strong><small>must be 0</small></article>
        <article><span>INVOICE PROJECTION GAPS</span><strong>{n(mirror?.invoice_projection_missing)}</strong><small>must be 0</small></article>
        <article><span>ACTIVE SOURCE MISSING</span><strong>{activeMissing}</strong><small>{activeMissing ? 'stop and investigate' : 'clear'}</small></article>
        <article><span>FINANCE REVIEW</span><strong>{n(orders?.finance_review_orders)}</strong><small>surcharge-aware reconciliation</small></article>
        <article><span>ACCOUNT HOLDS</span><strong>{n(orders?.account_hold_orders)}</strong><small>EcoFlow operational release holds</small></article>
        <article><span>VERIFIED</span><strong>{time(mirror?.checked_at)}</strong><small>complete-mirror health check</small></article>
      </section>
    </section>
  );
}

export function AuthoritativeDashboard() {
  const host = useDashboardHost();
  return host ? createPortal(<DashboardContent />, host) : null;
}
