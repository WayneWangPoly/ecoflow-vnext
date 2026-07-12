import { useEffect, useRef } from 'react';
import { observeBody } from '@/lib/domObserver';
import { loadWarehouseLayout, saveWarehouseLayout, type WarehouseLayoutBox, type WarehouseLayoutState } from '@/data/repositories/warehouseLayout';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'ecoflow-warehouse-layout-v1';
const SITE_CODE = 'SITE-01';
const BIN_PREFIX = 'bin-order:';

type BinOrders = Record<string, string[]>;
type LayoutOrderBox = WarehouseLayoutBox & { binOrder?: string[] };

type RackContext = {
  card: HTMLElement;
  grid: HTMLElement;
  rackId: string;
  side: string;
};

function readStoredLayout(): WarehouseLayoutState {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as WarehouseLayoutState;
  } catch {
    return {};
  }
}

function rackContext(): RackContext | null {
  const card = document.querySelector<HTMLElement>('.warehouse-rack-card');
  const grid = card?.querySelector<HTMLElement>('.rack-bin-grid');
  const rackId = card?.querySelector<HTMLElement>('.warehouse-map-card-head h2')?.textContent?.trim().toUpperCase() || '';
  const activeSide = card?.querySelector<HTMLButtonElement>('.rack-side-buttons button.active')?.textContent?.trim().toLowerCase();
  const side = activeSide === 'left' || activeSide === 'right' ? activeSide : 'front';
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

function applyVisibleOrder(orders: BinOrders) {
  const context = rackContext();
  if (!context) return;
  const requested = orders[orderKey(context.rackId, context.side)];
  if (!requested?.length) return;

  const currentColumns = binColumns(context.grid);
  const currentOrder = currentColumns.map(binCode);
  const available = new Set(currentOrder);
  const desiredOrder = [
    ...requested.map((bin) => bin.toUpperCase()).filter((bin) => available.has(bin)),
    ...currentOrder.filter((bin) => !requested.map((item) => item.toUpperCase()).includes(bin)),
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
  const next = { ...orders };
  next[orderKey(context.rackId, context.side)] = binColumns(context.grid).map(binCode).filter(Boolean);
  return next;
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

function decorateCell(cell: HTMLElement, rows: WarehouseLocationItemRow[]) {
  const codeElement = cell.querySelector<HTMLElement>('.location-code');
  if (!codeElement) return;
  const code = codeElement.textContent?.trim() || '';
  if (!code) return;
  if (cell.dataset.locationCode !== code) cell.dataset.locationCode = code;

  const locationRows = locationRowsFor(rows, code);
  const itemRows = itemRowsFor(rows, code);
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
  wrap.classList.remove('split');
  empty?.remove();

  const signature = JSON.stringify(itemRows.map((row) => [row.sku, row.quantity, row.sku_total_quantity, row.unit_level]));
  if (wrap.dataset.signature === signature) return;
  wrap.dataset.signature = signature;
  wrap.replaceChildren();

  itemRows.slice(0, 3).forEach((row) => {
    const item = document.createElement('span');
    item.className = 'slot-mini';
    const sku = document.createElement('b');
    sku.textContent = row.sku || 'SKU pending';
    const quantity = document.createElement('small');
    const here = Number(row.quantity || 0);
    const total = Number(row.sku_total_quantity || row.quantity || 0);
    quantity.textContent = `${here} here · ${total} total`;
    item.append(sku, quantity);
    wrap!.appendChild(item);
  });

  if (itemRows.length > 3) {
    const more = document.createElement('span');
    more.className = 'slot-more-items';
    more.textContent = `+${itemRows.length - 3} more SKU${itemRows.length - 3 === 1 ? '' : 's'}`;
    wrap.appendChild(more);
  }
}

function ensureAddButton(halfRow: HTMLElement, cell: HTMLElement) {
  let addButton = cell.nextElementSibling as HTMLButtonElement | null;
  if (!addButton?.classList.contains('warehouse-slot-add')) {
    addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'warehouse-slot-add';
    addButton.textContent = '+';
    cell.insertAdjacentElement('afterend', addButton);
  }
  const code = cell.querySelector<HTMLElement>('.location-code')?.textContent?.trim() || 'location';
  const title = `Select ${code} to add another SKU`;
  if (addButton.title !== title) addButton.title = title;
  if (addButton.getAttribute('aria-label') !== title) addButton.setAttribute('aria-label', title);
  addButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    cell.click();
  };
  halfRow.classList.add('warehouse-slot-row');
}

function decorateVisibleRack(rows: WarehouseLocationItemRow[], orders: BinOrders) {
  applyVisibleOrder(orders);
  const context = rackContext();
  if (!context) return;
  if (context.grid.dataset.rackId !== context.rackId) context.grid.dataset.rackId = context.rackId;
  if (context.grid.dataset.rackSide !== context.side) context.grid.dataset.rackSide = context.side;

  binColumns(context.grid).forEach((column) => {
    const bin = binCode(column);
    if (column.dataset.binCode !== bin) column.dataset.binCode = bin;
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

      cells.forEach((cell) => {
        decorateCell(cell, rows);
        ensureAddButton(halfRow, cell);
      });
    });
  });
}

