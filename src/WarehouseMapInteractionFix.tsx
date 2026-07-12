import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';
import { incrementWarehouseSkuSlot } from '@/lib/warehouseLayoutMetadata';

const PUTAWAY_REQUEST_EVENT = 'ecoflow:warehouse-putaway-request';

function locationCode(cell: HTMLElement | undefined) {
  return cell?.querySelector<HTMLElement>('.location-code')?.textContent?.trim() || '';
}

function liveSkuCount(cell: HTMLElement) {
  return cell.querySelectorAll('.slot-mini:not(.slot-placeholder)').length;
}

function showRowHint(levelRow: HTMLElement, message: string, tone: 'info' | 'error' = 'info') {
  let hint = levelRow.querySelector<HTMLElement>(':scope > .warehouse-level-add-hint');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'warehouse-level-add-hint';
    levelRow.appendChild(hint);
  }
  hint.dataset.tone = tone;
  hint.textContent = message;
  window.setTimeout(() => hint?.remove(), tone === 'error' ? 2600 : 1800);
}

function targetCell(cells: HTMLElement[]) {
  const selected = cells.find((cell) => cell.classList.contains('selected'));
  if (selected) return selected;
  const occupied = cells.filter((cell) => liveSkuCount(cell) > 0);
  return occupied.length === 1 ? occupied[0] : undefined;
}

function normaliseLevelRow(row: HTMLElement) {
  const cells = Array.from(row.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('location-cell'),
  );
  if (!cells.length) return;

  row.querySelectorAll(':scope > .warehouse-slot-add-primary').forEach((button) => button.remove());
  row.classList.add('warehouse-slot-row', 'warehouse-slot-row-header-action');

  const levelRow = row.closest<HTMLElement>('.rack-level-row');
  if (!levelRow) return;

  let addButton = levelRow.querySelector<HTMLButtonElement>(':scope > .warehouse-level-add-primary');
  if (!addButton) {
    addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'warehouse-level-add-primary';
    addButton.textContent = '+';
    const label = levelRow.querySelector(':scope > .rack-level-label');
    label?.insertAdjacentElement('afterend', addButton);
  }

  const selected = targetCell(cells);
  const selectedCode = locationCode(selected);
  const actionLabel = selectedCode
    ? `Add another SKU slot to ${selectedCode}`
    : 'Select the A or B cell on this level, then add another SKU slot';
  addButton.title = actionLabel;
  addButton.setAttribute('aria-label', actionLabel);
  addButton.classList.toggle('needs-cell-selection', !selectedCode);

  addButton.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const target = targetCell(cells);
    const code = locationCode(target);
    if (!target || !code) {
      showRowHint(levelRow, 'Tap the A or B cell first, then press +.', 'error');
      return;
    }

    addButton!.disabled = true;
    addButton!.textContent = '…';
    try {
      const currentMinimum = Math.max(
        1,
        liveSkuCount(target),
        Number(target.dataset.skuSlotCount || 1),
      );
      const slotCount = await incrementWarehouseSkuSlot(code, currentMinimum);
      target.dataset.skuSlotCount = String(slotCount);
      target.click();
      window.localStorage.setItem('ecoflow-putaway-target', code);
      window.dispatchEvent(new CustomEvent(PUTAWAY_REQUEST_EVENT, {
        detail: { locationCode: code, slotCount, action: 'ADD_SKU_SLOT' },
      }));
      showRowHint(levelRow, `${code}: SKU slot ${slotCount} added.`);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('.warehouse-putaway-control-mount')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
    } catch (error) {
      showRowHint(levelRow, error instanceof Error ? error.message : 'Could not add the SKU slot.', 'error');
    } finally {
      addButton!.disabled = false;
      addButton!.textContent = '+';
    }
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
