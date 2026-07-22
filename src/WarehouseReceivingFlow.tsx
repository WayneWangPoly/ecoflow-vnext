import { useEffect, useMemo, useRef, useState } from 'react';
import { loadWarehouseReceivingMovements, type WarehouseReceivingMovementRow } from '@/data/repositories/warehouseReceiving';
import {
  cancelStagedReceivingBatch,
  convertUnknownBarcodeIntake,
  finishStagedReceivingBatch,
  loadOpenStagedReceivingBatches,
  loadUnknownBarcodeIntakes,
  loadStagedReceivingLines,
  setReceivingLineTick,
  stageUnknownBarcodeIntake,
  stageReceivingScan,
  startStagedReceivingBatch,
  type StagedReceivingBatch,
  type StagedReceivingLine,
  type UnknownBarcodeIntake,
} from '@/data/repositories/stagedReceiving';

const defaultForm = { barcode: '', qty: '1', location: '', note: '' };
const defaultDelivery = { supplierName: '', supplierOrderRef: '', invoiceRef: '', note: '' };
type PendingScan = { fingerprint: string; idempotencyKey: string; clientScannedAt: string };

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
      <div className="warehouse-scan-number"><strong>{num(line.units_received)}</strong><span>base units</span></div>
      <Pill kind={posted ? 'good' : checked ? 'blue' : 'warn'}>{posted ? 'IN STOCK' : checked ? 'TICKED' : 'CHECK'}</Pill>
      <div className="warehouse-scan-location">{line.suggested_location || 'TEMP'}</div>
    </article>
  );
}

