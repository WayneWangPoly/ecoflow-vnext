import { useEffect, useMemo, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, RotateCcw } from 'lucide-react';
import {
  resolveOrderIdForBox,
  saveDropPointProof,
  saveGoodsPlacedProof,
  type PodQualityContext,
} from '@/data/repositories/deliveryPodQuality';
import { dispatchDeliveryNotifications, queueDeliveryNotifications, type DeliveryOutcome } from '@/data/repositories/deliveryOperations';
import { readImageDownscaled } from '@/lib/downscaleImage';

function activeBusinessDay() {
  const candidates: Array<{ businessDay: string; active: boolean }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith('ecoflow-driver-day:')) continue;
    try {
      const state = JSON.parse(window.localStorage.getItem(key) || '{}') as { businessDay?: string; routeStartedAt?: string; routeEndedAt?: string };
      const businessDay = state.businessDay || key.slice('ecoflow-driver-day:'.length);
      candidates.push({ businessDay, active: Boolean(state.routeStartedAt && !state.routeEndedAt) });
    } catch {
      candidates.push({ businessDay: key.slice('ecoflow-driver-day:'.length), active: false });
    }
  }
  return candidates.sort((left, right) => Number(right.active) - Number(left.active) || right.businessDay.localeCompare(left.businessDay))[0]?.businessDay || new Date().toISOString().slice(0, 10);
}

function text(root: ParentNode | null | undefined, selector: string) {
  return root?.querySelector<HTMLElement>(selector)?.textContent?.trim() || '';
}

function readContext(sheet: HTMLElement) {
  const stopMeta = text(sheet, '.sheet-head span');
  const stopMatch = /Stop\s+(\d+)\s+·\s+(.+)/i.exec(stopMeta);
  const orderHeading = Array.from(document.querySelectorAll<HTMLElement>('.driver-sheet .detail-section h3')).find((node) => /^Order\s+/i.test(node.textContent || ''))?.textContent?.trim() || '';
  const orderMatch = /^Order\s+(.+?)(?:\s+·|$)/i.exec(orderHeading);
  const boxCode = text(document, '.driver-sheet .box-chip');
  const actor = text(document, '.driver-topbar-brand span').replace(/^DRIVER\s*·\s*/i, '') || 'Driver';
  return {
    businessDay: activeBusinessDay(),
    stopNumber: stopMatch ? Number(stopMatch[1]) : null,
    storeName: stopMatch?.[2]?.trim() || null,
    orderNumber: orderMatch?.[1]?.trim() || null,
    boxCode: boxCode || null,
    actorLabel: actor,
  };
}

function contextKey(context: ReturnType<typeof readContext> | null) {
  if (!context) return '';
  return [context.businessDay, context.stopNumber, context.storeName, context.orderNumber, context.boxCode, context.actorLabel].join('|');
}

