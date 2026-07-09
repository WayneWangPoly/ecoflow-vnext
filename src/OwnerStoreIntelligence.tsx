import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  loadOwnerStoreExperienceGaps,
  loadOwnerStoreKpis,
  loadOwnerStorePerformance,
  loadOwnerStoreReorderWatch,
  loadOwnerStoreSkuMix,
  loadOwnerStoreStatementSummary,
  type OwnerStoreExperienceGapRow,
  type OwnerStoreKpis,
  type OwnerStorePerformanceRow,
  type OwnerStoreReorderWatchRow,
  type OwnerStoreSkuMixRow,
  type OwnerStoreStatementSummaryRow,
} from '@/data/repositories/storeIntelligence';

type StoreSort = 'revenue' | 'orders' | 'attention' | 'recent' | 'statement';

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

function signalTone(signal?: string | null): 'good' | 'warn' | 'blue' | 'neutral' {
  if (signal === 'ACTIVE' || signal === 'READY' || signal === 'CLEAR') return 'good';
  if (signal?.includes('NEEDS') || signal?.includes('MISSING') || signal?.includes('OVERDUE') || signal?.includes('HIGH')) return 'warn';
  if (signal === 'QUIET' || signal?.includes('WATCH') || signal?.includes('OPEN')) return 'blue';
  return 'neutral';
}

