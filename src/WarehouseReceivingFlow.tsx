import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadWarehouseReceivingMovements,
  loadWarehouseReceivingQueue,
  putawayByBarcode,
  receiveByBarcode,
  type WarehouseReceivingMovementRow,
  type WarehouseReceivingQueueRow,
} from '@/data/repositories/warehouseReceiving';

const defaultForm = {
  mode: 'RECEIVE',
  barcode: '',
  qty: '1',
  fromLocation: 'RECEIVING',
  toLocation: 'RECEIVING',
  note: '',
};

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function title(value?: unknown) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function signalTone(signal?: string | null) {
  if (signal === 'READY_TO_PUTAWAY') return 'good';
  if (signal?.includes('NEGATIVE')) return 'danger';
  if (signal?.includes('NEEDS')) return 'warn';
  return 'neutral';
}

function Pill({ children, kind = 'neutral' }: { children: any; kind?: string }) {
  return <span className={`warehouse-receive-pill warehouse-receive-pill-${kind}`}>{children}</span>;
}

function QueueRow({ row, onPick }: { row: WarehouseReceivingQueueRow; onPick: (row: WarehouseReceivingQueueRow) => void }) {
  return (
    <button type="button" className="warehouse-receive-queue-row" onClick={() => onPick(row)}>
      <div>
        <strong>{row.sku}</strong>
        <span>{row.product_name}</span>
        <small>{row.primary_barcode || 'barcode pending'} · {row.suggested_shelf || 'shelf pending'}</small>
      </div>
      <strong>{num(row.receiving_units)}</strong>
      <Pill kind={signalTone(row.receiving_signal)}>{title(row.receiving_signal)}</Pill>
    </button>
  );
}

function MovementRow({ row }: { row: WarehouseReceivingMovementRow }) {
  return (
    <article className="warehouse-receive-movement-row">
      <div>
        <strong>{row.sku} · {title(row.movement_type)}</strong>
        <span>{row.from_location || '—'} → {row.to_location || '—'}</span>
      </div>
      <strong>{num(row.quantity)}</strong>
      <small>{timeText(row.moved_at)}</small>
    </article>
  );
}

