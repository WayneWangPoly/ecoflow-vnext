import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';
import './warehouseUnreferencedInbound.css';

function clean(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function auditReference() {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide' }).replace(/-/g, '');
  const time = now.toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Adelaide',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(/:/g, '');
  return `UNREFERENCED-${date}-${time}`;
}

function improveReceivingForm() {
  const screen = document.querySelector<HTMLElement>('.warehouse-receive-screen');
  const grid = screen?.querySelector<HTMLElement>('.warehouse-delivery-reference-grid');
  const batchRow = screen?.querySelector<HTMLElement>('.warehouse-batch-row');
  if (!screen || !grid || !batchRow) return;

  const heroTitle = screen.querySelector<HTMLElement>('.warehouse-receive-hero h2');
  const heroCopy = screen.querySelector<HTMLElement>('.warehouse-receive-hero p');
  if (heroTitle && heroTitle.textContent !== 'Receive one inbound delivery at a time.') heroTitle.textContent = 'Receive one inbound delivery at a time.';
  const heroText = 'Supplier documents are optional. When none is available, EcoFlow creates an auditable inbound reference automatically; every scan still remains idempotent and requires verification before stock is posted.';
  if (heroCopy && heroCopy.textContent !== heroText) heroCopy.textContent = heroText;

  const labels = Array.from(grid.querySelectorAll<HTMLLabelElement>('label'));
  const docketLabel = labels.find((label) => /delivery docket|order ref/i.test(label.textContent || ''));
  const noteLabel = labels.find((label) => /delivery note/i.test(label.textContent || ''));
  const docketInput = docketLabel?.querySelector<HTMLInputElement>('input') || null;
  const invoiceInput = labels.find((label) => /invoice ref/i.test(label.textContent || ''))?.querySelector<HTMLInputElement>('input') || null;
  const noteInput = noteLabel?.querySelector<HTMLInputElement>('input') || null;

  const docketCaption = docketLabel?.querySelector<HTMLElement>('span');
  if (docketCaption && docketCaption.textContent !== 'Delivery docket / order ref (optional)') docketCaption.textContent = 'Delivery docket / order ref (optional)';
  if (docketInput && docketInput.placeholder !== 'Leave blank when no supplier document is available') docketInput.placeholder = 'Leave blank when no supplier document is available';

  let hint = screen.querySelector<HTMLElement>('.warehouse-unreferenced-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'warehouse-unreferenced-hint';
    hint.innerHTML = '<strong>No document?</strong><span>Press Start receiving normally. EcoFlow will generate an UNREFERENCED audit ID and preserve the supplier, operator time and notes.</span>';
    grid.insertAdjacentElement('afterend', hint);
  }

  const actionButton = Array.from(batchRow.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => /start receiving/i.test(clean(button.textContent)));
  if (!actionButton || actionButton.dataset.unreferencedGuard === 'true') return;
  actionButton.dataset.unreferencedGuard = 'true';

  actionButton.addEventListener('click', (event) => {
    if (actionButton.dataset.unreferencedReplay === 'true') {
      delete actionButton.dataset.unreferencedReplay;
      return;
    }
    const hasReference = Boolean(clean(docketInput?.value) || clean(invoiceInput?.value));
    if (hasReference || !docketInput) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const reference = auditReference();
    setReactInputValue(docketInput, reference);
    if (noteInput && !clean(noteInput.value)) {
      setReactInputValue(noteInput, `No supplier document available at receipt. EcoFlow audit reference ${reference}.`);
    }

    window.setTimeout(() => {
      const freshButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.warehouse-receive-screen .warehouse-batch-row button'))
        .find((button) => /start receiving/i.test(clean(button.textContent)));
      if (!freshButton) return;
      freshButton.dataset.unreferencedReplay = 'true';
      freshButton.click();
    }, 100);
  }, true);

  const batchSignal = batchRow.querySelector<HTMLElement>('span');
  if (batchSignal && /enter delivery reference/i.test(batchSignal.textContent || '')) {
    batchSignal.textContent = 'DOCUMENT OPTIONAL · AUDIT REFERENCE AUTOMATIC';
  }
}

export function WarehouseUnreferencedInboundEnhancer() {
  useEffect(() => observeBody(improveReceivingForm), []);
  return null;
}
