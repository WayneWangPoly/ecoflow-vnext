import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadBarcodeRecentScans,
  recordBarcodeScan,
  setSkuPackagePolicy,
  startBarcodeScanSession,
  type BarcodePackageLevel,
  type BarcodeRecentScanRow,
  type SkuPackageMode,
} from '@/data/repositories/inventoryControl';
import { loadStocktakeSkuOptions, type StocktakeSkuOption } from '@/data/repositories/stocktakeAssist';

const SESSION_KEY = 'ecoflow:first-stocktake-mapping-session';
const AREA_KEY = 'ecoflow:first-stocktake-mapping-area';
const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const BARCODE_INPUT_ID = 'first-stocktake-mapping-barcode';

type FormState = {
  area: string;
  sku: string;
  productName: string;
  barcode: string;
  packageMode: SkuPackageMode;
  packageLevel: BarcodePackageLevel;
  unitsPerBarcode: string;
  note: string;
};

const packageModes: Array<{ value: SkuPackageMode; label: string; firstLevel: BarcodePackageLevel }> = [
  { value: 'CARTON_AND_SLEEVE', label: 'Carton + sleeve', firstLevel: 'CARTON' },
  { value: 'CARTON_ONLY', label: 'Carton only', firstLevel: 'CARTON' },
  { value: 'SLEEVE_ONLY', label: 'Sleeve only', firstLevel: 'SLEEVE' },
  { value: 'INNER_ONLY', label: 'Inner pack', firstLevel: 'INNER' },
  { value: 'EACH_ONLY', label: 'Single unit', firstLevel: 'EACH' },
];

const packageLevels: Array<{ value: BarcodePackageLevel; label: string }> = [
  { value: 'CARTON', label: 'Carton' },
  { value: 'SLEEVE', label: 'Sleeve' },
  { value: 'INNER', label: 'Inner pack' },
  { value: 'EACH', label: 'Single unit' },
];

function initialForm(): FormState {
  return {
    area: window.localStorage.getItem(AREA_KEY) || '',
    sku: '',
    productName: '',
    barcode: '',
    packageMode: 'CARTON_AND_SLEEVE',
    packageLevel: 'CARTON',
    unitsPerBarcode: '1',
    note: '',
  };
}

function allowedLevel(mode: SkuPackageMode, level: BarcodePackageLevel) {
  if (mode === 'CARTON_AND_SLEEVE') return level === 'CARTON' || level === 'SLEEVE';
  if (mode === 'CARTON_ONLY') return level === 'CARTON';
  if (mode === 'SLEEVE_ONLY') return level === 'SLEEVE';
  if (mode === 'INNER_ONLY') return level === 'INNER';
  if (mode === 'EACH_ONLY') return level === 'EACH';
  return false;
}

function nextLevel(mode: SkuPackageMode, level: BarcodePackageLevel) {
  if (mode === 'CARTON_AND_SLEEVE' && level === 'CARTON') return 'SLEEVE' as BarcodePackageLevel;
  return packageModes.find((item) => item.value === mode)?.firstLevel || 'CARTON';
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function title(value?: string | null) {
  return String(value || '').replace(/_/g, ' ');
}

function internalBarcode(sku: string, level: BarcodePackageLevel) {
  const product = sku.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18) || 'SKU';
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `EF-${product}-${level.slice(0, 3)}-${suffix}`;
}

