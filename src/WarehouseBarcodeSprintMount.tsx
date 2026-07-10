import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WarehouseBarcodeSprint } from './WarehouseBarcodeSprint';
import { WarehouseReceivingFlow } from './WarehouseReceivingFlow';
import { WarehouseReturnsPanel } from './WarehouseReturnsPanel';

type WarehouseOpsMode = 'receive' | 'returns' | 'barcode';

const modeCopy: Record<WarehouseOpsMode, { label: string; helper: string }> = {
  receive: { label: 'Receive', helper: 'Daily inbound stock batches' },
  returns: { label: 'Returns', helper: 'Inspect before stock release' },
  barcode: { label: 'Barcode setup', helper: 'Master data, not daily receiving' },
};

export function WarehouseBarcodeSprintMount() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<WarehouseOpsMode>('receive');

  useEffect(() => {
    function locate() {
      const title = Array.from(document.querySelectorAll<HTMLElement>('.mobile-title h1')).find((node) => node.textContent?.trim() === 'Warehouse');
      const content = title?.closest<HTMLElement>('.mobile-content');
      const tabs = content?.querySelector<HTMLElement>('.mobile-tabs');
      if (!content || !tabs) { setHost(null); return; }

      const activeTab = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.classList.contains('active'))?.textContent?.trim();
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
      {mode === 'barcode' ? <WarehouseBarcodeSprint /> : null}
    </>,
    host,
  );
}
