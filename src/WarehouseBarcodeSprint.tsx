import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadBarcodeRecentScans,
  loadBarcodeRegistryReview,
  loadBarcodeSprintKpis,
  receiveByBarcode,
  recordBarcodeScan,
  setSkuPackagePolicy,
  startBarcodeScanSession,
} from '@/data/repositories/inventoryControl';

const packageLevels = ['CARTON', 'SLEEVE', 'EACH', 'INNER'] as const;
const packageModes = [
  ['CARTON_AND_SLEEVE', 'Carton + sleeve'],
  ['CARTON_ONLY', 'Carton only'],
  ['SLEEVE_ONLY', 'Sleeve only'],
  ['EACH_ONLY', 'Each only'],
  ['INNER_ONLY', 'Inner only'],
] as const;
const defaultForm = {
  sku: '',
  barcode: '',
  packageLevel: 'CARTON',
  packageMode: 'CARTON_AND_SLEEVE',
  unitsPerBarcode: '1',
  shelf: '',
  qtyObserved: '1',
  actionMode: 'MAP_ONLY',
  note: '',
};
const receiveFormDefault = { barcode: '', qtyPackages: '1', toLocation: 'RECEIVING', note: '' };

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
  if (mode === 'EACH_ONLY') return 'EACH';
  if (mode === 'SLEEVE_ONLY') return 'SLEEVE';
  if (mode === 'INNER_ONLY') return 'INNER';
  return current;
}

function SmallPill({ children, kind = 'neutral' }: { children: any; kind?: string }) {
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
      <SmallPill kind={row.movement_id ? 'good' : 'blue'}>{title(row.package_level)} · {title(row.scan_status)}</SmallPill>
    </article>
  );
}

