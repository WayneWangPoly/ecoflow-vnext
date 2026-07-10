import { useEffect } from 'react';

function applyLoadRecovery() {
  const loadList = document.querySelector<HTMLElement>('.load-list');
  if (!loadList) return;
  const rows = Array.from(loadList.querySelectorAll<HTMLButtonElement>('.load-row'));
  const loadedRows = rows.filter((row) => row.classList.contains('loaded'));
  let control = loadList.parentElement?.querySelector<HTMLButtonElement>('.warehouse-load-undo');
  if (!control && loadList.parentElement) {
    control = document.createElement('button');
    control.type = 'button';
    control.className = 'driver-ghost-button warehouse-load-undo';
    control.addEventListener('click', () => {
      const currentRows = Array.from(loadList.querySelectorAll<HTMLButtonElement>('.load-row'));
      const currentLoaded = currentRows.filter((row) => row.classList.contains('loaded'));
      const lastLoaded = currentLoaded[currentLoaded.length - 1];
      if (!lastLoaded) return;
      lastLoaded.disabled = false;
      lastLoaded.click();
    });
    loadList.insertAdjacentElement('afterend', control);
  }
  if (!control) return;
  control.disabled = loadedRows.length === 0;
  control.textContent = loadedRows.length ? `Undo last load · ${loadedRows.length}/${rows.length}` : 'Nothing loaded to undo';
  control.title = loadedRows.length ? 'Reopen only the most recently confirmed loading step.' : '';
}

export function LoadRecoveryControl() {
  useEffect(() => {
    applyLoadRecovery();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        applyLoadRecovery();
      }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    const timer = window.setInterval(applyLoadRecovery, 800);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