export function FirstStocktakeMappingFlow() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [skuOptions, setSkuOptions] = useState<StocktakeSkuOption[]>([]);
  const [recent, setRecent] = useState<BarcodeRecentScanRow[]>([]);
  const [skuFocused, setSkuFocused] = useState(false);
  const [keepSku, setKeepSku] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const barcodeRef = useRef<HTMLInputElement | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'area') window.localStorage.setItem(AREA_KEY, String(value));
  }

  async function reloadRecent() {
    const rows = await loadBarcodeRecentScans();
    setRecent(rows.filter((row) => row.action_mode === 'MAP_ONLY' || row.action_mode === 'MAP_AND_COUNT').slice(0, 16));
  }

  useEffect(() => {
    void Promise.all([loadStocktakeSkuOptions(), loadBarcodeRecentScans()])
      .then(([options, scans]) => {
        setSkuOptions(options);
        setRecent(scans.filter((row) => row.action_mode === 'MAP_ONLY' || row.action_mode === 'MAP_AND_COUNT').slice(0, 16));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const skuSuggestions = useMemo(() => {
    const needle = form.sku.trim().toUpperCase();
    if (!skuFocused || !needle) return [];
    return skuOptions
      .filter((option) => option.sku.toUpperCase().includes(needle) || (option.productName || '').toUpperCase().includes(needle))
      .sort((left, right) => {
        const leftStarts = left.sku.toUpperCase().startsWith(needle) ? 0 : 1;
        const rightStarts = right.sku.toUpperCase().startsWith(needle) ? 0 : 1;
        return leftStarts - rightStarts || right.orderCount - left.orderCount || left.sku.localeCompare(right.sku);
      })
      .slice(0, 8);
  }, [form.sku, skuFocused, skuOptions]);

  async function ensureSession() {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const rows = await startBarcodeScanSession({
      sessionName: `Product mapping ${new Date().toLocaleDateString('en-AU')}`,
      targetArea: form.area.trim() || 'Warehouse',
    });
    const id = rows[0]?.session_id;
    if (!id) throw new Error('Could not start product mapping.');
    window.localStorage.setItem(SESSION_KEY, id);
    return id;
  }

  function selectSku(option: StocktakeSkuOption) {
    setForm((current) => ({ ...current, sku: option.sku, productName: option.productName || '' }));
    setSkuFocused(false);
    window.setTimeout(() => barcodeRef.current?.focus(), 0);
  }

  function openCamera() {
    barcodeRef.current?.focus();
    window.dispatchEvent(new CustomEvent(CAMERA_SCAN_EVENT, { detail: { inputId: BARCODE_INPUT_ID } }));
  }

  function generateInternalCode() {
    const sku = form.sku.trim().toUpperCase();
    if (!sku) {
      setError('Enter the physical SKU first.');
      return;
    }
    setError('');
    setForm((current) => ({ ...current, barcode: internalBarcode(sku, current.packageLevel) }));
    setNotice('Internal Code 128 value generated.');
  }

  async function saveMapping() {
    const sku = form.sku.trim().toUpperCase();
    const barcode = form.barcode.trim();
    const units = Number(form.unitsPerBarcode);
    if (!sku) { setError('Physical SKU is required.'); return; }
    if (!barcode) { setError('Scan or generate a barcode.'); return; }
    if (!allowedLevel(form.packageMode, form.packageLevel)) { setError('Package level does not match the package rule.'); return; }
    if (!Number.isInteger(units) || units <= 0) { setError('Units per barcode must be a whole number greater than zero.'); return; }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const sessionId = await ensureSession();
      const area = form.area.trim().toUpperCase();
      const notes = [area ? `OBSERVED AREA ${area}` : '', form.note.trim()].filter(Boolean).join(' · ');
      await setSkuPackagePolicy({
        sku,
        packageMode: form.packageMode,
        note: notes || 'Product mapping',
      });
      await recordBarcodeScan({
        sessionId,
        sku,
        barcode,
        packageLevel: form.packageLevel,
        unitsPerBarcode: units,
        productName: form.productName.trim() || null,
        qtyObserved: 1,
        actionMode: 'MAP_ONLY',
        note: notes || 'Product mapping',
      });

      const savedLevel = form.packageLevel;
      setNotice(`${sku} · ${title(savedLevel)} mapped. Stock unchanged.`);
      setForm((current) => ({
        ...current,
        sku: keepSku ? sku : '',
        productName: keepSku ? current.productName : '',
        barcode: '',
        note: '',
        packageLevel: nextLevel(current.packageMode, current.packageLevel),
      }));
      await reloadRecent();
      window.setTimeout(() => barcodeRef.current?.focus(), 60);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="first-stocktake-map-screen">
      <header className="first-stocktake-map-header">
        <div><span>PRODUCT SETUP</span><h2>Map SKU and barcode</h2></div>
        <strong>Stock unchanged</strong>
      </header>

      {error ? <div className="first-stocktake-map-error">{error}</div> : null}
      {notice ? <div className="first-stocktake-map-notice">{notice}</div> : null}

      <section className="first-stocktake-map-form">
        <label><span>Current area <small>optional</small></span><input value={form.area} onChange={(event) => update('area', event.target.value.toUpperCase())} placeholder="Rack or temporary area" autoCapitalize="characters" /></label>

        <div className="first-stocktake-map-grid">
          <div className="first-stocktake-map-sku">
            <label><span>Physical SKU</span><input value={form.sku} onChange={(event) => update('sku', event.target.value.toUpperCase())} onFocus={() => setSkuFocused(true)} onBlur={() => window.setTimeout(() => setSkuFocused(false), 140)} placeholder="SKU / temporary SKU" autoCapitalize="characters" autoComplete="off" /></label>
            {skuSuggestions.length ? (
              <div className="first-stocktake-map-suggestions">
                {skuSuggestions.map((option) => <button key={option.sku} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectSku(option)}><strong>{option.sku}</strong><small>{option.productName || 'Product'}</small></button>)}
              </div>
            ) : null}
          </div>
          <label><span>Product name <small>optional</small></span><input value={form.productName} onChange={(event) => update('productName', event.target.value)} placeholder="Brand, size or customer logo" /></label>
        </div>

        <label><span>Barcode</span><div className="first-stocktake-map-barcode"><input id={BARCODE_INPUT_ID} ref={barcodeRef} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveMapping(); }} placeholder="Scan package barcode" autoComplete="off" /><button type="button" onClick={openCamera}>Scan</button><button type="button" onClick={generateInternalCode}>Internal code</button></div></label>

        <div className="first-stocktake-map-package-grid">
          <label><span>Package rule</span><select value={form.packageMode} onChange={(event) => {
            const next = event.target.value as SkuPackageMode;
            setForm((current) => ({ ...current, packageMode: next, packageLevel: packageModes.find((item) => item.value === next)?.firstLevel || 'CARTON' }));
          }}>{packageModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Barcode level</span><select value={form.packageLevel} onChange={(event) => update('packageLevel', event.target.value as BarcodePackageLevel)}>{packageLevels.filter((item) => allowedLevel(form.packageMode, item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Units per barcode</span><input type="number" min="1" step="1" inputMode="numeric" value={form.unitsPerBarcode} onChange={(event) => update('unitsPerBarcode', event.target.value)} /></label>
        </div>

        <label><span>Note <small>optional</small></span><input value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="Supplier, packaging version or restriction" /></label>

        <div className="first-stocktake-map-actions">
          <label className="first-stocktake-map-keep"><input type="checkbox" checked={keepSku} onChange={(event) => setKeepSku(event.target.checked)} /><span>Keep SKU for next barcode</span></label>
          <button type="button" className="first-stocktake-map-primary" disabled={busy} onClick={() => void saveMapping()}>{busy ? 'Saving…' : 'Save mapping'}</button>
        </div>
      </section>

      <section className="first-stocktake-map-recent">
        <header><h3>Recent mappings</h3><button type="button" disabled={busy} onClick={() => void reloadRecent()}>Refresh</button></header>
        <div>
          {recent.map((row) => (
            <article key={row.id}>
              <span><strong>{row.sku || 'Unknown SKU'}</strong><small>{row.product_name || row.scan_note || '—'}</small></span>
              <span><strong>{row.barcode}</strong><small>{title(String(row.package_level))} · {row.units_per_barcode || 1} units</small></span>
              <time>{dateText(row.scanned_at)}</time>
            </article>
          ))}
          {!recent.length ? <div className="first-stocktake-map-empty">No mappings yet.</div> : null}
        </div>
      </section>
    </section>
  );
}
