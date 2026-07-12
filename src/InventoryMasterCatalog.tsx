import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import { loadOrdermentumSyncSnapshot, triggerOrdermentumSync } from '@/features/team/ordermentumSync';
import type { InventorySkuControlRow } from '@/data/repositories/inventoryControl';
import './inventoryMasterCatalog.css';

type ProjectionHealth = {
  raw_products: number | string | null;
  raw_variants: number | string | null;
  projected_skus: number | string | null;
  projected_price_groups: number | string | null;
  latest_sku_master_sync_at: string | null;
};

type CanonicalSkuRow = {
  source_type: string | null;
  external_sku_code: string | null;
  external_product_name: string | null;
  external_variant_name: string | null;
  base_price: number | string | null;
  source_status: string | null;
  last_synced_at: string | null;
  raw_payload: Record<string, unknown> | null;
};

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

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function loadPagedInventoryRows() {
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

function canonicalToInventory(rows: CanonicalSkuRow[]) {
  const bySku = new Map<string, { priority: number; row: InventorySkuControlRow }>();
  rows.forEach((source, index) => {
    const payload = source.raw_payload ?? {};
    const sku = text(source.external_sku_code) || text(payload.SKU) || text(payload.sku) || text(payload.variantSku) || text(payload.itemCode) || text(payload.code);
    if (!sku) return;
    const key = sku.toUpperCase();
    const priority = String(source.source_type || '').toLowerCase() === 'variant' ? 0 : 1;
    const candidate: InventorySkuControlRow = {
      sku,
      product_name: text(source.external_variant_name) || text(source.external_product_name) || text(payload.name) || 'Product name pending',
      category: null,
      fixed_shelf: null,
      primary_barcode: text(payload.barcode) || null,
      reorder_target: null,
      on_hand_estimate: null,
      on_hand_live: null,
      stock_source: 'MASTER_ONLY',
      effective_on_hand: 0,
      movement_count: null,
      latest_movement_at: null,
      control_status: text(source.source_status).toUpperCase() || 'ACTIVE',
      owner_note: null,
      revenue_7d: 0,
      revenue_30d: 0,
      units_7d: 0,
      units_30d: 0,
      order_count_30d: 0,
      avg_unit_price: source.base_price,
      last_sold_at: null,
      barcode_attention_lines: 0,
      latest_barcode_status: text(payload.barcode) ? 'ORDERMENTUM_CANDIDATE' : null,
      high_reorder_stores: 0,
      watch_reorder_stores: 0,
      latest_store_reorder_at: null,
      latest_action: null,
      latest_execution_status: null,
      latest_action_at: null,
      inventory_signal: 'NO_STOCK_LEDGER',
      action_hint: 'Complete first stocktake / receiving and assign a warehouse location',
      inventory_rank: index + 1,
    };
    const existing = bySku.get(key);
    if (!existing || priority < existing.priority) bySku.set(key, { priority, row: candidate });
  });
  return [...bySku.values()].map((value) => value.row).sort((a, b) => String(a.sku).localeCompare(String(b.sku), undefined, { numeric: true }));
}

async function loadCanonicalFallback() {
  if (!supabase) return [];
  const rows: CanonicalSkuRow[] = [];
  const pageSize = 500;
  for (let start = 0; start < 5000; start += pageSize) {
    const { data, error } = await supabase
      .from('v_ecoflow_ordermentum_sku_master_v1')
      .select('source_type,external_sku_code,external_product_name,external_variant_name,base_price,source_status,last_synced_at,raw_payload')
      .range(start, start + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as CanonicalSkuRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return canonicalToInventory(rows);
}

async function loadProjectionHealth() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('v_ecoflow_master_projection_health').select('*').maybeSingle();
  if (error) return null;
  return data as ProjectionHealth | null;
}

async function loadAllSkuRows() {
  const projected = await loadPagedInventoryRows();
  if (projected.length) return { rows: projected, source: 'INVENTORY_CONTROL' as const };
  const fallback = await loadCanonicalFallback();
  return { rows: fallback, source: fallback.length ? 'CANONICAL_FALLBACK' as const : 'EMPTY' as const };
}

function Catalog() {
  const [rows, setRows] = useState<InventorySkuControlRow[]>([]);
  const [projection, setProjection] = useState<ProjectionHealth | null>(null);
  const [source, setSource] = useState<'INVENTORY_CONTROL' | 'CANONICAL_FALLBACK' | 'EMPTY'>('EMPTY');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setError('');
    try {
      const [catalog, health] = await Promise.all([loadAllSkuRows(), loadProjectionHealth()]);
      setRows(catalog.rows);
      setSource(catalog.source);
      setProjection(health);
      if (catalog.source === 'CANONICAL_FALLBACK') {
        setNotice(`${catalog.rows.length.toLocaleString('en-AU')} unique SKUs recovered from the synced Ordermentum master. Inventory control fields will join automatically after the projection repair finishes.`);
      } else if (catalog.source === 'INVENTORY_CONTROL') {
        setNotice('');
      }
      return catalog.rows;
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
    setBusy(true); setError(''); setNotice('Ordermentum product and variant refresh requested. A full master refresh normally takes several minutes; you may leave this page and return later.');
    const requestedAt = Date.now();
    try {
      await triggerOrdermentumSync(supabase, { mode: 'sku_only', reason: 'Owner refreshed complete Inventory SKU master' });
      for (let attempt = 0; attempt < 72; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 10000));
        const snapshot = await loadOrdermentumSyncSnapshot(supabase);
        const relevant = snapshot.masterHealth.filter((row) => ['products','variants'].some((type) => String(row.resource_type || '').toLowerCase().includes(type)));
        const latest = Math.max(0, ...relevant.map((row) => row.latest_synced_at ? new Date(row.latest_synced_at).getTime() : 0));
        if (latest >= requestedAt - 2000) {
          const next = await reload();
          const nextHealth = await loadProjectionHealth();
          setProjection(nextHealth);
          setNotice(`Ordermentum master refresh completed. ${next.length.toLocaleString('en-AU')} unique SKUs are visible; latest master sync ${dateText(nextHealth?.latest_sku_master_sync_at)}.`);
          return;
        }
      }
      const next = await reload();
      setNotice(`The cloud refresh has not reported completion within 12 minutes. The latest available database snapshot still contains ${next.length.toLocaleString('en-AU')} unique SKUs; this is not a reason to show zero.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const active = rows.filter((row) => row.control_status !== 'DISCONTINUED').length;
  const withBarcode = rows.filter((row) => row.primary_barcode).length;
  const withShelf = rows.filter((row) => row.fixed_shelf).length;
  const rawMaster = n(projection?.raw_products) + n(projection?.raw_variants);

  return <section className="inventory-master-catalog">
    <header><div><span>COMPLETE SKU MASTER</span><h3>All Ordermentum SKUs in the database</h3><p>This list starts from the full product and variant master, including SKUs with no recent sales or stock movement.</p></div><div><button type="button" disabled={busy} onClick={() => void syncAllSkus()}>{busy ? 'Checking cloud sync…' : 'Sync all SKUs from Ordermentum'}</button><button type="button" disabled={busy} onClick={() => void reload()}>Refresh list</button></div></header>
    {error ? <div className="inventory-master-error">{error}</div> : null}{notice ? <div className="inventory-master-notice">{notice}</div> : null}
    <section className="inventory-master-metrics"><div><strong>{rows.length}</strong><span>unique database SKUs</span></div><div><strong>{active}</strong><span>active</span></div><div><strong>{withBarcode}</strong><span>with barcode candidate</span></div><div><strong>{withShelf}</strong><span>with warehouse shelf</span></div></section>
    <div className="inventory-master-notice">Source: {source === 'INVENTORY_CONTROL' ? 'Inventory control projection' : source === 'CANONICAL_FALLBACK' ? 'Ordermentum canonical master fallback' : 'No projected SKU data'} · raw product/variant records {rawMaster || '—'} · projected unique SKUs {n(projection?.projected_skus) || rows.length || '—'} · latest sync {dateText(projection?.latest_sku_master_sync_at)}</div>
    <div className="inventory-master-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all SKU, product, shelf or barcode…" /><strong>{visible.length} shown</strong></div>
    <div className="inventory-master-list">{visible.map((row) => <article key={row.sku || `unknown-${row.inventory_rank}`}><div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Product name pending'}</span></div><span>{row.fixed_shelf || 'No shelf yet'}</span><span>{row.primary_barcode || 'No barcode yet'}</span><span>{n(row.effective_on_hand).toLocaleString('en-AU')} stock</span><b>{String(row.inventory_signal || 'PENDING').replaceAll('_',' ')}</b></article>)}</div>
  </section>;
}

export function InventoryMasterCatalog() {
  const host = useCatalogHost();
  return host ? createPortal(<Catalog />, host) : null;
}
