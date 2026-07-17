import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

/**
 * Warehouse Map is a read-only stock surface. Legacy "+ SKU position" controls are
 * removed here so cached DOM or an older enhancer cannot reintroduce a misleading
 * capacity action. Real SKU rows appear automatically from location balances.
 */
function removeLegacySkuPositionControls() {
  if (window.location.pathname !== '/warehouse-map') return;
  document.querySelectorAll<HTMLElement>(
    '.warehouse-slot-add, .warehouse-slot-add-primary, .warehouse-level-add-primary, .warehouse-level-add-hint, .slot-placeholder, .slot-more-open',
  ).forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>('.warehouse-slot-row-header-action').forEach((row) => {
    row.classList.remove('warehouse-slot-row-header-action');
  });
}

export function WarehouseMapInteractionFix() {
  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    return observeBody(removeLegacySkuPositionControls);
  }, []);

  return null;
}
