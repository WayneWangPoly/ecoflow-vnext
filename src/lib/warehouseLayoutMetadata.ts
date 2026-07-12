import { loadWarehouseLayout, saveWarehouseLayout, type WarehouseLayoutBox, type WarehouseLayoutState } from '@/data/repositories/warehouseLayout';

export const WAREHOUSE_LAYOUT_STORAGE_KEY = 'ecoflow-warehouse-layout-v1';
export const WAREHOUSE_SITE_CODE = 'SITE-01';
export const WAREHOUSE_SKU_SLOT_CHANGED_EVENT = 'ecoflow:warehouse-sku-slot-changed';
export const WAREHOUSE_LAYOUT_PRESENTATION_EVENT = 'ecoflow:warehouse-layout-presentation';

const SKU_SLOT_PREFIX = 'sku-slots:';

function emptyBox(): WarehouseLayoutBox {
  return { left: '', top: '', width: '', height: '' };
}

export function readLocalWarehouseLayout(): WarehouseLayoutState {
  try {
    return JSON.parse(window.localStorage.getItem(WAREHOUSE_LAYOUT_STORAGE_KEY) || '{}') as WarehouseLayoutState;
  } catch {
    return {};
  }
}

export function writeLocalWarehouseLayout(layout: WarehouseLayoutState) {
  window.localStorage.setItem(WAREHOUSE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export function rackLayoutKey(rackCode: string) {
  return `rack:${rackCode.trim().toLowerCase()}`;
}

export function skuSlotLayoutKey(locationCode: string) {
  return `${SKU_SLOT_PREFIX}${locationCode.trim().toLowerCase()}`;
}

export function skuSlotCountsFromLayout(layout: WarehouseLayoutState) {
  return Object.fromEntries(
    Object.entries(layout)
      .filter(([key, box]) => key.startsWith(SKU_SLOT_PREFIX) && Number.isFinite(Number(box.skuSlots)))
      .map(([key, box]) => [key.slice(SKU_SLOT_PREFIX.length).toUpperCase(), Math.max(1, Math.floor(Number(box.skuSlots)))])
  ) as Record<string, number>;
}

export function rackPresentationFromLayout(layout: WarehouseLayoutState, rackCode: string) {
  const box = layout[rackLayoutKey(rackCode)];
  return {
    displayName: box?.displayName?.trim() || '',
    categories: Array.isArray(box?.categories) ? box.categories.map((item) => String(item).trim()).filter(Boolean) : [],
  };
}

export function mergeRackPresentation(layout: WarehouseLayoutState, rackCode: string, displayName: string, categories: string[]) {
  const key = rackLayoutKey(rackCode);
  const existing = layout[key] || emptyBox();
  return {
    ...layout,
    [key]: {
      ...existing,
      displayName: displayName.trim() || undefined,
      categories: categories.map((item) => item.trim()).filter(Boolean),
    },
  };
}

export async function incrementWarehouseSkuSlot(locationCode: string, currentMinimum = 1) {
  const code = locationCode.trim().toUpperCase();
  if (!code) throw new Error('Select a warehouse location first.');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await loadWarehouseLayout(WAREHOUSE_SITE_CODE);
    const layout = row?.layout_json || readLocalWarehouseLayout();
    const key = skuSlotLayoutKey(code);
    const existing = Math.max(currentMinimum, Number(layout[key]?.skuSlots || 1));
    const nextCount = Math.floor(existing) + 1;
    const nextLayout = {
      ...layout,
      [key]: { ...(layout[key] || emptyBox()), skuSlots: nextCount },
    };

    writeLocalWarehouseLayout(nextLayout);
    try {
      const saved = await saveWarehouseLayout({
        siteCode: WAREHOUSE_SITE_CODE,
        layout: nextLayout,
        expectedVersion: row?.layout_version ?? null,
      });
      const finalLayout = saved?.layout_json || nextLayout;
      writeLocalWarehouseLayout(finalLayout);
      window.dispatchEvent(new CustomEvent(WAREHOUSE_SKU_SLOT_CHANGED_EVENT, {
        detail: { locationCode: code, slotCount: nextCount, layout: finalLayout },
      }));
      return nextCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !/LAYOUT_VERSION_CONFLICT/i.test(message)) throw error;
    }
  }

  throw new Error('Could not add another SKU slot. Reload the warehouse map and try again.');
}
