import { useEffect, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { FirstStocktakeWorkspace } from './FirstStocktakeWorkspace';
import { WarehouseReceivingFlow } from './WarehouseReceivingFlow';
import { WarehouseReturnsPanel } from './WarehouseReturnsPanel';

// Identity commissioning now lives exclusively in /commissioning/product-identity.
// Warehouse operations retain Stocktake / Receiving / Returns only.
type WarehouseOpsMode = 'stocktake' | 'receive' | 'returns';

const secondaryModes: Array<{ mode: Exclude<WarehouseOpsMode, 'stocktake'>; label: string }> = [
  { mode: 'receive', label: 'Receiving' },
  { mode: 'returns', label: 'Returns' },
];

function requestedMode(): WarehouseOpsMode {
  const value = new URLSearchParams(window.location.search).get('mode')?.toLowerCase();
  if (value === 'receive' || value === 'returns') return value;
  return 'stocktake';
}

function nativeTabLabel(button: HTMLButtonElement) {
  return button.textContent?.trim().toLowerCase() || '';
}

export function WarehouseBarcodeSprintMount() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<WarehouseOpsMode>(requestedMode);
  const initialTabApplied = useRef(false);
  const activatingStocktake = useRef(false);

  useEffect(() => {
    function locate() {
      const title = Array.from(document.querySelectorAll<HTMLElement>('.mobile-title h1')).find((node) => node.textContent?.trim() === 'Warehouse');
      const content = title?.closest<HTMLElement>('.mobile-content');
      const tabs = content?.querySelector<HTMLElement>('.mobile-tabs');
      if (!content || !tabs) { setHost(null); return; }

      const nativeButtons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button:not(.warehouse-first-stocktake-tab)'));
      const receiveButton = nativeButtons.find((button) => nativeTabLabel(button) === 'receive');
      if (receiveButton) receiveButton.classList.add('warehouse-native-receive-tab');

      let stocktakeButton = tabs.querySelector<HTMLButtonElement>('.warehouse-first-stocktake-tab');
      if (!stocktakeButton) {
        stocktakeButton = document.createElement('button');
        stocktakeButton.type = 'button';
        stocktakeButton.className = 'warehouse-first-stocktake-tab';
        stocktakeButton.textContent = 'First stocktake';
        tabs.insertBefore(stocktakeButton, receiveButton || tabs.firstChild);
      }
      stocktakeButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        activatingStocktake.current = true;
        setMode('stocktake');
        receiveButton?.click();
      };

      const activeTab = nativeButtons.find((button) => button.classList.contains('active'));
      const activeLabel = nativeTabLabel(activeTab || document.createElement('button'));
      if (!initialTabApplied.current && activeLabel !== 'receive') {
        initialTabApplied.current = true;
        activatingStocktake.current = mode === 'stocktake';
        receiveButton?.click();
        return;
      }
      initialTabApplied.current = true;

      const isReceiveSurface = activeLabel === 'receive';
      const stocktakeActive = isReceiveSurface && mode === 'stocktake';
      tabs.classList.toggle('warehouse-stocktake-top-active', stocktakeActive);
      stocktakeButton.classList.toggle('active', stocktakeActive);

      let mount = content.querySelector<HTMLElement>('.warehouse-barcode-sprint-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'warehouse-barcode-sprint-mount warehouse-operations-mount';
        tabs.insertAdjacentElement('afterend', mount);
      }
      mount.style.display = isReceiveSurface ? 'block' : 'none';

      const nativeReceiveCard = Array.from(content.querySelectorAll<HTMLElement>('.mobile-card')).find((card) => card.querySelector('h2')?.textContent?.trim() === 'Inbound receiving');
      if (nativeReceiveCard) nativeReceiveCard.classList.toggle('warehouse-native-receive-hide', isReceiveSurface);
      setHost(mount);
    }

    function handleNativeTab(event: MouseEvent) {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.mobile-tabs button');
      if (!button || button.classList.contains('warehouse-first-stocktake-tab')) return;
      const label = nativeTabLabel(button);
      if (label !== 'receive') return;
      if (activatingStocktake.current) {
        activatingStocktake.current = false;
        return;
      }
      setMode('receive');
    }

    const stopObserving = observeBody(locate);
    document.addEventListener('click', handleNativeTab);
    return () => {
      stopObserving();
      document.removeEventListener('click', handleNativeTab);
    };
  }, [mode]);

  if (!host) return null;
  return createPortal(
    <>
      {mode !== 'stocktake' ? (
        <nav className="warehouse-ops-switcher warehouse-secondary-ops" aria-label="Warehouse receiving tools">
          {secondaryModes.map((item) => (
            <button key={item.mode} type="button" className={mode === item.mode ? 'active' : ''} onClick={() => setMode(item.mode)}>{item.label}</button>
          ))}
          <button type="button" onClick={() => window.location.assign('/commissioning/product-identity')}>Product identity</button>
        </nav>
      ) : null}
      {mode === 'stocktake' ? <FirstStocktakeWorkspace /> : null}
      {mode === 'receive' ? <WarehouseReceivingFlow /> : null}
      {mode === 'returns' ? <WarehouseReturnsPanel /> : null}
    </>,
    host,
  );
}