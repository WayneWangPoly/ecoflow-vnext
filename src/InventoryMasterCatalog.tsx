import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import { loadOrdermentumSyncSnapshot, triggerOrdermentumSync } from '@/features/team/ordermentumSync';
import type { InventorySkuControlRow } from '@/data/repositories/inventoryControl';
import './inventoryMasterCatalog.css';

function useCatalogHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    const active = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button')).some((button) => button.classList.contains('active') && button.textContent?.trim() === 'Inventory');
    if (!active) { setHost(null); return; }
    const controlMount = document.querySelector<HTMLElement>('.inventory-control-center-mount');
    if (!controlMount) { setHost(null); return; }
    let mount = document.querySelector<HTMLElement>('.inventory-master-catalog-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'inventory-master-catalog-mount';
      controlMount.insertAdjacentElement('afterend', mount);
    }
    setHost(mount);
  }), []);
  return host;
}

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadAllSkuRows() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const rows: InventorySkuControlRow[] = [];
  const pageSize = 500;
  for (let start = 0; start < 10000; start += pageSize) {
    const { data, error } = await supabase
      .from('v_ecoflow_inventory_sku_control')
      .select('*')
      .order('sku', { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as InventorySkuControlRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function Catalog() {
  const [rows, setRows] = useState<InventorySkuControlRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setError('');
    try {
      const next = await loadAllSkuRows();
      setRows(next);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return [];
    }
  }

  useEffect(() => { void reload(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [row.sku,row.product_name,row.fixed_shelf,row.primary_barcode,row.control_status].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [query, rows]);

  async function syncAllSkus() {
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('Starting Ordermentum product and variant sync…');
    const requestedAt = Date.now();
    try {
      await triggerOrdermentumSync(supabase, { mode: 'sku_only', reason: 'Owner refreshed complete Inventory SKU master' });
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const snapshot = await loadOrdermentumSyncSnapshot(supabase);
        const relevant = snapshot.masterHealth.filter((row) => ['products','variants'].some((type) => String(row.resource_type || '').toLowerCase().includes(type)));
        const latest = Math.max(0, ...relevant.map((row) => row.latest_synced_at ? new Date(row.latest_synced_at).getTime() : 0));
        if (latest >= requestedAt - 2000) {
          const next = await reload();
          setNotice(`Ordermentum SKU sync complete. ${next.length.toLocaleString('en-AU')} database SKUs are available to Inventory.`);
          return;
        }
      }
      setNotice('SKU sync is still running in the cloud. Refresh Inventory when it completes.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const active = rows.filter((row) => row.control_status !== 'DISCONTINUED').length;
  const withBarcode = rows.filter((row) => row.primary_barcode).length;
  const withShelf = rows.filter((row) => row.fixed_shelf).length;

  return <section className="inventory-master-catalog">
    <header><div><span>COMPLETE SKU MASTER</span><h3>All Ordermentum SKUs in the database</h3><p>This list starts from the full product and variant master, including SKUs with no recent sales or stock movement.</p></div><div><button type="button" disabled={busy} onClick={() => void syncAllSkus()}>{busy ? 'Syncing…' : 'Sync all SKUs from Ordermentum'}</button><button type="button" disabled={busy} onClick={() => void reload()}>Refresh list</button></div></header>
    {error ? <div className="inventory-master-error">{error}</div> : null}{notice ? <div className="inventory-master-notice">{notice}</div> : null}
    <section className="inventory-master-metrics"><div><strong>{rows.length}</strong><span>database SKUs</span></div><div><strong>{active}</strong><span>active</span></div><div><strong>{withBarcode}</strong><span>with barcode</span></div><div><strong>{withShelf}</strong><span>with shelf</span></div></section>
    <div className="inventory-master-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all SKU, product, shelf or barcode…" /><strong>{visible.length} shown</strong></div>
    <div className="inventory-master-list">{visible.map((row) => <article key={row.sku || `unknown-${row.inventory_rank}`}><div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Product name pending'}</span></div><span>{row.fixed_shelf || 'No shelf'}</span><span>{row.primary_barcode || 'No barcode'}</span><span>{n(row.effective_on_hand).toLocaleString('en-AU')} stock</span><b>{String(row.inventory_signal || 'PENDING').replaceAll('_',' ')}</b></article>)}</div>
  </section>;
}

export function InventoryMasterCatalog() {
  const host = useCatalogHost();
  return host ? createPortal(<Catalog />, host) : null;
}