async function persistOrders(orders: BinOrders) {
  const localLayout = mergeOrders(readStoredLayout(), orders);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(localLayout));
  if (!supabase) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await loadWarehouseLayout(SITE_CODE);
    const merged = mergeOrders(row?.layout_json || localLayout, orders);
    try {
      const saved = await saveWarehouseLayout({ siteCode: SITE_CODE, layout: merged, expectedVersion: row?.layout_version ?? null });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved?.layout_json || merged));
      return;
    } catch (error) {
      if (attempt === 1 || !/LAYOUT_VERSION_CONFLICT/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

export function WarehouseMapRackEnhancer() {
  const rowsRef = useRef<WarehouseLocationItemRow[]>([]);
  const ordersRef = useRef<BinOrders>(ordersFromLayout(readStoredLayout()));
  const snapshotRef = useRef<BinOrders>({});
  const editingRef = useRef(false);
  const activeColumnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (window.location.pathname !== '/warehouse-map') return;

    void loadWarehouseLocationItems()
      .then((rows) => {
        rowsRef.current = rows;
        decorateVisibleRack(rowsRef.current, ordersRef.current);
      })
      .catch(() => decorateVisibleRack(rowsRef.current, ordersRef.current));

    if (supabase) {
      void loadWarehouseLayout(SITE_CODE).then((row) => {
        if (!row?.layout_json) return;
        ordersRef.current = { ...ordersRef.current, ...ordersFromLayout(row.layout_json) };
        const merged = mergeOrders(readStoredLayout(), ordersRef.current);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        decorateVisibleRack(rowsRef.current, ordersRef.current);
      }).catch(() => undefined);
    }

    function synchronise() {
      const editing = document.body.classList.contains('warehouse-layout-editing');
      if (editing && !editingRef.current) snapshotRef.current = structuredClone(ordersRef.current);
      editingRef.current = editing;
      decorateVisibleRack(rowsRef.current, ordersRef.current);
    }

    function pointerDown(event: PointerEvent) {
      if (!document.body.classList.contains('warehouse-layout-editing')) return;
      const column = (event.target as HTMLElement).closest<HTMLElement>('.warehouse-rack-card .rack-bin-column');
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
      const active = activeColumnRef.current;
      if (!active) return;
      active.classList.remove('bin-dragging');
      activeColumnRef.current = null;
      ordersRef.current = captureVisibleOrder(ordersRef.current);
      const merged = mergeOrders(readStoredLayout(), ordersRef.current);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }

    function controls(event: MouseEvent) {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.warehouse-layout-actions button');
      const label = button?.textContent?.trim() || '';
      if (!button) return;
      if (label === 'Cancel') {
        ordersRef.current = structuredClone(snapshotRef.current);
        const merged = mergeOrders(readStoredLayout(), ordersRef.current);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        window.setTimeout(() => decorateVisibleRack(rowsRef.current, ordersRef.current), 0);
      } else if (label === 'Reset to system') {
        ordersRef.current = {};
        naturalVisibleOrder();
        const merged = mergeOrders(readStoredLayout(), ordersRef.current);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } else if (label === 'Save layout' || label === 'Saving…') {
        ordersRef.current = captureVisibleOrder(ordersRef.current);
        window.setTimeout(() => void persistOrders(ordersRef.current).catch(() => undefined), 450);
      } else if (label === 'Reload cloud' && supabase) {
        window.setTimeout(() => void loadWarehouseLayout(SITE_CODE).then((row) => {
          ordersRef.current = ordersFromLayout(row?.layout_json || {});
          decorateVisibleRack(rowsRef.current, ordersRef.current);
        }), 250);
      }
    }

    const stopObserving = observeBody(synchronise);
    document.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    document.addEventListener('click', controls);
    synchronise();

    return () => {
      stopObserving();
      document.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('click', controls);
    };
  }, []);

  return null;
}
