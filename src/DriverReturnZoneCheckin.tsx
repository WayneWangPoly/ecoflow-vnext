import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, MapPin, PackageCheck, RotateCcw, X } from 'lucide-react';
import { driverDropReturn, loadOpenReturnZoneItems } from '@/data/repositories/returnZoneOperations';
import type { OpenDeliveryReturn } from '@/data/repositories/deliveryOperations';

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actorLabel() {
  return document.querySelector<HTMLElement>('.driver-topbar-brand span')?.textContent?.replace(/^DRIVER\s*·\s*/i, '').trim() || 'Driver';
}

async function detectBarcode(file: File) {
  const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
  if (!Detector) throw new Error('Camera barcode reading is not available on this phone. Use the scanner field or type the zone code.');
  const bitmap = await createImageBitmap(file);
  try {
    const detector = new Detector({ formats: ['qr_code', 'code_39', 'code_128'] });
    const results = await detector.detect(bitmap);
    const value = results[0]?.rawValue?.trim();
    if (!value) throw new Error('No return-zone barcode was found in the photo. Move closer and try again.');
    return value;
  } finally {
    bitmap.close();
  }
}

function getCurrentPosition() {
  return new Promise<{ latitude: number; longitude: number; accuracyMetres: number }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This phone cannot provide GPS location. Use a GPS-enabled phone at the warehouse.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMetres: position.coords.accuracy,
      }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new Error('Location permission is required. Allow precise location and scan again.'));
        else if (error.code === error.TIMEOUT) reject(new Error('GPS timed out. Move near the warehouse entrance and try again.'));
        else reject(new Error('Current warehouse location could not be verified. Try again with precise location enabled.'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 },
    );
  });
}

function ZoneDialog({ row, onClose, onSaved }: { row: OpenDeliveryReturn; onClose: () => void; onSaved: () => void }) {
  const [zoneCode, setZoneCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { window.setTimeout(() => codeRef.current?.focus(), 80); }, []);

  async function confirm(codeOverride?: string) {
    const code = (codeOverride ?? zoneCode).trim().toUpperCase();
    if (!code) { setError('Scan the fixed QR code attached to the warehouse returns area.'); return; }
    setBusy(true);
    setError('');
    try {
      const position = await getCurrentPosition();
      const result = await driverDropReturn({
        exceptionId: row.id,
        zoneCode: code,
        note,
        driver: actorLabel(),
        ...position,
      });
      const first = result[0] as { distance_metres?: number | string } | undefined;
      setDistance(first?.distance_metres == null ? null : num(first.distance_metres));
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function readCamera(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const value = (await detectBarcode(file)).toUpperCase();
      setZoneCode(value);
      await confirm(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
    }
  }

  return createPortal(
    <div className="driver-return-zone-overlay" role="dialog" aria-label="Return goods to warehouse">
      <section className="driver-return-zone-sheet">
        <header>
          <div><span>RETURN TO WAREHOUSE</span><h2>{row.return_code}</h2><p>{row.box_code || 'BOX'} · {row.store_name || 'Unknown store'} · {num(row.return_cartons)} carton(s)</p></div>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </header>
        {!saved ? (
          <>
            <div className="driver-return-zone-rule"><PackageCheck size={21} /><div><strong>Put the goods inside the marked Returns Area.</strong><span>Scan the fixed wall QR. The code and phone GPS must both verify within 500 metres of the warehouse.</span></div></div>
            <div className="driver-return-zone-geo"><MapPin size={18} /><div><strong>500 m warehouse geofence</strong><span>Precise location is checked only when this return is confirmed.</span></div></div>
            <input ref={codeRef} value={zoneCode} onChange={(event) => setZoneCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') void confirm(); }} placeholder="Scan RETURNS AREA QR" />
            <button type="button" className="driver-return-camera" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera size={19} /> Scan zone QR with camera</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void readCamera(event.target.files?.[0])} />
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional: where placed / condition" />
            {error ? <div className="driver-return-zone-error">{error}</div> : null}
            <button type="button" className="driver-return-zone-primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'Checking QR + warehouse GPS…' : 'Confirm placed in returns area'}</button>
            <p className="driver-return-zone-footnote">The RET number identifies this return. The fixed wall QR plus GPS proves it was physically brought back.</p>
          </>
        ) : (
          <section className="driver-return-zone-success">
            <CheckCircle2 size={40} />
            <h3>Return placed in warehouse area</h3>
            <p>{row.return_code} is waiting for warehouse inspection. GPS verified{distance == null ? '' : ` at ${Math.round(distance)} m from the return zone`}. It has not been added to sellable stock.</p>
            <button type="button" className="driver-return-zone-primary" onClick={onClose}>Done</button>
          </section>
        )}
      </section>
    </div>,
    document.body,
  );
}

function ReturnRow({ row, onOpen }: { row: OpenDeliveryReturn; onOpen: (row: OpenDeliveryReturn) => void }) {
  return (
    <article className="driver-return-zone-row">
      <div><strong>{row.return_code}</strong><span>{row.box_code || 'BOX'} · {row.store_name || 'Unknown store'}</span><small>{num(row.return_cartons)} carton(s) · {row.reason || row.driver_note || 'Return required'}</small></div>
      <button type="button" onClick={() => onOpen(row)}>Return to warehouse</button>
    </article>
  );
}

export function DriverReturnZoneCheckin() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<OpenDeliveryReturn[]>([]);
  const [selected, setSelected] = useState<OpenDeliveryReturn | null>(null);
  const [error, setError] = useState('');

  async function reload() {
    try {
      setRows(await loadOpenReturnZoneItems());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    function locate() {
      const shell = document.querySelector<HTMLElement>('.driver-shell');
      const content = shell?.querySelector<HTMLElement>('.driver-content');
      const activeNav = Array.from(shell?.querySelectorAll<HTMLButtonElement>('.driver-nav button') ?? []).find((button) => button.classList.contains('active'))?.textContent?.trim();
      if (!content || activeNav !== 'Today') { setHost(null); return; }
      let mount = content.querySelector<HTMLElement>('.driver-return-zone-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'driver-return-zone-mount';
        content.insertAdjacentElement('afterbegin', mount);
      }
      setHost(mount);
    }
    locate();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; locate(); }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!host) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [host]);

  const pending = useMemo(() => rows.filter((row) => row.return_status === 'WITH_DRIVER'), [rows]);
  if (!host || (!pending.length && !error)) return selected ? <ZoneDialog row={selected} onClose={() => setSelected(null)} onSaved={reload} /> : null;

  return createPortal(
    <>
      <section className="driver-return-zone-card">
        <header><div><span>RETURN RUN</span><h2>{pending.length} return item{pending.length === 1 ? '' : 's'} still with driver</h2><p>At the warehouse, place each item in the marked Returns Area and scan the fixed QR. Confirmation is accepted only within 500 metres.</p></div><button type="button" onClick={() => void reload()}><RotateCcw size={16} /></button></header>
        {error ? <div className="driver-return-zone-error">{error}</div> : null}
        <div>{pending.map((row) => <ReturnRow key={row.id} row={row} onOpen={setSelected} />)}</div>
      </section>
      {selected ? <ZoneDialog row={selected} onClose={() => setSelected(null)} onSaved={reload} /> : null}
    </>,
    host,
  );
}
