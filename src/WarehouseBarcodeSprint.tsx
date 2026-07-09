import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadBarcodeRecentScans,
  loadBarcodeRegistryReview,
  loadBarcodeSprintKpis,
  recordBarcodeScan,
  startBarcodeScanSession,
  type BarcodeActionMode,
  type BarcodePackageLevel,
  type BarcodeRecentScanRow,
  type BarcodeRegistryReviewRow,
  type BarcodeSprintKpis,
} from '@/data/repositories/inventoryControl';

type FormState = {
  sku: string;
  barcode: string;
  packageLevel: BarcodePackageLevel;
  unitsPerBarcode: string;
  shelf: string;
  qtyObserved: string;
  actionMode: BarcodeActionMode;
  note: string;
};

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
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function tone(signal?: string | null) {
  if (signal === 'BARCODE_READY') return 'good';
  if (signal?.includes('NEEDS')) return 'warn';
  return 'neutral';
}

function SmallPill({ children, kind = 'neutral' }: { children: string; kind?: 'good' | 'warn' | 'neutral' | 'blue' }) {
  return <span className={`barcode-pill barcode-pill-${kind}`}>{children}</span>;
}

function QueueRow({ row, onPick }: { row: BarcodeRegistryReviewRow; onPick: (row: BarcodeRegistryReviewRow) => void }) {
  return (
    <button type="button" className="barcode-queue-row" onClick={() => onPick(row)}>
      <div><strong>{row.sku}</strong><span>{row.product_name}</span><small>{row.fixed_shelf || 'No shelf'} · scanned {num(row.scan_count)}</small></div>
      <SmallPill kind={tone(row.barcode_signal)}>{title(row.barcode_signal)}</SmallPill>
    </button>
  );
}

function ScanRow({ row }: { row: BarcodeRecentScanRow }) {
  return (
    <article className="barcode-scan-row">
      <div><strong>{row.sku}</strong><span>{row.barcode}</span><small>{row.shelf || 'No shelf'} · {dateText(row.scanned_at)}</small></div>
      <SmallPill kind={row.movement_id ? 'good' : 'blue'}>{title(row.package_level)} · {title(row.scan_status)}</SmallPill>
    </article>
  );
}

const defaultForm: FormState = {
  sku: '',
  barcode: '',
  packageLevel: 'CARTON',
  unitsPerBarcode: '1',
  shelf: '',
  qtyObserved: '1',
  actionMode: 'MAP_ONLY',
  note: '',
};

