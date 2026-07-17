import { useEffect, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { FirstStocktakeFlow } from './FirstStocktakeFlow';
import { WarehouseBarcodeSprint } from './WarehouseBarcodeSprint';
import { WarehouseReceivingFlow } from './WarehouseReceivingFlow';
import { WarehouseReturnsPanel } from './WarehouseReturnsPanel';

type WarehouseOpsMode = 'stocktake' | 'receive' | 'returns' | 'barcode';

const modeCopy: Record<WarehouseOpsMode, { label: string; helper: string }> = {
  stocktake: { label: 'First stocktake', helper: 'Current preparation task: location, barcode, count and controlled opening stock' },
  receive: { label: 'Daily receiving', helper: 'Inbound supplier deliveries after opening stock is established' },
  returns: { label: 'Returns', helper: 'Inspect returned goods before stock release' },
  barcode: { label: 'Barcode maintenance', helper: 'Advanced package rules, replacements and retired codes' },
};

function requestedMode(): WarehouseOpsMode {
  const value = new URLSearchParams(window.location.search).get('mode')?.toLowerCase();
  if (value === 'receive' || value === 'returns' || value === 'barcode') return value;
  if (value === 'stocktake') return 'stocktake';
  return 'stocktake';
}

export function WarehouseBarcodeSprintMount() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<WarehouseOpsMode>(requestedMode);
  const initialTabApplied = useRef(false);

  useEffect(() => {
    function locate() {
      const title = Array.from(document.querySelectorAll<HTMLElement>('.mobile-title h1')).find((node) => node.textContent?.trim() === 'Warehouse');
      const content = title?.closest<HTMLElement>('.mobile-content');
      const tabs = content?.querySelector<HTMLElement>('.mobile-tabs');
      if (!content || !tabs) { setHost(null); return; }

      const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button'));
      const activeTab = buttons.find((button) => button.classList.contains('active'))?.textContent?.trim();
      if (!initialTabApplied.current && activeTab !== 'receive') {
        initialTabApplied.current = true;
        buttons.find((button) => button.textContent?.trim() === 'receive')?.click();
        return;
      }
      initialTabApplied.current = true;
      const isReceive = activeTab === 'receive';

      let mount = content.querySelector<HTMLElement>('.warehouse-barcode-sprint-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'warehouse-barcode-sprint-mount warehouse-operations-mount';
        tabs.insertAdjacentElement('afterend', mount);
      }
      mount.style.display = isReceive ? 'block' : 'none';

      const nativeReceiveCard = Array.from(content.querySelectorAll<HTMLElement>('.mobile-card')).find((card) => card.querySelector('h2')?.textContent?.trim() === 'Inbound receiving');
      if (nativeReceiveCard) nativeReceiveCard.classList.toggle('warehouse-native-receive-hide', isReceive);
      setHost(mount);
    }

    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  if (!host) return null;
  return createPortal(
    <>
      <section className="warehouse-phase-banner">
        <span>CURRENT RELEASE PHASE</span>
        <strong>Prepare opening stock before daily receiving, picking and delivery.</strong>
      </section>
      <nav className="warehouse-ops-switcher" aria-label="Warehouse work areas">
        {(Object.keys(modeCopy) as WarehouseOpsMode[]).map((item) => (
          <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)} title={modeCopy[item].helper}>{modeCopy[item].label}</button>
        ))}
      </nav>
      <div className="warehouse-ops-context">
        <a href="/warehouse-map">1 · Warehouse map</a>
        <button type="button" className={mode === 'stocktake' ? 'active' : ''} onClick={() => setMode('stocktake')}>2 · First stocktake</button>
        <a href="/?tab=inventory">3 · Review live stock</a>
      </div>
      {mode === 'stocktake' ? <FirstStocktakeFlow /> : null}
      {mode === 'receive' ? <WarehouseReceivingFlow /> : null}
      {mode === 'returns' ? <WarehouseReturnsPanel /> : null}
      {mode === 'barcode' ? (
        <>
          <section className="warehouse-first-stocktake-guide warehouse-advanced-guide">
            <span>ADVANCED BARCODE MAINTENANCE</span>
            <strong>Use this only for package-rule corrections, replacement packaging and retired codes.</strong>
            <small>Normal first-stocktake work belongs in the guided First stocktake screen.</small>
          </section>
          <WarehouseBarcodeSprint />
        </>
      ) : null}
    </>,
    host,
  );
}
