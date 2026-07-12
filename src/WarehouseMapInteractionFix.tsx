import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const PUTAWAY_REQUEST_EVENT = 'ecoflow:warehouse-putaway-request';

function locationCode(cell: HTMLElement | undefined) {
  return cell?.querySelector<HTMLElement>('.location-code')?.textContent?.trim() || '';
}

function normaliseLevelRow(row: HTMLElement) {
  const cells = Array.from(row.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('location-cell'),
  );
  if (!cells.length) return;

  // Legacy buttons remain in the body row so the rack enhancer stays idempotent,
  // but CSS hides them. The real action belongs beside A and B in the header row.
  row.querySelectorAll(':scope > .warehouse-slot-add-primary').forEach((button) => button.remove());
  row.classList.add('warehouse-slot-row', 'warehouse-slot-row-header-action');

  const levelRow = row.closest<HTMLElement>('.rack-level-row');
  const codeRow = levelRow?.querySelector<HTMLElement>(':scope > .rack-half-code-row');
  if (!codeRow) return;

  const target = cells.find((cell) => /B$/i.test(locationCode(cell))) ?? cells[cells.length - 1];
  const code = locationCode(target);
  if (!code) return;

  let addButton = codeRow.querySelector<HTMLButtonElement>(':scope > .warehouse-slot-add-primary');
  if (!addButton) {
    addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'warehouse-slot-add warehouse-slot-add-primary';
    addButton.textContent = '+';
    codeRow.appendChild(addButton);
  }

  addButton.title = `Add or put away another SKU at ${code}`;
  addButton.setAttribute('aria-label', `Add or put away another SKU at ${code}`);
  addButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.click();
    window.localStorage.setItem('ecoflow-putaway-target', code);
    window.dispatchEvent(new CustomEvent(PUTAWAY_REQUEST_EVENT, { detail: { locationCode: code } }));
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('.warehouse-putaway-control-mount')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  };
}

function normaliseRackActions() {
  if (window.location.pathname !== '/warehouse-map') return;
  document.querySelectorAll<HTMLElement>('.warehouse-rack-card .rack-half-row').forEach(normaliseLevelRow);
}

export function WarehouseMapInteractionFix() {
  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    return observeBody(normaliseRackActions);
  }, []);

  return null;
}