export function WarehouseBarcodeSprint() {
  const [sessionId, setSessionId] = useState<string | null>(() => window.localStorage.getItem('ecoflow-barcode-sprint-session'));
  const [sessionLabel, setSessionLabel] = useState('First barcode sprint');
  const [targetArea, setTargetArea] = useState('A4 / cups / lids');
  const [form, setForm] = useState<FormState>(defaultForm);
  const [kpis, setKpis] = useState<BarcodeSprintKpis | null>(null);
  const [queue, setQueue] = useState<BarcodeRegistryReviewRow[]>([]);
  const [recent, setRecent] = useState<BarcodeRecentScanRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextQueue, nextRecent] = await Promise.all([loadBarcodeSprintKpis(), loadBarcodeRegistryReview(), loadBarcodeRecentScans()]);
      setKpis(nextKpis);
      setQueue(nextQueue);
      setRecent(nextRecent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);
  useEffect(() => { barcodeInputRef.current?.focus(); }, [form.sku, form.packageLevel]);

  async function ensureSession() {
    if (sessionId) return sessionId;
    const rows = await startBarcodeScanSession({ sessionName: sessionLabel, targetArea });
    const id = rows[0]?.session_id;
    if (!id) throw new Error('Could not start barcode session.');
    window.localStorage.setItem('ecoflow-barcode-sprint-session', id);
    setSessionId(id);
    return id;
  }

  async function saveScan(modeOverride?: BarcodeActionMode) {
    const sku = form.sku.trim().toUpperCase();
    const barcode = form.barcode.trim();
    if (!sku) { setError('Type or pick SKU first.'); return; }
    if (!barcode) { setError('Scan barcode first.'); return; }
    setBusy('scan'); setError(''); setNotice('');
    try {
      const id = await ensureSession();
      const result = await recordBarcodeScan({
        sessionId: id,
        sku,
        barcode,
        packageLevel: form.packageLevel,
        unitsPerBarcode: form.unitsPerBarcode || 1,
        shelf: form.shelf,
        qtyObserved: form.qtyObserved || 1,
        actionMode: modeOverride || form.actionMode,
        note: form.note,
      });
      const first = result[0];
      setNotice(`${sku}: ${title(first?.package_level || form.packageLevel)} barcode saved${first?.movement_id ? ' + stock received' : ''}.`);
      setForm((current) => ({ ...current, barcode: '', note: '', packageLevel: current.packageLevel === 'CARTON' ? 'SLEEVE' : current.packageLevel }));
      await reload();
      window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  function pickSku(row: BarcodeRegistryReviewRow) {
    setForm((current) => ({
      ...current,
      sku: row.sku || '',
      shelf: row.fixed_shelf || current.shelf,
      packageLevel: row.barcode_signal === 'NEEDS_SLEEVE_BARCODE' ? 'SLEEVE' : 'CARTON',
      barcode: '',
    }));
    window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
  }

  const visibleQueue = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return queue.filter((row) => {
      if (!needle) return true;
      return [row.sku, row.product_name, row.fixed_shelf, row.barcode_signal].filter(Boolean).join(' ').toLowerCase().includes(needle);
    }).slice(0, 18);
  }, [queue, query]);

  return (
    <section className="barcode-sprint-screen">
      <section className="barcode-sprint-hero">
        <div><span>FAST BARCODE SPRINT</span><h2>Scan carton and sleeve barcodes without slowing the floor.</h2><p>Pick SKU once, scan carton, scan sleeve, move to next SKU. Use MAP ONLY for the first clean-up round.</p></div>
        <button type="button" disabled={busy === 'session'} onClick={async () => { setBusy('session'); try { await ensureSession(); setNotice('Session ready.'); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(''); } }}>Start / keep session</button>
      </section>

      {error ? <div className="barcode-error">{error}</div> : null}
      {notice ? <div className="barcode-notice">{notice}</div> : null}

      <section className="barcode-kpis">
        <div><strong>{num(kpis?.registered_barcodes)}</strong><span>barcodes</span></div>
        <div><strong>{num(kpis?.covered_skus)}</strong><span>covered SKUs</span></div>
        <div><strong>{num(kpis?.needs_carton)}</strong><span>need carton</span></div>
        <div><strong>{num(kpis?.needs_sleeve)}</strong><span>need sleeve</span></div>
      </section>

      <section className="barcode-form-card">
        <div className="barcode-session-row"><input value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} placeholder="Session name" /><input value={targetArea} onChange={(e) => setTargetArea(e.target.value)} placeholder="Area / rack" /></div>
        <div className="barcode-main-inputs"><input value={form.sku} onChange={(e) => update('sku', e.target.value.toUpperCase())} placeholder="SKU / item code" /><input ref={barcodeInputRef} value={form.barcode} onChange={(e) => update('barcode', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveScan(); }} placeholder="Scan barcode here, then Enter" /></div>
        <div className="barcode-package-buttons">
          {(['CARTON','SLEEVE','EACH','INNER'] as BarcodePackageLevel[]).map((level) => <button key={level} type="button" className={form.packageLevel === level ? 'active' : ''} onClick={() => update('packageLevel', level)}>{level}</button>)}
        </div>
        <div className="barcode-detail-inputs"><input value={form.unitsPerBarcode} onChange={(e) => update('unitsPerBarcode', e.target.value)} inputMode="decimal" placeholder="Units per barcode" /><input value={form.qtyObserved} onChange={(e) => update('qtyObserved', e.target.value)} inputMode="decimal" placeholder="Qty counted" /><input value={form.shelf} onChange={(e) => update('shelf', e.target.value.toUpperCase())} placeholder="Shelf / rack" /></div>
        <select value={form.actionMode} onChange={(e) => update('actionMode', e.target.value as BarcodeActionMode)}><option value="MAP_ONLY">Map barcode only</option><option value="MAP_AND_COUNT">Map + count note</option><option value="MAP_AND_RECEIVE">Map + receive into stock</option></select>
        <input value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Optional note" />
        <div className="barcode-actions"><button type="button" disabled={busy === 'scan'} onClick={() => void saveScan('MAP_ONLY')}>{busy === 'scan' ? 'Saving…' : 'Save barcode'}</button><button type="button" disabled={busy === 'scan'} onClick={() => void saveScan('MAP_AND_RECEIVE')}>Save + receive stock</button><button type="button" onClick={() => setForm(defaultForm)}>Clear</button></div>
      </section>

      <section className="barcode-work-grid">
        <section className="barcode-panel"><header><h3>Next SKUs to scan</h3><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SKU" /></header><div>{visibleQueue.map((row) => <QueueRow key={row.sku || Math.random()} row={row} onPick={pickSku} />)}</div></section>
        <section className="barcode-panel"><header><h3>Recent scans</h3><SmallPill kind="blue">{recent.length}</SmallPill></header><div>{recent.slice(0, 12).map((row) => <ScanRow key={row.id} row={row} />)}</div></section>
      </section>
    </section>
  );
}
