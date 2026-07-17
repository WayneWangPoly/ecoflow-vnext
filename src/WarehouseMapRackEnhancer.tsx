import { useEffect, useRef } from 'react';
import { observeBody } from '@/lib/domObserver';
import { loadWarehouseLayout, saveWarehouseLayout, type WarehouseLayoutBox, type WarehouseLayoutState } from '@/data/repositories/warehouseLayout';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import {
  WAREHOUSE_SITE_CODE,
  mergeSkuVisualOrders,
  readLocalWarehouseLayout,
  skuVisualOrdersFromLayout,
  writeLocalWarehouseLayout,
} from '@/lib/warehouseLayoutMetadata';
import { supabase } from '@/lib/supabaseClient';

const SITE_CODE = WAREHOUSE_SITE_CODE;
const BIN_PREFIX = 'bin-order:';

type BinOrders = Record<string, string[]>;
type SkuVisualOrders = Record<string, string[]>;
type LayoutOrderBox = WarehouseLayoutBox & { binOrder?: string[] };

type RackContext = {
  card: HTMLElement;
  grid: HTMLElement;
  rackId: string;
  side: string;
};

type ActiveSkuDrag = {
  item: HTMLElement;
  wrap: HTMLElement;
  locationCode: string;
};

function readStoredLayout(): WarehouseLayoutState {
  return readLocalWarehouseLayout();
}

function rackContext(): RackContext | null {
  const card = document.querySelector<HTMLElement>('.warehouse-rack-card');
  const grid = card?.querySelector<HTMLElement>('.rack-bin-grid');
  const activeFloorRack = document.querySelector<HTMLElement>('.warehouse-floorplan .floor-rack.active');
  const floorCode = activeFloorRack?.dataset.rackCode
    || activeFloorRack?.querySelector<HTMLElement>('span')?.dataset.rackCode
    || activeFloorRack?.querySelector<HTMLElement>('span')?.textContent?.trim();
  const heading = card?.querySelector<HTMLElement>('.warehouse-map-card-head h2');
  const rackId = (card?.dataset.rackId || heading?.dataset.rackCode || floorCode || heading?.textContent?.trim() || '').toUpperCase();
  const activeSide = card?.querySelector<HTMLButtonElement>('.rack-side-buttons button.active')?.textContent?.trim().toLowerCase();
  const side = activeSide === 'left' || activeSide === 'right' ? activeSide : 'front';
  if (card && rackId) card.dataset.rackId = rackId;
  if (heading && rackId) heading.dataset.rackCode = rackId;
  return card && grid && rackId ? { card, grid, rackId, side } : null;
}

function binColumns(grid: HTMLElement) {
  return Array.from(grid.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('rack-bin-column'));
}

function binCode(column: HTMLElement) {
  const heading = column.querySelector<HTMLElement>('h3')?.textContent?.trim() || '';
  return heading.split('-').pop()?.toUpperCase() || heading.toUpperCase();
}

function orderKey(rackId: string, side: string) {
  return `${BIN_PREFIX}${rackId.toLowerCase()}:${side.toLowerCase()}`;
}

function orderFromBox(box: WarehouseLayoutBox) {
  return (box as LayoutOrderBox).binOrder;
}

function ordersFromLayout(layout: WarehouseLayoutState): BinOrders {
  return Object.fromEntries(Object.entries(layout)
    .filter(([key, box]) => key.startsWith(BIN_PREFIX) && Array.isArray(orderFromBox(box)))
    .map(([key, box]) => [key, [...(orderFromBox(box) || [])]]));
}

function mergeOrders(layout: WarehouseLayoutState, orders: BinOrders) {
  const merged = { ...layout };
  Object.keys(merged).filter((key) => key.startsWith(BIN_PREFIX)).forEach((key) => delete merged[key]);
  Object.entries(orders).forEach(([key, binOrder]) => {
    merged[key] = { left: '', top: '', width: '', height: '', binOrder: [...binOrder] } as LayoutOrderBox;
  });
  return merged;
}

function mergeVisualPreferences(layout: WarehouseLayoutState, binOrders: BinOrders, skuOrders: SkuVisualOrders) {
  return mergeSkuVisualOrders(mergeOrders(layout, binOrders), skuOrders);
}