function UnknownIntakeRow({ intake, busy, onRetry }: { intake: UnknownBarcodeIntake; busy: string; onRetry: (intake: UnknownBarcodeIntake) => void }) {
  const resolved = intake.intake_status === 'CONVERTED' || intake.intake_status === 'CANCELLED';
  return (
    <article className={`warehouse-scan-line unknown-intake ${resolved ? 'checked' : ''}`}>
      <div className="warehouse-scan-check">!</div>
      <div className="warehouse-scan-copy">
        <strong>Unknown barcode</strong>
        <span>{intake.barcode}</span>
        <small>Physical goods held in TEMP · no stock posted</small>
      </div>
      <div className="warehouse-scan-number"><strong>{num(intake.qty_packages)}</strong><span>packages</span></div>
      <Pill kind={resolved ? 'good' : 'warn'}>{title(intake.intake_status)}</Pill>
      {!resolved ? <button type="button" disabled={Boolean(busy)} onClick={() => onRetry(intake)}>{busy === intake.id ? 'Checking…' : 'Retry after mapping'}</button> : null}
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
  const [delivery, setDelivery] = useState(defaultDelivery);
  const [batch, setBatch] = useState<StagedReceivingBatch | null>(null);
  const [openBatches, setOpenBatches] = useState<StagedReceivingBatch[]>([]);
  const [lines, setLines] = useState<StagedReceivingLine[]>([]);
  const [unknownIntakes, setUnknownIntakes] = useState<UnknownBarcodeIntake[]>([]);
  const [movements, setMovements] = useState<WarehouseReceivingMovementRow[]>([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scanRef = useRef<HTMLInputElement | null>(null);
  const pendingScanRef = useRef<PendingScan | null>(null);

  function update(key: keyof typeof defaultForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDelivery(key: keyof typeof defaultDelivery, value: string) {
    setDelivery((current) => ({ ...current, [key]: value }));
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
      if (activeBatch?.id) {
        const [nextLines, nextUnknowns] = await Promise.all([
          loadStagedReceivingLines(activeBatch.id),
          loadUnknownBarcodeIntakes(activeBatch.id),
        ]);
        setLines(nextLines);
        setUnknownIntakes(nextUnknowns);
      } else {
        setLines([]);
        setUnknownIntakes([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(null); }, []);
  useEffect(() => { scanRef.current?.focus(); }, [batch?.id]);

  async function createBatch() {
    return startStagedReceivingBatch({
      supplierName: delivery.supplierName,
      supplierOrderRef: delivery.supplierOrderRef,
      invoiceRef: delivery.invoiceRef,
      note: delivery.note || 'Warehouse staged receiving',
    });
  }

  async function ensureBatch() {
    if (batch?.id) return batch.id;
    const rows = await createBatch();
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
      supplier_name: delivery.supplierName || null,
      supplier_order_ref: delivery.supplierOrderRef || null,
      invoice_ref: delivery.invoiceRef || null,
      batch_note: delivery.note || null,
    };
    setBatch(nextBatch);
    setOpenBatches((current) => [nextBatch, ...current.filter((item) => item.id !== nextBatch.id)]);
    return first.batch_id;
  }

  async function startNewBatch() {
    if (!delivery.supplierOrderRef.trim() && !delivery.invoiceRef.trim()) {
      setError('Enter the supplier delivery docket/order reference or invoice reference before starting this inbound batch.');
      return;
    }
    if (openBatches.length > 0) {
      const confirmed = window.confirm(`There ${openBatches.length === 1 ? 'is' : 'are'} ${openBatches.length} open receiving batch${openBatches.length === 1 ? '' : 'es'}. Start another only when the existing work belongs to a separate delivery. Continue?`);
      if (!confirmed) return;
    }
    setBusy('start');
    setNotice('');
    setError('');
    try {
      const rows = await createBatch();
      const first = rows[0];
      if (!first?.batch_id) throw new Error('Could not start receiving batch.');
      pendingScanRef.current = null;
      setNotice(`Receiving batch ${first.batch_no || ''} started for ${delivery.supplierOrderRef || delivery.invoiceRef}.`);
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
    pendingScanRef.current = null;
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
    if (!batch?.id && !delivery.supplierOrderRef.trim() && !delivery.invoiceRef.trim()) {
      setError('Enter the supplier delivery docket/order reference or invoice reference before the first scan.');
      return;
    }
    let targetBatchId: string | null = null;
    setBusy('scan');
    setError('');
    setNotice('');
    try {
      const batchId = await ensureBatch();
      targetBatchId = batchId;
      const location = form.location.trim().toUpperCase();
      const fingerprint = JSON.stringify([batchId, barcode, qty, location, form.note.trim()]);
      const pending = pendingScanRef.current?.fingerprint === fingerprint
        ? pendingScanRef.current
        : { fingerprint, idempotencyKey: crypto.randomUUID(), clientScannedAt: new Date().toISOString() };
      pendingScanRef.current = pending;

      const result = await stageReceivingScan({
        batchId,
        barcode,
        qtyPackages: qty,
        targetLocation: location || null,
        note: form.note || null,
        idempotencyKey: pending.idempotencyKey,
        clientScannedAt: pending.clientScannedAt,
      });
      const first = result[0];
      pendingScanRef.current = null;
      setNotice(`${first?.sku || 'SKU'} found. Check package quantity and shelf, then tick the line.`);
      setForm((current) => ({ ...current, barcode: '', qty: '1', note: '' }));
      await reload(batchId);
      window.setTimeout(() => scanRef.current?.focus(), 60);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const unmapped = /barcode is not mapped yet|BARCODE_NOT_MAPPED/i.test(detail);
      if (unmapped && targetBatchId) {
        try {
          const pending = pendingScanRef.current;
          if (!pending) throw new Error('Unknown barcode intake key was not available.');
          await stageUnknownBarcodeIntake({
            batchId: targetBatchId,
            barcode,
            qtyPackages: qty,
            note: form.note || null,
            idempotencyKey: pending.idempotencyKey,
            clientScannedAt: pending.clientScannedAt,
          });
          pendingScanRef.current = null;
          setForm((current) => ({ ...current, barcode: '', qty: '1', note: '' }));
          setNotice(`${barcode} is not mapped. The physical packages are held in TEMP and recorded against this delivery; stock remains unchanged.`);
          await reload(targetBatchId);
          window.setTimeout(() => scanRef.current?.focus(), 60);
        } catch (quarantineError) {
          setError(`${quarantineError instanceof Error ? quarantineError.message : String(quarantineError)} · retrying the same scan will not duplicate the intake.`);
        }
      } else {
        setError(`${detail} · retrying the same scan will not create a duplicate line.`);
      }
    } finally {
      setBusy('');
    }
  }

  async function retryUnknown(intake: UnknownBarcodeIntake) {
    setBusy(intake.id);
    setError('');
    setNotice('');
    try {
      const result = await convertUnknownBarcodeIntake(intake.id);
      const first = result[0];
      setNotice(`${intake.barcode} mapped to ${first?.sku || 'SKU'}. Verify and tick the new receiving line.`);
      await reload(intake.batch_id);
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
      const result = await finishStagedReceivingBatch({ batchId: batch.id, note: form.note || delivery.note || null });
      const first = result[0];
      pendingScanRef.current = null;
      setNotice(`${first?.posted_lines || 0} lines posted once to stock and warehouse locations · ${num(first?.posted_units)} base units.`);
      setForm(defaultForm);
      setDelivery(defaultDelivery);
      await reload(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function cancelBatch() {
    if (!batch?.id) return;
    const reason = window.prompt(`Cancel ${batch.batch_no}? Enter a reason for the audit trail.`)?.trim();
    if (!reason) return;
    setBusy('cancel');
    setError('');
    setNotice('');
    try {
      await cancelStagedReceivingBatch({ batchId: batch.id, reason });
      pendingScanRef.current = null;
      setNotice(`${batch.batch_no} cancelled · ${reason}`);
      setForm(defaultForm);
      setDelivery(defaultDelivery);
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
  const unresolvedUnknowns = unknownIntakes.filter((intake) => intake.intake_status === 'PENDING_MAPPING' || intake.intake_status === 'READY_TO_CONVERT');
  const allChecked = totalLines > 0 && checkedLines === totalLines && postedLines < totalLines && unresolvedUnknowns.length === 0;
  const totalUnits = useMemo(() => lines.reduce((sum, line) => sum + num(line.units_received), 0), [lines]);
  const activeReference = batch?.supplier_order_ref || batch?.invoice_ref || '';

  return (
    <section className="warehouse-receive-screen">
      <section className="warehouse-receive-hero">
        <div>
          <span>DAILY RECEIVING</span>
          <h2>Receive against one delivery document.</h2>
          <p>Record the supplier docket or invoice first. Every scan is idempotent; verified lines post to the base-unit ledger and the matching carton, sleeve or each location balance.</p>
        </div>
        <button type="button" onClick={() => void reload(batch?.id)}>Refresh</button>
      </section>

      {error ? <div className="warehouse-receive-error">{error}</div> : null}
      {notice ? <div className="warehouse-receive-notice">{notice}</div> : null}

      <section className="warehouse-receive-form warehouse-stage-form">
        <div className="warehouse-delivery-reference-grid">
          <label><span>Supplier</span><input value={batch?.supplier_name || delivery.supplierName} disabled={Boolean(batch)} onChange={(event) => updateDelivery('supplierName', event.target.value)} placeholder="Supplier name" /></label>
          <label><span>Delivery docket / order ref *</span><input value={batch?.supplier_order_ref || delivery.supplierOrderRef} disabled={Boolean(batch)} onChange={(event) => updateDelivery('supplierOrderRef', event.target.value)} placeholder="Required unless invoice ref is entered" /></label>
          <label><span>Invoice ref</span><input value={batch?.invoice_ref || delivery.invoiceRef} disabled={Boolean(batch)} onChange={(event) => updateDelivery('invoiceRef', event.target.value)} placeholder="Supplier invoice number" /></label>
          <label><span>Delivery note</span><input value={batch?.batch_note || delivery.note} disabled={Boolean(batch)} onChange={(event) => updateDelivery('note', event.target.value)} placeholder="Damaged, partial or late delivery note" /></label>
        </div>

        <div className="warehouse-batch-row">
          <div><strong>{batch?.batch_no || 'No active receiving batch'}</strong><span>{activeReference ? `SOURCE ${activeReference}` : title(batch?.receive_signal || 'ENTER DELIVERY REFERENCE')}</span></div>
          <div className="warehouse-batch-actions">
            {batch ? <button className="warehouse-cancel-batch" type="button" disabled={Boolean(busy)} onClick={() => void cancelBatch()}>Cancel batch</button> : null}
            <button type="button" disabled={Boolean(busy)} onClick={() => void startNewBatch()}>{batch ? 'New delivery batch' : 'Start receiving'}</button>
          </div>
        </div>

        {openBatches.length ? (
          <div className="warehouse-batch-control">
            <label>Open receiving work
              <select value={batch?.id || ''} disabled={Boolean(busy)} onChange={(event) => void resumeBatch(event.target.value)}>
                {openBatches.map((item) => <option key={item.id} value={item.id}>{item.batch_no} · {item.supplier_order_ref || item.invoice_ref || 'NO REF'} · {title(item.batch_status)} · {num(item.confirmed_count)}/{num(item.line_count)} checked</option>)}
              </select>
            </label>
            <Pill kind={openBatches.length > 1 ? 'warn' : 'blue'}>{openBatches.length} OPEN</Pill>
          </div>
        ) : null}
        {openBatches.length > 1 ? <div className="warehouse-open-batch-warning">Multiple deliveries are open. Resume the correct supplier reference before scanning so stock is not posted against the wrong inbound delivery.</div> : null}

        <input ref={scanRef} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void scanLine(); }} placeholder="Scan one carton or sleeve barcode, then Enter" autoComplete="off" />
        <div className="warehouse-receive-grid warehouse-stage-grid">
          <input type="number" min="1" step="1" value={form.qty} onChange={(event) => update('qty', event.target.value)} inputMode="numeric" placeholder="Package quantity" />
          <input value={form.location} onChange={(event) => update('location', event.target.value.toUpperCase())} placeholder="Blank = fixed shelf or TEMP" autoCapitalize="characters" />
          <input value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="Line note: damage, mixed pack, discrepancy" />
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={() => void scanLine()}>{busy === 'scan' ? 'Checking barcode…' : 'Add scanned package'}</button>
      </section>

      <section className="warehouse-receive-kpis">
        <div><strong>{checkedLines}/{totalLines}</strong><span>lines verified</span></div>
        <div><strong>{num(totalUnits)}</strong><span>base units waiting to post</span></div>
        <div><strong>{unresolvedUnknowns.length}</strong><span>unknown codes in TEMP</span></div>
      </section>

      {unknownIntakes.length ? (
        <section className="warehouse-receive-panel warehouse-scan-panel">
          <header><h3>TEMP barcode quarantine</h3><Pill kind={unresolvedUnknowns.length ? 'warn' : 'good'}>{unresolvedUnknowns.length ? `${unresolvedUnknowns.length} NEED MAPPING` : 'RESOLVED'}</Pill></header>
          <p className="warehouse-open-batch-warning">These packages are physically held in TEMP. They are not inventory and block batch completion until the barcode is mapped in Barcode Setup and converted here.</p>
          <div>{unknownIntakes.map((intake) => <UnknownIntakeRow key={intake.id} intake={intake} busy={busy} onRetry={retryUnknown} />)}</div>
        </section>
      ) : null}

      <section className="warehouse-receive-panel warehouse-scan-panel">
        <header><h3>Current batch lines</h3><Pill kind={allChecked ? 'good' : 'warn'}>{unresolvedUnknowns.length ? 'MAP UNKNOWN CODES' : allChecked ? 'READY TO POST' : 'VERIFY EACH LINE'}</Pill></header>
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