export function WarehouseBarcodeSprint() {
  const [sessionId, setSessionId] = useState<string | null>(() => window.localStorage.getItem('ecoflow-barcode-sprint-session'));
  const [sessionLabel, setSessionLabel] = useState('First barcode sprint');
  const [targetArea, setTargetArea] = useState('A4 / cups / lids');
  const [form, setForm] = useState(defaultForm);
  const [receiveForm, setReceiveForm] = useState(receiveFormDefault);
  const [kpis, setKpis] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const receiveInputRef = useRef<HTMLInputElement | null>(null);

  function update(key: keyof typeof defaultForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateReceive(key: keyof typeof receiveFormDefault, value: string) {
    setReceiveForm((current) => ({ ...current, [key]: value }));
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

  async function savePolicy() {
    const sku = form.sku.trim().toUpperCase();
    if (!sku) { setError('Type or pick SKU first.'); return; }
    setBusy('policy'); setError(''); setNotice('');
    try {
      await setSkuPackagePolicy({ sku, packageMode: form.packageMode, defaultShelf: form.shelf, note: form.note });
      setNotice(`${sku}: package mode set to ${title(form.packageMode)}.`);
      await reload();
      window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function saveScan(modeOverride?: string) {
    const sku = form.sku.trim().toUpperCase();
    const barcode = form.barcode.trim();
    if (!sku) { setError('Type or pick SKU first.'); return; }
    if (!barcode) { setError('Scan barcode first.'); return; }
    setBusy('scan'); setError(''); setNotice('');
    try {
      const id = await ensureSession();
      await setSkuPackagePolicy({ sku, packageMode: form.packageMode, defaultShelf: form.shelf, note: form.note });
      const result = await recordBarcodeScan({
        sessionId: id,
        sku,
        barcode,
        packageLevel: form.packageLevel as any,
        unitsPerBarcode: form.unitsPerBarcode || 1,
        shelf: form.shelf,
        qtyObserved: form.qtyObserved || 1,
        actionMode: (modeOverride || form.actionMode) as any,
        note: form.note,
      });
      const first = result[0];
      setNotice(`${sku}: ${title(first?.package_level || form.packageLevel)} barcode saved${first?.movement_id ? ' + stock received' : ''}.`);
      setForm((current) => ({ ...current, barcode: '', note: '', packageLevel: nextLevel(current.packageMode, current.packageLevel) }));
      await reload();
      window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function receiveMappedBarcode() {
    const barcode = receiveForm.barcode.trim();
    if (!barcode) { setError('Scan mapped receiving barcode first.'); return; }
    setBusy('receive'); setError(''); setNotice('');
    try {
      const result = await receiveByBarcode({ barcode, qtyPackages: receiveForm.qtyPackages || 1, toLocation: receiveForm.toLocation || 'RECEIVING', note: receiveForm.note });
      const first = result[0];
      setNotice(`${first?.sku || 'SKU'}: received ${num(first?.units_received)} units from ${title(first?.package_level)} barcode.`);
      setReceiveForm((current) => ({ ...current, barcode: '', note: '' }));
      await reload();
      window.setTimeout(() => receiveInputRef.current?.focus(), 60);
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
    setReceiveForm((current) => ({ ...current, toLocation: row.fixed_shelf || current.toLocation }));
    window.setTimeout(() => barcodeInputRef.current?.focus(), 60);
  }

  const visibleQueue = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return queue.filter((row) => {
      if (!needle) return true;
      return [row.sku, row.product_name, row.fixed_shelf, row.package_mode, row.barcode_signal].filter(Boolean).join(' ').toLowerCase().includes(needle);
    }).slice(0, 18);
  }, [queue, query]);

  return (
    <section className="barcode-sprint-screen">
      <section className="barcode-sprint-hero">
        <div><span>FAST BARCODE SPRINT</span><h2>Package rules first, then scan what the SKU actually needs.</h2><p>Carton-only, sleeve-only, each-only chemicals and carton+sleeve products are handled separately. First round should stay MAP ONLY unless receiving new stock.</p></div>
        <button type="button" disabled={busy === 'session'} onClick={async () => { setBusy('session'); try { await ensureSession(); setNotice('Session ready.'); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(''); } }}>Start / keep session</button>
      </section>

      {error ? <div className="barcode-error">{error}</div> : null}
      {notice ? <div className="barcode-notice">{notice}</div> : null}

      <section className="barcode-kpis">
        <div><strong>{num(kpis?.registered_barcodes)}</strong><span>barcodes</span></div>
        <div><strong>{num(kpis?.needs_policy)}</strong><span>need policy</span></div>
        <div><strong>{num(kpis?.needs_carton)}</strong><span>need carton</span></div>
        <div><strong>{num(kpis?.needs_sleeve) + num(kpis?.needs_each)}</strong><span>need sleeve / each</span></div>
      </section>

      <section className="barcode-form-card">
        <div className="barcode-session-row"><input value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} placeholder="Session name" /><input value={targetArea} onChange={(e) => setTargetArea(e.target.value)} placeholder="Area / rack" /></div>
        <div className="barcode-main-inputs"><input value={form.sku} onChange={(e) => update('sku', e.target.value.toUpperCase())} placeholder="SKU / item code" /><input ref={barcodeInputRef} value={form.barcode} onChange={(e) => update('barcode', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveScan(); }} placeholder="Scan barcode here, then Enter" /></div>
        <div className="barcode-package-buttons barcode-mode-buttons">
          {packageModes.map(([mode, label]) => <button key={mode} type="button" className={form.packageMode === mode ? 'active' : ''} onClick={() => { update('packageMode', mode); update('packageLevel', levelForMode(mode)); }}>{label}</button>)}
        </div>
        <div className="barcode-package-buttons">
          {packageLevels.map((level) => <button key={level} type="button" className={form.packageLevel === level ? 'active' : ''} onClick={() => update('packageLevel', level)}>{level}</button>)}
        </div>
        <div className="barcode-detail-inputs"><input value={form.unitsPerBarcode} onChange={(e) => update('unitsPerBarcode', e.target.value)} inputMode="decimal" placeholder="Units per barcode" /><input value={form.qtyObserved} onChange={(e) => update('qtyObserved', e.target.value)} inputMode="decimal" placeholder="Qty counted" /><input value={form.shelf} onChange={(e) => update('shelf', e.target.value.toUpperCase())} placeholder="Shelf / rack" /></div>
        <select value={form.actionMode} onChange={(e) => update('actionMode', e.target.value)}><option value="MAP_ONLY">Map barcode only</option><option value="MAP_AND_COUNT">Map + count note</option><option value="MAP_AND_RECEIVE">Map + receive into stock</option></select>
        <input value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Optional note" />
        <div className="barcode-actions"><button type="button" disabled={busy === 'policy'} onClick={() => void savePolicy()}>{busy === 'policy' ? 'Saving…' : 'Save package rule'}</button><button type="button" disabled={busy === 'scan'} onClick={() => void saveScan('MAP_ONLY')}>{busy === 'scan' ? 'Saving…' : 'Save barcode'}</button><button type="button" disabled={busy === 'scan'} onClick={() => void saveScan('MAP_AND_RECEIVE')}>Save + receive stock</button><button type="button" onClick={() => setForm(defaultForm)}>Clear</button></div>
      </section>

      <section className="barcode-form-card barcode-receive-card">
        <h3>Receive by known barcode</h3>
        <p>Use this after barcode mapping is done. Scan a mapped carton/sleeve/each code, enter package count, and receive into live stock.</p>
        <div className="barcode-detail-inputs"><input ref={receiveInputRef} value={receiveForm.barcode} onChange={(e) => updateReceive('barcode', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void receiveMappedBarcode(); }} placeholder="Scan mapped barcode to receive" /><input value={receiveForm.qtyPackages} onChange={(e) => updateReceive('qtyPackages', e.target.value)} inputMode="decimal" placeholder="Package count" /><input value={receiveForm.toLocation} onChange={(e) => updateReceive('toLocation', e.target.value.toUpperCase())} placeholder="To location" /></div>
        <input value={receiveForm.note} onChange={(e) => updateReceive('note', e.target.value)} placeholder="Receiving note / PO" />
        <div className="barcode-actions"><button type="button" disabled={busy === 'receive'} onClick={() => void receiveMappedBarcode()}>{busy === 'receive' ? 'Receiving…' : 'Receive by barcode'}</button></div>
      </section>

      <section className="barcode-work-grid">
        <section className="barcode-panel"><header><h3>Next SKUs to scan</h3><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SKU" /></header><div>{visibleQueue.map((row) => <QueueRow key={row.sku || Math.random()} row={row} onPick={pickSku} />)}</div></section>
        <section className="barcode-panel"><header><h3>Recent scans</h3><SmallPill kind="blue">{recent.length}</SmallPill></header><div>{recent.slice(0, 12).map((row) => <ScanRow key={row.id} row={row} />)}</div></section>
      </section>
    </section>
  );
}
