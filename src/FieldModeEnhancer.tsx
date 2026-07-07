import { useEffect } from 'react';
import { loadInventoryLocationSummaries, type InventoryLocationSummaryRow } from '@/data/repositories/warehouseLocations';

function asButtonLink(label: string, href: string, className = 'inventory-map-link') {
  const link = document.createElement('a');
  link.href = href;
  link.className = className;
  link.textContent = label;
  return link;
}

function mapUrlForLocation(location: string | null | undefined) {
  return location ? `/warehouse-map?location=${encodeURIComponent(location)}` : '/warehouse-map';
}

function mapUrlForSku(sku: string) {
  return `/warehouse-map?sku=${encodeURIComponent(sku)}`;
}

function numberText(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '0';
}

function renderKey(rows: InventoryLocationSummaryRow[] | null, error: string) {
  const targetSku = new URLSearchParams(window.location.search).get('sku') || '';
  const lastUpdate = rows?.map((row) => `${row.sku}:${row.updated_at ?? ''}:${row.total_quantity ?? ''}`).join('|') ?? 'loading';
  return `${targetSku}|${error}|${lastUpdate}`;
}

export function FieldModeEnhancer() {
  useEffect(() => {
    let inventoryRows: InventoryLocationSummaryRow[] | null = null;
    let inventoryError = '';
    let inventoryLoading: Promise<void> | null = null;

    function openRequestedInventoryTab() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') !== 'inventory') return;
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button')).find((item) => item.textContent?.trim().toLowerCase() === 'inventory');
      if (button && !button.classList.contains('active')) button.click();
    }

    function patchWarehouseReceiveCard() {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.mobile-card'));
      cards.forEach((card) => {
        const title = card.querySelector('h2')?.textContent?.trim();
        if (title !== 'Inbound receiving') return;
        const button = card.querySelector<HTMLButtonElement>('button.primary-button');
        if (!button) return;
        button.textContent = 'Open map';
        button.onclick = () => {
          window.location.assign('/warehouse-map');
        };
      });
    }

    function renderInventoryPanel(panel: HTMLElement) {
      const nextKey = renderKey(inventoryRows, inventoryError);
      if (panel.dataset.renderKey === nextKey) return;
      panel.dataset.renderKey = nextKey;
      panel.textContent = '';

      const head = document.createElement('div');
      head.className = 'panel-head';
      const title = document.createElement('h2');
      title.textContent = 'Live warehouse locations';
      const meta = document.createElement('span');
      meta.textContent = inventoryError ? 'schema pending' : inventoryRows ? `${inventoryRows.length} SKU rows` : 'loading';
      head.append(title, meta);
      panel.appendChild(head);

      if (inventoryError || !inventoryRows || !inventoryRows.length) {
        const note = document.createElement('p');
        note.className = 'inventory-live-note';
        note.textContent = inventoryError || 'No live warehouse stock has been received yet.';
        panel.appendChild(note);
        return;
      }

      const targetSku = new URLSearchParams(window.location.search).get('sku')?.trim().toLowerCase() || '';
      const table = document.createElement('div');
      table.className = 'table-like inventory-live-table';
      const header = document.createElement('div');
      header.className = 'table-head';
      ['SKU', 'Current location', 'Qty', 'Barcodes', 'Action'].forEach((label) => {
        const cell = document.createElement('span');
        cell.textContent = label;
        header.appendChild(cell);
      });
      table.appendChild(header);

      inventoryRows.slice(0, 40).forEach((row) => {
        const item = document.createElement('div');
        item.className = 'table-row inventory-location-row';
        item.dataset.sku = row.sku;
        if (targetSku && row.sku.toLowerCase() === targetSku) item.classList.add('target-sku');

        const skuCell = document.createElement('span');
        const sku = document.createElement('strong');
        sku.textContent = row.sku;
        const name = document.createElement('small');
        name.textContent = row.product_name || 'warehouse stock';
        skuCell.append(sku, name);

        const locationCell = document.createElement('span');
        const locationLink = asButtonLink(row.current_locations || row.primary_location || 'no location', mapUrlForLocation(row.primary_location), 'inventory-location-map-link');
        const fixed = document.createElement('small');
        fixed.textContent = row.fixed_shelf ? `Fixed shelf ${row.fixed_shelf}` : 'fixed shelf pending';
        locationCell.append(locationLink, fixed);

        const qtyCell = document.createElement('span');
        qtyCell.textContent = numberText(row.total_quantity);
        const barcodeCell = document.createElement('span');
        barcodeCell.textContent = row.barcodes || '—';
        const actionCell = document.createElement('span');
        actionCell.className = 'row-actions';
        actionCell.appendChild(asButtonLink('Map', mapUrlForSku(row.sku), 'inventory-map-link secondary'));

        item.append(skuCell, locationCell, qtyCell, barcodeCell, actionCell);
        table.appendChild(item);
      });

      panel.appendChild(table);
      const target = table.querySelector<HTMLElement>('.target-sku');
      window.setTimeout(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
    }

    function patchInventoryLocationsPanel() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2, h1')).find((item) => item.textContent?.trim().toLowerCase().includes('inventory'));
      if (!heading) return;
      const host = heading.closest<HTMLElement>('.panel') || heading.closest<HTMLElement>('.desktop-content');
      if (!host) return;
      let panel = document.querySelector<HTMLElement>('.inventory-live-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'panel inventory-live-panel';
        host.insertAdjacentElement('afterend', panel);
      }
      renderInventoryPanel(panel);
      if (!inventoryRows && !inventoryLoading) {
        inventoryLoading = loadInventoryLocationSummaries()
          .then((rows) => {
            inventoryRows = rows;
            inventoryError = '';
          })
          .catch((error) => {
            inventoryRows = [];
            inventoryError = error instanceof Error ? error.message : String(error);
          })
          .finally(() => {
            inventoryLoading = null;
            patchInventoryLocationsPanel();
          });
      }
    }

    function patchInventoryMapEntry() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2, h1')).find((item) => item.textContent?.trim().toLowerCase().includes('inventory'));
      if (!heading) return;
      const panel = heading.closest<HTMLElement>('.panel, .desktop-content, section, main');
      if (!panel || panel.querySelector('.inventory-map-action-row')) return;
      const row = document.createElement('div');
      row.className = 'inventory-map-action-row';
      row.appendChild(asButtonLink('Open warehouse map', '/warehouse-map'));
      const insertionPoint = heading.closest<HTMLElement>('.panel-head') || heading;
      insertionPoint.insertAdjacentElement('afterend', row);
    }

    function patchCompletedLabels() {
      Array.from(document.querySelectorAll<HTMLElement>('.pill')).forEach((pill) => {
        const text = pill.textContent?.trim().toUpperCase();
        if (text === 'CLOSED' || text === 'DELIVERED') {
          pill.textContent = 'COMPLETED';
          pill.classList.add('pill-good');
        }
      });
    }

    function patchAll() {
      openRequestedInventoryTab();
      patchWarehouseReceiveCard();
      patchInventoryMapEntry();
      patchInventoryLocationsPanel();
      patchCompletedLabels();
    }

    patchAll();
    const observer = new MutationObserver(patchAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
