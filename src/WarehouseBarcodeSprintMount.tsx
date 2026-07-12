import { useEffect, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { WarehouseBarcodeSprint } from './WarehouseBarcodeSprint';
import { WarehouseReceivingFlow } from './WarehouseReceivingFlow';
import { WarehouseReturnsPanel } from './WarehouseReturnsPanel';

type WarehouseOpsMode = 'receive' | 'returns' | 'barcode';

const modeCopy: Record<WarehouseOpsMode, { label: string; helper: string }> = {
  receive: { label: 'Receive', helper: 'Daily inbound stock batches' },
  returns: { label: 'Returns', helper: 'Inspect before stock release' },
  barcode: { label: 'Barcode setup', helper: 'First stocktake: location, SKU and packaging barcode mapping' },
};

function requestedMode(): WarehouseOpsMode {
  const value = new URLSearchParams(window.location.search).get('mode')?.toLowerCase();
  return value === 'barcode' || value === 'returns' ? value : 'receive';
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
      if (!initialTabApplied.current && requestedMode() !== 'receive' && activeTab !== 'receive') {
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
      <nav className="warehouse-ops-switcher" aria-label="Warehouse receiving work areas">
        {(Object.keys(modeCopy) as WarehouseOpsMode[]).map((item) => (
          <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)} title={modeCopy[item].helper}>{modeCopy[item].label}</button>
        ))}
      </nav>
      <div className="warehouse-ops-context">
        <a href="/warehouse-map">Warehouse map</a>
        <a href="/warehouse-map?mode=putaway">Putaway locations</a>
        <a href="/?tab=inventory">Inventory control</a>
      </div>
      {mode === 'receive' ? <WarehouseReceivingFlow /> : null}
      {mode === 'returns' ? <WarehouseReturnsPanel /> : null}
      {mode === 'barcode' ? (
        <>
          <section className="warehouse-first-stocktake-guide">
            <span>FIRST STOCKTAKE · LOCATION FIRST</span>
            <strong>Choose the physical cell, then scan every SKU and its packaging barcode.</strong>
            <ol>
              <li>Select or scan the A/B location.</li>
              <li>Scan the SKU/item code stored there.</li>
              <li>Scan carton, sleeve or unit barcode and record package size.</li>
              <li>Count observed packages; post real opening stock only through the controlled stocktake/receiving action.</li>
            </ol>
            <small>The saved fixed shelf becomes the picker’s location hint. Warehouse Map and Pick therefore use the same SKU-to-location master.</small>
          </section>
          <WarehouseBarcodeSprint />
        </>
      ) : null}
    </>,
    host,
  );
}
