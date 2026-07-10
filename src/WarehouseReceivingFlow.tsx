import { useEffect, useMemo, useRef, useState } from 'react';
import { loadWarehouseReceivingMovements, type WarehouseReceivingMovementRow } from '@/data/repositories/warehouseReceiving';
import {
  finishStagedReceivingBatch,
  loadOpenStagedReceivingBatches,
  loadStagedReceivingLines,
  setReceivingLineTick,
  stageReceivingScan,
  startStagedReceivingBatch,
  type StagedReceivingBatch,
  type StagedReceivingLine,
} from '@/data/repositories/stagedReceiving';

const defaultForm = { barcode: '', qty: '1', location: '', note: '' };

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

function Pill({ children, kind = 'neutral' }: { children: React.ReactNode; kind?: string }) {
  return <span className={`warehouse-receive-pill warehouse-receive-pill-${kind}`}>{children}</span>;
}

function LineRow({ line, busy, onTick }: { line: StagedReceivingLine; busy: string; onTick: (line: StagedReceivingLine) => void }) {
  const posted = line.line_status === 'POSTED';
  const checked = Boolean(line.confirmation_checked) || posted;
  return (
    <article className={`warehouse-scan-line ${checked ? 'checked' : ''} ${posted ? 'posted' : ''}`}>
      <button type="button" disabled={posted || Boolean(busy)} className="warehouse-scan-check" onClick={() => onTick(line)} aria-label={`Confirm ${line.sku || 'receiving'} line`}>
        {checked ? '✓' : ''}
      </button>
      <div className="warehouse-scan-copy">
        <strong>{line.sku}</strong>
        <span>{line.product_name || 'Unknown product'}</span>
        <small>{title(line.package_level)} · barcode {line.barcode}</small>
      </div>
      <div className="warehouse-scan-number"><strong>{num(line.qty_packages)}</strong><span>packages</span></div>
      <div className="warehouse-scan-number"><strong>{num(line.units_received)}</strong><span>units</span></div>
      <Pill kind={posted ? 'good' : checked ? 'blue' : 'warn'}>{posted ? 'IN STOCK' : checked ? 'TICKED' : 'CHECK'}</Pill>
      <div className="warehouse-scan-location">{line.suggested_location || 'RECEIVING'}</div>
    </article>
  );
}

function MovementRow({ row }: { row: WarehouseReceivingMovementRow }) {
  return (
    <article className="warehouse-receive-movement-row">
      <div><strong>{row.sku} · {title(row.movement_type)}</strong><span>{row.from_location || '—'} → {row.to_location || '—'}</span></div>
      <strong>{num(row.quantity)}</strong>
      <small>{timeText(row.moved_at)}</small>
    </article>
  );
}

