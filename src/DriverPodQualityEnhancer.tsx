import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, RotateCcw } from 'lucide-react';
import { resolveOrderIdForBox, saveGoodsPlacedProof, type PodQualityContext } from '@/data/repositories/deliveryPodQuality';
import { dispatchDeliveryNotifications, queueDeliveryNotifications, type DeliveryOutcome } from '@/data/repositories/deliveryOperations';

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const max = 1100;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(String(reader.result));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.68));
      };
      image.onerror = () => reject(new Error('Photo could not be read.'));
      image.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Photo could not be read.'));
    reader.readAsDataURL(file);
  });
}

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
  return candidates.sort((a, b) => Number(b.active) - Number(a.active) || b.businessDay.localeCompare(a.businessDay))[0]?.businessDay || new Date().toISOString().slice(0, 10);
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

function Pod2Capture({ contextSeed, onReadyChange }: { contextSeed: ReturnType<typeof readContext>; onReadyChange: (path: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState('');
  const [uploadedPath, setUploadedPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onReadyChange(uploadedPath), [uploadedPath, onReadyChange]);

  const contextLabel = useMemo(() => [contextSeed.boxCode, contextSeed.storeName].filter(Boolean).join(' · '), [contextSeed.boxCode, contextSeed.storeName]);

  async function capture(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setUploadedPath('');
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPreview(dataUrl);
      const orderId = contextSeed.boxCode ? await resolveOrderIdForBox({ businessDay: contextSeed.businessDay, boxCode: contextSeed.boxCode }) : null;
      if (!orderId) throw new Error('Locked route order could not be resolved for this BOX. Refresh the route sync and try again.');
      const context: PodQualityContext = { ...contextSeed, orderId };
      const path = await saveGoodsPlacedProof({ context, dataUrl });
      setUploadedPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <div><b>2</b><span><strong>All goods placed</strong><small>Show every carton together at the agreed drop point. Labels should be visible where practical.</small></span></div>
        {uploadedPath ? <em><CheckCircle2 size={16} /> Saved</em> : null}
      </div>
      {preview ? (
        <div className="pod-quality-preview">
          <img src={preview} alt="All delivered goods placed" />
          <button type="button" disabled={busy} onClick={reset}><RotateCcw size={15} /> Retake</button>
        </div>
      ) : (
        <button type="button" className="pod-quality-capture" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Camera size={20} /> {busy ? 'Uploading photo…' : 'Take POD 2 photo'}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void capture(event.target.files?.[0])} />
      <p className="pod-quality-context">{contextLabel || 'Current delivery stop'} · photo uploads before delivery can be completed.</p>
      {error ? <div className="pod-quality-error">{error}</div> : null}
    </section>
  );
}

export function DriverPodQualityEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const [pod2Path, setPod2Path] = useState('');
  const [pod1Ready, setPod1Ready] = useState(false);
  const [contextSeed, setContextSeed] = useState<ReturnType<typeof readContext> | null>(null);

  useEffect(() => {
    function locate() {
      const nextSheet = document.querySelector<HTMLElement>('.driver-overlay[aria-label^="Proof of delivery"] .driver-bottom-sheet');
      if (!nextSheet) {
        setHost(null);
        setSheet(null);
        setPod1Ready(false);
        setPod2Path('');
        setContextSeed(null);
        return;
      }

      const firstField = nextSheet.querySelector<HTMLElement>('.pod-field');
      const firstButton = firstField?.querySelector<HTMLButtonElement>('.pod-capture-button');
      if (firstButton) firstButton.innerHTML = '<span aria-hidden="true">📷</span> Take POD 1 · store / drop point';
      let firstNote = nextSheet.querySelector<HTMLElement>('.pod-quality-pod1-note');
      if (!firstNote && firstField) {
        firstNote = document.createElement('div');
        firstNote.className = 'pod-quality-pod1-note';
        firstNote.innerHTML = '<b>1</b><span><strong>Store / drop location</strong><small>Include store signage, entrance or another recognisable delivery point.</small></span>';
        firstField.insertAdjacentElement('beforebegin', firstNote);
      }

      let mount = nextSheet.querySelector<HTMLElement>('.driver-pod-quality-mount');
      const signature = nextSheet.querySelector<HTMLElement>('.signature-block');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'driver-pod-quality-mount';
        if (signature) signature.insertAdjacentElement('beforebegin', mount);
        else nextSheet.appendChild(mount);
      }

      setSheet(nextSheet);
      setHost(mount);
      setContextSeed(readContext(nextSheet));
      setPod1Ready(Boolean(firstField?.querySelector('.pod-photo-preview img')));
    }

    locate();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; locate(); }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sheet || !contextSeed) return;
    const confirm = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button')).find((button) => /Confirm delivered/i.test(button.textContent || ''));
    if (!confirm) return;
    const ready = pod1Ready && Boolean(pod2Path);
    confirm.disabled = !ready;
    confirm.dataset.podQualityReady = ready ? 'true' : 'false';

    let gate = sheet.querySelector<HTMLElement>('.pod-quality-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'pod-quality-gate';
      confirm.insertAdjacentElement('beforebegin', gate);
    }
    gate.innerHTML = `<strong>${ready ? 'POD COMPLETE' : 'TWO PHOTOS REQUIRED'}</strong><span>POD 1 ${pod1Ready ? '✓' : '—'} · POD 2 ${pod2Path ? '✓' : '—'} · confirmation message queues automatically</span>`;

    const handle = (event: Event) => {
      if (confirm.dataset.podQualityReady !== 'true') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (confirm.dataset.notificationQueued === 'true') return;
      confirm.dataset.notificationQueued = 'true';
      void (async () => {
        try {
          const orderId = contextSeed.boxCode ? await resolveOrderIdForBox({ businessDay: contextSeed.businessDay, boxCode: contextSeed.boxCode }) : null;
          if (!orderId) throw new Error('Could not resolve order for delivery notification.');
          const phoneHref = document.querySelector<HTMLAnchorElement>('.driver-sheet a.phone-link')?.getAttribute('href') || '';
          const storedKey = `ecoflow-delivery-outcome:${contextSeed.businessDay}:${orderId}`;
          let stored: { outcome?: DeliveryOutcome; exceptionId?: string } | null = null;
          try { stored = JSON.parse(window.localStorage.getItem(storedKey) || 'null'); } catch { stored = null; }
          const outcome: DeliveryOutcome = stored?.outcome === 'PARTIAL' || stored?.outcome === 'MISSING_CARTON' ? stored.outcome : 'DELIVERED';
          const eventKey = stored?.exceptionId ? `${contextSeed.businessDay}:${orderId}:EXCEPTION:${stored.exceptionId}` : `${contextSeed.businessDay}:${orderId}:DELIVERED`;
          await queueDeliveryNotifications({
            ...contextSeed,
            orderId,
            outcome,
            eventKey,
            storePhone: phoneHref.replace(/^tel:/i, '').trim() || null,
            pod2Path,
            internalDetail: outcome === 'DELIVERED' ? 'Full delivery completed with two-photo POD.' : 'Partial delivery completed for the cartons placed on site.',
          });
          void dispatchDeliveryNotifications({ businessDay: contextSeed.businessDay, orderId }).catch(() => undefined);
          if (stored?.exceptionId) window.localStorage.removeItem(storedKey);
        } catch (err) {
          confirm.dataset.notificationQueued = 'false';
          console.error('Delivery notification queue failed', err);
        }
      })();
    };
    confirm.addEventListener('click', handle, true);
    return () => confirm.removeEventListener('click', handle, true);
  }, [sheet, contextSeed, pod1Ready, pod2Path]);

  return host && sheet && contextSeed
    ? createPortal(<Pod2Capture key={`${contextSeed.businessDay}-${contextSeed.boxCode}-${contextSeed.stopNumber}`} contextSeed={contextSeed} onReadyChange={setPod2Path} />, host)
    : null;
}
