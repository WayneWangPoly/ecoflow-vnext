import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, FileImage, RefreshCw } from 'lucide-react';
import { observeBody } from '@/lib/domObserver';
import {
  loadOpenPurchaseOrders,
  loadPurchaseOrderLines,
  startPurchaseOrderReceipt,
  uploadReceivingDocument,
  type OpenPurchaseOrder,
  type PurchaseOrderLine,
} from '@/data/repositories/purchaseOrders';

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function WarehousePurchaseOrderReceiving() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [orders, setOrders] = useState<OpenPurchaseOrder[]>([]);
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [docketRef, setDocketRef] = useState('');
  const [note, setNote] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => observeBody(() => {
    const screen = document.querySelector<HTMLElement>('.warehouse-receive-screen');
    const form = screen?.querySelector<HTMLElement>('.warehouse-receive-form');
    if (!screen || !form) { setHost(null); return; }
    let mount = screen.querySelector<HTMLElement>(':scope > .warehouse-po-receiving-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'warehouse-po-receiving-mount';
      form.insertAdjacentElement('beforebegin', mount);
    }
    const heroTitle = screen.querySelector<HTMLElement>('.warehouse-receive-hero h2');
    if (heroTitle && heroTitle.textContent !== 'Receive stock') heroTitle.textContent = 'Receive stock';
    setHost(mount);
  }), []);

  async function loadOrders() {
    setError('');
    try {
      const next = await loadOpenPurchaseOrders();
      setOrders(next);
      if (purchaseOrderId && !next.some((item) => item.id === purchaseOrderId)) {
        setPurchaseOrderId('');
        setLines([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => { if (host) void loadOrders(); }, [host]);

  useEffect(() => {
    if (!purchaseOrderId) { setLines([]); return; }
    void loadPurchaseOrderLines(purchaseOrderId).then(setLines).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [purchaseOrderId]);

  const selected = useMemo(() => orders.find((item) => item.id === purchaseOrderId) ?? null, [orders, purchaseOrderId]);

  function selectFile(file?: File | null) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('Docket file must be under 10 MB.'); return; }
    setDocumentFile(file);
    setError('');
  }

  function refreshReceivingScreen() {
    window.setTimeout(() => {
      const refresh = document.querySelector<HTMLButtonElement>('.warehouse-receive-hero button');
      refresh?.click();
      window.dispatchEvent(new CustomEvent('ecoflow:warehouse-receiving-refresh'));
    }, 120);
  }

  async function startReceipt() {
    if (!purchaseOrderId) { setError('Select a PO.'); return; }
    if (!docketRef.trim()) { setError('Enter the delivery docket number.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await startPurchaseOrderReceipt({ purchaseOrderId, deliveryDocketRef: docketRef, note });
      const first = result[0];
      if (!first?.batch_id) throw new Error('Receiving batch could not be created.');
      if (documentFile) await uploadReceivingDocument(first.batch_id, documentFile);
      setNotice(`${first.batch_no} ready · ${first.po_number} · ${docketRef.trim().toUpperCase()}`);
      setPurchaseOrderId('');
      setDocketRef('');
      setNote('');
      setDocumentFile(null);
      setLines([]);
      await loadOrders();
      refreshReceivingScreen();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;

  return createPortal(
    <section className="warehouse-po-receiving">
      <header>
        <div><span>PO RECEIPT</span><h3>Match inbound delivery</h3></div>
        <button type="button" disabled={busy} onClick={() => void loadOrders()} aria-label="Refresh purchase orders"><RefreshCw size={15} /></button>
      </header>

      <div className="warehouse-po-receiving-grid">
        <label><span>Purchase order</span>
          <select value={purchaseOrderId} disabled={busy} onChange={(event) => setPurchaseOrderId(event.target.value)}>
            <option value="">Select open PO</option>
            {orders.map((order) => <option key={order.id} value={order.id}>{order.po_number} · {order.supplier_name} · {number(order.remaining_units).toLocaleString('en-AU')} remaining</option>)}
          </select>
        </label>
        <label><span>Delivery docket</span><input value={docketRef} disabled={busy} onChange={(event) => setDocketRef(event.target.value.toUpperCase())} placeholder="Docket number" autoCapitalize="characters" /></label>
        <label><span>Receipt note</span><input value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Partial, damage or container ref" /></label>
      </div>

      {selected ? (
        <div className="warehouse-po-summary">
          <div><strong>{selected.po_number}</strong><span>{selected.supplier_name}</span></div>
          <div><strong>{number(selected.received_units).toLocaleString('en-AU')} / {number(selected.ordered_units).toLocaleString('en-AU')}</strong><span>base units</span></div>
          <b data-status={selected.po_status}>{selected.po_status.replace(/_/g, ' ')}</b>
        </div>
      ) : null}

      {lines.length ? <div className="warehouse-po-lines">{lines.slice(0, 6).map((line) => <span key={line.id}><b>{line.sku}</b>{number(line.received_units).toLocaleString('en-AU')} / {number(line.expected_units).toLocaleString('en-AU')}</span>)}</div> : null}

      <div className="warehouse-po-document-row">
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => selectFile(event.target.files?.[0])} />
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" hidden onChange={(event) => selectFile(event.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => cameraInputRef.current?.click()}><Camera size={16} />Take docket photo</button>
        <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}><FileImage size={16} />Choose file</button>
        <span>{documentFile?.name || 'No file attached'}</span>
      </div>

      {error ? <div className="warehouse-po-error">{error}</div> : null}
      {notice ? <div className="warehouse-po-notice">{notice}</div> : null}

      <button className="warehouse-po-start" type="button" disabled={busy || !purchaseOrderId || !docketRef.trim()} onClick={() => void startReceipt()}>{busy ? 'Starting…' : 'Start PO receipt'}</button>
    </section>,
    host,
  );
}