export function WarehouseReceivingFlow() {
  const [form, setForm] = useState(defaultForm);
  const [batch, setBatch] = useState<StagedReceivingBatch | null>(null);
  const [openBatches, setOpenBatches] = useState<StagedReceivingBatch[]>([]);
  const [lines, setLines] = useState<StagedReceivingLine[]>([]);
  const [movements, setMovements] = useState<WarehouseReceivingMovementRow[]>([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scanRef = useRef<HTMLInputElement | null>(null);

  function update(key: keyof typeof defaultForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function reload(targetBatchId?: string | null) {
    setError('');
    try {
      const [nextBatches, nextMovements] = await Promise.all([loadOpenStagedReceivingBatches(), loadWarehouseReceivingMovements()]);
      setOpenBatches(nextBatches);
      setMovements(nextMovements);
      const preferredId = targetBatchId === undefined ? batch?.id : targetBatchId;
      const activeBatch = preferredId ? nextBatches.find((item) => item.id === preferredId) : nextBatches[0];
      setBatch(activeBatch ?? null);
      if (activeBatch?.id) setLines(await loadStagedReceivingLines(activeBatch.id));
      else setLines([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(null); }, []);
  useEffect(() => { scanRef.current?.focus(); }, [batch?.id]);

  async function ensureBatch() {
    if (batch?.id) return batch.id;
    const rows = await startStagedReceivingBatch();
    const first = rows[0];
    if (!first?.batch_id) throw new Error('Could not start receiving batch.');
    const nextBatch: StagedReceivingBatch = {
      id: first.batch_id,
      batch_no: first.batch_no,
      batch_status: first.batch_status,
      line_count: 0,
      confirmed_count: 0,
      posted_count: 0,
      total_units: 0,
      receive_signal: 'SCAN_FIRST_ITEM',
    };
    setBatch(nextBatch);
    setOpenBatches((current) => [nextBatch, ...current.filter((item) => item.id !== nextBatch.id)]);
    return first.batch_id;
  }

  async function startNewBatch() {
    if (openBatches.length > 0) {
      const confirmed = window.confirm(`There ${openBatches.length === 1 ? 'is' : 'are'} ${openBatches.length} open receiving batch${openBatches.length === 1 ? '' : 'es'}. Start another only when the existing work belongs to a separate delivery. Continue?`);
      if (!confirmed) return;
    }
    setBusy('start');
    setNotice('');
    setError('');
    try {
      const rows = await startStagedReceivingBatch();
      const first = rows[0];
      if (!first?.batch_id) throw new Error('Could not start receiving batch.');
      setNotice(`Receiving batch ${first.batch_no || ''} started.`);
      await reload(first.batch_id);
      window.setTimeout(() => scanRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function resumeBatch(batchId: string) {
    setBusy('resume');
    setNotice('');
    try {
      await reload(batchId || null);
      window.setTimeout(() => scanRef.current?.focus(), 60);
    } finally {
      setBusy('');
    }
  }

  async function scanLine() {
    const barcode = form.barcode.trim();
    const qty = Number(form.qty);
    if (!barcode) { setError('Scan barcode first.'); return; }
    if (!Number.isInteger(qty) || qty <= 0) { setError('Package quantity must be a whole number greater than zero.'); return; }
    setBusy('scan');
    setError('');
    setNotice('');
    try {
      const batchId = await ensureBatch();
      const result = await stageReceivingScan({ batchId, barcode, qtyPackages: qty, targetLocation: form.location || null, note: form.note || null });
      const first = result[0];
      setNotice(`${first?.sku || 'SKU'} found. Check package quantity and shelf, then tick the line.`);
      setForm((current) => ({ ...current, barcode: '', qty: '1', note: '' }));
      await reload(batchId);
      window.setTimeout(() => scanRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function tickLine(line: StagedReceivingLine) {
    setBusy(line.id);
    setError('');
    setNotice('');
    try {
      await setReceivingLineTick({ lineId: line.id, ticked: !line.confirmation_checked });
      await reload(line.batch_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function completeBatch() {
    if (!batch?.id) return;
    setBusy('complete');
    setError('');
    setNotice('');
    try {
      const result = await finishStagedReceivingBatch({ batchId: batch.id, note: form.note || null });
      const first = result[0];
      setNotice(`${first?.posted_lines || 0} lines posted to stock · ${num(first?.posted_units)} units.`);
      setForm(defaultForm);
      await reload(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  const totalLines = lines.length;
  const checkedLines = lines.filter((line) => line.confirmation_checked || line.line_status === 'POSTED').length;
  const postedLines = lines.filter((line) => line.line_status === 'POSTED').length;
  const allChecked = totalLines > 0 && checkedLines === totalLines && postedLines < totalLines;
  const totalUnits = useMemo(() => lines.reduce((sum, line) => sum + num(line.units_received), 0), [lines]);

  return (
    <section className="warehouse-receive-screen">
      <section className="warehouse-receive-hero">
        <div>
          <span>DAILY RECEIVING</span>
          <h2>Scan. Verify. Post once.</h2>
          <p>One live batch at a time wherever possible. Every line is checked before the database posts stock to the ledger.</p>
        </div>
        <button type="button" onClick={() => void reload(batch?.id)}>Refresh</button>
      </section>

      {error ? <div className="warehouse-receive-error">{error}</div> : null}
      {notice ? <div className="warehouse-receive-notice">{notice}</div> : null}

      <section className="warehouse-receive-form warehouse-stage-form">
        <div className="warehouse-batch-row">
          <div><strong>{batch?.batch_no || 'No active receiving batch'}</strong><span>{title(batch?.receive_signal || 'SCAN FIRST ITEM')}</span></div>
          <button type="button" disabled={Boolean(busy)} onClick={() => void startNewBatch()}>{batch ? 'New delivery batch' : 'Start receiving'}</button>
        </div>

        {openBatches.length ? (
          <div className="warehouse-batch-control">
            <label>Open receiving work
              <select value={batch?.id || ''} disabled={Boolean(busy)} onChange={(event) => void resumeBatch(event.target.value)}>
                {openBatches.map((item) => <option key={item.id} value={item.id}>{item.batch_no} · {title(item.batch_status)} · {num(item.confirmed_count)}/{num(item.line_count)} checked</option>)}
              </select>
            </label>
            <Pill kind={openBatches.length > 1 ? 'warn' : 'blue'}>{openBatches.length} OPEN</Pill>
          </div>
        ) : null}
        {openBatches.length > 1 ? <div className="warehouse-open-batch-warning">Multiple deliveries are open. Resume the correct batch before scanning so stock is not posted against the wrong inbound delivery.</div> : null}

        <input ref={scanRef} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void scanLine(); }} placeholder="Scan one carton or sleeve barcode, then Enter" autoComplete="off" />
        <div className="warehouse-receive-grid warehouse-stage-grid">
          <input type="number" min="1" step="1" value={form.qty} onChange={(event) => update('qty', event.target.value)} inputMode="numeric" placeholder="Package quantity" />
          <input value={form.location} onChange={(event) => update('location', event.target.value.toUpperCase())} placeholder="Blank = system shelf" autoCapitalize="characters" />
          <input value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="Supplier order / invoice / note" />
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={() => void scanLine()}>{busy === 'scan' ? 'Checking barcode…' : 'Add scanned package'}</button>
      </section>

      <section className="warehouse-receive-kpis">
        <div><strong>{checkedLines}/{totalLines}</strong><span>lines verified</span></div>
        <div><strong>{num(totalUnits)}</strong><span>units waiting to post</span></div>
      </section>

      <section className="warehouse-receive-panel warehouse-scan-panel">
        <header><h3>Current batch lines</h3><Pill kind={allChecked ? 'good' : 'warn'}>{allChecked ? 'READY TO POST' : 'VERIFY EACH LINE'}</Pill></header>
        <div>{lines.map((line) => <LineRow key={line.id} line={line} busy={busy} onTick={tickLine} />)}{!lines.length ? <div className="warehouse-receive-empty">Scan the first package. Nothing enters stock until every line is verified and the batch is completed.</div> : null}</div>
        <button type="button" className="warehouse-complete-receiving-button" disabled={!allChecked || Boolean(busy)} onClick={() => void completeBatch()}>{busy === 'complete' ? 'Posting stock once…' : 'Complete batch and post stock'}</button>
      </section>

      <section className="warehouse-receive-panel">
        <header><h3>Recent posted movements</h3><Pill kind="blue">{movements.length}</Pill></header>
        <div>{movements.slice(0, 8).map((row) => <MovementRow key={row.id} row={row} />)}{!movements.length ? <div className="warehouse-receive-empty">Posted receiving movements will appear here.</div> : null}</div>
      </section>
    </section>
  );
}