export function WarehouseReceivingFlow() {
  const [form, setForm] = useState(defaultForm);
  const [queue, setQueue] = useState<WarehouseReceivingQueueRow[]>([]);
  const [movements, setMovements] = useState<WarehouseReceivingMovementRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scanRef = useRef<HTMLInputElement | null>(null);

  function update(key: keyof typeof defaultForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function reload() {
    setError('');
    try {
      const [nextQueue, nextMovements] = await Promise.all([loadWarehouseReceivingQueue(), loadWarehouseReceivingMovements()]);
      setQueue(nextQueue);
      setMovements(nextMovements);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);
  useEffect(() => { scanRef.current?.focus(); }, [form.mode]);

  async function submit() {
    const barcode = form.barcode.trim();
    if (!barcode) { setError('Scan barcode first.'); return; }
    setBusy(form.mode);
    setError('');
    setNotice('');
    try {
      if (form.mode === 'PUTAWAY') {
        const result = await putawayByBarcode({ barcode, qtyPackages: form.qty || 1, fromLocation: form.fromLocation || 'RECEIVING', toLocation: form.toLocation || null, note: form.note || null });
        const first = result[0];
        setNotice(`${first?.sku || 'SKU'} put away ${num(first?.units_putaway)} units to ${first?.to_location || form.toLocation}.`);
      } else {
        const result = await receiveByBarcode({ barcode, qtyPackages: form.qty || 1, toLocation: form.toLocation || 'RECEIVING', note: form.note || null });
        const first = result[0];
        setNotice(`${first?.sku || 'SKU'} received ${num(first?.units_received)} units into ${first?.to_location || form.toLocation}.`);
      }
      setForm((current) => ({ ...current, barcode: '', note: '' }));
      await reload();
      window.setTimeout(() => scanRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  function pickQueue(row: WarehouseReceivingQueueRow) {
    setForm((current) => ({
      ...current,
      mode: 'PUTAWAY',
      barcode: row.primary_barcode || current.barcode,
      fromLocation: 'RECEIVING',
      toLocation: row.suggested_shelf || current.toLocation,
      note: row.sku ? `Putaway ${row.sku}` : current.note,
    }));
    window.setTimeout(() => scanRef.current?.focus(), 60);
  }

  const visibleQueue = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return queue.filter((row) => {
      if (!needle) return true;
      return [row.sku, row.product_name, row.suggested_shelf, row.primary_barcode, row.receiving_signal].filter(Boolean).join(' ').toLowerCase().includes(needle);
    }).slice(0, 12);
  }, [queue, query]);

  const receiveCount = queue.reduce((total, row) => total + num(row.receiving_units), 0);

  return (
    <section className="warehouse-receive-screen">
      <section className="warehouse-receive-hero">
        <div>
          <span>DAILY RECEIVING</span>
          <h2>Scan in, then scan to shelf.</h2>
          <p>Two actions only: receive known barcode into RECEIVING, then put away from RECEIVING to the fixed shelf.</p>
        </div>
        <button type="button" onClick={() => void reload()}>Refresh</button>
      </section>

      {error ? <div className="warehouse-receive-error">{error}</div> : null}
      {notice ? <div className="warehouse-receive-notice">{notice}</div> : null}

      <section className="warehouse-receive-form">
        <div className="warehouse-receive-mode-row">
          <button type="button" className={form.mode === 'RECEIVE' ? 'active' : ''} onClick={() => update('mode', 'RECEIVE')}>Receive</button>
          <button type="button" className={form.mode === 'PUTAWAY' ? 'active' : ''} onClick={() => update('mode', 'PUTAWAY')}>Putaway</button>
        </div>
        <input ref={scanRef} value={form.barcode} onChange={(e) => update('barcode', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} placeholder="Scan mapped barcode, then Enter" />
        <div className="warehouse-receive-grid">
          <input value={form.qty} onChange={(e) => update('qty', e.target.value)} inputMode="decimal" placeholder="Package count" />
          <input value={form.fromLocation} onChange={(e) => update('fromLocation', e.target.value.toUpperCase())} placeholder="From" disabled={form.mode === 'RECEIVE'} />
          <input value={form.toLocation} onChange={(e) => update('toLocation', e.target.value.toUpperCase())} placeholder={form.mode === 'RECEIVE' ? 'To location' : 'Shelf / rack'} />
        </div>
        <input value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Optional PO / note" />
        <button type="button" disabled={Boolean(busy)} onClick={() => void submit()}>{busy ? 'Saving…' : form.mode === 'PUTAWAY' ? 'Confirm putaway' : 'Confirm receive'}</button>
      </section>

      <section className="warehouse-receive-kpis">
        <div><strong>{queue.length}</strong><span>SKU rows in receiving</span></div>
        <div><strong>{num(receiveCount)}</strong><span>units in receiving</span></div>
      </section>

      <section className="warehouse-receive-work-grid">
        <section className="warehouse-receive-panel">
          <header><h3>Putaway queue</h3><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search queue" /></header>
          <div>{visibleQueue.map((row) => <QueueRow key={row.sku || Math.random()} row={row} onPick={pickQueue} />)}{!visibleQueue.length ? <div className="warehouse-receive-empty">No stock waiting in RECEIVING.</div> : null}</div>
        </section>
        <section className="warehouse-receive-panel">
          <header><h3>Recent warehouse movements</h3><Pill kind="blue">{movements.length}</Pill></header>
          <div>{movements.slice(0, 10).map((row) => <MovementRow key={row.id} row={row} />)}{!movements.length ? <div className="warehouse-receive-empty">No receiving movements yet.</div> : null}</div>
        </section>
      </section>
    </section>
  );
}
