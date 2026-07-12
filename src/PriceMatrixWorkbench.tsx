import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  bulkAdjustPriceMatrix,
  loadPriceMatrix,
  loadPriceMatrixHistory,
  loadPriceMatrixRole,
  setPriceMatrixPrice,
  type PriceMatrixHistoryRow,
  type PriceMatrixRow,
} from '@/data/repositories/priceMatrix';

function n(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function money(value: unknown) { return n(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }); }
function date(value?: string | null) { return value ? new Date(value).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

function useHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    const active = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button')).some((button) => button.classList.contains('active') && button.textContent?.trim() === 'Stores');
    if (!active) { setHost(null); return; }
    const parent = document.querySelector<HTMLElement>('.desktop-content > .workspace-stack');
    if (!parent) { setHost(null); return; }
    let mount = parent.querySelector<HTMLElement>('.price-matrix-workbench-mount');
    if (!mount) { mount = document.createElement('section'); mount.className = 'price-matrix-workbench-mount'; parent.prepend(mount); }
    setHost(mount);
  }), []);
  return host;
}

type EditState = { sku: string; group: string; value: string; effectiveFrom: string; reason: string };

function History({ rows }: { rows: PriceMatrixHistoryRow[] }) {
  return <div className="price-history-list">{rows.slice(0, 18).map((row) => <article key={row.id}><div><strong>{row.sku}</strong><span>{row.price_group_name || row.price_group_id}</span></div><strong>{money(row.unit_price)}</strong><span>v{row.version_no} · {date(row.effective_from)}</span><small>{row.change_reason}</small></article>)}{!rows.length ? <p>No EcoFlow price changes have been recorded.</p> : null}</div>;
}