function applyVisibleOrder(orders: BinOrders) {
  const context = rackContext();
  if (!context) return;
  const requested = orders[orderKey(context.rackId, context.side)];
  if (!requested?.length) return;

  const currentColumns = binColumns(context.grid);
  const currentOrder = currentColumns.map(binCode);
  const available = new Set(currentOrder);
  const requestedUpper = requested.map((bin) => bin.toUpperCase());
  const desiredOrder = [
    ...requestedUpper.filter((bin) => available.has(bin)),
    ...currentOrder.filter((bin) => !requestedUpper.includes(bin)),
  ];
  if (currentOrder.join('|') === desiredOrder.join('|')) return;

  const byBin = new Map(currentColumns.map((column) => [binCode(column), column]));
  desiredOrder.forEach((bin) => {
    const column = byBin.get(bin);
    if (column) context.grid.appendChild(column);
  });
}

function captureVisibleOrder(orders: BinOrders) {
  const context = rackContext();
  if (!context) return orders;
  return {
    ...orders,
    [orderKey(context.rackId, context.side)]: binColumns(context.grid).map(binCode).filter(Boolean),
  };
}

function naturalVisibleOrder() {
  const context = rackContext();
  if (!context) return;
  const columns = binColumns(context.grid);
  const currentOrder = columns.map(binCode);
  const desiredOrder = [...currentOrder].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (currentOrder.join('|') === desiredOrder.join('|')) return;
  const byBin = new Map(columns.map((column) => [binCode(column), column]));
  desiredOrder.forEach((bin) => {
    const column = byBin.get(bin);
    if (column) context.grid.appendChild(column);
  });
}

function shortLocationCode(code: string) {
  return code.match(/(\d{2}[AB])$/i)?.[1]?.toUpperCase() || code;
}