function Pod2Capture({ context, onReadyChange }: { context: PodQualityContext; onReadyChange: (path: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState('');
  const [uploadedPath, setUploadedPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onReadyChange(uploadedPath), [uploadedPath, onReadyChange]);

  const contextLabel = useMemo(() => [context.boxCode, context.storeName].filter(Boolean).join(' · '), [context.boxCode, context.storeName]);

  async function capture(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setUploadedPath('');
    try {
      const dataUrl = await readImageDownscaled(file, 1100, 0.68);
      setPreview(dataUrl);
      const path = await saveGoodsPlacedProof({ context, dataUrl });
      setUploadedPath(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function reset() {
    setPreview('');
    setUploadedPath('');
    setError('');
    window.setTimeout(() => inputRef.current?.click(), 50);
  }

  return (
    <section className="pod-quality-pod2">
      <div className="pod-quality-step-head">
        <div><b>2</b><span><strong>All goods</strong><small>Show all delivered cartons together at the agreed placement point. Labels should be visible where practical.</small></span></div>
        {uploadedPath ? <em><CheckCircle2 size={16} /> Saved</em> : null}
      </div>
      {preview ? (
        <div className="pod-quality-preview">
          <img src={preview} alt="All delivered goods" />
          <button type="button" disabled={busy} onClick={reset}><RotateCcw size={15} /> Retake</button>
        </div>
      ) : (
        <button type="button" className="pod-quality-capture" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Camera size={20} /> {busy ? 'Uploading POD 2…' : 'Take POD 2 · all goods'}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void capture(event.target.files?.[0])} />
      <p className="pod-quality-context">{contextLabel || 'Current delivery stop'} · confirmation remains locked until this photo is uploaded.</p>
      {error ? <div className="pod-quality-error">{error}</div> : null}
    </section>
  );
}

function hideLegacyOptionalFields(sheet: HTMLElement) {
  const signature = sheet.querySelector<HTMLElement>('.signature-block');
  if (signature) signature.hidden = true;

  const receiverLabel = Array.from(sheet.querySelectorAll<HTMLElement>('label.pod-input')).find((label) => /received by/i.test(label.textContent || ''));
  if (receiverLabel) {
    receiverLabel.hidden = true;
    const input = receiverLabel.querySelector<HTMLInputElement>('input');
    if (input?.value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  const requirement = sheet.querySelector<HTMLElement>('.pod-requirement');
  if (requirement) requirement.textContent = 'POD 1 and POD 2 are both required. Signature and receiver name are not required.';
}

export function DriverPodQualityEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const [contextSeed, setContextSeed] = useState<ReturnType<typeof readContext> | null>(null);
  const [resolvedContext, setResolvedContext] = useState<PodQualityContext | null>(null);
  const [pod1DataUrl, setPod1DataUrl] = useState('');
  const [pod1Path, setPod1Path] = useState('');
  const [pod1Busy, setPod1Busy] = useState(false);
  const [pod1Error, setPod1Error] = useState('');
  const [pod2Path, setPod2Path] = useState('');
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState('');
  const bypassRef = useRef(false);

  useEffect(() => {
    function locate() {
      const nextSheet = document.querySelector<HTMLElement>('.driver-overlay[aria-label^="Proof of delivery"] .driver-bottom-sheet');
      if (!nextSheet) {
        setHost(null);
        setSheet(null);
        setContextSeed(null);
        setResolvedContext(null);
        setPod1DataUrl('');
        setPod1Path('');
        setPod1Error('');
        setPod2Path('');
        setQueueError('');
        return;
      }

      hideLegacyOptionalFields(nextSheet);
      const firstField = nextSheet.querySelector<HTMLElement>('.pod-field');
      const firstButton = firstField?.querySelector<HTMLButtonElement>('.pod-capture-button');
      if (firstButton) firstButton.innerHTML = '<span aria-hidden="true">📷</span> Take POD 1 · store / placement point';

      let firstNote = nextSheet.querySelector<HTMLElement>('.pod-quality-pod1-note');
      if (!firstNote && firstField) {
        firstNote = document.createElement('div');
        firstNote.className = 'pod-quality-pod1-note';
        firstNote.innerHTML = '<b>1</b><span><strong>Store / placement point</strong><small>Include store signage, entrance, counter or another recognisable placement point.</small></span>';
        firstField.insertAdjacentElement('beforebegin', firstNote);
      }

      let firstStatus = nextSheet.querySelector<HTMLElement>('.pod-quality-pod1-status');
      if (!firstStatus && firstField) {
        firstStatus = document.createElement('div');
        firstStatus.className = 'pod-quality-context pod-quality-pod1-status';
        firstField.insertAdjacentElement('afterend', firstStatus);
      }

      let mount = nextSheet.querySelector<HTMLElement>('.driver-pod-quality-mount');
      const signature = nextSheet.querySelector<HTMLElement>('.signature-block');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'driver-pod-quality-mount';
        if (signature) signature.insertAdjacentElement('beforebegin', mount);
        else nextSheet.appendChild(mount);
      }

      const nextContext = readContext(nextSheet);
      setContextSeed((current) => contextKey(current) === contextKey(nextContext) ? current : nextContext);
      setSheet(nextSheet);
      setHost(mount);

      const imageSource = firstField?.querySelector<HTMLImageElement>('.pod-photo-preview img')?.src || '';
      setPod1DataUrl((current) => current === imageSource ? current : imageSource);
    }

    return observeBody(locate);
  }, []);

  useEffect(() => {
    if (!contextSeed?.boxCode) {
      setResolvedContext(null);
      return;
    }
    let active = true;
    void resolveOrderIdForBox({ businessDay: contextSeed.businessDay, boxCode: contextSeed.boxCode })
      .then((orderId) => {
        if (!active) return;
        if (!orderId) throw new Error('Locked route order could not be resolved for this box. Refresh route sync and try again.');
        setResolvedContext({ ...contextSeed, orderId });
      })
      .catch((reason) => {
        if (!active) return;
        setResolvedContext(null);
        setQueueError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [contextSeed]);

  useEffect(() => {
    if (!pod1DataUrl) {
      setPod1Path('');
      setPod1Error('');
      return;
    }
    if (!resolvedContext || pod1Path) return;
    let active = true;
    setPod1Busy(true);
    setPod1Error('');
    void saveDropPointProof({ context: resolvedContext, dataUrl: pod1DataUrl })
      .then((path) => { if (active) setPod1Path(path); })
      .catch((reason) => { if (active) setPod1Error(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setPod1Busy(false); });
    return () => { active = false; };
  }, [pod1DataUrl, resolvedContext, pod1Path]);

  useEffect(() => {
    if (!sheet) return;
    const status = sheet.querySelector<HTMLElement>('.pod-quality-pod1-status');
    if (!status) return;
    status.textContent = pod1Busy
      ? 'Uploading POD 1…'
      : pod1Path
        ? 'POD 1 uploaded and saved.'
        : pod1Error
          ? `POD 1 not saved: ${pod1Error}`
          : 'Take POD 1 to continue.';
    status.classList.toggle('pod-quality-error', Boolean(pod1Error));
  }, [sheet, pod1Busy, pod1Path, pod1Error]);

  useEffect(() => {
    if (!sheet || !resolvedContext) return;
    const confirm = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button')).find((button) => /Confirm delivered/i.test(button.textContent || ''));
    if (!confirm) return;
    const ready = Boolean(pod1Path && pod2Path) && !pod1Busy && !queueBusy;
    confirm.disabled = !ready;
    confirm.dataset.podQualityReady = ready ? 'true' : 'false';

    let gate = sheet.querySelector<HTMLElement>('.pod-quality-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'pod-quality-gate';
      confirm.insertAdjacentElement('beforebegin', gate);
    }
    gate.innerHTML = `<strong>${ready ? 'POD COMPLETE' : 'TWO PHOTOS REQUIRED'}</strong><span>POD 1 ${pod1Path ? '✓' : '—'} · POD 2 ${pod2Path ? '✓' : '—'} · no receiver name required</span>${queueError ? `<small>${queueError}</small>` : ''}`;

    const handle = (event: Event) => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!ready || queueBusy) return;

      setQueueBusy(true);
      setQueueError('');
      void (async () => {
        try {
          const phoneHref = document.querySelector<HTMLAnchorElement>('.driver-sheet a.phone-link')?.getAttribute('href') || '';
          const storedKey = `ecoflow-delivery-outcome:${resolvedContext.businessDay}:${resolvedContext.orderId}`;
          let stored: { outcome?: DeliveryOutcome; exceptionId?: string } | null = null;
          try { stored = JSON.parse(window.localStorage.getItem(storedKey) || 'null'); } catch { stored = null; }
          const outcome: DeliveryOutcome = stored?.outcome === 'PARTIAL' || stored?.outcome === 'MISSING_CARTON' ? stored.outcome : 'DELIVERED';
          const eventKey = stored?.exceptionId
            ? `${resolvedContext.businessDay}:${resolvedContext.orderId}:EXCEPTION:${stored.exceptionId}`
            : `${resolvedContext.businessDay}:${resolvedContext.orderId}:DELIVERED`;

          await queueDeliveryNotifications({
            ...resolvedContext,
            outcome,
            eventKey,
            storePhone: phoneHref.replace(/^tel:/i, '').trim() || null,
            pod1Path,
            pod2Path,
            internalDetail: outcome === 'DELIVERED'
              ? 'Full delivery completed with required two-photo POD.'
              : 'Partial delivery completed with required two-photo POD for goods placed on site.',
          });
          void dispatchDeliveryNotifications({ businessDay: resolvedContext.businessDay, orderId: resolvedContext.orderId }).catch(() => undefined);
          if (stored?.exceptionId) window.localStorage.removeItem(storedKey);
          bypassRef.current = true;
          confirm.click();
        } catch (reason) {
          setQueueError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          setQueueBusy(false);
        }
      })();
    };

    confirm.addEventListener('click', handle, true);
    return () => confirm.removeEventListener('click', handle, true);
  }, [sheet, resolvedContext, pod1Path, pod2Path, pod1Busy, queueBusy, queueError]);

  return host && resolvedContext
    ? createPortal(<Pod2Capture key={`${resolvedContext.businessDay}-${resolvedContext.orderId}`} context={resolvedContext} onReadyChange={setPod2Path} />, host)
    : null;
}
