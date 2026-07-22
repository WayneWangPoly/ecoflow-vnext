import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';
import './releaseOperationsEnhancer.css';

type ExceptionAction = {
  label: string;
  destination: string;
  explanation: string;
  href?: string;
};

function clean(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function findDesktopButton(labels: string[]) {
  const wanted = labels.map((label) => label.toLowerCase());
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button, .desktop-mobile-nav button'))
    .find((button) => wanted.some((label) => clean(button.textContent).toLowerCase() === label));
}

function exceptionAction(categoryText: string): ExceptionAction {
  const category = categoryText.toUpperCase();
  if (category.includes('SKU MAPPING')) {
    return {
      label: 'Open Barcode setup',
      destination: 'Warehouse Barcode setup',
      explanation: 'Map the physical barcode to the Ordermentum SKU, then refresh this release check.',
      href: '/?workspace=warehouse&mode=barcode',
    };
  }
  if (category.includes('STOCK SHORTAGE')) {
    return {
      label: 'Open Inventory',
      destination: 'Inventory',
      explanation: 'Confirm live stock, receiving and location balances before releasing the order.',
    };
  }
  if (category.includes('PAYMENT')) {
    return {
      label: 'Open Accounts',
      destination: 'Accounts',
      explanation: 'Review the customer payment state or hold before the order can enter the run.',
    };
  }
  if (category.includes('SITE MAPPING') || category.includes('ADDRESS') || category.includes('PRICE TIER')) {
    return {
      label: 'Open Customers',
      destination: 'Customers',
      explanation: 'Correct the customer/site master issue, then refresh the Ordermentum snapshot.',
    };
  }
  return {
    label: 'Open Orders',
    destination: 'Orders',
    explanation: 'Review the source order and resolve the listed blocker before release.',
  };
}

function navigate(action: ExceptionAction) {
  if (action.href) {
    window.open(action.href, '_blank', 'noopener,noreferrer');
    return;
  }
  const candidates = action.destination === 'Accounts'
    ? ['accounts', 'reconciliation']
    : action.destination === 'Customers'
      ? ['customers', 'stores']
      : [action.destination.toLowerCase()];
  findDesktopButton(candidates)?.click();
}

function numberFrom(root: ParentNode | null, selector: string) {
  const text = clean(root?.querySelector<HTMLElement>(selector)?.textContent);
  const value = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function ensureSubtitle(panel: HTMLElement, text: string) {
  const head = panel.querySelector<HTMLElement>(':scope > .panel-head');
  if (!head) return;
  let subtitle = head.querySelector<HTMLElement>('.release-panel-purpose');
  if (!subtitle) {
    subtitle = document.createElement('span');
    subtitle.className = 'release-panel-purpose';
    head.querySelector('h2')?.insertAdjacentElement('afterend', subtitle);
  }
  subtitle.textContent = text;
}

function decorateException(card: HTMLElement) {
  if (card.dataset.releaseActionReady === 'true') return;
  card.dataset.releaseActionReady = 'true';
  card.classList.add('release-blocker-card');

  // The generic desktop workbench previously opened a duplicate inspector for
  // these cards. The card is now a self-contained blocker/action surface.
  card.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    event.stopPropagation();
  }, true);

  const category = clean(card.querySelector<HTMLElement>('span')?.textContent).split('·').pop() || '';
  const action = exceptionAction(category);
  const footer = document.createElement('div');
  footer.className = 'release-blocker-action';
  footer.innerHTML = `<div><span>NEXT ACTION</span><strong>${action.explanation}</strong></div>`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = action.label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(action);
  });
  footer.appendChild(button);
  card.appendChild(footer);
}