function StorePill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <span className={`owner-store-pill owner-store-pill-${tone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <article className={`owner-store-metric owner-store-metric-${tone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function useStoresHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    function locate() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Store master');
      const panel = heading?.closest<HTMLElement>('.panel');
      if (!panel) { setHost(null); return; }
      panel.classList.add('stores-native-master-panel-soft-hide');
      let mount = document.querySelector<HTMLElement>('.owner-store-intelligence-mount');
      if (!mount) { mount = document.createElement('section'); mount.className = 'owner-store-intelligence-mount'; panel.insertAdjacentElement('beforebegin', mount); }
      setHost(mount);
    }
    locate();
    let pending = false;
    const observer = new MutationObserver(() => { if (pending) return; pending = true; window.setTimeout(() => { pending = false; locate(); }, 160); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return host;
}

function StoreRow({ row, statement, onSelect }: { row: OwnerStorePerformanceRow; statement?: OwnerStoreStatementSummaryRow; onSelect: () => void }) {
  return (
    <article className="owner-store-row" onClick={onSelect}>
      <div className="owner-store-rank">#{units(row.revenue_rank_30d)}</div>
      <div className="owner-store-main"><strong>{row.store_name || 'Unknown store'}</strong><span>{row.suburb || 'Suburb pending'} · {row.address || 'Address pending'}</span><small>{row.delivery_instructions || 'No delivery instructions captured'}</small></div>
      <div><strong>{money(row.revenue_30d)}</strong><span>30d value</span></div>
      <div><strong>{units(row.orders_30d)}</strong><span>orders</span></div>
      <div><strong>{money(statement?.open_statement_value)}</strong><span>statement</span></div>
      <StorePill tone={signalTone(statement?.statement_signal || row.store_signal)}>{title(statement?.statement_signal || row.store_signal)}</StorePill>
    </article>
  );
}

function StoreSkuRow({ row }: { row: OwnerStoreSkuMixRow }) {
  return <article className="owner-store-sku-row"><div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Unknown product'}</span></div><span>{units(row.units_30d)} units</span><span>{money(row.revenue_30d)}</span><small>{dateText(row.last_sold_at)}</small></article>;
}

function ReorderRow({ row }: { row: OwnerStoreReorderWatchRow }) {
  return (
    <article className="owner-store-pressure-row">
      <div><strong>{row.store_name}</strong><span>{row.sku} · {row.product_name}</span></div>
      <span>{units(row.units_30d)} units</span>
      <span>{money(row.revenue_30d)}</span>
      <StorePill tone={signalTone(row.reorder_signal)}>{title(row.reorder_signal)}</StorePill>
    </article>
  );
}

function GapRow({ row }: { row: OwnerStoreExperienceGapRow }) {
  return (
    <article className="owner-store-gap-row">
      <div><strong>{row.store_name}</strong><span>{row.suburb || 'Suburb pending'} · {money(row.revenue_30d)}</span></div>
      <StorePill tone={signalTone(row.owner_action)}>{title(row.owner_action)}</StorePill>
      <small>{title(row.store_signal)} · {title(row.statement_signal)} · open {money(row.open_statement_value)}</small>
    </article>
  );
}

function StoreDetail({ store, mix, statement, reorder }: { store?: OwnerStorePerformanceRow; mix: OwnerStoreSkuMixRow[]; statement?: OwnerStoreStatementSummaryRow; reorder: OwnerStoreReorderWatchRow[] }) {
  if (!store) return <div className="owner-store-empty">Select a store to see store detail, statement exposure and product mix.</div>;
  return (
    <section className="owner-store-detail">
      <div className="owner-store-detail-hero">
        <div><span>STORE DETAIL</span><h3>{store.store_name}</h3><p>{store.address || 'Address pending'} · {store.contact_phone || 'phone pending'}</p></div>
        <StorePill tone={signalTone(statement?.statement_signal || store.store_signal)}>{title(statement?.statement_signal || store.store_signal)}</StorePill>
      </div>
      <div className="owner-store-detail-grid">
        <div><strong>{money(store.revenue_30d)}</strong><span>30d revenue</span></div>
        <div><strong>{units(store.orders_30d)}</strong><span>30d orders</span></div>
        <div><strong>{money(statement?.open_statement_value)}</strong><span>open statement</span></div>
        <div><strong>{dateText(store.last_order_at)}</strong><span>last order</span></div>
      </div>
      <div className="owner-store-notes">
        <p><strong>Price tier:</strong> {store.price_group_id || 'needs price tier'}</p>
        <p><strong>Delivery:</strong> {store.delivery_instructions || 'needs delivery instructions'}</p>
        <p><strong>Statement:</strong> {title(statement?.statement_signal)} · overdue {money(statement?.overdue_statement_value)} · {units(statement?.overdue_invoice_count)} overdue invoices</p>
        <p><strong>Top SKU:</strong> {store.top_sku_30d} · {store.top_product_30d} · {units(store.top_sku_units_30d)} units</p>
      </div>
      <div className="owner-store-mini-grid">
        <section><h4>Product mix</h4><div className="owner-store-sku-list">{mix.slice(0, 6).map((row) => <StoreSkuRow key={`${row.store_id}-${row.sku}`} row={row} />)}{!mix.length ? <div className="owner-store-empty">No SKU mix in the last 30 days.</div> : null}</div></section>
        <section><h4>Reorder watch</h4><div className="owner-store-sku-list">{reorder.slice(0, 6).map((row) => <ReorderRow key={`${row.store_id}-${row.sku}`} row={row} />)}{!reorder.length ? <div className="owner-store-empty">No reorder pressure for this store.</div> : null}</div></section>
      </div>
    </section>
  );
}

function StoreContent() {
  const [kpis, setKpis] = useState<OwnerStoreKpis | null>(null);
  const [stores, setStores] = useState<OwnerStorePerformanceRow[]>([]);
  const [mix, setMix] = useState<OwnerStoreSkuMixRow[]>([]);
  const [statements, setStatements] = useState<OwnerStoreStatementSummaryRow[]>([]);
  const [reorder, setReorder] = useState<OwnerStoreReorderWatchRow[]>([]);
  const [gaps, setGaps] = useState<OwnerStoreExperienceGapRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StoreSort>('revenue');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextStores, nextMix, nextStatements, nextReorder, nextGaps] = await Promise.all([
        loadOwnerStoreKpis(), loadOwnerStorePerformance(), loadOwnerStoreSkuMix(), loadOwnerStoreStatementSummary(), loadOwnerStoreReorderWatch(), loadOwnerStoreExperienceGaps(),
      ]);
      setKpis(nextKpis); setStores(nextStores); setMix(nextMix); setStatements(nextStatements); setReorder(nextReorder); setGaps(nextGaps);
      setSelectedStoreId((current) => current || nextStores[0]?.store_id || '');
      setLoadedAt(new Date().toISOString());
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  useEffect(() => { void reload(); }, []);

  const statementByStore = useMemo(() => new Map(statements.map((row) => [row.store_id, row])), [statements]);
  const visibleStores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? stores.filter((store) => [store.store_name, store.address, store.suburb, store.price_group_id, store.store_signal, store.top_sku_30d, store.top_product_30d, statementByStore.get(store.store_id)?.statement_signal].filter(Boolean).join(' ').toLowerCase().includes(needle)) : stores;
    return [...filtered].sort((a, b) => {
      if (sort === 'orders') return num(b.orders_30d) - num(a.orders_30d);
      if (sort === 'statement') return num(statementByStore.get(b.store_id)?.open_statement_value) - num(statementByStore.get(a.store_id)?.open_statement_value);
      if (sort === 'attention') return Number(signalTone(b.store_signal) === 'warn') - Number(signalTone(a.store_signal) === 'warn') || num(b.revenue_30d) - num(a.revenue_30d);
      if (sort === 'recent') return new Date(b.last_order_at || 0).getTime() - new Date(a.last_order_at || 0).getTime();
      return num(b.revenue_30d) - num(a.revenue_30d);
    });
  }, [stores, query, sort, statementByStore]);

  const selectedStore = stores.find((store) => store.store_id === selectedStoreId) || visibleStores[0];
  const selectedMix = mix.filter((row) => row.store_id === selectedStore?.store_id);
  const selectedReorder = reorder.filter((row) => row.store_id === selectedStore?.store_id);
  const selectedStatement = statementByStore.get(selectedStore?.store_id);
  const latest = loadedAt ? new Date(loadedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'loading';
  const attention = num(kpis?.address_attention_stores) + num(kpis?.price_tier_attention_stores) + gaps.length;
  const openStatement = statements.reduce((sum, row) => sum + num(row.open_statement_value), 0);
  const reorderPressure = reorder.filter((row) => row.reorder_signal === 'HIGH_REORDER_PRESSURE' || row.reorder_signal === 'WATCH_REORDER').length;

  return (
    <section className="owner-store-shell">
      <section className="owner-store-hero"><div><span>STORE INTELLIGENCE</span><h2>A better store master than Ordermentum.</h2><p>Customer contribution, statement exposure, delivery readiness, price tier gaps and product mix in one owner view.</p></div><div className="owner-store-actions"><button type="button" onClick={() => void reload()}>Refresh stores</button><small>{latest}</small></div></section>
      {error ? <div className="owner-store-error">{error}</div> : null}
      <section className="owner-store-metrics">
        <Metric label="30d store revenue" value={money(kpis?.revenue_30d)} helper={`${units(kpis?.active_stores_30d)} active stores`} tone="good" />
        <Metric label="Open statement" value={money(openStatement)} helper={`${units(statements.reduce((sum, row) => sum + num(row.open_invoice_count), 0))} open invoices`} tone={openStatement ? 'blue' : 'good'} />
        <Metric label="Reorder pressure" value={units(reorderPressure)} helper="fast repeat store/SKU pairs" tone={reorderPressure ? 'warn' : 'good'} />
        <Metric label="Data attention" value={units(attention)} helper="address / price tier / statement gaps" tone={attention ? 'warn' : 'good'} />
      </section>
      <section className="owner-store-controlbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search store, suburb, SKU, price tier, statement…" /><select value={sort} onChange={(event) => setSort(event.target.value as StoreSort)}><option value="revenue">Sort by revenue</option><option value="orders">Sort by order count</option><option value="statement">Sort by statement</option><option value="attention">Data attention first</option><option value="recent">Most recent order</option></select></section>
      <section className="owner-store-grid"><section className="owner-store-panel"><header><div><h3>Customer contribution</h3><p>Stores ranked by value, statement exposure and operational readiness.</p></div><StorePill tone="blue">{visibleStores.length}</StorePill></header><div className="owner-store-list">{visibleStores.slice(0, 18).map((store) => <StoreRow key={store.store_id || store.store_name || Math.random()} row={store} statement={statementByStore.get(store.store_id)} onSelect={() => setSelectedStoreId(store.store_id || '')} />)}{!visibleStores.length ? <div className="owner-store-empty">No store matches this filter.</div> : null}</div></section><StoreDetail store={selectedStore} mix={selectedMix} statement={selectedStatement} reorder={selectedReorder} /></section>
      <section className="owner-store-bottom-grid"><section className="owner-store-panel"><header><div><h3>Reorder pressure</h3><p>Store/SKU pairs with fast repeat demand.</p></div><StorePill tone={reorderPressure ? 'warn' : 'good'}>{reorderPressure}</StorePill></header><div className="owner-store-sku-list">{reorder.slice(0, 10).map((row) => <ReorderRow key={`${row.store_id}-${row.sku}`} row={row} />)}{!reorder.length ? <div className="owner-store-empty">No reorder pressure yet.</div> : null}</div></section><section className="owner-store-panel"><header><div><h3>Owner action list</h3><p>Fix the gaps Ordermentum does not make easy to manage.</p></div><StorePill tone={gaps.length ? 'warn' : 'good'}>{gaps.length}</StorePill></header><div className="owner-store-sku-list">{gaps.slice(0, 10).map((row) => <GapRow key={`${row.store_id}-${row.owner_action}`} row={row} />)}{!gaps.length ? <div className="owner-store-empty">No store experience gaps.</div> : null}</div></section></section>
    </section>
  );
}

export function OwnerStoreIntelligence() {
  const host = useStoresHost();
  return host ? createPortal(<StoreContent />, host) : null;
}
