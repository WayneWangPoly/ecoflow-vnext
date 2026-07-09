import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  applyInventorySkuAction,
  loadInventoryKpis,
  loadInventorySkuControl,
  type InventoryKpis,
  type InventorySkuAction,
  type InventorySkuControlRow,
} from '@/data/repositories/inventoryControl';

type SortMode = 'rank' | 'units' | 'revenue' | 'barcode' | 'reorder' | 'recent';
type Drafts = { shelf: string; barcode: string; reorder: string; onHand: string; note: string; status: string };

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

function tone(signal?: string | null): 'good' | 'warn' | 'danger' | 'blue' | 'neutral' {
  if (signal === 'CONTROLLED' || signal === 'READY') return 'good';
  if (signal === 'BELOW_TARGET') return 'danger';
  if (signal?.includes('REORDER') || signal?.includes('WATCH')) return 'warn';
  if (signal?.includes('BARCODE') || signal?.includes('NEEDS') || signal?.includes('NO_STOCK')) return 'warn';
  if (signal?.includes('ACTIVE')) return 'blue';
  return 'neutral';
}

function Pill({ children, tone: pillTone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <span className={`inventory-pill inventory-pill-${pillTone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone: metricTone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <article className={`inventory-metric inventory-metric-${metricTone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function useInventoryHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function locate() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Inventory watch');
      const panel = heading?.closest<HTMLElement>('.panel');
      if (!panel) { setHost(null); return; }
      panel.classList.add('inventory-native-watch-soft-hide');
      let mount = document.querySelector<HTMLElement>('.inventory-control-center-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'inventory-control-center-mount';
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

function SkuRow({ row, selected, onSelect }: { row: InventorySkuControlRow; selected: boolean; onSelect: () => void }) {
  return (
    <article className={`inventory-sku-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <b>#{units(row.inventory_rank)}</b>
      <div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Unknown product'}</span><small>{row.fixed_shelf || 'No shelf'} · {row.primary_barcode || 'No barcode'}</small></div>
      <div><strong>{units(row.units_30d)}</strong><span>30d units</span></div>
      <div><strong>{money(row.revenue_30d)}</strong><span>30d value</span></div>
      <div><strong>{row.on_hand_estimate == null ? '—' : units(row.on_hand_estimate)}</strong><span>on hand</span></div>
      <Pill tone={tone(row.inventory_signal)}>{title(row.inventory_signal)}</Pill>
    </article>
  );
}

function SkuDetail({ row, drafts, setDrafts, busyAction, onAction }: { row?: InventorySkuControlRow; drafts: Drafts; setDrafts: (drafts: Drafts) => void; busyAction: string; onAction: (action: InventorySkuAction, value?: string, note?: string) => void }) {
  const set = (key: keyof Drafts, value: string) => setDrafts({ ...drafts, [key]: value });
  const busy = (action: InventorySkuAction) => busyAction === action;
  if (!row) return <section className="inventory-detail inventory-empty">Select a SKU to control shelf, barcode, reorder target and stock note.</section>;
  return (
    <section className="inventory-detail">
      <div className="inventory-detail-hero">
        <div><span>SKU CONTROL</span><h3>{row.sku}</h3><p>{row.product_name || 'Unknown product'}</p></div>
        <Pill tone={tone(row.inventory_signal)}>{title(row.inventory_signal)}</Pill>
      </div>
      <div className="inventory-detail-grid">
        <div><strong>{units(row.units_30d)}</strong><span>30d units</span></div>
        <div><strong>{money(row.revenue_30d)}</strong><span>30d value</span></div>
        <div><strong>{units(row.high_reorder_stores)}</strong><span>high reorder stores</span></div>
        <div><strong>{units(row.barcode_attention_lines)}</strong><span>barcode attention</span></div>
      </div>
      <div className="inventory-note-card"><strong>{row.action_hint}</strong><span>Latest: {title(row.latest_execution_status)} · {dateText(row.latest_action_at)}</span><small>{row.owner_note || 'No owner note yet.'}</small></div>
      <section className="inventory-action-panel">
        <header><h4>Inventory actions</h4><Pill tone="blue">audited</Pill></header>
        <div className="inventory-action-row"><input value={drafts.shelf} onChange={(e) => set('shelf', e.target.value)} placeholder="Fixed shelf / rack, e.g. A4-02-B" /><button type="button" disabled={busy('SET_FIXED_SHELF')} onClick={() => onAction('SET_FIXED_SHELF', drafts.shelf, 'Inventory fixed shelf updated')}>{busy('SET_FIXED_SHELF') ? 'Saving…' : 'Set shelf'}</button></div>
        <div className="inventory-action-row"><input value={drafts.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Primary barcode" /><button type="button" disabled={busy('SET_BARCODE')} onClick={() => onAction('SET_BARCODE', drafts.barcode, 'Inventory barcode updated')}>{busy('SET_BARCODE') ? 'Saving…' : 'Set barcode'}</button></div>
        <div className="inventory-action-row"><input value={drafts.reorder} onChange={(e) => set('reorder', e.target.value)} inputMode="decimal" placeholder="Reorder target" /><button type="button" disabled={busy('SET_REORDER_TARGET')} onClick={() => onAction('SET_REORDER_TARGET', drafts.reorder, 'Inventory reorder target updated')}>{busy('SET_REORDER_TARGET') ? 'Saving…' : 'Set target'}</button></div>
        <div className="inventory-action-row"><input value={drafts.onHand} onChange={(e) => set('onHand', e.target.value)} inputMode="decimal" placeholder="Temporary on-hand estimate" /><button type="button" disabled={busy('SET_ON_HAND_ESTIMATE')} onClick={() => onAction('SET_ON_HAND_ESTIMATE', drafts.onHand, 'Temporary stock estimate updated')}>{busy('SET_ON_HAND_ESTIMATE') ? 'Saving…' : 'Set stock'}</button></div>
        <div className="inventory-action-row"><select value={drafts.status} onChange={(e) => set('status', e.target.value)}><option value="ACTIVE">ACTIVE</option><option value="WATCH">WATCH</option><option value="HOLD">HOLD</option><option value="DISCONTINUED">DISCONTINUED</option></select><button type="button" disabled={busy('SET_STATUS')} onClick={() => onAction('SET_STATUS', drafts.status, 'Inventory SKU status updated')}>{busy('SET_STATUS') ? 'Saving…' : 'Set status'}</button></div>
        <div className="inventory-action-row"><input value={drafts.note} onChange={(e) => set('note', e.target.value)} placeholder="Owner / warehouse note" /><button type="button" disabled={busy('SET_NOTE')} onClick={() => onAction('SET_NOTE', drafts.note, 'Inventory note updated')}>{busy('SET_NOTE') ? 'Saving…' : 'Save note'}</button></div>
        <div className="inventory-action-buttons"><button type="button" disabled={busy('MARK_REVIEWED')} onClick={() => onAction('MARK_REVIEWED', undefined, 'SKU reviewed')}>{busy('MARK_REVIEWED') ? 'Saving…' : 'Mark reviewed'}</button></div>
      </section>
    </section>
  );
}

function InventoryContent() {
  const [kpis, setKpis] = useState<InventoryKpis | null>(null);
  const [rows, setRows] = useState<InventorySkuControlRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('rank');
  const [selectedSku, setSelectedSku] = useState('');
  const [drafts, setDrafts] = useState<Drafts>({ shelf: '', barcode: '', reorder: '', onHand: '', note: '', status: 'ACTIVE' });
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextRows] = await Promise.all([loadInventoryKpis(), loadInventorySkuControl()]);
      setKpis(nextKpis);
      setRows(nextRows);
      setSelectedSku((current) => current || nextRows[0]?.sku || '');
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => [row.sku, row.product_name, row.fixed_shelf, row.primary_barcode, row.inventory_signal, row.owner_note].filter(Boolean).join(' ').toLowerCase().includes(needle)) : rows;
    return [...filtered].sort((a, b) => {
      if (sort === 'units') return num(b.units_30d) - num(a.units_30d);
      if (sort === 'revenue') return num(b.revenue_30d) - num(a.revenue_30d);
      if (sort === 'barcode') return num(b.barcode_attention_lines) - num(a.barcode_attention_lines) || num(b.units_30d) - num(a.units_30d);
      if (sort === 'reorder') return (num(b.high_reorder_stores) + num(b.watch_reorder_stores)) - (num(a.high_reorder_stores) + num(a.watch_reorder_stores)) || num(b.units_30d) - num(a.units_30d);
      if (sort === 'recent') return new Date(b.last_sold_at || 0).getTime() - new Date(a.last_sold_at || 0).getTime();
      return num(a.inventory_rank) - num(b.inventory_rank);
    });
  }, [query, rows, sort]);

  const selected = rows.find((row) => row.sku === selectedSku) || visibleRows[0];
  useEffect(() => {
    setDrafts({ shelf: selected?.fixed_shelf || '', barcode: selected?.primary_barcode || '', reorder: selected?.reorder_target == null ? '' : String(selected.reorder_target), onHand: selected?.on_hand_estimate == null ? '' : String(selected.on_hand_estimate), note: selected?.owner_note || '', status: selected?.control_status || 'ACTIVE' });
  }, [selected?.sku]);

  async function runAction(action: InventorySkuAction, value?: string, note?: string) {
    if (!selected?.sku) return;
    setBusyAction(action);
    setError('');
    setNotice('');
    try {
      const result = await applyInventorySkuAction({ sku: selected.sku, action, value, note });
      const first = result[0];
      setNotice(`${selected.sku}: ${title(first?.execution_status || 'UPDATED')}.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  }

  const attention = num(kpis?.below_target_skus) + num(kpis?.reorder_pressure_skus) + num(kpis?.barcode_cleanup_skus) + num(kpis?.needs_shelf_skus);
  const latest = loadedAt ? new Date(loadedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'loading';

  return (
    <section className="inventory-shell">
      <section className="inventory-hero"><div><span>INVENTORY SKU CONTROL</span><h2>Velocity, shelf, barcode and reorder pressure.</h2><p>SKU control from Ordermentum demand plus EcoFlow warehouse rules. Live ledger can be plugged in later without losing this operating layer.</p></div><div className="inventory-actions"><button type="button" onClick={() => void reload()}>Refresh inventory</button><small>{latest}</small></div></section>
      {error ? <div className="inventory-error">{error}</div> : null}
      {notice ? <div className="inventory-notice">{notice}</div> : null}
      <section className="inventory-metrics"><Metric label="SKU rows" value={units(kpis?.sku_count)} helper={`${units(kpis?.no_stock_ledger_skus)} without live stock ledger`} tone="blue" /><Metric label="30d movement" value={units(kpis?.units_30d)} helper={money(kpis?.revenue_30d)} tone="good" /><Metric label="Attention" value={units(attention)} helper="target / reorder / barcode / shelf" tone={attention ? 'warn' : 'good'} /><Metric label="Top SKU" value={kpis?.top_sku_30d || '—'} helper={kpis?.top_product_30d || 'No product'} tone="neutral" /></section>
      <section className="inventory-controlbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, product, shelf, barcode, note…" /><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="rank">Sort by control priority</option><option value="units">Sort by units</option><option value="revenue">Sort by revenue</option><option value="barcode">Barcode cleanup first</option><option value="reorder">Reorder pressure first</option><option value="recent">Most recent sold</option></select></section>
      <section className="inventory-grid"><section className="inventory-panel"><header><div><h3>SKU control queue</h3><p>Operational SKU list: demand, shelf, barcode and stock control signal.</p></div><Pill tone="blue">{visibleRows.length}</Pill></header><div className="inventory-sku-list">{visibleRows.slice(0, 30).map((row) => <SkuRow key={row.sku || Math.random()} row={row} selected={row.sku === selected?.sku} onSelect={() => setSelectedSku(row.sku || '')} />)}{!visibleRows.length ? <div className="inventory-empty">No SKU rows match this filter.</div> : null}</div></section><SkuDetail row={selected} drafts={drafts} setDrafts={setDrafts} busyAction={busyAction} onAction={runAction} /></section>
    </section>
  );
}

export function InventoryControlCenter() {
  const host = useInventoryHost();
  return host ? createPortal(<InventoryContent />, host) : null;
}
