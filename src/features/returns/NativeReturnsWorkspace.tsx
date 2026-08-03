import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WarehouseCameraScanner } from '@/WarehouseCameraScanner';
import { loadWarehouseLocationItems } from '@/data/repositories/warehouseLocations';
import {
  inspectDeliveryReturnItem,
  loadReturnIdentityInspections,
  loadReturnIdentityQueue,
  receiveDeliveryReturn,
  returnIdentityFriendlyError,
  type ReturnIdentityInspection,
  type ReturnIdentityQueueRow,
} from '@/data/repositories/returnIdentity';
import { NativeWorkspaceEmpty, NativeWorkspaceFrame, NativeWorkspaceLoading, NativeWorkspaceUnavailable } from '@/features/navigation/NativeWorkspaceFrame';
import './nativeReturnsWorkspace.css';

const RETURN_BARCODE_INPUT_ID = 'return-product-barcode-input';
const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value?: string | null) {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function label(value?: string | null) {
  return String(value || 'UNKNOWN').replaceAll('_', ' ');
}

function tone(value?: string | null) {
  const status = String(value || '').toUpperCase();
  if (['RESTOCKED', 'DISPOSED', 'MIXED_DISPOSITION'].includes(status)) return 'complete';
  if (status === 'WITH_DRIVER') return 'transit';
  if (['RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(status)) return 'hold';
  return 'neutral';
}

function ReturnStatus({ value }: { value: string }) {
  return <span className={`native-return-status ${tone(value)}`}>{label(value)}</span>;
}

function ReturnMetric({ label: metricLabel, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="metric-card"><span>{metricLabel}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function InspectionHistory({ inspections }: { inspections: ReturnIdentityInspection[] }) {
  if (!inspections.length) return <NativeWorkspaceEmpty title="No product packages inspected" detail="After warehouse receipt, scan each returned product package and choose its disposition." />;
  return (
    <div className="native-return-inspection-list">
      {inspections.map((inspection) => (
        <article key={inspection.inspection_id}>
          <header><div><strong>{inspection.physical_sku}</strong><span>{inspection.product_name}</span></div><span className={`native-return-disposition ${inspection.disposition.toLowerCase()}`}>{inspection.disposition}</span></header>
          <dl>
            <div><dt>Barcode</dt><dd>{inspection.product_barcode}</dd></div>
            <div><dt>SKU Family</dt><dd>{inspection.family_code}</dd></div>
            <div><dt>Package</dt><dd>{inspection.package_level} × {number(inspection.package_quantity)}</dd></div>
            <div><dt>Condition</dt><dd>{label(inspection.goods_condition)}</dd></div>
            <div><dt>Location</dt><dd>{inspection.warehouse_location}</dd></div>
            <div><dt>Stock movement</dt><dd>{inspection.stock_movement_recorded ? 'Recorded' : 'None'}</dd></div>
          </dl>
          <footer>{dateTime(inspection.inspected_at)} · {inspection.actor_role}{inspection.inspection_note ? ` · ${inspection.inspection_note}` : ''}</footer>
        </article>
      ))}
    </div>
  );
}

export function NativeReturnsWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const selectedId = searchParams.get('return') || '';
  const [rows, setRows] = useState<ReturnIdentityQueueRow[]>([]);
  const [inspections, setInspections] = useState<ReturnIdentityInspection[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [receiptLocation, setReceiptLocation] = useState('RETURNS-HOLD');
  const [receiptNote, setReceiptNote] = useState('Returned goods received into controlled inspection hold.');
  const [productBarcode, setProductBarcode] = useState('');
  const [packageQuantity, setPackageQuantity] = useState('1');
  const [goodsCondition, setGoodsCondition] = useState<'SEALED' | 'SALEABLE' | 'OPENED' | 'DAMAGED' | 'CONTAMINATED' | 'UNKNOWN'>('SEALED');
  const [disposition, setDisposition] = useState<'RESTOCK' | 'DISPOSE'>('RESTOCK');
  const [targetLocation, setTargetLocation] = useState('');
  const [inspectionNote, setInspectionNote] = useState('');
  const barcodeRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => rows.find((row) => row.exception_id === selectedId) ?? rows.find((row) => ['WITH_DRIVER', 'RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(row.return_status)) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  const load = useCallback(async (message?: string) => {
    setLoading(true);
    try {
      const [queue, locationRows] = await Promise.all([
        loadReturnIdentityQueue(search),
        loadWarehouseLocationItems().catch(() => []),
      ]);
      setRows(queue);
      setLocations(Array.from(new Set(locationRows
        .filter((row) => row.location_status === 'ACTIVE')
        .map((row) => row.location_code)
        .filter(Boolean))).sort());
      const activeId = selectedId && queue.some((row) => row.exception_id === selectedId)
        ? selectedId
        : queue.find((row) => ['WITH_DRIVER', 'RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(row.return_status))?.exception_id || queue[0]?.exception_id || '';
      if (activeId) {
        const detail = await loadReturnIdentityInspections(activeId);
        setInspections(detail);
        if (activeId !== selectedId) {
          const next = new URLSearchParams(searchParams);
          next.set('return', activeId);
          setSearchParams(next, { replace: true });
        }
      } else {
        setInspections([]);
      }
      setError('');
      if (message) setOutcome(message);
    } catch (reason) {
      setError(returnIdentityFriendlyError(reason));
    } finally {
      setLoading(false);
    }
  }, [search, searchParams, selectedId, setSearchParams]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    void loadReturnIdentityInspections(selectedId)
      .then(setInspections)
      .catch((reason) => setError(returnIdentityFriendlyError(reason)));
  }, [selectedId]);

  useEffect(() => {
    if (disposition === 'DISPOSE') setTargetLocation('RETURNS-DISPOSAL');
    else if (targetLocation === 'RETURNS-DISPOSAL' || targetLocation === 'RETURNS-HOLD') setTargetLocation(locations[0] || '');
  }, [disposition, locations, targetLocation]);

  function updateSearch(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    next.delete('return');
    setSearchParams(next, { replace: true });
  }

  function selectReturn(row: ReturnIdentityQueueRow) {
    const next = new URLSearchParams(searchParams);
    next.set('return', row.exception_id);
    setSearchParams(next, { replace: true });
    setOutcome('');
    setError('');
  }

  function openCamera() {
    barcodeRef.current?.focus();
    window.dispatchEvent(new CustomEvent(CAMERA_SCAN_EVENT, { detail: { inputId: RETURN_BARCODE_INPUT_ID } }));
  }

  async function receive() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await receiveDeliveryReturn({
        returnCode: selected.return_code,
        warehouseLocation: receiptLocation,
        note: receiptNote,
      });
      await load(`${selected.return_code} received into ${receiptLocation}. Product packages remain outside sellable stock until inspection.`);
    } catch (reason) {
      setError(returnIdentityFriendlyError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function inspect() {
    if (!selected) return;
    const quantity = Number(packageQuantity);
    if (!productBarcode.trim() || !Number.isInteger(quantity) || quantity <= 0) {
      setError('Scan a published product Barcode and enter a whole package quantity.');
      return;
    }
    if (disposition === 'RESTOCK' && !targetLocation) {
      setError('Choose an active sellable location before restocking.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await inspectDeliveryReturnItem({
        returnCode: selected.return_code,
        productBarcode,
        packageQuantity: quantity,
        goodsCondition,
        disposition,
        warehouseLocation: disposition === 'DISPOSE' ? 'RETURNS-DISPOSAL' : targetLocation,
        note: inspectionNote,
      });
      const movement = result.stock_movement_recorded ? ' A stock movement was recorded against the actual Physical SKU.' : ' No stock movement was created.';
      setProductBarcode('');
      setPackageQuantity('1');
      setInspectionNote('');
      await load(`${result.physical_sku} inspected as ${result.disposition}.${movement}`);
      window.setTimeout(() => barcodeRef.current?.focus(), 40);
    } catch (reason) {
      setError(returnIdentityFriendlyError(reason));
    } finally {
      setBusy(false);
    }
  }

  const openCount = rows.filter((row) => ['WITH_DRIVER', 'RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(row.return_status)).length;
  const withDriver = rows.filter((row) => row.return_status === 'WITH_DRIVER').length;
  const inHold = rows.filter((row) => ['RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(row.return_status)).length;
  const recentlyClosed = rows.length - openCount;

  if (loading && !rows.length) return <NativeWorkspaceLoading label="returns and product identity inspections" />;
  if (error && !rows.length) return <NativeWorkspaceUnavailable label="Returns" detail={error} onRetry={() => void load()} />;

  return (
    <NativeWorkspaceFrame
      eyebrow="CONTROLLED REVERSE LOGISTICS"
      title="Returns Inspection"
      detail="Receive the driver Return Code, identify every product package, then restock only published saleable goods."
      actions={<button type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh server state'}</button>}
    >
      <section className="quick-stats">
        <ReturnMetric label="Open returns" value={openCount} detail="Require warehouse action" />
        <ReturnMetric label="With driver" value={withDriver} detail="Return Code not received" />
        <ReturnMetric label="Inspection hold" value={inHold} detail="Outside sellable stock" />
        <ReturnMetric label="Recently closed" value={recentlyClosed} detail="Last 14 days" />
      </section>

      {outcome ? <div className="native-return-command success" role="status"><strong>Command completed</strong><span>{outcome}</span><button type="button" onClick={() => setOutcome('')}>Dismiss</button></div> : null}
      {error ? <div className="native-return-command error" role="alert"><strong>Command blocked</strong><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div> : null}

      <section className="native-return-toolbar"><label><span>Search return queue</span><input value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Return Code, order, store or box" /></label><button type="button" onClick={() => updateSearch('')}>Clear</button></section>

      {!rows.length ? <NativeWorkspaceEmpty title="No return records" detail="There are no open or recently completed returns matching this query." /> : (
        <div className="native-return-layout">
          <aside className="native-return-queue" aria-label="Return queue">
            {rows.map((row) => (
              <button key={row.exception_id} type="button" className={row.exception_id === selected?.exception_id ? 'active' : ''} onClick={() => selectReturn(row)}>
                <header><strong>{row.return_code}</strong><ReturnStatus value={row.return_status} /></header>
                <span>{row.store_name || 'Unknown store'} · {row.order_number || row.order_id}</span>
                <small>{number(row.inspected_packages)}/{number(row.return_cartons)} package(s) inspected · {label(row.outcome)}</small>
              </button>
            ))}
          </aside>

          {selected ? <section className="native-return-workbench">
            <header><div><span>SELECTED RETURN</span><h2>{selected.return_code}</h2><p>{selected.store_name || 'Unknown store'} · Order {selected.order_number || selected.order_id} · Box {selected.box_code || '—'}</p></div><ReturnStatus value={selected.return_status} /></header>
            <div className="native-return-facts"><span><small>Expected return</small><strong>{number(selected.return_cartons)} package(s)</strong></span><span><small>Inspected</small><strong>{number(selected.inspected_packages)}</strong></span><span><small>Restocked</small><strong>{number(selected.restocked_packages)}</strong></span><span><small>Disposed</small><strong>{number(selected.disposed_packages)}</strong></span></div>
            {selected.reason || selected.driver_note ? <div className="native-workspace-notice"><strong>Driver evidence</strong><span>{[selected.reason, selected.driver_note].filter(Boolean).join(' · ')}</span></div> : null}

            {selected.return_status === 'WITH_DRIVER' ? <section className="native-return-step"><header><span>STEP 1</span><h3>Receive Return Code</h3><p>Move the sealed return into controlled RETURNS-HOLD. This does not add stock.</p></header><label><span>Warehouse hold location</span><input value={receiptLocation} onChange={(event) => setReceiptLocation(event.target.value.toUpperCase())} /></label><label><span>Receipt note</span><textarea value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} /></label><button className="primary-button" type="button" disabled={busy} onClick={() => void receive()}>{busy ? 'Receiving…' : 'Receive into inspection hold'}</button></section> : null}

            {['RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(selected.return_status) ? <section className="native-return-step"><header><span>STEP 2</span><h3>Inspect product package</h3><p>The Barcode must already be published in Product Setup. Unpublished or prohibited identity fails closed.</p></header><div className="native-return-form-grid"><label className="native-return-barcode"><span>Product Barcode</span><div><input id={RETURN_BARCODE_INPUT_ID} ref={barcodeRef} value={productBarcode} onChange={(event) => setProductBarcode(event.target.value.trim())} placeholder="Scan carton, sleeve or each" inputMode="numeric" autoComplete="off" /><button type="button" onClick={openCamera}>Use camera</button></div></label><label><span>Package quantity</span><input type="number" min="1" step="1" inputMode="numeric" value={packageQuantity} onChange={(event) => setPackageQuantity(event.target.value)} /></label><label><span>Condition</span><select value={goodsCondition} onChange={(event) => { const next = event.target.value as typeof goodsCondition; setGoodsCondition(next); if (!['SEALED', 'SALEABLE'].includes(next)) setDisposition('DISPOSE'); }}><option value="SEALED">Sealed</option><option value="SALEABLE">Saleable</option><option value="OPENED">Opened</option><option value="DAMAGED">Damaged</option><option value="CONTAMINATED">Contaminated</option><option value="UNKNOWN">Unknown</option></select></label><label><span>Disposition</span><select value={disposition} onChange={(event) => setDisposition(event.target.value as typeof disposition)}><option value="RESTOCK" disabled={!['SEALED', 'SALEABLE'].includes(goodsCondition)}>Restock actual Physical SKU</option><option value="DISPOSE">Dispose / no stock</option></select></label>{disposition === 'RESTOCK' ? <label><span>Sellable location</span><input list="return-location-options" value={targetLocation} onChange={(event) => setTargetLocation(event.target.value.toUpperCase())} placeholder="Choose active location" /><datalist id="return-location-options">{locations.map((location) => <option key={location} value={location} />)}</datalist></label> : <label><span>Disposition location</span><input value="RETURNS-DISPOSAL" disabled /></label>}<label><span>Inspection note</span><textarea value={inspectionNote} onChange={(event) => setInspectionNote(event.target.value)} placeholder="Seal, damage, contamination or reason" /></label></div><div className={`native-return-impact ${disposition.toLowerCase()}`}><div><strong>{disposition === 'RESTOCK' ? 'A verified stock movement will be created' : 'No stock movement will be created'}</strong><span>{disposition === 'RESTOCK' ? 'The movement uses the Barcode’s published Physical SKU, Family and package conversion.' : 'The package remains out of sellable inventory and the disposal decision is audited.'}</span></div><button className="primary-button" type="button" disabled={busy || !productBarcode.trim()} onClick={() => void inspect()}>{busy ? 'Applying safely…' : disposition === 'RESTOCK' ? 'Inspect and restock' : 'Inspect and dispose'}</button></div></section> : null}

            {!['WITH_DRIVER', 'RETURNED_TO_WAREHOUSE', 'INSPECTION_HOLD'].includes(selected.return_status) ? <div className="native-workspace-notice"><strong>Return completed</strong><span>{label(selected.return_status)} · latest inspection {dateTime(selected.latest_inspection_at)}.</span></div> : null}

            <section className="native-return-history"><header><div><span>IDENTITY HISTORY</span><h3>Inspected packages</h3></div><strong>{inspections.length}</strong></header><InspectionHistory inspections={inspections} /></section>
          </section> : null}
        </div>
      )}
      <WarehouseCameraScanner />
    </NativeWorkspaceFrame>
  );
}
