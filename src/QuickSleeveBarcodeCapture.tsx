import { useRef, useState } from 'react';
import { lookupBarcodeMapping } from '@/data/repositories/barcodeMappingSession';
import { recordBarcodeScan, setSkuPackagePolicy, startBarcodeScanSession } from '@/data/repositories/inventoryControl';

const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const QUICK_SESSION_KEY = 'ecoflow:quick-sleeve-mapping-session';
const CARTON_INPUT_ID = 'quick-sleeve-carton-barcode';
const SLEEVE_INPUT_ID = 'quick-sleeve-sleeve-barcode';

export function QuickSleeveBarcodeCapture() {
  const [open, setOpen] = useState(false);
  const [cartonBarcode, setCartonBarcode] = useState('');
  const [sleeveBarcode, setSleeveBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const cartonRef = useRef<HTMLInputElement | null>(null);
  const sleeveRef = useRef<HTMLInputElement | null>(null);

  function openCapture() {
    setOpen(true);
    setNotice('');
    setError('');
    window.setTimeout(() => cartonRef.current?.focus(), 30);
  }

  function closeCapture() {
    setOpen(false);
    setBusy(false);
    setError('');
  }

  function scanField(inputId: string) {
    document.getElementById(inputId)?.focus();
    window.dispatchEvent(new CustomEvent(CAMERA_SCAN_EVENT, { detail: { inputId } }));
  }

  async function ensureSession() {
    const stored = window.localStorage.getItem(QUICK_SESSION_KEY);
    if (stored) return stored;
    const rows = await startBarcodeScanSession({ sessionName: 'Quick sleeve capture', targetArea: 'Pick / receiving' });
    const id = rows[0]?.session_id;
    if (!id) throw new Error('Could not start quick sleeve capture.');
    window.localStorage.setItem(QUICK_SESSION_KEY, id);
    return id;
  }

  async function saveSleeve() {
    const carton = cartonBarcode.trim();
    const sleeve = sleeveBarcode.trim();
    if (!carton) { setError('Scan the carton barcode first.'); return; }
    if (!sleeve) { setError('Scan the sleeve barcode.'); return; }
    if (carton === sleeve) { setError('Carton and sleeve barcodes must be different.'); return; }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const parent = await lookupBarcodeMapping(carton);
      if (!parent) throw new Error('Carton barcode is not mapped yet. Map the carton first.');
      if (String(parent.package_level).toUpperCase() !== 'CARTON') throw new Error('The first barcode is not registered as a carton.');

      const existingSleeve = await lookupBarcodeMapping(sleeve);
      if (existingSleeve && existingSleeve.sku !== parent.sku) {
        throw new Error(`Sleeve barcode already belongs to ${existingSleeve.sku}.`);
      }

      const sessionId = await ensureSession();
      await setSkuPackagePolicy({
        sku: parent.sku,
        packageMode: 'CARTON_AND_SLEEVE',
        note: `Quick sleeve capture from carton ${carton}`,
      });
      await recordBarcodeScan({
        sessionId,
        sku: parent.sku,
        barcode: sleeve,
        packageLevel: 'SLEEVE',
        unitsPerBarcode: 1,
        productName: parent.product_name,
        qtyObserved: 1,
        actionMode: 'MAP_ONLY',
        note: `Quick sleeve capture from carton ${carton}`,
      });

      setNotice(`${parent.sku} sleeve barcode saved. Stock unchanged.`);
      setCartonBarcode('');
      setSleeveBarcode('');
      window.setTimeout(() => cartonRef.current?.focus(), 40);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open ? <button type="button" className="quick-sleeve-launch" onClick={openCapture}>Add sleeve code</button> : null}
      {open ? (
        <div className="quick-sleeve-overlay" role="dialog" aria-modal="true" aria-label="Add sleeve barcode">
          <section className="quick-sleeve-sheet">
            <header><div><span>QUICK LINK</span><h2>Add sleeve barcode</h2></div><button type="button" onClick={closeCapture}>Close</button></header>
            <div className="quick-sleeve-body">
              <label><span>1 · Carton barcode</span><div><input id={CARTON_INPUT_ID} ref={cartonRef} value={cartonBarcode} onChange={(event) => setCartonBarcode(event.target.value)} placeholder="Scan known carton barcode" autoComplete="off" /><button type="button" onClick={() => scanField(CARTON_INPUT_ID)}>Scan</button></div></label>
              <label><span>2 · Sleeve barcode</span><div><input id={SLEEVE_INPUT_ID} ref={sleeveRef} value={sleeveBarcode} onChange={(event) => setSleeveBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveSleeve(); }} placeholder="Scan sleeve barcode" autoComplete="off" /><button type="button" onClick={() => scanField(SLEEVE_INPUT_ID)}>Scan</button></div></label>
              {error ? <div className="quick-sleeve-error">{error}</div> : null}
              {notice ? <div className="quick-sleeve-notice">{notice}</div> : null}
              <button type="button" className="quick-sleeve-save" disabled={busy} onClick={() => void saveSleeve()}>{busy ? 'Saving…' : 'Save sleeve code'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
