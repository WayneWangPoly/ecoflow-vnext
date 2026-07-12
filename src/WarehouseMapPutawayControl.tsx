import { useEffect, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';

const PUTAWAY_REQUEST_EVENT = 'ecoflow:warehouse-putaway-request';

type PutawayRequestEvent = CustomEvent<{ locationCode?: string; slotCount?: number; action?: string }>;

function selectedLocationCode() {
  return document.querySelector<HTMLElement>('.location-detail-block > strong')?.textContent?.trim() || '';
}

export function WarehouseMapPutawayControl() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [locationCode, setLocationCode] = useState('');
  const [slotCount, setSlotCount] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    function locate() {
      const bottom = document.querySelector<HTMLElement>('.warehouse-bottom-grid');
      const cards = bottom ? Array.from(bottom.querySelectorAll<HTMLElement>(':scope > .warehouse-map-card')) : [];
      const locationCard = cards.find((card) => card.querySelector('h2')?.textContent?.trim() === 'Location');
      if (!locationCard) { setHost(null); return; }
      let mount = bottom?.querySelector<HTMLElement>('.warehouse-putaway-control-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'warehouse-map-card warehouse-putaway-control-mount';
        locationCard.insertAdjacentElement('afterend', mount);
      }
      setHost(mount);
      setLocationCode(selectedLocationCode());
    }
    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  useEffect(() => {
    function handlePutawayRequest(event: Event) {
      const detail = (event as PutawayRequestEvent).detail;
      const code = detail?.locationCode?.trim() || selectedLocationCode();
      if (!code) return;
      setLocationCode(code);
      setSlotCount(detail?.slotCount ?? null);
      window.localStorage.setItem('ecoflow-putaway-target', code);
      setNotice(detail?.action === 'ADD_SKU_SLOT'
        ? `${code}: another SKU position has been added${detail.slotCount ? ` (slot ${detail.slotCount})` : ''}. Scan the next SKU into this same location.`
        : `${code} selected as the next controlled putaway location.`);
    }
    window.addEventListener(PUTAWAY_REQUEST_EVENT, handlePutawayRequest);
    return () => window.removeEventListener(PUTAWAY_REQUEST_EVENT, handlePutawayRequest);
  }, []);

  async function copyLocation() {
    if (!locationCode) return;
    await navigator.clipboard?.writeText(locationCode);
    setNotice(`${locationCode} copied.`);
    window.setTimeout(() => setNotice(''), 1200);
  }

  function useForPutaway() {
    if (!locationCode) return;
    window.localStorage.setItem('ecoflow-putaway-target', locationCode);
    setNotice(`${locationCode} saved as the next putaway target.`);
  }

  if (!host) return null;
  const receiveHref = `/?role=warehouse&tab=receive&location=${encodeURIComponent(locationCode)}`;
  const barcodeHref = `/?role=warehouse&tab=receive&mode=barcode&location=${encodeURIComponent(locationCode)}`;
  return createPortal(
    <section className="warehouse-putaway-control">
      <div className="warehouse-map-card-head compact-head"><h2>Location SKU control</h2><span>First stocktake and putaway</span></div>
      <div className="warehouse-putaway-target">
        <span>SELECTED LOCATION</span>
        <strong>{locationCode || 'Choose a rack position'}</strong>
        <p>The + button adds another SKU position inside this physical cell. It does not add stock quantity. Use Barcode setup for the first warehouse scan, then Receive for real incoming stock so barcode checks and the stock ledger remain controlled.</p>
        {slotCount ? <small>{slotCount} SKU positions are now configured for this cell.</small> : null}
      </div>
      {notice ? <div className="warehouse-putaway-notice" role="status">{notice}</div> : null}
      <div className="warehouse-putaway-actions">
        <button type="button" disabled={!locationCode} onClick={() => void copyLocation()}>Copy location</button>
        <button type="button" disabled={!locationCode} onClick={useForPutaway}>Set putaway target</button>
        <a className={locationCode ? 'primary' : 'disabled'} aria-disabled={!locationCode} href={locationCode ? barcodeHref : undefined}>Open Barcode setup</a>
        <a className={locationCode ? 'primary secondary' : 'disabled'} aria-disabled={!locationCode} href={locationCode ? receiveHref : undefined}>Open Receive</a>
      </div>
    </section>,
    host,
  );
}
