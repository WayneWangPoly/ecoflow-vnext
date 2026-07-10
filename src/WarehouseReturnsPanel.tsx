import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageCheck, Printer, RotateCcw } from 'lucide-react';
import type { OpenDeliveryReturn } from '@/data/repositories/deliveryOperations';
import {
  completeReturnInspection,
  loadOpenReturnZoneItems,
  loadReturnInspectionLines,
  loadReturnZones,
  recordReturnInspectionItem,
  type ReturnInspectionLine,
  type ReturnZone,
} from '@/data/repositories/returnZoneOperations';

const CODE39: Record<string, string> = {
  '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
  A:'wnnnnwnnw',B:'nnwnnwnnw',C:'wnwnnwnnn',D:'nnnnwwnnw',E:'wnnnwwnnn',F:'nnwnwwnnn',G:'nnnnnwwnw',H:'wnnnnwwnn',I:'nnwnnwwnn',J:'nnnnwwwnn',
  K:'wnnnnnnww',L:'nnwnnnnww',M:'wnwnnnnwn',N:'nnnnwnnww',O:'wnnnwnnwn',P:'nnwnwnnwn',Q:'nnnnnnwww',R:'wnnnnnwwn',S:'nnwnnnwwn',T:'nnnnwnwwn',
  U:'wwnnnnnnw',V:'nwwnnnnnw',W:'wwwnnnnnn',X:'nwnnwnnnw',Y:'wwnnwnnnn',Z:'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn'
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
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Code39Barcode({ value }: { value: string }) {
  const text = `*${value.toUpperCase().replace(/[^0-9A-Z.\- ]/g, '')}*`;
  let x = 0;
  const bars: Array<{ x: number; width: number }> = [];
  for (const char of text) {
    const pattern = CODE39[char] || CODE39['-'];
    pattern.split('').forEach((part, index) => {
      const width = part === 'w' ? 5 : 2;
      if (index % 2 === 0) bars.push({ x, width });
      x += width;
    });
    x += 2;
  }
  return <svg className="return-zone-barcode" viewBox={`0 0 ${x} 60`} role="img" aria-label={`Barcode ${value}`}>{bars.map((bar, index) => <rect key={`${bar.x}-${index}`} x={bar.x} y="0" width={bar.width} height="60" fill="currentColor" />)}</svg>;
}

function ReturnRow({ row, onInspect }: { row: OpenDeliveryReturn; onInspect: (row: OpenDeliveryReturn) => void }) {
  const withDriver = row.return_status === 'WITH_DRIVER';
  return (
    <article className={`warehouse-return-row ${withDriver ? 'waiting' : 'received'}`}>
      <div className="warehouse-return-code-block"><strong>{row.return_code}</strong><span>{withDriver ? 'WITH DRIVER' : 'IN RETURNS AREA'}</span></div>
      <div><strong>{row.box_code || 'BOX'} · {row.store_name || 'Unknown store'}</strong><span>{title(row.outcome)} · {num(row.return_cartons)} carton(s) · order {row.order_number || '—'}</span><small>{row.reason || row.driver_note || 'No driver detail'} · {dateText(row.recorded_at)}</small></div>
      <div className="warehouse-return-action">
        {withDriver ? <><strong>Waiting</strong><span>Driver scans fixed zone code</span></> : <button type="button" onClick={() => onInspect(row)}>Inspect return</button>}
      </div>
    </article>
  );
}

function InspectionPanel({ row, onDone }: { row: OpenDeliveryReturn; onDone: () => void }) {
  const [lines, setLines] = useState<ReturnInspectionLine[]>([]);
  const [barcode, setBarcode] = useState('');
  const [qty, setQty] = useState('1');
  const [location, setLocation] = useState('');
  const [manualItem, setManualItem] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function reload() {
    try { setLines(await loadReturnInspectionLines(row.id)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  useEffect(() => { void reload(); }, [row.id]);

  async function record(resolution: 'RESTOCK' | 'SUPPLIER_CLAIM' | 'DISPOSE') {
    if (resolution === 'RESTOCK' && !barcode.trim()) { setError('Scan a mapped product barcode before restocking.'); return; }
    if (!barcode.trim() && !manualItem.trim()) { setError('Scan a barcode or describe the returned item.'); return; }
    setBusy(resolution); setError(''); setNotice('');
    try {
      await recordReturnInspectionItem({ exceptionId: row.id, resolution, barcode: barcode || null, qtyPackages: qty || 1, targetLocation: location || null, manualItem: manualItem || null, note: note || null, inspectedBy: 'Warehouse' });
      setNotice(resolution === 'RESTOCK' ? 'Sellable quantity returned to live stock.' : resolution === 'SUPPLIER_CLAIM' ? 'Item held for supplier claim; no stock added.' : 'Item recorded for disposal; no stock added.');
      setBarcode(''); setManualItem(''); setNote('');
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  }

  async function finish() {
    setBusy('FINISH'); setError(''); setNotice('');
    try {
      await completeReturnInspection({ exceptionId: row.id, note: note || null, inspectedBy: 'Warehouse' });
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  }

  return (
    <section className="warehouse-return-inspection">
      <header><div><span>NEXT-SHIFT INSPECTION</span><h3>{row.return_code} · {row.store_name}</h3><p>Inspect item by item. Only clean sellable goods scanned as Restock enter live inventory.</p></div><button type="button" onClick={onDone}>Close</button></header>
      {error ? <div className="warehouse-return-error"><AlertTriangle size={17} /> {error}</div> : null}
      {notice ? <div className="warehouse-return-notice"><CheckCircle2 size={17} /> {notice}</div> : null}
      <div className="warehouse-return-inspection-inputs">
        <input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Scan product barcode" />
        <input value={qty} onChange={(event) => setQty(event.target.value)} inputMode="decimal" placeholder="Qty / packs" />
        <input value={location} onChange={(event) => setLocation(event.target.value.toUpperCase())} placeholder="Blank = fixed shelf" />
        <input value={manualItem} onChange={(event) => setManualItem(event.target.value)} placeholder="Description if no barcode" />
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condition / claim note" />
      </div>
      <div className="warehouse-return-resolution-buttons">
        <button type="button" disabled={Boolean(busy)} onClick={() => void record('RESTOCK')}>{busy === 'RESTOCK' ? 'Posting…' : 'Restock sellable'}</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void record('SUPPLIER_CLAIM')}>{busy === 'SUPPLIER_CLAIM' ? 'Saving…' : 'Supplier claim hold'}</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void record('DISPOSE')}>{busy === 'DISPOSE' ? 'Saving…' : 'Dispose / damaged'}</button>
      </div>
      <div className="warehouse-return-inspection-lines">
        {lines.map((line) => <article key={line.id}><div><strong>{line.sku || line.manual_item || 'Manual item'}</strong><span>{line.product_name || line.inspection_note || 'No description'}</span></div><b>{title(line.resolution)}</b><small>{num(line.units_processed)} units · {line.target_location || 'no stock location'}</small></article>)}
        {!lines.length ? <div className="warehouse-return-empty">No inspected items recorded yet.</div> : null}
      </div>
      <button type="button" className="warehouse-return-finish" disabled={!lines.length || Boolean(busy)} onClick={() => void finish()}>{busy === 'FINISH' ? 'Closing inspection…' : 'Finish return inspection'}</button>
    </section>
  );
}

export function WarehouseReturnsPanel() {
  const [rows, setRows] = useState<OpenDeliveryReturn[]>([]);
  const [zones, setZones] = useState<ReturnZone[]>([]);
  const [selected, setSelected] = useState<OpenDeliveryReturn | null>(null);
  const [error, setError] = useState('');

  async function reload() {
    try {
      const [nextRows, nextZones] = await Promise.all([loadOpenReturnZoneItems(), loadReturnZones()]);
      setRows(nextRows); setZones(nextZones); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  useEffect(() => { void reload(); }, []);

  const waiting = useMemo(() => rows.filter((row) => row.return_status === 'WITH_DRIVER'), [rows]);
  const inZone = useMemo(() => rows.filter((row) => row.return_status !== 'WITH_DRIVER'), [rows]);
  const zone = zones[0];

  function printZoneSign() {
    document.body.classList.add('print-return-zone-sign');
    window.print();
    window.setTimeout(() => document.body.classList.remove('print-return-zone-sign'), 500);
  }

  return (
    <section className="warehouse-returns-panel">
      <header className="warehouse-returns-head">
        <div><span>RETURNS AREA</span><h2>One fixed area code. Driver scans it; warehouse inspects next shift.</h2><p>The RET number identifies each return. The fixed area barcode proves physical drop-off. They are deliberately different.</p></div>
        <button type="button" onClick={() => void reload()}><RotateCcw size={16} /> Refresh</button>
      </header>
      {error ? <div className="warehouse-return-error"><AlertTriangle size={17} /> {error}</div> : null}

      {zone ? <section className="return-zone-sign">
        <div><span>ECOFLOW PACKAGING</span><h2>{zone.zone_name || 'RETURNS AREA'}</h2><p>Place all returned goods inside this marked area, then scan the barcode below in the Driver app.</p></div>
        <Code39Barcode value={zone.zone_code} />
        <strong>{zone.zone_code}</strong><small>{zone.warehouse_location || 'RETURNS-HOLD'} · fixed warehouse proof code</small>
        <button type="button" onClick={printZoneSign}><Printer size={17} /> Print area sign</button>
      </section> : null}

      <section className="warehouse-return-metrics">
        <div><strong>{waiting.length}</strong><span>still with driver</span></div>
        <div><strong>{inZone.length}</strong><span>waiting inspection</span></div>
      </section>

      {selected ? <InspectionPanel row={selected} onDone={() => { setSelected(null); void reload(); }} /> : null}

      <section className="warehouse-return-list">
        <h3>Open return chain</h3>
        {rows.map((row) => <ReturnRow key={row.id} row={row} onInspect={setSelected} />)}
        {!rows.length ? <div className="warehouse-return-empty">No open returns.</div> : null}
      </section>
    </section>
  );
}
