import { useEffect } from 'react';

function asButtonLink(label: string, href: string, className = 'inventory-map-link') {
  const link = document.createElement('a');
  link.href = href;
  link.className = className;
  link.textContent = label;
  return link;
}

export function FieldModeEnhancer() {
  useEffect(() => {
    function patchWarehouseReceiveCard() {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.mobile-card'));
      cards.forEach((card) => {
        const title = card.querySelector('h2')?.textContent?.trim();
        if (title !== 'Inbound receiving') return;
        const button = card.querySelector<HTMLButtonElement>('button.primary-button');
        if (!button) return;
        button.textContent = 'Open map';
        button.onclick = () => {
          window.location.href = '/warehouse-map';
        };
      });
    }

    function patchInventoryMapEntry() {
      const headings = Array.from(document.querySelectorAll<HTMLElement>('h2, h1'));
      const inventoryHeading = headings.find((item) => item.textContent?.trim().toLowerCase().includes('inventory'));
      if (!inventoryHeading) return;
      const panel = inventoryHeading.closest<HTMLElement>('.panel, .desktop-content, section, main');
      if (!panel || panel.querySelector('.inventory-map-action-row')) return;
      const row = document.createElement('div');
      row.className = 'inventory-map-action-row';
      row.appendChild(asButtonLink('Open warehouse map', '/warehouse-map'));
      const insertionPoint = inventoryHeading.closest<HTMLElement>('.panel-head') || inventoryHeading;
      insertionPoint.insertAdjacentElement('afterend', row);
    }

    function patchCompletedLabels() {
      const pills = Array.from(document.querySelectorAll<HTMLElement>('.pill'));
      pills.forEach((pill) => {
        const text = pill.textContent?.trim().toUpperCase();
        if (text === 'CLOSED' || text === 'DELIVERED') {
          pill.textContent = 'COMPLETED';
          pill.classList.add('pill-good');
        }
      });
    }

    function patchAll() {
      patchWarehouseReceiveCard();
      patchInventoryMapEntry();
      patchCompletedLabels();
    }

    patchAll();
    const observer = new MutationObserver(patchAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
