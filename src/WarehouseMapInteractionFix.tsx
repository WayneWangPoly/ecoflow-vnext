import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

/** Remove legacy add-position controls and their obsolete layout classes. */
function removeLegacySkuPositionControls() {
  if (window.location.pathname !== '/warehouse-map') return;
  document.querySelectorAll<HTMLElement>(
    '.warehouse-slot-add, .warehouse-slot-add-primary, .warehouse-level-add-primary, .warehouse-level-add-hint, .slot-placeholder, .slot-more-open',
  ).forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>('.rack-half-row').forEach((row) => {
    row.classList.remove('warehouse-slot-row-header-action', 'warehouse-slot-row');
  });
}

export function WarehouseMapInteractionFix() {
  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;
    return observeBody(removeLegacySkuPositionControls);
  }, []);

  return null;
}
