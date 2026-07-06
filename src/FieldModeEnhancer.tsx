import { useEffect } from 'react';

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

    patchWarehouseReceiveCard();
    const observer = new MutationObserver(patchWarehouseReceiveCard);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