function addDecisionSummary(syncPanel: HTMLElement, releasePanel: HTMLElement | null, exceptionPanel: HTMLElement | null) {
  let summary = syncPanel.querySelector<HTMLElement>(':scope > .release-decision-summary');
  if (!summary) {
    summary = document.createElement('section');
    summary.className = 'release-decision-summary';
    const anchor = syncPanel.querySelector('.sync-meta-line') || syncPanel.querySelector('.sync-header-block');
    anchor?.insertAdjacentElement('afterend', summary);
  }

  const ready = releasePanel?.querySelectorAll('.order-list-item').length || 0;
  const blocked = exceptionPanel?.querySelectorAll('.exception-card').length || 0;
  const inRun = numberFrom(syncPanel, '.industrial-run-state strong');
  summary.innerHTML = `
    <div><span>1 · FIX BLOCKERS</span><strong>${blocked}</strong><small>orders needing mapping, stock, account or customer work</small></div>
    <div><span>2 · READY TO RELEASE</span><strong>${ready}</strong><small>select exact orders in the queue below</small></div>
    <div><span>3 · TODAY'S RUN</span><strong>${inRun}</strong><small>released orders available to route planning</small></div>
  `;
}

function addDiagnosticsToggle(syncPanel: HTMLElement) {
  let button = syncPanel.querySelector<HTMLButtonElement>(':scope > .release-diagnostics-toggle');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'release-diagnostics-toggle';
    button.addEventListener('click', () => {
      syncPanel.classList.toggle('release-diagnostics-open');
      button!.textContent = syncPanel.classList.contains('release-diagnostics-open')
        ? 'Hide sync and gate diagnostics'
        : 'Show sync and gate diagnostics';
    });
    const summary = syncPanel.querySelector('.release-decision-summary');
    summary?.insertAdjacentElement('afterend', button);
  }
  button.textContent = syncPanel.classList.contains('release-diagnostics-open')
    ? 'Hide sync and gate diagnostics'
    : 'Show sync and gate diagnostics';
}

function restructureRelease() {
  const syncPanel = document.querySelector<HTMLElement>('.sync-panel');
  const inboxPanel = document.querySelector<HTMLElement>('.inbox-panel');
  if (!syncPanel || !inboxPanel) return;

  const workspace = syncPanel.closest<HTMLElement>('.workspace-stack');
  if (!workspace) return;
  const panels = Array.from(workspace.querySelectorAll<HTMLElement>('.panel'));
  const releasePanel = panels.find((panel) => clean(panel.querySelector('.panel-head h2')?.textContent).toLowerCase().includes('release queue')) || null;
  const exceptionPanel = panels.find((panel) => clean(panel.querySelector('.panel-head h2')?.textContent).toLowerCase().includes('exception control')) || null;

  const eyebrow = syncPanel.querySelector<HTMLElement>('.section-eyebrow');
  const title = syncPanel.querySelector<HTMLElement>('.sync-header-block h2');
  if (eyebrow) eyebrow.textContent = 'ORDER RELEASE';
  if (title) title.textContent = 'Release orders to today’s run';

  if (releasePanel) {
    releasePanel.classList.add('release-ready-panel');
    const heading = releasePanel.querySelector<HTMLElement>('.panel-head h2');
    if (heading) heading.textContent = '2 · Ready to release';
    ensureSubtitle(releasePanel, 'Select the exact orders, review the count, then release them to today’s run.');
    syncPanel.insertAdjacentElement('afterend', releasePanel);
  }

  if (exceptionPanel) {
    exceptionPanel.classList.add('release-blockers-panel');
    const heading = exceptionPanel.querySelector<HTMLElement>('.panel-head h2');
    if (heading) heading.textContent = '1 · Fix blockers';
    ensureSubtitle(exceptionPanel, 'These orders cannot be released. Each card now shows the next operational action.');
    (releasePanel || syncPanel).insertAdjacentElement('afterend', exceptionPanel);
    exceptionPanel.querySelectorAll<HTMLElement>('.exception-card').forEach(decorateException);
  }

  const oldSplit = Array.from(workspace.querySelectorAll<HTMLElement>('.split-grid')).find((grid) => !grid.children.length);
  oldSplit?.remove();

  const inboxHeading = inboxPanel.querySelector<HTMLElement>('.panel-head h2');
  if (inboxHeading) inboxHeading.textContent = 'Order audit and primary queues';

  addDecisionSummary(syncPanel, releasePanel, exceptionPanel);
  addDiagnosticsToggle(syncPanel);
  syncPanel.classList.add('release-operations-summary');
}

export function ReleaseOperationsEnhancer() {
  useEffect(() => observeBody(restructureRelease), []);
  return null;
}
