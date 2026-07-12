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

  // The original enhancer inserted one add button after every half. Remove all of
  // those transient controls and rebuild exactly one button after the B half.
  row.querySelectorAll(':scope > .warehouse-slot-add').forEach((button) => button.remove());
  row.classList.add('warehouse-slot-row', 'warehouse-slot-row-native-action');

  const target = cells.find((cell) => /B$/i.test(locationCode(cell))) ?? cells[cells.length - 1];
  const code = locationCode(target);
  if (!code) return;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'warehouse-slot-add warehouse-slot-add-primary';
  addButton.textContent = '+';
  addButton.title = `Add or put away another SKU at ${code}`;
  addButton.setAttribute('aria-label', `Add or put away another SKU at ${code}`);
  addButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.click();
    window.localStorage.setItem('ecoflow-putaway-target', code);
    window.dispatchEvent(new CustomEvent(PUTAWAY_REQUEST_EVENT, { detail: { locationCode: code } }));
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('.warehouse-putaway-control-mount')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  });
  row.appendChild(addButton);
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
