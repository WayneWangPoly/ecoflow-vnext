import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  applyInventorySkuAction,
  loadInventoryKpis,
  loadInventoryLocationBalances,
  loadInventoryRecentMovements,
  loadInventorySkuControl,
  recordInventoryMovement,
  type InventoryKpis,
  type InventoryLocationBalanceRow,
  type InventoryMovementRow,
  type InventoryMovementType,
  type InventorySkuAction,
  type InventorySkuControlRow,
} from '@/data/repositories/inventoryControl';

type SortMode = 'rank' | 'units' | 'revenue' | 'barcode' | 'reorder' | 'recent' | 'stock';
type Drafts = { shelf: string; barcode: string; reorder: string; onHand: string; note: string; status: string };
type MovementDrafts = { movementType: InventoryMovementType; qty: string; from: string; to: string; reference: string; note: string };

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

function stockValue(row?: InventorySkuControlRow) {
  return row?.effective_on_hand ?? row?.on_hand_live ?? row?.on_hand_estimate;
}

function tone(signal?: string | null): 'good' | 'warn' | 'danger' | 'blue' | 'neutral' {
  if (signal === 'CONTROLLED' || signal === 'READY') return 'good';
  if (signal === 'BELOW_TARGET' || signal === 'NEGATIVE_STOCK') return 'danger';
  if (signal?.includes('REORDER') || signal?.includes('WATCH')) return 'warn';
  if (signal?.includes('BARCODE') || signal?.includes('NEEDS') || signal?.includes('NO_STOCK')) return 'warn';
  if (signal?.includes('ACTIVE') || signal?.includes('LIVE')) return 'blue';
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
  const stock = stockValue(row);
  return (
    <article className={`inventory-sku-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <b>#{units(row.inventory_rank)}</b>
      <div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Unknown product'}</span><small>{row.fixed_shelf || 'No shelf'} · {row.primary_barcode || 'No barcode'}</small></div>
      <div><strong>{units(row.units_30d)}</strong><span>30d units</span></div>
      <div><strong>{money(row.revenue_30d)}</strong><span>30d value</span></div>
      <div><strong>{stock == null ? '—' : units(stock)}</strong><span>{row.stock_source === 'LIVE_LEDGER' ? 'live stock' : 'stock'}</span></div>
      <Pill tone={tone(row.inventory_signal)}>{title(row.inventory_signal)}</Pill>
    </article>
  );
}

function MovementRow({ movement }: { movement: InventoryMovementRow }) {
  return (
    <article className="inventory-movement-row">
      <div><strong>{title(movement.movement_type)}</strong><span>{movement.from_location || '—'} → {movement.to_location || '—'}</span></div>
      <strong>{units(movement.quantity)}</strong>
      <small>{dateText(movement.moved_at)}</small>
    </article>
  );
}

function LocationRow({ balance }: { balance: InventoryLocationBalanceRow }) {
  return <article className="inventory-location-row"><strong>{balance.location || 'Unknown'}</strong><span>{units(balance.on_hand_location)} units</span></article>;
}

function MovementPanel({ movementDrafts, setMovementDrafts, busyMovement, onMovement }: { movementDrafts: MovementDrafts; setMovementDrafts: (drafts: MovementDrafts) => void; busyMovement: string; onMovement: (drafts: MovementDrafts) => void }) {
  const set = (key: keyof MovementDrafts, value: string) => setMovementDrafts({ ...movementDrafts, [key]: value });
  const type = movementDrafts.movementType;
  const needsFrom = type === 'PUTAWAY' || type === 'DISPATCH' || type === 'ADJUST_OUT';
  const needsTo = type === 'PUTAWAY' || type === 'RECEIVE' || type === 'ADJUST_IN' || type === 'RETURN_IN';
  return (
    <section className="inventory-movement-panel">
      <header><h4>Live movement ledger</h4><Pill tone="blue">stock source</Pill></header>
      <div className="inventory-movement-grid">
        <select value={movementDrafts.movementType} onChange={(e) => set('movementType', e.target.value as InventoryMovementType)}>
          <option value="RECEIVE">Receive</option>
          <option value="PUTAWAY">Putaway</option>
          <option value="DISPATCH">Dispatch</option>
          <option value="ADJUST_IN">Adjust in</option>
          <option value="ADJUST_OUT">Adjust out</option>
          <option value="RETURN_IN">Return in</option>
        </select>
        <input value={movementDrafts.qty} onChange={(e) => set('qty', e.target.value)} inputMode="decimal" placeholder="Qty" />
        <input value={movementDrafts.from} onChange={(e) => set('from', e.target.value)} placeholder={needsFrom ? 'From location required' : 'From location optional'} />
        <input value={movementDrafts.to} onChange={(e) => set('to', e.target.value)} placeholder={needsTo ? 'To location required' : 'To location optional'} />
        <input value={movementDrafts.reference} onChange={(e) => set('reference', e.target.value)} placeholder="PO / order / reason" />
        <input value={movementDrafts.note} onChange={(e) => set('note', e.target.value)} placeholder="Movement note" />
      </div>
      <button type="button" disabled={Boolean(busyMovement)} onClick={() => onMovement(movementDrafts)}>{busyMovement ? 'Recording…' : 'Record movement'}</button>
    </section>
  );
}

function SkuDetail({ row, drafts, setDrafts, movementDrafts, setMovementDrafts, busyAction, busyMovement, onAction, onMovement, movements, balances }: { row?: InventorySkuControlRow; drafts: Drafts; setDrafts: (drafts: Drafts) => void; movementDrafts: MovementDrafts; setMovementDrafts: (drafts: MovementDrafts) => void; busyAction: string; busyMovement: string; onAction: (action: InventorySkuAction, value?: string, note?: string) => void; onMovement: (drafts: MovementDrafts) => void; movements: InventoryMovementRow[]; balances: InventoryLocationBalanceRow[] }) {
  const set = (key: keyof Drafts, value: string) => setDrafts({ ...drafts, [key]: value });
  const busy = (action: InventorySkuAction) => busyAction === action;
  if (!row) return <section className="inventory-detail inventory-empty">Select a SKU to control shelf, barcode, reorder target and stock note.</section>;
  const stock = stockValue(row);
  return (
    <section className="inventory-detail">
      <div className="inventory-detail-hero">
        <div><span>SKU CONTROL</span><h3>{row.sku}</h3><p>{row.product_name || 'Unknown product'}</p></div>
        <Pill tone={tone(row.inventory_signal)}>{title(row.inventory_signal)}</Pill>
      </div>
      <div className="inventory-detail-grid">
        <div><strong>{stock == null ? '—' : units(stock)}</strong><span>{row.stock_source === 'LIVE_LEDGER' ? 'live on hand' : 'effective stock'}</span></div>
        <div><strong>{units(row.units_30d)}</strong><span>30d units</span></div>
        <div><strong>{units(row.high_reorder_stores)}</strong><span>high reorder stores</span></div>
        <div><strong>{units(row.barcode_attention_lines)}</strong><span>barcode attention</span></div>
      </div>
      <div className="inventory-note-card"><strong>{row.action_hint}</strong><span>{title(row.stock_source)} · movements {units(row.movement_count)} · latest {dateText(row.latest_movement_at || row.latest_action_at)}</span><small>{row.owner_note || 'No owner note yet.'}</small></div>
      <MovementPanel movementDrafts={movementDrafts} setMovementDrafts={setMovementDrafts} busyMovement={busyMovement} onMovement={onMovement} />
      <section className="inventory-action-panel">
        <header><h4>SKU controls</h4><Pill tone="blue">audited</Pill></header>
        <div className="inventory-action-row"><input value={drafts.shelf} onChange={(e) => set('shelf', e.target.value)} placeholder="Fixed shelf / rack, e.g. A4-02-B" /><button type="button" disabled={busy('SET_FIXED_SHELF')} onClick={() => onAction('SET_FIXED_SHELF', drafts.shelf, 'Inventory fixed shelf updated')}>{busy('SET_FIXED_SHELF') ? 'Saving…' : 'Set shelf'}</button></div>
        <div className="inventory-action-row"><input value={drafts.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Primary barcode" /><button type="button" disabled={busy('SET_BARCODE')} onClick={() => onAction('SET_BARCODE', drafts.barcode, 'Inventory barcode updated')}>{busy('SET_BARCODE') ? 'Saving…' : 'Set barcode'}</button></div>
        <div className="inventory-action-row"><input value={drafts.reorder} onChange={(e) => set('reorder', e.target.value)} inputMode="decimal" placeholder="Reorder target" /><button type="button" disabled={busy('SET_REORDER_TARGET')} onClick={() => onAction('SET_REORDER_TARGET', drafts.reorder, 'Inventory reorder target updated')}>{busy('SET_REORDER_TARGET') ? 'Saving…' : 'Set target'}</button></div>
        <div className="inventory-action-row"><input value={drafts.onHand} onChange={(e) => set('onHand', e.target.value)} inputMode="decimal" placeholder="Temporary on-hand estimate" /><button type="button" disabled={busy('SET_ON_HAND_ESTIMATE')} onClick={() => onAction('SET_ON_HAND_ESTIMATE', drafts.onHand, 'Temporary stock estimate updated')}>{busy('SET_ON_HAND_ESTIMATE') ? 'Saving…' : 'Set estimate'}</button></div>
        <div className="inventory-action-row"><select value={drafts.status} onChange={(e) => set('status', e.target.value)}><option value="ACTIVE">ACTIVE</option><option value="WATCH">WATCH</option><option value="HOLD">HOLD</option><option value="DISCONTINUED">DISCONTINUED</option></select><button type="button" disabled={busy('SET_STATUS')} onClick={() => onAction('SET_STATUS', drafts.status, 'Inventory SKU status updated')}>{busy('SET_STATUS') ? 'Saving…' : 'Set status'}</button></div>
        <div className="inventory-action-row"><input value={drafts.note} onChange={(e) => set('note', e.target.value)} placeholder="Owner / warehouse note" /><button type="button" disabled={busy('SET_NOTE')} onClick={() => onAction('SET_NOTE', drafts.note, 'Inventory note updated')}>{busy('SET_NOTE') ? 'Saving…' : 'Save note'}</button></div>
        <div className="inventory-action-buttons"><button type="button" disabled={busy('MARK_REVIEWED')} onClick={() => onAction('MARK_REVIEWED', undefined, 'SKU reviewed')}>{busy('MARK_REVIEWED') ? 'Saving…' : 'Mark reviewed'}</button></div>
      </section>
      <section className="inventory-ledger-grid">
        <div><h4>Location balance</h4>{balances.slice(0, 6).map((balance) => <LocationRow key={`${balance.sku}-${balance.location}`} balance={balance} />)}{!balances.length ? <div className="inventory-empty">No location balance yet.</div> : null}</div>
        <div><h4>Recent movements</h4>{movements.slice(0, 6).map((movement) => <MovementRow key={movement.id} movement={movement} />)}{!movements.length ? <div className="inventory-empty">No movements yet.</div> : null}</div>
      </section>
    </section>
  );
}

function InventoryContent() {
  const [kpis, setKpis] = useState<InventoryKpis | null>(null);
  const [rows, setRows] = useState<InventorySkuControlRow[]>([]);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [balances, setBalances] = useState<InventoryLocationBalanceRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('rank');
  const [selectedSku, setSelectedSku] = useState('');
  const [drafts, setDrafts] = useState<Drafts>({ shelf: '', barcode: '', reorder: '', onHand: '', note: '', status: 'ACTIVE' });
  const [movementDrafts, setMovementDrafts] = useState<MovementDrafts>({ movementType: 'RECEIVE', qty: '', from: '', to: 'RECEIVING', reference: '', note: '' });
  const [busyAction, setBusyAction] = useState('');
  const [busyMovement, setBusyMovement] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextRows, nextMovements, nextBalances] = await Promise.all([loadInventoryKpis(), loadInventorySkuControl(), loadInventoryRecentMovements(), loadInventoryLocationBalances()]);
      setKpis(nextKpis);
      setRows(nextRows);
      setMovements(nextMovements);
      setBalances(nextBalances);
      setSelectedSku((current) => current || nextRows[0]?.sku || '');
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => [row.sku, row.product_name, row.fixed_shelf, row.primary_barcode, row.inventory_signal, row.owner_note, row.stock_source].filter(Boolean).join(' ').toLowerCase().includes(needle)) : rows;
    return [...filtered].sort((a, b) => {
      if (sort === 'units') return num(b.units_30d) - num(a.units_30d);
      if (sort === 'revenue') return num(b.revenue_30d) - num(a.revenue_30d);
      if (sort === 'stock') return num(stockValue(a)) - num(stockValue(b));
      if (sort === 'barcode') return num(b.barcode_attention_lines) - num(a.barcode_attention_lines) || num(b.units_30d) - num(a.units_30d);
      if (sort === 'reorder') return (num(b.high_reorder_stores) + num(b.watch_reorder_stores)) - (num(a.high_reorder_stores) + num(a.watch_reorder_stores)) || num(b.units_30d) - num(a.units_30d);
      if (sort === 'recent') return new Date(b.latest_movement_at || b.last_sold_at || 0).getTime() - new Date(a.latest_movement_at || a.last_sold_at || 0).getTime();
      return num(a.inventory_rank) - num(b.inventory_rank);
    });
  }, [query, rows, sort]);

  const selected = rows.find((row) => row.sku === selectedSku) || visibleRows[0];
  const selectedMovements = movements.filter((movement) => movement.sku === selected?.sku);
  const selectedBalances = balances.filter((balance) => balance.sku === selected?.sku);

  useEffect(() => {
    setDrafts({ shelf: selected?.fixed_shelf || '', barcode: selected?.primary_barcode || '', reorder: selected?.reorder_target == null ? '' : String(selected.reorder_target), onHand: selected?.on_hand_estimate == null ? '' : String(selected.on_hand_estimate), note: selected?.owner_note || '', status: selected?.control_status || 'ACTIVE' });
    setMovementDrafts((current) => ({ ...current, from: selected?.fixed_shelf || current.from, to: selected?.fixed_shelf || current.to || 'RECEIVING' }));
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

  async function runMovement(draft: MovementDrafts) {
    if (!selected?.sku) return;
    setBusyMovement(draft.movementType);
    setError('');
    setNotice('');
    try {
      const result = await recordInventoryMovement({ sku: selected.sku, movementType: draft.movementType, quantity: draft.qty, fromLocation: draft.from, toLocation: draft.to, referenceType: draft.reference ? 'MANUAL' : null, referenceId: draft.reference, note: draft.note, source: 'INVENTORY_CONTROL' });
      const first = result[0];
      setNotice(`${selected.sku}: ${title(first?.movement_type || draft.movementType)} ${units(first?.quantity || draft.qty)} recorded.`);
      setMovementDrafts((current) => ({ ...current, qty: '', reference: '', note: '' }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMovement('');
    }
  }

  const attention = num(kpis?.negative_stock_skus) + num(kpis?.below_target_skus) + num(kpis?.reorder_pressure_skus) + num(kpis?.barcode_cleanup_skus) + num(kpis?.needs_shelf_skus);
  const latest = loadedAt ? new Date(loadedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'loading';

  return (
    <section className="inventory-shell">
      <section className="inventory-hero"><div><span>INVENTORY SKU CONTROL</span><h2>Live movement ledger, shelf, barcode and reorder pressure.</h2><p>Receiving, putaway, dispatch and adjustments now flow into live SKU stock balance while preserving the owner control layer.</p></div><div className="inventory-actions"><button type="button" onClick={() => void reload()}>Refresh inventory</button><small>{latest}</small></div></section>
      {error ? <div className="inventory-error">{error}</div> : null}
      {notice ? <div className="inventory-notice">{notice}</div> : null}
      <section className="inventory-metrics"><Metric label="Live ledger SKUs" value={units(kpis?.live_ledger_skus)} helper={`${units(kpis?.live_on_hand_units)} live on-hand units`} tone="blue" /><Metric label="30d movement" value={units(kpis?.units_30d)} helper={money(kpis?.revenue_30d)} tone="good" /><Metric label="Attention" value={units(attention)} helper="negative / target / reorder / barcode / shelf" tone={attention ? 'warn' : 'good'} /><Metric label="Top SKU" value={kpis?.top_sku_30d || '—'} helper={kpis?.top_product_30d || 'No product'} tone="neutral" /></section>
      <section className="inventory-controlbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, product, shelf, barcode, note…" /><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="rank">Sort by control priority</option><option value="stock">Lowest effective stock</option><option value="units">Sort by units</option><option value="revenue">Sort by revenue</option><option value="barcode">Barcode cleanup first</option><option value="reorder">Reorder pressure first</option><option value="recent">Most recent activity</option></select></section>
      <section className="inventory-grid"><section className="inventory-panel"><header><div><h3>SKU control queue</h3><p>Demand, shelf, barcode and live stock ledger signal.</p></div><Pill tone="blue">{visibleRows.length}</Pill></header><div className="inventory-sku-list">{visibleRows.slice(0, 30).map((row) => <SkuRow key={row.sku || Math.random()} row={row} selected={row.sku === selected?.sku} onSelect={() => setSelectedSku(row.sku || '')} />)}{!visibleRows.length ? <div className="inventory-empty">No SKU rows match this filter.</div> : null}</div></section><SkuDetail row={selected} drafts={drafts} setDrafts={setDrafts} movementDrafts={movementDrafts} setMovementDrafts={setMovementDrafts} busyAction={busyAction} busyMovement={busyMovement} onAction={runAction} onMovement={runMovement} movements={selectedMovements} balances={selectedBalances} /></section>
    </section>
  );
}

export function InventoryControlCenter() {
  const host = useInventoryHost();
  return host ? createPortal(<InventoryContent />, host) : null;
}
