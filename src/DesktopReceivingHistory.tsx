import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, RefreshCw, X } from 'lucide-react';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import './desktopReceivingHistory.css';

type ReceivingBatchHistoryRow = {
  id: string;
  batch_no: string | null;
  batch_status: string | null;
  line_count: number | string | null;
  confirmed_count: number | string | null;
  posted_count: number | string | null;
  total_units: number | string | null;
  supplier_name: string | null;
  supplier_order_ref: string | null;
  invoice_ref: string | null;
  batch_note: string | null;
  created_at: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
};

type DesktopReceivingMovementRow = {
  id: string;
  sku: string | null;
  product_name: string | null;
  movement_type: string | null;
  quantity: number | string | null;
  from_location: string | null;
  to_location: string | null;
  reference_type: string | null;
  reference_id: string | null;
  action_note: string | null;
  source: string | null;
  moved_at: string | null;
  moved_by_name?: string | null;
  moved_by_email?: string | null;
};

function clean(value?: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceReference(batch: ReceivingBatchHistoryRow) {
  return clean(batch.supplier_order_ref) || clean(batch.invoice_ref) || 'UNREFERENCED INBOUND';
}

function actor(batch: ReceivingBatchHistoryRow) {
  return clean(batch.created_by_name) || clean(batch.created_by_email) || 'Warehouse user';
}

function movementActor(movement: DesktopReceivingMovementRow) {
  return clean(movement.moved_by_name) || clean(movement.moved_by_email) || clean(movement.source) || 'EcoFlow warehouse';
}

function rpcError(value: unknown) {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(record);
  }
  return String(value);
}

export function DesktopReceivingHistory() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'batches' | 'movements'>('batches');
  const [batches, setBatches] = useState<ReceivingBatchHistoryRow[]>([]);
  const [movements, setMovements] = useState<DesktopReceivingMovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => observeBody(() => {
    const topbar = document.querySelector<HTMLElement>('.industrial-v2-topbar-mount')
      || document.querySelector<HTMLElement>('.topbar-actions');
    if (!topbar) { setHost(null); return; }
    let mount = topbar.querySelector<HTMLElement>(':scope > .desktop-receiving-history-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'desktop-receiving-history-mount';
      topbar.appendChild(mount);
    }
    setHost(mount);
  }), []);

  async function load() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [batchResult, movementResult] = await Promise.all([
        supabase.rpc('ecoflow_read_desktop_receiving_batches', { p_limit: 80 }),
        supabase.rpc('ecoflow_read_desktop_receiving_movements', { p_limit: 120 }),
      ]);
      if (batchResult.error) throw new Error(rpcError(batchResult.error));
      if (movementResult.error) throw new Error(rpcError(movementResult.error));
      setBatches((batchResult.data ?? []) as ReceivingBatchHistoryRow[]);
      setMovements((movementResult.data ?? []) as DesktopReceivingMovementRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const postedUnits = useMemo(
    () => batches.filter((batch) => batch.batch_status === 'POSTED').reduce((sum, batch) => sum + number(batch.total_units), 0),
    [batches],
  );
  const openCount = batches.filter((batch) => batch.batch_status === 'SCANNING' || batch.batch_status === 'READY_TO_POST').length;

  const button = host ? createPortal(
    <button type="button" className="desktop-receiving-history-button" onClick={() => setOpen(true)}>
      <ClipboardList size={14} />Receiving log
    </button>,
    host,
  ) : null;

  const modal = open ? createPortal(
    <div className="desktop-receiving-history-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="desktop-receiving-history-dialog" role="dialog" aria-modal="true" aria-label="Receiving log">
        <header>
          <div><span>WAREHOUSE AUDIT</span><h2>Receiving log</h2><p>Desktop record of inbound batches and posted stock movements.</p></div>
          <div className="desktop-receiving-history-header-actions">
            <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} />Refresh</button>
            <button type="button" aria-label="Close receiving log" onClick={() => setOpen(false)}><X size={17} /></button>
          </div>
        </header>

        <div className="desktop-receiving-history-kpis">
          <div><strong>{batches.length}</strong><span>recent batches</span></div>
          <div><strong>{openCount}</strong><span>open receiving work</span></div>
          <div><strong>{postedUnits.toLocaleString('en-AU')}</strong><span>posted base units</span></div>
          <div><strong>{movements.length}</strong><span>recent movements</span></div>
        </div>

        <nav>
          <button type="button" className={view === 'batches' ? 'active' : ''} onClick={() => setView('batches')}>Inbound batches</button>
          <button type="button" className={view === 'movements' ? 'active' : ''} onClick={() => setView('movements')}>Posted movements</button>
        </nav>

        {error ? <div className="desktop-receiving-history-error">Receiving history could not be loaded: {error}</div> : null}
        {loading && !batches.length && !movements.length ? <div className="desktop-receiving-history-empty">Loading receiving history…</div> : null}

        <div className="desktop-receiving-history-body">
          {view === 'batches' ? (
            <div className="desktop-receiving-batch-table">
              <div className="head"><span>Batch / source</span><span>Supplier</span><span>Status</span><span>Lines</span><span>Units</span><span>Created</span><span>Operator</span></div>
              {batches.map((batch) => (
                <article key={batch.id}>
                  <span><strong>{batch.batch_no || 'Receiving batch'}</strong><small>{sourceReference(batch)}</small></span>
                  <span>{batch.supplier_name || 'Supplier not recorded'}<small>{batch.invoice_ref ? `Invoice ${batch.invoice_ref}` : batch.batch_note || '—'}</small></span>
                  <span><b data-status={batch.batch_status || 'UNKNOWN'}>{clean(batch.batch_status).replace(/_/g, ' ') || 'UNKNOWN'}</b></span>
                  <span>{number(batch.confirmed_count)}/{number(batch.line_count)}<small>{number(batch.posted_count)} posted</small></span>
                  <span>{number(batch.total_units).toLocaleString('en-AU')}</span>
                  <span>{dateTime(batch.created_at)}<small>{batch.completed_at ? `completed ${dateTime(batch.completed_at)}` : ''}</small></span>
                  <span>{actor(batch)}</span>
                </article>
              ))}
              {!batches.length && !loading ? <div className="desktop-receiving-history-empty">No receiving batches are visible to this account.</div> : null}
            </div>
          ) : (
            <div className="desktop-receiving-movement-table">
              <div className="head"><span>SKU</span><span>Quantity</span><span>Location</span><span>Reference</span><span>Note / operator</span><span>Posted</span></div>
              {movements.map((movement) => (
                <article key={movement.id}>
                  <span><strong>{movement.sku || 'Unknown SKU'}</strong><small>{movement.product_name || clean(movement.movement_type).replace(/_/g, ' ')}</small></span>
                  <span>{number(movement.quantity).toLocaleString('en-AU')}</span>
                  <span>{movement.from_location || '—'} → {movement.to_location || '—'}</span>
                  <span>{movement.reference_type || 'RECEIVING'}<small>{movement.reference_id || '—'}</small></span>
                  <span>{movement.action_note || '—'}<small>{movementActor(movement)}</small></span>
                  <span>{dateTime(movement.moved_at)}</span>
                </article>
              ))}
              {!movements.length && !loading ? <div className="desktop-receiving-history-empty">No posted receiving movements are visible to this account.</div> : null}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{button}{modal}</>;
}
