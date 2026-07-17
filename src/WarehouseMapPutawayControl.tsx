import { useEffect, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';

const PUTAWAY_REQUEST_EVENT = 'ecoflow:warehouse-putaway-request';

type PutawayRequestEvent = CustomEvent<{ locationCode?: string }>;

function selectedLocationCode() {
  return document.querySelector<HTMLElement>('.location-detail-block > strong')?.textContent?.trim() || '';
}

export function WarehouseMapPutawayControl() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [locationCode, setLocationCode] = useState('');
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
    return observeBody(locate);
  }, []);

  useEffect(() => {
    function handlePutawayRequest(event: Event) {
      const detail = (event as PutawayRequestEvent).detail;
      const code = detail?.locationCode?.trim() || selectedLocationCode();
      if (!code) return;
      setLocationCode(code);
      window.localStorage.setItem('ecoflow-putaway-target', code);
      setNotice(`${code} selected as the next controlled warehouse location.`);
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
    setNotice(`${locationCode} saved as the next controlled putaway target.`);
  }

  if (!host) return null;
  const stocktakeHref = `/?workspace=warehouse&mode=stocktake&location=${encodeURIComponent(locationCode)}`;
  const receiveHref = `/?workspace=warehouse&mode=receive&location=${encodeURIComponent(locationCode)}`;
  return createPortal(
    <section className="warehouse-putaway-control">
      <div className="warehouse-map-card-head compact-head"><h2>Location actions</h2><span>Read-only map · controlled workflows</span></div>
      <div className="warehouse-putaway-target">
        <span>SELECTED LOCATION</span>
        <strong>{locationCode || 'Choose a rack position'}</strong>
        <p>Warehouse Map never changes stock quantity or SKU assignment directly. Start First stocktake for opening stock, or Daily receiving for a real inbound movement; both post through the controlled stock ledger transaction.</p>
      </div>
      {notice ? <div className="warehouse-putaway-notice" role="status">{notice}</div> : null}
      <div className="warehouse-putaway-actions">
        <button type="button" disabled={!locationCode} onClick={() => void copyLocation()}>Copy location</button>
        <button type="button" disabled={!locationCode} onClick={useForPutaway}>Set putaway target</button>
        <a className={locationCode ? 'primary' : 'disabled'} aria-disabled={!locationCode} href={locationCode ? stocktakeHref : undefined}>Start stocktake here</a>
        <a className={locationCode ? 'primary secondary' : 'disabled'} aria-disabled={!locationCode} href={locationCode ? receiveHref : undefined}>Open daily receiving</a>
      </div>
    </section>,
    host,
  );
}
