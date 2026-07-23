import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileCheck2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { observeBody } from '@/lib/domObserver';
import {
  createPurchaseOrder,
  createReceivingDocumentSignedUrl,
  loadPurchaseOrderLines,
  loadPurchaseOrderReceipts,
  loadPurchaseOrders,
  reviewPurchaseOrder,
  type PurchaseOrderDraftLine,
  type PurchaseOrderLine,
  type PurchaseOrderReceipt,
  type PurchaseOrderSummary,
} from '@/data/repositories/purchaseOrders';

type Queue = 'OPEN' | 'REVIEW' | 'CLOSED';

type DraftLine = PurchaseOrderDraftLine & { key: string; unitCostText: string };

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide' });
const blankLine = (): DraftLine => ({ key: crypto.randomUUID(), sku: '', productName: '', packageLevel: 'CARTON', orderedPackages: 1, unitsPerPackage: 1, unitCost: null, unitCostText: '', note: '' });

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusQueue(status: string): Queue {
  if (status === 'AWAITING_REVIEW' || status === 'VARIANCE') return 'REVIEW';
  if (status === 'MATCHED' || status === 'CLOSED' || status === 'CANCELLED') return 'CLOSED';
  return 'OPEN';
}

export function PurchaseOrderReconciliation() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'QUEUE' | 'CREATE'>('QUEUE');
  const [queue, setQueue] = useState<Queue>('OPEN');
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [receipts, setReceipts] = useState<PurchaseOrderReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [supplier, setSupplier] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [expectedDate, setExpectedDate] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [note, setNote] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([blankLine()]);

  useEffect(() => observeBody(() => {
    const nav = document.querySelector<HTMLElement>('.sidebar-nav');
    if (!nav) { setHost(null); return; }
    let mount = nav.querySelector<HTMLElement>(':scope > .po-reconciliation-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'po-reconciliation-mount';
    }
    const receivingMount = nav.querySelector<HTMLElement>(':scope > .desktop-receiving-history-mount');
    const accountButton = Array.from(nav.querySelectorAll<HTMLButtonElement>(':scope > button')).find((button) => /ACCOUNT|AUDIT/i.test(button.textContent || ''));
    if (receivingMount) receivingMount.insertAdjacentElement('afterend', mount);
    else if (accountButton) accountButton.insertAdjacentElement('afterend', mount);
    else nav.appendChild(mount);
    setHost(mount);
  }), []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const next = await loadPurchaseOrders();
      setOrders(next);
      if (selectedId && !next.some((item) => item.id === selectedId)) setSelectedId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) void load(); }, [open]);

  async function selectOrder(id: string) {
    setSelectedId(id);
    setError('');
    if (!id) { setLines([]); setReceipts([]); return; }
    try {
      const [nextLines, nextReceipts] = await Promise.all([loadPurchaseOrderLines(id), loadPurchaseOrderReceipts(id)]);
      setLines(nextLines);
      setReceipts(nextReceipts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const selected = orders.find((item) => item.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => statusQueue(order.po_status) === queue && (!term || `${order.po_number} ${order.supplier_name}`.toLowerCase().includes(term)));
  }, [orders, queue, search]);
  const queueCounts = useMemo(() => ({
    OPEN: orders.filter((item) => statusQueue(item.po_status) === 'OPEN').length,
    REVIEW: orders.filter((item) => statusQueue(item.po_status) === 'REVIEW').length,
    CLOSED: orders.filter((item) => statusQueue(item.po_status) === 'CLOSED').length,
  }), [orders]);

  function updateDraftLine(key: string, patch: Partial<DraftLine>) {
    setDraftLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function resetDraft() {
    setPoNumber('');
    setSupplier('');
    setOrderDate(today());
    setExpectedDate('');
    setCurrency('AUD');
    setNote('');
    setDraftLines([blankLine()]);
  }

  async function savePurchaseOrder() {
    const cleanLines = draftLines.filter((line) => line.sku.trim()).map((line) => ({
      sku: line.sku.trim().toUpperCase(),
      productName: line.productName?.trim() || '',
      packageLevel: line.packageLevel,
      orderedPackages: Number(line.orderedPackages),
      unitsPerPackage: Number(line.unitsPerPackage),
      unitCost: line.unitCostText.trim() ? Number(line.unitCostText) : null,
      note: line.note?.trim() || '',
    }));
    if (!poNumber.trim() || !supplier.trim()) { setError('PO number and supplier are required.'); return; }
    if (!cleanLines.length || cleanLines.some((line) => !Number.isInteger(line.orderedPackages) || line.orderedPackages <= 0 || !Number.isInteger(line.unitsPerPackage) || line.unitsPerPackage <= 0)) {
      setError('Add at least one valid PO line.'); return;
    }
    setBusy('create');
    setError('');
    try {
      const result = await createPurchaseOrder({
        poNumber,
        supplierName: supplier,
        orderDate,
        expectedDate: expectedDate || null,
        currency,
        note,
        lines: cleanLines,
      });
      resetDraft();
      setMode('QUEUE');
      setQueue('OPEN');
      await load();
      if (result[0]?.purchase_order_id) await selectOrder(result[0].purchase_order_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  async function act(action: 'MATCH' | 'ACCEPT_VARIANCE' | 'REOPEN' | 'CLOSE' | 'CANCEL') {
    if (!selected) return;
    let actionNote = '';
    if (action === 'ACCEPT_VARIANCE' || action === 'CANCEL') {
      actionNote = window.prompt(action === 'CANCEL' ? 'Cancellation note' : 'Variance note')?.trim() || '';
      if (!actionNote) return;
    }
    setBusy(action);
    setError('');
    try {
      await reviewPurchaseOrder({ purchaseOrderId: selected.id, action, note: actionNote });
      await load();
      await selectOrder(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  async function openDocument(path: string) {
    setBusy(path);
    setError('');
    try {
      const url = await createReceivingDocumentSignedUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  const navButton = host ? createPortal(
    <button type="button" className="po-reconciliation-button" onClick={() => setOpen(true)}><FileCheck2 size={14} />PO matching{queueCounts.REVIEW ? <b>{queueCounts.REVIEW}</b> : null}</button>,
    host,
  ) : null;

  const modal = open ? createPortal(
    <div className="po-reconciliation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="po-reconciliation-dialog" role="dialog" aria-modal="true" aria-label="Purchase order matching">
        <header>
          <div><span>PURCHASING</span><h2>{mode === 'CREATE' ? 'New purchase order' : 'PO matching'}</h2></div>
          <div>
            {mode === 'QUEUE' ? <button type="button" onClick={() => setMode('CREATE')}><Plus size={15} />New PO</button> : <button type="button" onClick={() => setMode('QUEUE')}>Back</button>}
            <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
          </div>
        </header>

        {error ? <div className="po-reconciliation-error">{error}</div> : null}

        {mode === 'CREATE' ? (
          <div className="po-create-body">
            <div className="po-create-head-grid">
              <label><span>PO number</span><input value={poNumber} onChange={(event) => setPoNumber(event.target.value.toUpperCase())} /></label>
              <label><span>Supplier</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></label>
              <label><span>Order date</span><input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></label>
              <label><span>Expected</span><input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></label>
              <label><span>Currency</span><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
              <label><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
            </div>
            <div className="po-create-lines">
              <div className="head"><span>SKU</span><span>Product</span><span>Pack</span><span>Qty</span><span>Units / pack</span><span>Unit cost</span><span></span></div>
              {draftLines.map((line) => (
                <div className="row" key={line.key}>
                  <input value={line.sku} onChange={(event) => updateDraftLine(line.key, { sku: event.target.value.toUpperCase() })} placeholder="SKU" />
                  <input value={line.productName || ''} onChange={(event) => updateDraftLine(line.key, { productName: event.target.value })} placeholder="Product" />
                  <select value={line.packageLevel} onChange={(event) => updateDraftLine(line.key, { packageLevel: event.target.value as DraftLine['packageLevel'] })}><option>CARTON</option><option>SLEEVE</option><option>INNER</option><option>EACH</option></select>
                  <input type="number" min="1" step="1" value={line.orderedPackages} onChange={(event) => updateDraftLine(line.key, { orderedPackages: Number(event.target.value) })} />
                  <input type="number" min="1" step="1" value={line.unitsPerPackage} onChange={(event) => updateDraftLine(line.key, { unitsPerPackage: Number(event.target.value) })} />
                  <input inputMode="decimal" value={line.unitCostText} onChange={(event) => updateDraftLine(line.key, { unitCostText: event.target.value })} placeholder="0.00" />
                  <button type="button" disabled={draftLines.length === 1} onClick={() => setDraftLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <div className="po-create-actions"><button type="button" onClick={() => setDraftLines((current) => [...current, blankLine()])}><Plus size={15} />Add line</button><button className="primary" type="button" disabled={busy === 'create'} onClick={() => void savePurchaseOrder()}>{busy === 'create' ? 'Creating…' : 'Create PO'}</button></div>
          </div>
        ) : (
          <>
            <nav className="po-queue-tabs">{(['OPEN','REVIEW','CLOSED'] as Queue[]).map((item) => <button key={item} type="button" className={queue === item ? 'active' : ''} onClick={() => { setQueue(item); setSelectedId(''); setLines([]); setReceipts([]); }}>{item === 'REVIEW' ? 'To review' : item.charAt(0) + item.slice(1).toLowerCase()} <b>{queueCounts[item]}</b></button>)}</nav>
            <div className="po-search-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search PO or supplier" /></div>
            <div className="po-reconciliation-body">
              <div className="po-order-list">
                {filtered.map((order) => <button type="button" key={order.id} className={selectedId === order.id ? 'active' : ''} onClick={() => void selectOrder(order.id)}><span><strong>{order.po_number}</strong><small>{order.supplier_name}</small></span><span><b data-status={order.po_status}>{order.po_status.replace(/_/g, ' ')}</b><small>{num(order.received_units).toLocaleString('en-AU')} / {num(order.ordered_units).toLocaleString('en-AU')}</small></span></button>)}
                {!filtered.length && !loading ? <div className="po-empty">No purchase orders.</div> : null}
              </div>
              <div className="po-order-detail">
                {selected ? (
                  <>
                    <div className="po-detail-head"><div><span>{selected.supplier_name}</span><h3>{selected.po_number}</h3><small>Ordered {dateText(selected.order_date)} · Expected {dateText(selected.expected_date)}</small></div><b data-status={selected.po_status}>{selected.po_status.replace(/_/g, ' ')}</b></div>
                    <div className="po-detail-kpis"><div><strong>{num(selected.ordered_units).toLocaleString('en-AU')}</strong><span>ordered</span></div><div><strong>{num(selected.received_units).toLocaleString('en-AU')}</strong><span>received</span></div><div><strong>{num(selected.variance_units).toLocaleString('en-AU')}</strong><span>variance</span></div></div>
                    <div className="po-line-table"><div className="head"><span>SKU</span><span>Ordered</span><span>Received</span><span>Variance</span></div>{lines.map((line) => <div className="row" key={line.id}><span><strong>{line.sku}</strong><small>{line.product_name || line.package_level}</small></span><span>{num(line.expected_units).toLocaleString('en-AU')}</span><span>{num(line.received_units).toLocaleString('en-AU')}</span><span data-variance={num(line.variance_units) !== 0}>{num(line.variance_units).toLocaleString('en-AU')}</span></div>)}</div>
                    <div className="po-receipts"><h4>Receipts</h4>{receipts.map((receipt) => <div key={receipt.batch_id}><span><strong>{receipt.delivery_docket_ref || receipt.batch_no}</strong><small>{receipt.batch_no} · {dateText(receipt.physically_received_at || receipt.created_at)}</small></span><span>{num(receipt.posted_units).toLocaleString('en-AU')} units</span>{receipt.delivery_document_path ? <button type="button" disabled={busy === receipt.delivery_document_path} onClick={() => void openDocument(receipt.delivery_document_path!)}>Docket</button> : <em>No file</em>}</div>)}{!receipts.length ? <div className="po-empty">No receipts.</div> : null}</div>
                    <div className="po-review-actions">
                      {selected.po_status === 'AWAITING_REVIEW' ? <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => void act('MATCH')}>Match PO</button> : null}
                      {selected.po_status === 'VARIANCE' ? <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => void act('ACCEPT_VARIANCE')}>Accept variance</button> : null}
                      {selected.po_status === 'MATCHED' ? <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => void act('CLOSE')}>Close PO</button> : null}
                      {selected.po_status === 'CLOSED' || selected.po_status === 'CANCELLED' || selected.po_status === 'MATCHED' ? <button type="button" disabled={Boolean(busy)} onClick={() => void act('REOPEN')}>Reopen</button> : null}
                      {selected.po_status !== 'CLOSED' && selected.po_status !== 'CANCELLED' ? <button className="danger" type="button" disabled={Boolean(busy)} onClick={() => void act('CANCEL')}>Cancel</button> : null}
                    </div>
                  </>
                ) : <div className="po-empty">Select a purchase order.</div>}
              </div>
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{navButton}{modal}</>;
}