function setText(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

function itemRowsFor(rows: WarehouseLocationItemRow[], code: string) {
  return rows.filter((row) => row.location_code === code && row.item_id && row.sku);
}

function locationRowsFor(rows: WarehouseLocationItemRow[], code: string) {
  return rows.filter((row) => row.location_code === code);
}

function skuVisualKey(row: WarehouseLocationItemRow) {
  return `${String(row.sku || '').trim().toUpperCase()}::${String(row.unit_level || 'unknown').trim().toLowerCase()}`;
}

function orderedItemRows(rows: WarehouseLocationItemRow[], requested: string[] | undefined) {
  if (!requested?.length) return [...rows];
  const rank = new Map(requested.map((key, index) => [key, index]));
  return [...rows].sort((left, right) => {
    const leftRank = rank.get(skuVisualKey(left));
    const rightRank = rank.get(skuVisualKey(right));
    if (leftRank !== undefined || rightRank !== undefined) return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    return String(left.sku || '').localeCompare(String(right.sku || ''), undefined, { numeric: true });
  });
}

function captureVisibleSkuOrders(orders: SkuVisualOrders) {
  const next = { ...orders };
  document.querySelectorAll<HTMLElement>('.warehouse-rack-card .location-cell[data-location-code]').forEach((cell) => {
    const code = cell.dataset.locationCode?.trim().toUpperCase();
    if (!code) return;
    const keys = Array.from(cell.querySelectorAll<HTMLElement>(':scope .slot-item-wrap > .slot-mini[data-sku-key]'))
      .map((item) => item.dataset.skuKey || '')
      .filter(Boolean);
    if (keys.length > 1) next[code] = keys;
    else delete next[code];
  });
  return next;
}

function decorateCell(cell: HTMLElement, rows: WarehouseLocationItemRow[], skuOrders: SkuVisualOrders) {
  const codeElement = cell.querySelector<HTMLElement>('.location-code');
  if (!codeElement) return;
  const code = codeElement.textContent?.trim() || '';
  if (!code) return;
  cell.dataset.locationCode = code;

  const locationRows = locationRowsFor(rows, code);
  const itemRows = orderedItemRows(itemRowsFor(rows, code), skuOrders[code.toUpperCase()]);
  const categories = Array.from(new Set(locationRows.map((row) => row.location_category || '').filter(Boolean)));
  const category = categories.join(' / ') || itemRows[0]?.product_name || '';

  let categoryElement = cell.querySelector<HTMLElement>('.slot-category-label');
  if (!categoryElement) {
    categoryElement = document.createElement('span');
    categoryElement.className = 'slot-category-label';
    codeElement.insertAdjacentElement('afterend', categoryElement);
  }
  setText(categoryElement, category || 'Available location');
  categoryElement.classList.toggle('is-placeholder', !category);

  let wrap = cell.querySelector<HTMLElement>('.slot-item-wrap');
  const empty = cell.querySelector<HTMLElement>('.slot-empty');
  if (!itemRows.length) {
    wrap?.remove();
    if (empty) {
      empty.classList.add('slot-empty-label');
      setText(empty, 'Empty');
    }
    return;
  }

  if (!wrap) {
    wrap = document.createElement('span');
    wrap.className = 'slot-item-wrap';
    categoryElement.insertAdjacentElement('afterend', wrap);
  }
  wrap.dataset.locationCode = code;
  wrap.classList.remove('split');
  empty?.remove();

  const signature = JSON.stringify(itemRows.map((row) => [skuVisualKey(row), row.quantity, row.sku_total_quantity, row.unit_level]));
  if (wrap.dataset.signature === signature) return;
  wrap.dataset.signature = signature;
  wrap.replaceChildren();

  itemRows.forEach((row) => {
    const item = document.createElement('span');
    item.className = 'slot-mini';
    item.dataset.skuKey = skuVisualKey(row);
    item.dataset.locationCode = code;
    const sku = document.createElement('b');
    sku.textContent = row.sku || 'SKU pending';
    const quantity = document.createElement('small');
    const here = Number(row.quantity || 0);
    const total = Number(row.sku_total_quantity || row.quantity || 0);
    quantity.textContent = `${here} here · ${total} total`;
    item.append(sku, quantity);
    wrap!.appendChild(item);
  });
}

function removeLegacySkuPositionControls() {
  document.querySelectorAll<HTMLElement>(
    '.warehouse-slot-add, .warehouse-slot-add-primary, .warehouse-level-add-primary, .warehouse-level-add-hint, .slot-placeholder, .slot-more-open',
  ).forEach((element) => element.remove());
}

function ensureEditorHint() {
  const editor = document.querySelector<HTMLElement>('.warehouse-layout-editor');
  if (!editor) return;
  let hint = editor.querySelector<HTMLElement>('.warehouse-sku-order-editor-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'warehouse-sku-order-editor-hint';
    editor.appendChild(hint);
  }
  hint.textContent = 'Drag SKU cards left or right only inside their current location. This changes visual order only—never location assignment, quantity or stock history.';
}

function decorateVisibleRack(rows: WarehouseLocationItemRow[], orders: BinOrders, skuOrders: SkuVisualOrders) {
  removeLegacySkuPositionControls();
  applyVisibleOrder(orders);
  const context = rackContext();
  if (!context) return;
  context.grid.dataset.rackId = context.rackId;
  context.grid.dataset.rackSide = context.side;

  binColumns(context.grid).forEach((column) => {
    const bin = binCode(column);
    column.dataset.binCode = bin;
    column.querySelectorAll<HTMLElement>('.rack-level-row').forEach((levelRow) => {
      const halfRow = levelRow.querySelector<HTMLElement>('.rack-half-row');
      if (!halfRow) return;
      const cells = Array.from(halfRow.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('location-cell'));
      if (!cells.length) return;

      let codeRow = levelRow.querySelector<HTMLElement>(':scope > .rack-half-code-row');
      if (!codeRow) {
        codeRow = document.createElement('div');
        codeRow.className = 'rack-half-code-row';
        halfRow.insertAdjacentElement('beforebegin', codeRow);
      }
      while (codeRow.children.length < 2) codeRow.appendChild(document.createElement('span'));
      const labels = Array.from(codeRow.children).slice(0, 2) as HTMLElement[];
      labels.forEach((label, index) => {
        const fullCode = cells[index]?.querySelector<HTMLElement>('.location-code')?.textContent?.trim() || '';
        setText(label, shortLocationCode(fullCode));
      });

      cells.forEach((cell) => decorateCell(cell, rows, skuOrders));
    });
  });

  if (document.body.classList.contains('warehouse-layout-editing')) ensureEditorHint();
}

async function persistVisualPreferences(binOrders: BinOrders, skuOrders: SkuVisualOrders) {
  const localLayout = mergeVisualPreferences(readStoredLayout(), binOrders, skuOrders);
  writeLocalWarehouseLayout(localLayout);
  if (!supabase) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await loadWarehouseLayout(SITE_CODE);
    const merged = mergeVisualPreferences(row?.layout_json || localLayout, binOrders, skuOrders);
    try {
      const saved = await saveWarehouseLayout({ siteCode: SITE_CODE, layout: merged, expectedVersion: row?.layout_version ?? null });
      writeLocalWarehouseLayout(saved?.layout_json || merged);
      return;
    } catch (error) {
      if (attempt === 1 || !/LAYOUT_VERSION_CONFLICT/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

export function WarehouseMapRackEnhancer() {
  const rowsRef = useRef<WarehouseLocationItemRow[]>([]);
  const initialLayout = readStoredLayout();
  const ordersRef = useRef<BinOrders>(ordersFromLayout(initialLayout));
  const skuOrdersRef = useRef<SkuVisualOrders>(skuVisualOrdersFromLayout(initialLayout));
  const binSnapshotRef = useRef<BinOrders>({});
  const skuSnapshotRef = useRef<SkuVisualOrders>({});
  const editingRef = useRef(false);
  const activeColumnRef = useRef<HTMLElement | null>(null);
  const activeSkuRef = useRef<ActiveSkuDrag | null>(null);

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;

    void loadWarehouseLocationItems()
      .then((rows) => {
        rowsRef.current = rows;
        decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current);
      })
      .catch(() => decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current));

    if (supabase) {
      void loadWarehouseLayout(SITE_CODE).then((row) => {
        if (!row?.layout_json) return;
        ordersRef.current = { ...ordersRef.current, ...ordersFromLayout(row.layout_json) };
        skuOrdersRef.current = { ...skuOrdersRef.current, ...skuVisualOrdersFromLayout(row.layout_json) };
        const merged = mergeVisualPreferences({ ...readStoredLayout(), ...row.layout_json }, ordersRef.current, skuOrdersRef.current);
        writeLocalWarehouseLayout(merged);
        decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current);
      }).catch(() => undefined);
    }

    function synchronise() {
      const editing = document.body.classList.contains('warehouse-layout-editing');
      if (editing && !editingRef.current) {
        binSnapshotRef.current = structuredClone(ordersRef.current);
        skuSnapshotRef.current = structuredClone(skuOrdersRef.current);
      }
      editingRef.current = editing;
      decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current);
    }

    function pointerDown(event: PointerEvent) {
      if (!document.body.classList.contains('warehouse-layout-editing')) return;
      const target = event.target as HTMLElement;
      const skuItem = target.closest<HTMLElement>('.warehouse-rack-card .location-cell .slot-mini[data-sku-key]');
      if (skuItem) {
        const wrap = skuItem.closest<HTMLElement>('.slot-item-wrap');
        const cell = skuItem.closest<HTMLElement>('.location-cell[data-location-code]');
        const locationCode = cell?.dataset.locationCode?.trim().toUpperCase() || '';
        if (!wrap || !locationCode || wrap.querySelectorAll(':scope > .slot-mini[data-sku-key]').length < 2) return;
        event.preventDefault();
        event.stopPropagation();
        activeSkuRef.current = { item: skuItem, wrap, locationCode };
        skuItem.classList.add('sku-visual-dragging');
        wrap.classList.add('sku-order-editing');
        const editorTitle = document.querySelector<HTMLElement>('.warehouse-layout-editor > div:first-child strong');
        if (editorTitle) editorTitle.textContent = `${locationCode} · visual SKU order`;
        skuItem.setPointerCapture?.(event.pointerId);
        return;
      }

      const column = target.closest<HTMLElement>('.warehouse-rack-card .rack-bin-column');
      if (!column) return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll<HTMLElement>('.rack-bin-column').forEach((item) => item.classList.toggle('layout-bin-selected', item === column));
      column.classList.add('bin-dragging');
      activeColumnRef.current = column;
      const context = rackContext();
      const editorTitle = document.querySelector<HTMLElement>('.warehouse-layout-editor > div:first-child strong');
      if (editorTitle && context) editorTitle.textContent = `${context.rackId} · ${context.side} · ${binCode(column)} column`;
      column.setPointerCapture?.(event.pointerId);
    }

    function pointerMove(event: PointerEvent) {
      const activeSku = activeSkuRef.current;
      if (activeSku) {
        event.preventDefault();
        const siblings = Array.from(activeSku.wrap.querySelectorAll<HTMLElement>(':scope > .slot-mini[data-sku-key]'))
          .filter((item) => item !== activeSku.item);
        const before = siblings.find((item) => {
          const rect = item.getBoundingClientRect();
          return event.clientX < rect.left + rect.width / 2;
        });
        if (before) activeSku.wrap.insertBefore(activeSku.item, before);
        else activeSku.wrap.appendChild(activeSku.item);
        return;
      }

      const active = activeColumnRef.current;
      if (!active) return;
      event.preventDefault();
      const grid = active.parentElement as HTMLElement | null;
      if (!grid) return;
      const before = binColumns(grid).filter((column) => column !== active).find((column) => {
        const rect = column.getBoundingClientRect();
        return event.clientX < rect.left + rect.width / 2;
      });
      if (before) grid.insertBefore(active, before);
      else grid.appendChild(active);
    }

    function pointerUp() {
      const activeSku = activeSkuRef.current;
      if (activeSku) {
        activeSku.item.classList.remove('sku-visual-dragging');
        activeSku.wrap.classList.remove('sku-order-editing');
        activeSkuRef.current = null;
        skuOrdersRef.current = captureVisibleSkuOrders(skuOrdersRef.current);
        writeLocalWarehouseLayout(mergeVisualPreferences(readStoredLayout(), ordersRef.current, skuOrdersRef.current));
      }

      const active = activeColumnRef.current;
      if (active) {
        active.classList.remove('bin-dragging');
        activeColumnRef.current = null;
        ordersRef.current = captureVisibleOrder(ordersRef.current);
        writeLocalWarehouseLayout(mergeVisualPreferences(readStoredLayout(), ordersRef.current, skuOrdersRef.current));
      }
    }

    function controls(event: MouseEvent) {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.warehouse-layout-actions button');
      const label = button?.textContent?.trim() || '';
      if (!button) return;
      if (label === 'Cancel') {
        ordersRef.current = structuredClone(binSnapshotRef.current);
        skuOrdersRef.current = structuredClone(skuSnapshotRef.current);
        writeLocalWarehouseLayout(mergeVisualPreferences(readStoredLayout(), ordersRef.current, skuOrdersRef.current));
        window.setTimeout(() => decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current), 0);
      } else if (label === 'Reset to system') {
        ordersRef.current = {};
        skuOrdersRef.current = {};
        naturalVisibleOrder();
        writeLocalWarehouseLayout(mergeVisualPreferences(readStoredLayout(), ordersRef.current, skuOrdersRef.current));
        window.setTimeout(() => decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current), 0);
      } else if (label === 'Save layout' || label === 'Saving…') {
        ordersRef.current = captureVisibleOrder(ordersRef.current);
        skuOrdersRef.current = captureVisibleSkuOrders(skuOrdersRef.current);
        window.setTimeout(() => void persistVisualPreferences(ordersRef.current, skuOrdersRef.current).catch(() => undefined), 450);
      } else if (label === 'Reload cloud' && supabase) {
        window.setTimeout(() => void loadWarehouseLayout(SITE_CODE).then((row) => {
          ordersRef.current = ordersFromLayout(row?.layout_json || {});
          skuOrdersRef.current = skuVisualOrdersFromLayout(row?.layout_json || {});
          writeLocalWarehouseLayout(row?.layout_json || {});
          decorateVisibleRack(rowsRef.current, ordersRef.current, skuOrdersRef.current);
        }), 250);
      }
    }

    const stopObserving = observeBody(synchronise);
    document.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    document.addEventListener('click', controls);
    synchronise();

    return () => {
      stopObserving();
      document.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('click', controls);
    };
  }, []);

  return null;
}
