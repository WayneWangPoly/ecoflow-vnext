import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyInventoryMovementPolicy() {
  const panel = document.querySelector<HTMLElement>('.inventory-movement-panel');
  if (!panel) return;

  const select = panel.querySelector<HTMLSelectElement>('select');
  const receiveOption = select?.querySelector<HTMLOptionElement>('option[value="RECEIVE"]');
  if (receiveOption) {
    receiveOption.disabled = true;
    receiveOption.hidden = true;
    receiveOption.textContent = 'Receive — use Warehouse Daily Receiving';
  }
  if (select?.value === 'RECEIVE') setSelectValue(select, 'PUTAWAY');

  let policy = panel.querySelector<HTMLElement>('.inventory-receive-policy');
  if (!policy) {
    policy = document.createElement('div');
    policy.className = 'inventory-receive-policy';
    const strong = document.createElement('strong');
    strong.textContent = 'Receiving is controlled by warehouse batches';
    const span = document.createElement('span');
    span.textContent = 'Use the Warehouse Receive tab to scan, verify and post inbound stock once. This ledger panel is for putaway, dispatch, adjustments and inspected returns.';
    policy.append(strong, span);
    panel.querySelector('header')?.insertAdjacentElement('afterend', policy);
  }

  const button = Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find((item) => /Record movement/i.test(item.textContent || ''));
  if (button) {
    const blockReceive = (event: Event) => {
      if (select?.value !== 'RECEIVE') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    if (button.dataset.inventoryPolicyBound !== 'true') {
      button.dataset.inventoryPolicyBound = 'true';
      button.addEventListener('click', blockReceive, true);
    }
  }
}

export function InventoryMovementPolicy() {
  useEffect(() => observeBody(applyInventoryMovementPolicy), []);
  return null;
}
