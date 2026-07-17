import { useEffect, useMemo, useRef, useState } from 'react';
import {
  recordBarcodeScan,
  setSkuPackagePolicy,
  startBarcodeScanSession,
  type BarcodePackageLevel,
  type SkuPackageMode,
} from '@/data/repositories/inventoryControl';
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

const SESSION_KEY = 'ecoflow:first-stocktake-session';
const BATCH_KEY = 'ecoflow:first-stocktake-batch';

type PendingLine = {
  fingerprint: string;
  idempotencyKey: string;
  clientScannedAt: string;
};

const packageModes: Array<{ value: SkuPackageMode; label: string; firstLevel: BarcodePackageLevel }> = [
  { value: 'CARTON_AND_SLEEVE', label: 'Carton + sleeve', firstLevel: 'CARTON' },
  { value: 'CARTON_ONLY', label: 'Carton only', firstLevel: 'CARTON' },
  { value: 'SLEEVE_ONLY', label: 'Sleeve only', firstLevel: 'SLEEVE' },
  { value: 'EACH_ONLY', label: 'Single unit', firstLevel: 'EACH' },
  { value: 'INNER_ONLY', label: 'Inner pack', firstLevel: 'INNER' },
];

const packageLevels: Array<{ value: BarcodePackageLevel; label: string }> = [
  { value: 'CARTON', label: 'Carton' },
  { value: 'SLEEVE', label: 'Sleeve' },
  { value: 'INNER', label: 'Inner pack' },
  { value: 'EACH', label: 'Single unit' },
];

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function allowedLevel(mode: SkuPackageMode, level: BarcodePackageLevel) {
  if (mode === 'CARTON_AND_SLEEVE') return level === 'CARTON' || level === 'SLEEVE';
  if (mode === 'CARTON_ONLY') return level === 'CARTON';
  if (mode === 'SLEEVE_ONLY') return level === 'SLEEVE';
  if (mode === 'EACH_ONLY') return level === 'EACH';
  if (mode === 'INNER_ONLY') return level === 'INNER';
  return false;
}

function initialLocation() {
  return new URLSearchParams(window.location.search).get('location')?.trim().toUpperCase() || '';
}

