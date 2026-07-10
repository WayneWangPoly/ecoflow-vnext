import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  loadBarcodeRecentScans,
  loadBarcodeRegistryReview,
  loadBarcodeSprintKpis,
  recordBarcodeScan,
  setSkuPackagePolicy,
  startBarcodeScanSession,
} from '@/data/repositories/inventoryControl';

const packageLevels = [
  ['CARTON', 'Carton'],
  ['SLEEVE', 'Sleeve'],
  ['EACH', 'Unit / bottle'],
  ['INNER', 'Inner pack'],
] as const;

const packageModes = [
  ['CARTON_AND_SLEEVE', 'Carton + sleeve'],
  ['CARTON_ONLY', 'Carton only'],
  ['SLEEVE_ONLY', 'Sleeve only'],
  ['EACH_ONLY', 'Unit / bottle only'],
  ['INNER_ONLY', 'Inner pack only'],
] as const;

const defaultForm = {
  sku: '',
  barcode: '',
  packageLevel: 'CARTON',
  packageMode: 'CARTON_AND_SLEEVE',
  unitsPerBarcode: '1',
  shelf: '',
  qtyObserved: '1',
  note: '',
};

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function title(value?: unknown) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function signalTone(signal?: string | null) {
  if (signal === 'BARCODE_READY') return 'good';
  if (signal?.includes('NEEDS')) return 'warn';
  return 'neutral';
}

function levelForMode(mode: string, signal?: string | null) {
  if (signal === 'NEEDS_SLEEVE_BARCODE' || mode === 'SLEEVE_ONLY') return 'SLEEVE';
  if (signal === 'NEEDS_EACH_BARCODE' || mode === 'EACH_ONLY') return 'EACH';
  if (signal === 'NEEDS_INNER_BARCODE' || mode === 'INNER_ONLY') return 'INNER';
  return 'CARTON';
}

function nextLevel(mode: string, current: string) {
  if (mode === 'CARTON_AND_SLEEVE' && current === 'CARTON') return 'SLEEVE';
  return levelForMode(mode);
}

function levelAllowed(mode: string, level: string) {
  if (mode === 'CARTON_AND_SLEEVE') return level === 'CARTON' || level === 'SLEEVE';
  if (mode === 'CARTON_ONLY') return level === 'CARTON';
  if (mode === 'SLEEVE_ONLY') return level === 'SLEEVE';
  if (mode === 'EACH_ONLY') return level === 'EACH';
  if (mode === 'INNER_ONLY') return level === 'INNER';
  return false;
}

function SmallPill({ children, kind = 'neutral' }: { children: ReactNode; kind?: string }) {
  return <span className={`barcode-pill barcode-pill-${kind}`}>{children}</span>;
}

function QueueRow({ row, onPick }: { row: any; onPick: (row: any) => void }) {
  return (
    <button type="button" className="barcode-queue-row" onClick={() => onPick(row)}>
      <div><strong>{row.sku}</strong><span>{row.product_name}</span><small>{title(row.package_mode)} · {row.fixed_shelf || 'No shelf'} · scanned {num(row.scan_count)}</small></div>
      <SmallPill kind={signalTone(row.barcode_signal)}>{title(row.barcode_signal)}</SmallPill>
    </button>
  );
}

function ScanRow({ row }: { row: any }) {
  return (
    <article className="barcode-scan-row">
      <div><strong>{row.sku}</strong><span>{row.barcode}</span><small>{row.shelf || 'No shelf'} · {dateText(row.scanned_at)}</small></div>
      <SmallPill kind="blue">{title(row.package_level)} · {title(row.scan_status)}</SmallPill>
    </article>
  );
}