function PriceMatrixContent() {
  const [rows, setRows] = useState<PriceMatrixRow[]>([]);
  const [history, setHistory] = useState<PriceMatrixHistoryRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkPercent, setBulkPercent] = useState('');
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkReason, setBulkReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function reload() {
    setError('');
    try {
      const [matrix, audit, role] = await Promise.all([loadPriceMatrix(), loadPriceMatrixHistory(), loadPriceMatrixRole()]);
      setRows(matrix); setHistory(audit);
      setCanEdit(Boolean(role?.is_active && role.team_status === 'ACTIVE' && ['OWNER', 'ADMIN'].includes(role.app_role)));
      setBulkGroup((current) => current || matrix[0]?.price_group_id || '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  useEffect(() => { void reload(); }, []);

  const groups = useMemo(() => [...new Map(rows.map((row) => [row.price_group_id, row.price_group_name])).entries()].map(([id, name]) => ({ id, name })), [rows]);
  const skuRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const bySku = new Map<string, { sku: string; product: string; cells: Map<string, PriceMatrixRow> }>();
    rows.forEach((row) => {
      if (needle && !`${row.sku} ${row.product_name || ''}`.toLowerCase().includes(needle)) return;
      const item = bySku.get(row.sku) ?? { sku: row.sku, product: row.product_name || 'Product name pending', cells: new Map() };
      item.cells.set(row.price_group_id, row); bySku.set(row.sku, item);
    });
    return [...bySku.values()].slice(0, 500);
  }, [rows, query]);

  async function saveEdit() {
    if (!edit) return;
    const value = Number(edit.value);
    if (!Number.isFinite(value) || value < 0 || !edit.reason.trim()) { setError('Enter a valid price and a change reason.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await setPriceMatrixPrice({ sku: edit.sku, priceGroupId: edit.group, unitPrice: value, effectiveFrom: edit.effectiveFrom, reason: edit.reason });
      setNotice(`${edit.sku} price version saved.`); setEdit(null); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function runBulk() {
    const percent = Number(bulkPercent);
    if (!bulkGroup || !Number.isFinite(percent) || !bulkReason.trim()) { setError('Select a tier and enter a percentage and reason.'); return; }
    if (!window.confirm(`Apply ${percent}% to every visible SKU in ${groups.find((g) => g.id === bulkGroup)?.name || bulkGroup}? A new version is recorded for each SKU.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const selectedSkus = skuRows.map((row) => row.sku);
      const result = await bulkAdjustPriceMatrix({ priceGroupId: bulkGroup, percent, effectiveFrom: bulkDate, reason: bulkReason, skus: selectedSkus });
      setNotice(`${n((result as Array<Record<string, unknown>>)[0]?.adjusted_count)} price rows versioned.`); setBulkPercent(''); setBulkReason(''); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <section className="price-matrix-shell">
    <header className="price-matrix-hero"><div><span>COMMERCIAL CONTROL</span><h2>SKU price matrix</h2><p>EcoFlow target prices by live Ordermentum price group. Every change is versioned; this does not silently push prices back to Ordermentum.</p></div><div><strong>{groups.length}</strong><span>mirrored price groups</span><button type="button" onClick={() => void reload()} disabled={busy}>Refresh</button></div></header>
    {!groups.length ? <div className="price-matrix-warning">No Ordermentum price groups are currently available to the matrix. Run the Store/price-group sync before changing prices.</div> : groups.length !== 4 ? <div className="price-matrix-notice">Ordermentum currently returns {groups.length} price groups. The matrix is using that live master; identify the four customer-facing tiers before any bulk price change.</div> : null}
    {error ? <div className="price-matrix-error">{error}</div> : null}{notice ? <div className="price-matrix-notice">{notice}</div> : null}
    <section className="price-matrix-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU or product" />{canEdit ? <><select value={bulkGroup} onChange={(event) => setBulkGroup(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><input type="number" step="0.1" value={bulkPercent} onChange={(event) => setBulkPercent(event.target.value)} placeholder="Bulk %" /><input type="date" value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} /><input value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} placeholder="Mandatory reason" /><button type="button" disabled={busy} onClick={() => void runBulk()}>Preview & apply</button></> : <strong>Read-only commercial view</strong>}</section>
    <section className="price-matrix-layout"><div className="price-matrix-table-wrap"><table className="price-matrix-table"><thead><tr><th>SKU / product</th>{groups.map((group) => <th key={group.id}>{group.name}</th>)}</tr></thead><tbody>{skuRows.map((item) => <tr key={item.sku}><th><strong>{item.sku}</strong><span>{item.product}</span></th>{groups.map((group) => { const cell = item.cells.get(group.id); return <td key={group.id}><button type="button" disabled={!canEdit} className={cell?.has_override ? 'overridden' : ''} onClick={() => setEdit({ sku: item.sku, group: group.id, value: String(n(cell?.effective_price).toFixed(2)), effectiveFrom: new Date().toISOString().slice(0, 10), reason: '' })}><strong>{money(cell?.effective_price)}</strong><small>{cell?.has_override ? `EcoFlow v${cell.version_no}` : 'Ordermentum base'}</small></button></td>; })}</tr>)}</tbody></table>{!skuRows.length ? <p>No matching SKU rows.</p> : null}</div><aside className="price-history"><h3>Recent price history</h3><History rows={history} /></aside></section>
    {edit ? <div className="price-edit-backdrop" role="presentation"><section className="price-edit-dialog" role="dialog" aria-modal="true"><h3>{edit.sku} · {groups.find((g) => g.id === edit.group)?.name}</h3><label>Unit price<input type="number" min="0" step="0.01" value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })} /></label><label>Effective from<input type="date" value={edit.effectiveFrom} onChange={(event) => setEdit({ ...edit, effectiveFrom: event.target.value })} /></label><label>Change reason<textarea value={edit.reason} onChange={(event) => setEdit({ ...edit, reason: event.target.value })} placeholder="Why is this price changing?" /></label><div><button type="button" onClick={() => setEdit(null)}>Cancel</button><button type="button" disabled={busy} onClick={() => void saveEdit()}>Save new version</button></div></section></div> : null}
  </section>;
}

export function PriceMatrixWorkbench() { const host = useHost(); return host ? createPortal(<PriceMatrixContent />, host) : null; }
