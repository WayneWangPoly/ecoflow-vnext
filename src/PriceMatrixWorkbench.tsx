import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { loadPriceMatrix, type PriceMatrixRow } from '@/data/repositories/priceMatrix';

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return n(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });
}

function date(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

function useHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    const active = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button'))
      .some((button) => button.classList.contains('active') && ['Stores', 'Stores Mirror'].includes(button.textContent?.trim() || ''));
    if (!active) { setHost(null); return; }
    const parent = document.querySelector<HTMLElement>('.desktop-content > .workspace-stack');
    if (!parent) { setHost(null); return; }
    let mount = parent.querySelector<HTMLElement>('.price-matrix-workbench-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'price-matrix-workbench-mount';
      parent.prepend(mount);
    }
    setHost(mount);
  }), []);
  return host;
}

function PriceMatrixContent() {
  const [rows, setRows] = useState<PriceMatrixRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try { setRows(await loadPriceMatrix()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, []);

  const groups = useMemo(() => [...new Map(rows.map((row) => [row.price_group_id, row.price_group_name])).entries()]
    .map(([id, name]) => ({ id, name })), [rows]);
  const skuRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const bySku = new Map<string, { sku: string; product: string; syncedAt: string | null; cells: Map<string, PriceMatrixRow> }>();
    rows.forEach((row) => {
      if (needle && !`${row.sku} ${row.product_name || ''}`.toLowerCase().includes(needle)) return;
      const item = bySku.get(row.sku) ?? { sku: row.sku, product: row.product_name || 'Product name pending', syncedAt: row.sku_last_synced_at, cells: new Map() };
      item.cells.set(row.price_group_id, row);
      if (row.sku_last_synced_at && (!item.syncedAt || row.sku_last_synced_at > item.syncedAt)) item.syncedAt = row.sku_last_synced_at;
      bySku.set(row.sku, item);
    });
    return [...bySku.values()].slice(0, 1000);
  }, [rows, query]);

  return (
    <section className="price-matrix-shell">
      <header className="price-matrix-hero">
        <div>
          <span>ORDERMENTUM PRICE MIRROR · READ ONLY</span>
          <h2>SKU price groups</h2>
          <p>Every selling price and price-group assignment is managed in Ordermentum. EcoFlow mirrors the latest source values for operations and analysis; it cannot create local overrides.</p>
        </div>
        <div><strong>{groups.length}</strong><span>source price groups</span><button type="button" onClick={() => void reload()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh mirror'}</button></div>
      </header>
      <div className="price-matrix-notice">To add, change or remove a price, update Ordermentum and run the complete mirror. Local EcoFlow price versions are disabled.</div>
      {error ? <div className="price-matrix-error">Price mirror unavailable: {error}</div> : null}
      <section className="price-matrix-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mirrored SKU or product" /><strong>Read-only commercial source</strong></section>
      <section className="price-matrix-layout">
        <div className="price-matrix-table-wrap">
          <table className="price-matrix-table">
            <thead><tr><th>SKU / product</th>{groups.map((group) => <th key={group.id}>{group.name}</th>)}</tr></thead>
            <tbody>{skuRows.map((item) => (
              <tr key={item.sku}>
                <th><strong>{item.sku}</strong><span>{item.product}</span><small>synced {date(item.syncedAt)}</small></th>
                {groups.map((group) => {
                  const cell = item.cells.get(group.id);
                  return <td key={group.id}><strong>{cell ? money(cell.source_base_price ?? cell.effective_price) : '—'}</strong><small>Ordermentum source</small></td>;
                })}
              </tr>
            ))}</tbody>
          </table>
          {!skuRows.length ? <p>{loading ? 'Loading Ordermentum prices…' : 'No mirrored price rows match this search.'}</p> : null}
        </div>
      </section>
    </section>
  );
}

export function PriceMatrixWorkbench() {
  const host = useHost();
  return host ? createPortal(<PriceMatrixContent />, host) : null;
}