export function WarehouseBarcodeSprint() {
  const [sessionId, setSessionId] = useState<string | null>(() => window.localStorage.getItem('ecoflow-barcode-sprint-session'));
  const [sessionLabel, setSessionLabel] = useState('Warehouse barcode setup');
  const [targetArea, setTargetArea] = useState('Current rack / area');
  const [form, setForm] = useState(defaultForm);
  const [kpis, setKpis] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  function update(key: keyof typeof defaultForm, value: string) {
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

  async function createSession() {
    const rows = await startBarcodeScanSession({ sessionName: sessionLabel, targetArea });
    const id = rows[0]?.session_id;
    if (!id) throw new Error('Could not start barcode session.');
    window.localStorage.setItem('ecoflow-barcode-sprint-session', id);
    setSessionId(id);
    return id;
  }

  async function ensureSession() {
    return sessionId || createSession();
  }

  async function newSession() {
    setBusy('session');
    setError('');
    setNotice('');
    try {
      window.localStorage.removeItem('ecoflow-barcode-sprint-session');
      setSessionId(null);
      const id = await createSession();
      setNotice(`New setup session ready · ${id.slice(0, 8)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function savePolicy() {
    const sku = form.sku.trim().toUpperCase();
    if (!sku) { setError('Select or type a valid SKU first.'); return; }
    setBusy('policy');
    setError('');
    setNotice('');
    try {
      await setSkuPackagePolicy({ sku, packageMode: form.packageMode, defaultShelf: form.shelf, note: form.note });
      setNotice(`${sku}: package rule saved as ${title(form.packageMode)}.`);
      await reload();
      window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function saveScan(actionMode: 'MAP_ONLY' | 'MAP_AND_COUNT' = 'MAP_ONLY') {
    const sku = form.sku.trim().toUpperCase();
    const barcode = form.barcode.trim();
    const units = Number(form.unitsPerBarcode);
    const observed = Number(form.qtyObserved);
    if (!sku) { setError('Select or type a valid SKU first.'); return; }
    if (!barcode) { setError('Scan barcode first.'); return; }
    if (!levelAllowed(form.packageMode, form.packageLevel)) { setError(`${title(form.packageLevel)} is not valid for ${title(form.packageMode)}.`); return; }
    if (!Number.isInteger(units) || units <= 0) { setError('Units per barcode must be a whole number greater than zero.'); return; }
    if (!Number.isInteger(observed) || observed <= 0) { setError('Observed package count must be a whole number greater than zero.'); return; }
    setBusy('scan');
    setError('');
    setNotice('');
    try {
      const id = await ensureSession();
      await setSkuPackagePolicy({ sku, packageMode: form.packageMode, defaultShelf: form.shelf, note: form.note });
      const result = await recordBarcodeScan({
        sessionId: id,
        sku,
        barcode,
        packageLevel: form.packageLevel as any,
        unitsPerBarcode: units,
        shelf: form.shelf,
        qtyObserved: observed,
        actionMode,
        note: form.note,
      });
      const first = result[0];
      setNotice(`${sku}: ${title(first?.package_level || form.packageLevel)} barcode mapped. Stock was not changed.`);
      setForm((current) => ({ ...current, barcode: '', note: '', qtyObserved: '1', packageLevel: nextLevel(current.packageMode, current.packageLevel) }));
      await reload();
      window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  function pickSku(row: any) {
    const mode = row.package_mode && row.package_mode !== 'UNKNOWN' ? row.package_mode : form.packageMode;
    setForm((current) => ({
      ...current,
      sku: row.sku || '',
      shelf: row.fixed_shelf || current.shelf,
      packageMode: mode,
      packageLevel: levelForMode(mode, row.barcode_signal),
      barcode: '',
    }));
    window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
  }

  const visibleQueue = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return queue.filter((row) => {
      if (!needle) return true;
      return [row.sku, row.product_name, row.fixed_shelf, row.package_mode, row.barcode_signal].filter(Boolean).join(' ').toLowerCase().includes(needle);
    }).slice(0, 24);
  }, [queue, query]);

  return (
    <section className="barcode-sprint-screen barcode-master-screen">
      <section className="barcode-sprint-hero">
        <div><span>BARCODE MASTER</span><h2>Map packaging once. Receive through the controlled batch.</h2><p>Carton and sleeve codes remain stable for the product. New packaging creates a new active mapping instead of changing stock here. Unit / bottle is available only where the product genuinely needs it.</p></div>
        <button type="button" disabled={busy === 'session'} onClick={() => void newSession()}>{busy === 'session' ? 'Starting…' : sessionId ? 'New setup session' : 'Start setup session'}</button>
      </section>

      {error ? <div className="barcode-error">{error}</div> : null}
      {notice ? <div className="barcode-notice">{notice}</div> : null}

      <section className="barcode-kpis">
        <div><strong>{num(kpis?.registered_barcodes)}</strong><span>registered codes</span></div>
        <div><strong>{num(kpis?.needs_policy)}</strong><span>need package rule</span></div>
        <div><strong>{num(kpis?.needs_carton)}</strong><span>need carton code</span></div>
        <div><strong>{num(kpis?.needs_sleeve) + num(kpis?.needs_each)}</strong><span>need sleeve / unit</span></div>
      </section>

      <section className="barcode-form-card">
        <div className="barcode-session-row"><input value={sessionLabel} onChange={(event) => setSessionLabel(event.target.value)} placeholder="Session name" /><input value={targetArea} onChange={(event) => setTargetArea(event.target.value)} placeholder="Rack / area" /></div>
        <div className="barcode-main-inputs"><input value={form.sku} onChange={(event) => update('sku', event.target.value.toUpperCase())} placeholder="SKU / item code" autoCapitalize="characters" /><input ref={barcodeInputRef} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveScan(); }} placeholder="Scan package barcode here, then Enter" autoComplete="off" /></div>
        <div className="barcode-package-buttons barcode-mode-buttons">
          {packageModes.map(([mode, label]) => <button key={mode} type="button" className={form.packageMode === mode ? 'active' : ''} onClick={() => { update('packageMode', mode); update('packageLevel', levelForMode(mode)); }}>{label}</button>)}
        </div>
        <div className="barcode-package-buttons">
          {packageLevels.map(([level, label]) => <button key={level} type="button" disabled={!levelAllowed(form.packageMode, level)} className={form.packageLevel === level ? 'active' : ''} onClick={() => update('packageLevel', level)}>{label}</button>)}
        </div>
        <div className="barcode-detail-inputs"><input type="number" min="1" step="1" value={form.unitsPerBarcode} onChange={(event) => update('unitsPerBarcode', event.target.value)} inputMode="numeric" placeholder="Units per package" /><input type="number" min="1" step="1" value={form.qtyObserved} onChange={(event) => update('qtyObserved', event.target.value)} inputMode="numeric" placeholder="Packages observed" /><input value={form.shelf} onChange={(event) => update('shelf', event.target.value.toUpperCase())} placeholder="Fixed shelf / rack" autoCapitalize="characters" /></div>
        <input value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="Packaging version / supplier note" />
        <div className="barcode-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void savePolicy()}>{busy === 'policy' ? 'Saving rule…' : 'Save package rule'}</button><button type="button" disabled={Boolean(busy)} onClick={() => void saveScan('MAP_ONLY')}>{busy === 'scan' ? 'Saving barcode…' : 'Save barcode mapping'}</button><button type="button" disabled={Boolean(busy)} onClick={() => void saveScan('MAP_AND_COUNT')}>Save mapping + count note</button><button type="button" onClick={() => setForm(defaultForm)}>Clear</button></div>
      </section>

      <section className="barcode-work-grid">
        <section className="barcode-panel"><header><h3>Next SKUs to map</h3><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU / product" /></header><div>{visibleQueue.map((row) => <QueueRow key={row.sku || `${row.product_name}-${row.fixed_shelf}`} row={row} onPick={pickSku} />)}{!visibleQueue.length ? <div className="barcode-empty">No matching SKU mapping work.</div> : null}</div></section>
        <section className="barcode-panel"><header><h3>Recent mappings</h3><SmallPill kind="blue">{recent.length}</SmallPill></header><div>{recent.slice(0, 16).map((row) => <ScanRow key={row.id} row={row} />)}{!recent.length ? <div className="barcode-empty">New barcode mappings appear here.</div> : null}</div></section>
      </section>
    </section>
  );
}
