import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WarehouseBarcodeSprint } from './WarehouseBarcodeSprint';
import { WarehouseReceivingFlow } from './WarehouseReceivingFlow';
import { WarehouseReturnsPanel } from './WarehouseReturnsPanel';

export function WarehouseBarcodeSprintMount() {
  const [host, setHost] = useState<HTMLElement | null>(null);

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
        mount.className = 'warehouse-barcode-sprint-mount';
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
      window.setTimeout(() => { pending = false; locate(); }, 140);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return host ? createPortal(<><WarehouseReceivingFlow /><WarehouseReturnsPanel /><WarehouseBarcodeSprint /></>, host) : null;
}
