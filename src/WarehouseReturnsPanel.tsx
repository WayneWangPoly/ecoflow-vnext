import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageCheck, RotateCcw } from 'lucide-react';
import { loadOpenDeliveryReturns, scanDeliveryReturn, type OpenDeliveryReturn } from '@/data/repositories/deliveryOperations';

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function title(value?: string | null) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ReturnRow({ row }: { row: OpenDeliveryReturn }) {
  const waiting = row.return_status === 'WITH_DRIVER';
  return (
    <article className={`warehouse-return-row ${waiting ? 'waiting' : 'received'}`}>
      <div className="warehouse-return-code-block"><strong>{row.return_code}</strong><span>{waiting ? 'WITH DRIVER' : 'WAREHOUSE HOLD'}</span></div>
      <div><strong>{row.box_code || 'BOX'} · {row.store_name || 'Unknown store'}</strong><span>{title(row.outcome)} · {num(row.return_cartons)} carton(s) · order {row.order_number || '—'}</span><small>{row.reason || row.driver_note || 'No driver detail'} · {dateText(row.recorded_at)}</small></div>
      <div className="warehouse-return-action"><strong>{row.warehouse_location || 'RETURNS-HOLD'}</strong><span>{title(row.warehouse_action)}</span></div>
    </article>
  );
}

export function WarehouseReturnsPanel() {
  const [rows, setRows] = useState<OpenDeliveryReturn[]>([]);
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('RETURNS-HOLD');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function reload() {
    try {
      setRows(await loadOpenDeliveryReturns());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  async function scan() {
    if (!code.trim()) { setError('Scan or enter the return code first.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await scanDeliveryReturn({ returnCode: code.trim(), warehouseLocation: location || 'RETURNS-HOLD', note, actorLabel: 'Warehouse' });
      const first = result[0] as { store_name?: string; return_cartons?: number | string; warehouse_location?: string } | undefined;
      setNotice(`${first?.store_name || 'Return'} received: ${num(first?.return_cartons)} carton(s) into ${first?.warehouse_location || location}. Inspection required before restock.`);
      setCode('');
      setNote('');
      await reload();
      window.setTimeout(() => inputRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const waiting = useMemo(() => rows.filter((row) => row.return_status === 'WITH_DRIVER'), [rows]);
  const inWarehouse = useMemo(() => rows.filter((row) => row.return_status !== 'WITH_DRIVER'), [rows]);

  return (
    <section className="warehouse-returns-panel">
      <header className="warehouse-returns-head">
        <div><span>RETURNS HOLD</span><h2>Scan the return code when cartons come back.</h2><p>Scanning proves physical return to warehouse. It does not add stock back. Goods stay in RETURNS-HOLD until inspection.</p></div>
        <button type="button" onClick={() => void reload()}><RotateCcw size={16} /> Refresh</button>
      </header>

      {error ? <div className="warehouse-return-error"><AlertTriangle size={17} /> {error}</div> : null}
      {notice ? <div className="warehouse-return-notice"><CheckCircle2 size={17} /> {notice}</div> : null}

      <section className="warehouse-return-scan-card">
        <input ref={inputRef} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') void scan(); }} placeholder="Scan or enter RET- code" />
        <input value={location} onChange={(event) => setLocation(event.target.value.toUpperCase())} placeholder="RETURNS-HOLD" />
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condition / who returned it" />
        <button type="button" disabled={busy} onClick={() => void scan()}><PackageCheck size={18} /> {busy ? 'Recording return…' : 'Confirm returned to warehouse'}</button>
      </section>

      <section className="warehouse-return-metrics">
        <div><strong>{waiting.length}</strong><span>with driver</span></div>
        <div><strong>{inWarehouse.length}</strong><span>inspection hold</span></div>
      </section>

      <section className="warehouse-return-list">
        <h3>Open return chain</h3>
        {rows.map((row) => <ReturnRow key={row.id} row={row} />)}
        {!rows.length ? <div className="warehouse-return-empty">No open returns.</div> : null}
      </section>
    </section>
  );
}
