import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, PackageX, RotateCcw, X } from 'lucide-react';
import { resolveOrderIdForBox } from '@/data/repositories/deliveryPodQuality';
import { dispatchDeliveryNotifications, recordDeliveryException, type DeliveryOutcome } from '@/data/repositories/deliveryOperations';

type ExceptionOutcome = Exclude<DeliveryOutcome, 'DELIVERED' | 'FAILED'>;

type StopContext = {
  businessDay: string;
  orderId: string | null;
  orderNumber: string | null;
  stopNumber: number | null;
  boxCode: string | null;
  storeName: string | null;
  storePhone: string | null;
  expectedCartons: number;
  actorLabel: string;
};

function activeBusinessDay() {
  const candidates: Array<{ day: string; active: boolean }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith('ecoflow-driver-day:')) continue;
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || '{}') as { businessDay?: string; routeStartedAt?: string; routeEndedAt?: string };
      candidates.push({ day: value.businessDay || key.slice('ecoflow-driver-day:'.length), active: Boolean(value.routeStartedAt && !value.routeEndedAt) });
    } catch {
      candidates.push({ day: key.slice('ecoflow-driver-day:'.length), active: false });
    }
  }
  return candidates.sort((a, b) => Number(b.active) - Number(a.active) || b.day.localeCompare(a.day))[0]?.day || new Date().toISOString().slice(0, 10);
}

function text(root: ParentNode | null | undefined, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() || '';
}

function readStopContext(sheet: HTMLElement): StopContext {
  const stopHeading = text(sheet, '.sheet-title strong');
  const stopMatch = /Stop\s+(\d+)/i.exec(stopHeading);
  const orderHeading = Array.from(sheet.querySelectorAll<HTMLElement>('.detail-section h3')).find((node) => /^Order\s+/i.test(node.textContent || ''))?.textContent?.trim() || '';
  const orderMatch = /^Order\s+(.+?)(?:\s+·|$)/i.exec(orderHeading);
  const cartonChip = Array.from(sheet.querySelectorAll<HTMLElement>('.detail-chip')).find((node) => /carton/i.test(node.textContent || ''))?.textContent || '';
  const cartonMatch = /(\d+(?:\.\d+)?)\s+carton/i.exec(cartonChip);
  const phoneHref = sheet.querySelector<HTMLAnchorElement>('a.phone-link')?.getAttribute('href') || '';
  return {
    businessDay: activeBusinessDay(),
    orderId: null,
    orderNumber: orderMatch?.[1]?.trim() || null,
    stopNumber: stopMatch ? Number(stopMatch[1]) : null,
    boxCode: text(sheet, '.box-chip') || null,
    storeName: text(sheet, '.detail-store-head h2') || null,
    storePhone: phoneHref.replace(/^tel:/i, '').trim() || null,
    expectedCartons: cartonMatch ? Number(cartonMatch[1]) : 0,
    actorLabel: text(document, '.driver-topbar-brand span').replace(/^DRIVER\s*·\s*/i, '') || 'Driver',
  };
}

function outcomeLabel(value: ExceptionOutcome) {
  if (value === 'PARTIAL') return 'Partial delivery';
  if (value === 'MISSING_CARTON') return 'Missing carton';
  if (value === 'REFUSED') return 'Customer refused';
  if (value === 'DAMAGED') return 'Damaged goods';
  return 'Wrong goods';
}

