import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';
import '../industrialOperationalClarity.css';

function ensureLabel(parent: HTMLElement, anchor: HTMLElement | null, key: string, text: string) {
  if (!anchor) return;
  let label = parent.querySelector<HTMLElement>(`:scope > [data-clarity-label="${key}"]`);
  if (!label) {
    label = document.createElement('div');
    label.className = 'industrial-clarity-label';
    label.dataset.clarityLabel = key;
    anchor.insertAdjacentElement('beforebegin', label);
  }
  if (label.textContent !== text) label.textContent = text;
}

function clarifyOrdermentumInbox() {
  const syncPanel = document.querySelector<HTMLElement>('.sync-panel');
  if (syncPanel) {
    const syncStrip = syncPanel.querySelector<HTMLElement>('.sync-strip');
    const releaseStrip = syncPanel.querySelector<HTMLElement>('.release-gate-strip');
    const internaliseRow = syncPanel.querySelector<HTMLElement>('.internalise-row');
    ensureLabel(syncPanel, syncStrip, 'sync-result', 'LAST SYNC RESULT');
    ensureLabel(syncPanel, releaseStrip, 'release-state', 'CURRENT RELEASE CHECK');

    if (releaseStrip) {
      const runCard = Array.from(releaseStrip.children).find((node) =>
        node instanceof HTMLElement && /today.?s run/i.test(node.textContent || ''),
      ) as HTMLElement | undefined;
      let runSection = syncPanel.querySelector<HTMLElement>(':scope > .industrial-run-state');
      if (runCard) {
        if (!runSection) {
          runSection = document.createElement('div');
          runSection.className = 'industrial-run-state';
          runSection.innerHTML = '<span>TODAY\'S RUN</span>';
          releaseStrip.insertAdjacentElement('afterend', runSection);
        }
        if (runCard.parentElement !== runSection) runSection.appendChild(runCard);
      }
    }

    // Internal-order creation is a database write. Do not expose a one-click
    // bulk action until the UI can preview exact orders and require confirmation.
    internaliseRow?.remove();
  }

  const inboxPanel = document.querySelector<HTMLElement>('.inbox-panel');
  if (inboxPanel) {
    const heading = inboxPanel.querySelector<HTMLElement>('.panel-head h2');
    if (heading && heading.textContent !== 'Order work queues') heading.textContent = 'Order work queues';
    const tabs = inboxPanel.querySelector<HTMLElement>('.inbox-tabs');
    if (tabs) {
      tabs.dataset.exclusiveQueues = 'true';
      tabs.setAttribute('aria-label', 'Mutually exclusive primary order queues');
    }
  }
}

function clarifyInventory() {
  const nav = document.querySelector<HTMLElement>('[data-workspace-tabs="inventory"]');
  if (nav) {
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button[data-view]'));
    buttons.forEach((button) => {
      if (button.dataset.view === 'control' && button.textContent !== 'Stock control') button.textContent = 'Stock control';
      if (button.dataset.view === 'catalog' && button.textContent !== 'SKU master') button.textContent = 'SKU master';
    });
    const available = buttons.filter((button) => !button.hidden);
    nav.hidden = available.length <= 1;
    nav.classList.toggle('inventory-workspace-tabs', available.length > 1);
  }

  const hero = document.querySelector<HTMLElement>('.inventory-hero');
  if (hero) {
    const eyebrow = hero.querySelector<HTMLElement>('span');
    const heading = hero.querySelector<HTMLElement>('h2');
    if (eyebrow && eyebrow.textContent !== 'WAREHOUSE & STOCK') eyebrow.textContent = 'WAREHOUSE & STOCK';
    if (heading && heading.textContent !== 'Inventory control') heading.textContent = 'Inventory control';
  }

  const queueHeading = document.querySelector<HTMLElement>('.inventory-panel h3');
  if (queueHeading && queueHeading.textContent !== 'Stock control') queueHeading.textContent = 'Stock control';
}

function applyClarity() {
  clarifyOrdermentumInbox();
  clarifyInventory();
}

export function IndustrialOperationalClarity() {
  useEffect(() => observeBody(applyClarity), []);
  return null;
}