export function FirstStocktakeFlow() {
  const [location, setLocation] = useState(initialLocation);
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [packageMode, setPackageMode] = useState<SkuPackageMode>('CARTON_AND_SLEEVE');
  const [packageLevel, setPackageLevel] = useState<BarcodePackageLevel>('CARTON');
  const [unitsPerPackage, setUnitsPerPackage] = useState('1');
  const [packagesObserved, setPackagesObserved] = useState('1');
  const [note, setNote] = useState('');
  const [batch, setBatch] = useState<StagedReceivingBatch | null>(null);
  const [openBatches, setOpenBatches] = useState<StagedReceivingBatch[]>([]);
  const [lines, setLines] = useState<StagedReceivingLine[]>([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<PendingLine | null>(null);

  async function reload(preferredBatchId?: string | null) {
    const batches = await loadOpenStagedReceivingBatches();
    setOpenBatches(batches);
    const stored = preferredBatchId === undefined ? window.localStorage.getItem(BATCH_KEY) : preferredBatchId;
    const active = stored ? batches.find((row) => row.id === stored) ?? null : null;
    if (!active && stored) window.localStorage.removeItem(BATCH_KEY);
    setBatch(active);
    setLines(active ? await loadStagedReceivingLines(active.id) : []);
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    barcodeRef.current?.focus();
  }, [sku, packageLevel]);

  async function ensureSession() {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const rows = await startBarcodeScanSession({
      sessionName: `First stocktake ${new Date().toLocaleDateString('en-AU')}`,
      targetArea: location || 'Warehouse',
    });
    const id = rows[0]?.session_id;
    if (!id) throw new Error('Could not start the first-stocktake scan session.');
    window.localStorage.setItem(SESSION_KEY, id);
    return id;
  }

  async function ensureBatch() {
    if (batch?.id) return batch.id;
    if (openBatches.length > 0) {
      const proceed = window.confirm('Another receiving batch is already open. Start a separate first-stocktake batch so the two jobs remain auditable?');
      if (!proceed) throw new Error('First stocktake was not started. Finish or cancel the existing receiving batch first.');
    }
    const rows = await startStagedReceivingBatch();
    const first = rows[0];
    if (!first?.batch_id) throw new Error('Could not start the controlled first-stocktake batch.');
    window.localStorage.setItem(BATCH_KEY, first.batch_id);
    await reload(first.batch_id);
    return first.batch_id;
  }

  async function addStocktakeLine() {
    const cleanLocation = location.trim().toUpperCase();
    const cleanSku = sku.trim().toUpperCase();
    const cleanBarcode = barcode.trim();
    const units = Number(unitsPerPackage);
    const packages = Number(packagesObserved);
    if (!cleanLocation) { setError('Step 1: enter or scan a warehouse location.'); return; }
    if (!cleanSku) { setError('Step 2: enter the Ordermentum SKU / item code.'); return; }
    if (!cleanBarcode) { setError('Step 3: scan the package barcode.'); return; }
    if (!allowedLevel(packageMode, packageLevel)) { setError(`${packageLevel} is not valid for the selected package rule.`); return; }
    if (!Number.isInteger(units) || units <= 0) { setError('Units per package must be a whole number greater than zero.'); return; }
    if (!Number.isInteger(packages) || packages <= 0) { setError('Packages counted must be a whole number greater than zero.'); return; }

    setBusy('add');
    setError('');
    setNotice('');
    try {
      const [sessionId, batchId] = await Promise.all([ensureSession(), ensureBatch()]);
      await setSkuPackagePolicy({ sku: cleanSku, packageMode, defaultShelf: cleanLocation, note: note || 'First stocktake' });
      await recordBarcodeScan({
        sessionId,
        sku: cleanSku,
        barcode: cleanBarcode,
        packageLevel,
        unitsPerBarcode: units,
        shelf: cleanLocation,
        qtyObserved: packages,
        actionMode: 'MAP_AND_COUNT',
        note: note || 'First stocktake mapping and observed count',
      });

      const fingerprint = JSON.stringify([batchId, cleanLocation, cleanSku, cleanBarcode, packageLevel, units, packages, note.trim()]);
      const pending = pendingRef.current?.fingerprint === fingerprint
        ? pendingRef.current
        : { fingerprint, idempotencyKey: crypto.randomUUID(), clientScannedAt: new Date().toISOString() };
      pendingRef.current = pending;

      await stageReceivingScan({
        batchId,
        barcode: cleanBarcode,
        qtyPackages: packages,
        targetLocation: cleanLocation,
        note: `FIRST STOCKTAKE · ${cleanSku} · ${packageLevel}${note ? ` · ${note}` : ''}`,
        idempotencyKey: pending.idempotencyKey,
        clientScannedAt: pending.clientScannedAt,
      });
      pendingRef.current = null;
      setNotice(`${cleanSku} added to ${cleanLocation}. Check the line below before posting opening stock.`);
      setSku('');
      setBarcode('');
      setPackagesObserved('1');
      setNote('');
      await reload(batchId);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : String(reason)} · The same retry key is retained, so retrying will not duplicate the stocktake line.`);
    } finally {
      setBusy('');
    }
  }

  async function toggleLine(line: StagedReceivingLine) {
    setBusy(line.id);
    setError('');
    try {
      await setReceivingLineTick({ lineId: line.id, ticked: !line.confirmation_checked });
      await reload(line.batch_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  async function postOpeningStock() {
    if (!batch?.id) return;
    setBusy('post');
    setError('');
    setNotice('');
    try {
      const result = await finishStagedReceivingBatch({ batchId: batch.id, note: 'FIRST STOCKTAKE · verified opening stock' });
      const first = result[0];
      window.localStorage.removeItem(BATCH_KEY);
      window.localStorage.removeItem(SESSION_KEY);
      setBatch(null);
      setLines([]);
      setNotice(`First stocktake posted once: ${n(first?.posted_lines)} SKU lines and ${n(first?.posted_units)} units are now in the stock ledger and warehouse locations.`);
      await reload(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  const checked = lines.filter((line) => line.confirmation_checked || line.line_status === 'POSTED').length;
  const allChecked = lines.length > 0 && checked === lines.length;
  const totalUnits = useMemo(() => lines.reduce((sum, line) => sum + n(line.units_received), 0), [lines]);

  return (
    <section className="first-stocktake-screen">
      <header className="first-stocktake-hero">
        <div>
          <span>FIELD READINESS · CURRENT TASK</span>
          <h2>First stocktake</h2>
          <p>Work one physical location at a time. One scan saves the package identity and adds the counted packages to a controlled batch; stock changes only after the final review.</p>
        </div>
        <div className="first-stocktake-hero-actions">
          <a href="/warehouse-map">Open warehouse map</a>
          <button type="button" onClick={() => void reload(batch?.id)} disabled={Boolean(busy)}>Refresh</button>
        </div>
      </header>

      <ol className="first-stocktake-steps">
        <li className={location ? 'done' : 'active'}><b>1</b><span><strong>Location</strong><small>Choose the physical cell</small></span></li>
        <li className={sku ? 'done' : location ? 'active' : ''}><b>2</b><span><strong>SKU</strong><small>Use the Ordermentum item code</small></span></li>
        <li className={barcode ? 'done' : sku ? 'active' : ''}><b>3</b><span><strong>Package</strong><small>Scan barcode and conversion</small></span></li>
        <li className={barcode ? 'active' : ''}><b>4</b><span><strong>Count</strong><small>Add packages to the review batch</small></span></li>
      </ol>

      {error ? <div className="first-stocktake-error">{error}</div> : null}
      {notice ? <div className="first-stocktake-notice">{notice}</div> : null}

      <section className="first-stocktake-entry">
        <label className="first-stocktake-location"><span>1 · Warehouse location</span><input value={location} onChange={(event) => setLocation(event.target.value.toUpperCase())} placeholder="Example A4-L-01-03A" autoCapitalize="characters" /></label>
        <label><span>2 · SKU / item code</span><input value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder="Scan or type SKU" autoCapitalize="characters" /></label>
        <label><span>3 · Package barcode</span><input ref={barcodeRef} value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addStocktakeLine(); }} placeholder="Scan carton / sleeve barcode" autoComplete="off" /></label>

        <div className="first-stocktake-package-rule">
          <span>Package rule</span>
          <select value={packageMode} onChange={(event) => {
            const next = event.target.value as SkuPackageMode;
            setPackageMode(next);
            setPackageLevel(packageModes.find((item) => item.value === next)?.firstLevel || 'CARTON');
          }}>
            {packageModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={packageLevel} onChange={(event) => setPackageLevel(event.target.value as BarcodePackageLevel)}>
            {packageLevels.filter((item) => allowedLevel(packageMode, item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        <div className="first-stocktake-count-row">
          <label><span>Units per package</span><input type="number" min="1" step="1" inputMode="numeric" value={unitsPerPackage} onChange={(event) => setUnitsPerPackage(event.target.value)} /></label>
          <label><span>4 · Packages counted</span><input type="number" min="1" step="1" inputMode="numeric" value={packagesObserved} onChange={(event) => setPackagesObserved(event.target.value)} /></label>
        </div>
        <label><span>Optional note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Damaged cartons, mixed packaging, count note" /></label>
        <button className="first-stocktake-primary" type="button" disabled={Boolean(busy)} onClick={() => void addStocktakeLine()}>{busy === 'add' ? 'Saving and adding…' : 'Add to first stocktake'}</button>
        <small className="first-stocktake-safety">This button does not post stock. It creates or updates the barcode mapping and stages one idempotent line for final verification.</small>
      </section>

      <section className="first-stocktake-review">
        <header>
          <div><span>CONTROLLED BATCH</span><h3>{batch?.batch_no || 'No first-stocktake batch yet'}</h3></div>
          <strong>{checked}/{lines.length} verified · {totalUnits} units</strong>
        </header>
        <div className="first-stocktake-lines">
          {lines.map((line) => (
            <button key={line.id} type="button" className={line.confirmation_checked ? 'checked' : ''} disabled={Boolean(busy)} onClick={() => void toggleLine(line)}>
              <span className="first-stocktake-check">{line.confirmation_checked ? '✓' : ''}</span>
              <span><strong>{line.sku || 'Unknown SKU'}</strong><small>{line.product_name || line.barcode} · {line.suggested_location || location}</small></span>
              <span><b>{n(line.qty_packages)}</b><small>{line.package_level || 'packages'}</small></span>
              <span><b>{n(line.units_received)}</b><small>units</small></span>
            </button>
          ))}
          {!lines.length ? <div className="first-stocktake-empty">Start with one rack and one SKU. Added lines remain saved if the phone closes or loses connection.</div> : null}
        </div>
        <button className="first-stocktake-post" type="button" disabled={!allChecked || Boolean(busy)} onClick={() => void postOpeningStock()}>{busy === 'post' ? 'Posting once…' : 'Post verified opening stock'}</button>
        <p>Posting is enabled only after every line is checked. The existing receiving transaction writes the stock ledger and the warehouse location balance together.</p>
      </section>
    </section>
  );
}