function ExceptionDialog({ context, onClose, sheet }: { context: StopContext; onClose: () => void; sheet: HTMLElement }) {
  const [outcome, setOutcome] = useState<ExceptionOutcome>('PARTIAL');
  const [delivered, setDelivered] = useState(String(Math.max(0, context.expectedCartons - 1)));
  const [returning, setReturning] = useState('0');
  const [reason, setReason] = useState('Not all cartons available');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ exceptionId: string; returnCode: string | null; outcome: ExceptionOutcome } | null>(null);

  function selectOutcome(next: ExceptionOutcome) {
    setOutcome(next);
    if (next === 'PARTIAL') {
      setDelivered(String(Math.max(0, context.expectedCartons - 1)));
      setReturning('0');
      setReason('Not all cartons available');
    } else if (next === 'MISSING_CARTON') {
      setDelivered(String(Math.max(0, context.expectedCartons - 1)));
      setReturning('0');
      setReason('Carton missing from vehicle');
    } else if (next === 'REFUSED') {
      setDelivered('0');
      setReturning(String(context.expectedCartons || 1));
      setReason('Customer refused delivery');
    } else if (next === 'DAMAGED') {
      setDelivered(String(Math.max(0, context.expectedCartons - 1)));
      setReturning('1');
      setReason('Damaged in transit');
    } else {
      setDelivered(String(Math.max(0, context.expectedCartons - 1)));
      setReturning('1');
      setReason('Wrong product or order');
    }
  }

  async function save() {
    if (!context.boxCode) { setError('BOX code is missing. Refresh the locked route.'); return; }
    if (!reason.trim()) { setError('Choose or enter a clear reason.'); return; }
    setBusy(true);
    setError('');
    try {
      const orderId = context.orderId || await resolveOrderIdForBox({ businessDay: context.businessDay, boxCode: context.boxCode });
      if (!orderId) throw new Error('Could not resolve the locked route order for this BOX.');
      const rows = await recordDeliveryException({
        ...context,
        orderId,
        outcome,
        expectedCartons: context.expectedCartons,
        deliveredCartons: delivered || 0,
        returnCartons: returning || 0,
        reason,
        driverNote: note,
      });
      const first = rows[0];
      if (!first?.exception_id) throw new Error('Exception record was not created.');
      const stored = { outcome, exceptionId: first.exception_id, returnCode: first.return_code, recordedAt: first.recorded_at };
      window.localStorage.setItem(`ecoflow-delivery-outcome:${context.businessDay}:${orderId}`, JSON.stringify(stored));
      setResult({ exceptionId: first.exception_id, returnCode: first.return_code, outcome });
      void dispatchDeliveryNotifications({ businessDay: context.businessDay, orderId }).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function continueFlow() {
    onClose();
    window.setTimeout(() => {
      const buttons = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button'));
      if (result?.outcome === 'PARTIAL' || result?.outcome === 'MISSING_CARTON') {
        buttons.find((button) => /Capture POD/i.test(button.textContent || ''))?.click();
      } else {
        buttons.find((button) => /Failed delivery/i.test(button.textContent || ''))?.click();
      }
    }, 80);
  }

  const requiresReturn = Number(returning) > 0 || ['REFUSED', 'DAMAGED', 'WRONG_GOODS'].includes(outcome);
  const balance = useMemo(() => Math.max(0, context.expectedCartons - Number(delivered || 0) - Number(returning || 0)), [context.expectedCartons, delivered, returning]);

  return createPortal(
    <div className="delivery-exception-overlay" role="dialog" aria-label="Partial delivery or return">
      <section className="delivery-exception-sheet">
        <header><div><span>DELIVERY EXCEPTION</span><h2>{context.boxCode} · {context.storeName}</h2><p>{context.expectedCartons} expected cartons · order {context.orderNumber || '—'}</p></div><button type="button" onClick={onClose}><X size={20} /></button></header>
        {!result ? (
          <>
            <div className="delivery-outcome-grid">
              {(['PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS'] as ExceptionOutcome[]).map((value) => <button key={value} type="button" className={outcome === value ? 'active' : ''} onClick={() => selectOutcome(value)}>{outcomeLabel(value)}</button>)}
            </div>
            <div className="delivery-carton-grid">
              <label><span>Expected</span><input value={context.expectedCartons} readOnly /></label>
              <label><span>Delivered</span><input inputMode="decimal" value={delivered} onChange={(event) => setDelivered(event.target.value)} /></label>
              <label><span>Returning</span><input inputMode="decimal" value={returning} onChange={(event) => setReturning(event.target.value)} /></label>
            </div>
            {balance > 0 ? <div className="delivery-exception-warning"><AlertTriangle size={17} /> {balance} carton(s) are not accounted for. Correct the counts before saving.</div> : null}
            <label className="delivery-exception-input"><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <label className="delivery-exception-input"><span>Driver note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What happened, who was spoken to, condition of goods…" /></label>
            {requiresReturn ? <div className="delivery-return-rule"><PackageX size={18} /><div><strong>Return to warehouse hold</strong><span>The system will create one return code. Warehouse scans it into RETURNS-HOLD; stock is not automatically sellable.</span></div></div> : null}
            {error ? <div className="delivery-exception-error">{error}</div> : null}
            <button type="button" className="delivery-exception-primary" disabled={busy || balance > 0} onClick={() => void save()}>{busy ? 'Saving exception…' : 'Record outcome and notify'}</button>
          </>
        ) : (
          <section className="delivery-exception-result">
            <CheckCircle2 size={34} />
            <h3>{outcomeLabel(result.outcome)} recorded</h3>
            {result.returnCode ? <div className="delivery-return-code"><span>RETURN CODE</span><strong>{result.returnCode}</strong><small>Keep this code with the returned cartons. Warehouse scans or enters it at Returns.</small></div> : <p>No goods are returning to warehouse.</p>}
            <button type="button" className="delivery-exception-primary" onClick={continueFlow}>{result.outcome === 'PARTIAL' || result.outcome === 'MISSING_CARTON' ? 'Continue to POD for delivered goods' : 'Continue to failed-stop record'}</button>
            <button type="button" className="delivery-exception-secondary" onClick={onClose}><RotateCcw size={16} /> Close for now</button>
          </section>
        )}
      </section>
    </div>,
    document.body,
  );
}

export function DriverDeliveryExceptionEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<StopContext | null>(null);

  useEffect(() => {
    function locate() {
      const nextSheet = document.querySelector<HTMLElement>('.driver-sheet');
      const footer = nextSheet?.querySelector<HTMLElement>('.sheet-actions');
      if (!nextSheet || !footer) { setHost(null); setSheet(null); setOpen(false); return; }
      let mount = footer.querySelector<HTMLElement>('.delivery-exception-action-mount');
      if (!mount) {
        mount = document.createElement('div');
        mount.className = 'delivery-exception-action-mount';
        footer.insertAdjacentElement('afterbegin', mount);
      }
      setSheet(nextSheet);
      setHost(mount);
      setContext(readStopContext(nextSheet));
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

  return (
    <>
      {host ? createPortal(<button type="button" className="delivery-exception-open" onClick={() => setOpen(true)}><AlertTriangle size={18} /> Partial, missing or return</button>, host) : null}
      {open && context && sheet ? <ExceptionDialog context={context} sheet={sheet} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
