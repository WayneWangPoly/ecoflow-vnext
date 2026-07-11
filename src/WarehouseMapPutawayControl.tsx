import { useEffect, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';

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
      const legacyReceive = cards.find((card) => card.querySelector('h2')?.textContent?.trim() === 'Receive + putaway');
      if (legacyReceive) legacyReceive.hidden = true;
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
  return createPortal(
    <section className="warehouse-putaway-control">
      <div className="warehouse-map-card-head compact-head"><h2>Putaway control</h2><span>Map is read-only for stock</span></div>
      <div className="warehouse-putaway-target">
        <span>SELECTED LOCATION</span>
        <strong>{locationCode || 'Choose a rack position'}</strong>
        <p>Use the map to inspect and choose a destination. All stock increases still go through the controlled Receive batch and ledger posting gate.</p>
      </div>
      {notice ? <div className="warehouse-putaway-notice" role="status">{notice}</div> : null}
      <div className="warehouse-putaway-actions">
        <button type="button" disabled={!locationCode} onClick={() => void copyLocation()}>Copy location</button>
        <button type="button" disabled={!locationCode} onClick={useForPutaway}>Set putaway target</button>
        <a href="/">Open warehouse operations</a>
      </div>
    </section>,
    host,
  );
}
