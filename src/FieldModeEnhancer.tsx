import { useEffect } from 'react';
import {
  loadCustomerOpsQueue,
  loadInventoryLocationSummaries,
  loadWarehouseLocationItems,
  recordCustomerStockDrawdown,
  updateCustomerOpsStatus,
  type CustomerOpsQueueRow,
  type CustomerOpsStatus,
  type InventoryLocationSummaryRow,
  type WarehouseLocationItemRow,
} from '@/data/repositories/warehouseLocations';

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

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTime(value?: string | null) {
  if (!value) return 'not released';
  try { return new Date(value).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return value; }
}

function renderKey(rows: InventoryLocationSummaryRow[] | null, error: string) {
  const targetSku = new URLSearchParams(window.location.search).get('sku') || '';
  const lastUpdate = rows?.map((row) => `${row.sku}:${row.updated_at ?? ''}:${row.total_quantity ?? ''}`).join('|') ?? 'loading';
  return `${targetSku}|${error}|${lastUpdate}`;
}

function warehouseRenderKey(rows: WarehouseLocationItemRow[] | null, error: string) {
  const lastUpdate = rows?.map((row) => `${row.location_code}:${row.sku ?? ''}:${row.quantity ?? ''}:${row.item_updated_at ?? ''}`).join('|') ?? 'loading';
  return `${error}|${lastUpdate}`;
}

function opsQueueRenderKey(rows: CustomerOpsQueueRow[] | null, error: string, mode: string) {
  const body = rows?.map((row) => `${row.id}:${row.ops_status}:${row.updated_at ?? ''}`).join('|') ?? 'loading';
  return `${mode}|${error}|${body}`;
}

function liveStockRows(rows: WarehouseLocationItemRow[] | null) {
  return (rows ?? []).filter((row) => row.item_id && row.sku && numberValue(row.quantity) > 0);
}

function opsStatusLabel(status: CustomerOpsStatus) {
  if (status === 'RELEASED_TO_WAREHOUSE') return 'Released to warehouse';
  if (status === 'PICKED') return 'Picked / ready for driver';
  if (status === 'OUT_FOR_DELIVERY') return 'With driver';
  if (status === 'DELIVERED') return 'Delivered';
  return 'Cancelled';
}

export function FieldModeEnhancer() {
  useEffect(() => {
    let inventoryRows: InventoryLocationSummaryRow[] | null = null;
    let inventoryError = '';
    let inventoryLoading: Promise<void> | null = null;
    let warehouseRows: WarehouseLocationItemRow[] | null = null;
    let warehouseError = '';
    let warehouseLoading: Promise<void> | null = null;
    let opsRows: CustomerOpsQueueRow[] | null = null;
    let opsError = '';
    let opsLoading: Promise<void> | null = null;
    let quickPanelScrolled = false;

    async function reloadOpsQueue() {
      opsRows = await loadCustomerOpsQueue();
      opsError = '';
      document.querySelectorAll<HTMLElement>('.quick-ops-panel').forEach((panel) => { panel.dataset.renderKey = ''; });
    }

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
        button.onclick = () => { window.location.assign('/warehouse-map?quickIssue=1'); };
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
          .then((rows) => { inventoryRows = rows; inventoryError = ''; })
          .catch((error) => { inventoryRows = []; inventoryError = error instanceof Error ? error.message : String(error); })
          .finally(() => { inventoryLoading = null; patchInventoryLocationsPanel(); });
      }
    }

    function renderQuickCustomerPanel(panel: HTMLElement) {
      const nextKey = warehouseRenderKey(warehouseRows, warehouseError);
      if (panel.dataset.renderKey === nextKey) return;
      panel.dataset.renderKey = nextKey;
      panel.textContent = '';

      const head = document.createElement('div');
      head.className = 'warehouse-map-card-head compact-head';
      const title = document.createElement('h2');
      title.textContent = 'Quick customer stock';
      const meta = document.createElement('span');
      meta.textContent = warehouseError ? 'schema pending' : warehouseRows ? 'Choose owner take-away or driver delivery' : 'loading';
      head.append(title, meta);
      panel.appendChild(head);

      if (warehouseError || !warehouseRows) {
        const note = document.createElement('p');
        note.className = 'inventory-live-note';
        note.textContent = warehouseError || 'Loading live stock…';
        panel.appendChild(note);
        return;
      }

      const rows = liveStockRows(warehouseRows);
      if (!rows.length) {
        const note = document.createElement('p');
        note.className = 'inventory-live-note';
        note.textContent = 'No live stock is available for quick customer stock yet.';
        panel.appendChild(note);
        return;
      }

      const modeHint = document.createElement('div');
      modeHint.className = 'quick-customer-mode-hint';
      modeHint.innerHTML = '<b>Owner onsite</b>: no warehouse/driver release. <b>Warehouse + driver</b>: release to staff mobile queue; it does not change normal A–F route labels.';
      panel.appendChild(modeHint);

      const skuMap = new Map<string, WarehouseLocationItemRow[]>();
      rows.forEach((row) => { if (row.sku) skuMap.set(row.sku, [...(skuMap.get(row.sku) ?? []), row]); });
      const skuList = Array.from(skuMap.keys()).sort((a, b) => a.localeCompare(b));
      const form = document.createElement('div');
      form.className = 'quick-customer-grid';

      function labelWrap(label: string, field: HTMLElement) {
        const wrap = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = label;
        wrap.append(span, field);
        return wrap;
      }

      const mode = document.createElement('select');
      const onsiteOption = document.createElement('option');
      onsiteOption.value = 'OWNER_ONSITE';
      onsiteOption.textContent = 'Owner onsite / no release';
      const opsOption = document.createElement('option');
      opsOption.value = 'OPS_DELIVERY';
      opsOption.textContent = 'Warehouse + driver delivery';
      mode.append(onsiteOption, opsOption);
      const customer = document.createElement('input');
      customer.placeholder = 'Store / customer name';
      const reference = document.createElement('input');
      reference.placeholder = 'Optional reference';
      const sku = document.createElement('select');
      skuList.forEach((value) => {
        const option = document.createElement('option');
        const first = skuMap.get(value)?.[0];
        option.value = value;
        option.textContent = `${value} · ${first?.product_name || 'warehouse stock'}`;
        sku.appendChild(option);
      });
      const location = document.createElement('select');
      const qty = document.createElement('input');
      qty.placeholder = 'Qty';
      qty.inputMode = 'numeric';
      qty.value = '1';
      const unit = document.createElement('select');
      ['carton', 'sleeve', 'each', 'unknown'].forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        unit.appendChild(option);
      });
      const deliveryAddress = document.createElement('input');
      deliveryAddress.placeholder = 'Delivery address / route note';
      const driverNote = document.createElement('input');
      driverNote.placeholder = 'Driver instruction';
      const note = document.createElement('input');
      note.placeholder = 'Reason / who approved';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'tactile quick-customer-save';
      save.textContent = 'Save for billing';
      const status = document.createElement('div');
      status.className = 'quick-customer-status';

      function refreshModeFields() {
        const ops = mode.value === 'OPS_DELIVERY';
        deliveryAddress.disabled = !ops;
        driverNote.disabled = !ops;
        deliveryAddress.placeholder = ops ? 'Delivery address / route note' : 'Not needed when owner is onsite';
        driverNote.placeholder = ops ? 'Driver instruction' : 'Not released to driver';
        save.textContent = ops ? 'Release to warehouse + driver' : 'Save owner onsite stock';
      }

      function refreshLocationOptions() {
        const options = (skuMap.get(sku.value) ?? []).filter((row) => numberValue(row.quantity) > 0);
        location.textContent = '';
        options.forEach((row) => {
          const option = document.createElement('option');
          option.value = row.location_code;
          option.textContent = `${row.location_code} · ${numberText(row.quantity)} ${row.unit_level || 'unit'}`;
          location.appendChild(option);
        });
        const first = options[0];
        unit.value = first?.unit_level || 'carton';
      }

      mode.onchange = refreshModeFields;
      sku.onchange = refreshLocationOptions;
      refreshLocationOptions();
      refreshModeFields();

      save.onclick = async () => {
        const selectedRow = (skuMap.get(sku.value) ?? []).find((row) => row.location_code === location.value) ?? skuMap.get(sku.value)?.[0];
        const amount = Number(qty.value);
        const ops = mode.value === 'OPS_DELIVERY';
        if (!customer.value.trim() || !sku.value || !Number.isFinite(amount) || amount <= 0) {
          status.textContent = 'Customer, SKU and positive qty are required.';
          status.className = 'quick-customer-status error';
          return;
        }
        if (ops && !deliveryAddress.value.trim()) {
          status.textContent = 'Delivery address or route note is required when releasing to warehouse/driver.';
          status.className = 'quick-customer-status error';
          return;
        }
        save.setAttribute('disabled', 'true');
        save.textContent = 'Saving…';
        try {
          const result = await recordCustomerStockDrawdown({
            customerName: customer.value.trim(),
            customerReference: reference.value.trim() || undefined,
            sku: sku.value,
            productName: selectedRow?.product_name || undefined,
            barcode: selectedRow?.source_barcode || undefined,
            quantity: amount,
            unitLevel: unit.value as 'carton' | 'sleeve' | 'each' | 'unknown',
            locationCode: location.value || undefined,
            note: note.value.trim() || undefined,
            fulfilmentMode: mode.value as 'OWNER_ONSITE' | 'OPS_DELIVERY',
            deliveryAddress: ops ? deliveryAddress.value.trim() : undefined,
            driverNote: ops ? driverNote.value.trim() || undefined : undefined,
          });
          const tag = ops ? 'RELEASED_TO_WAREHOUSE · TO_BILL' : 'NOT_RELEASED · TO_BILL';
          status.textContent = result.length ? `Saved ${result[0].issue_no} · ${amount} ${unit.value} · ${customer.value.trim()} · ${tag}` : `Saved · ${tag}`;
          status.className = 'quick-customer-status ok';
          qty.value = '1';
          note.value = '';
          deliveryAddress.value = '';
          driverNote.value = '';
          warehouseRows = await loadWarehouseLocationItems();
          if (ops) await reloadOpsQueue();
          panel.dataset.renderKey = '';
          renderQuickCustomerPanel(panel);
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
          status.className = 'quick-customer-status error';
        } finally {
          save.removeAttribute('disabled');
          refreshModeFields();
        }
      };

      form.append(labelWrap('Mode', mode), labelWrap('Customer', customer), labelWrap('Reference', reference), labelWrap('SKU', sku), labelWrap('Location', location), labelWrap('Qty', qty), labelWrap('Unit', unit), labelWrap('Delivery address', deliveryAddress), labelWrap('Driver note', driverNote), labelWrap('Note', note), save);
      panel.append(form, status);
    }

    function renderOpsQueuePanel(panel: HTMLElement, mode: 'warehouse' | 'driver') {
      const nextKey = opsQueueRenderKey(opsRows, opsError, mode);
      if (panel.dataset.renderKey === nextKey) return;
      panel.dataset.renderKey = nextKey;
      panel.textContent = '';

      const head = document.createElement('div');
      head.className = 'driver-card-head quick-ops-head';
      const title = document.createElement('h2');
      title.textContent = mode === 'warehouse' ? 'Quick customer handoff' : 'Quick deliveries';
      const meta = document.createElement('span');
      meta.textContent = opsError ? 'schema pending' : opsRows ? `${opsRows.length} open` : 'loading';
      head.append(title, meta);
      panel.appendChild(head);

      const hint = document.createElement('p');
      hint.className = 'driver-card-meta quick-ops-policy';
      hint.textContent = 'Sorting rule: normal Ordermentum stops and A–F labels stay unchanged. Quick items use QI number only; driver handles them as separate add-ons after/around the normal run.';
      panel.appendChild(hint);

      if (opsError || !opsRows) {
        const note = document.createElement('div');
        note.className = 'driver-inline-hint';
        note.textContent = opsError || 'Loading quick customer stock queue…';
        panel.appendChild(note);
        return;
      }
      if (!opsRows.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No released quick customer stock tasks.';
        panel.appendChild(empty);
        return;
      }

      const list = document.createElement('div');
      list.className = 'quick-ops-list';
      opsRows.forEach((row) => {
        const card = document.createElement('article');
        card.className = `quick-ops-row quick-ops-${row.ops_status.toLowerCase()}`;
        const copy = document.createElement('div');
        copy.className = 'quick-ops-copy';
        const titleLine = document.createElement('strong');
        titleLine.textContent = `${row.issue_no} · ${row.customer_name}`;
        const skuLine = document.createElement('span');
        skuLine.textContent = `${row.quantity} ${row.unit_level} · ${row.sku}${row.product_name ? ` · ${row.product_name}` : ''}`;
        const detail = document.createElement('small');
        detail.textContent = `${row.location_code || 'no location'} · ${opsStatusLabel(row.ops_status)} · released ${formatTime(row.released_at)}`;
        const address = document.createElement('small');
        address.textContent = row.delivery_address ? `Deliver: ${row.delivery_address}` : 'No delivery address on record';
        const note = document.createElement('small');
        note.textContent = [row.driver_note, row.note].filter(Boolean).join(' · ') || 'No driver note';
        copy.append(titleLine, skuLine, detail, address, note);

        const actions = document.createElement('div');
        actions.className = 'quick-ops-actions';
        const chip = document.createElement('span');
        chip.className = 'quick-ops-label-chip';
        chip.textContent = 'NO A–F LABEL · USE QI';
        actions.appendChild(chip);

        function addAction(label: string, next: CustomerOpsStatus, actionNote: string) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'driver-ghost-button quick-ops-action';
          button.textContent = label;
          button.onclick = async () => {
            button.setAttribute('disabled', 'true');
            button.textContent = 'Saving…';
            try {
              await updateCustomerOpsStatus({ issueId: row.id, opsStatus: next, note: actionNote });
              await reloadOpsQueue();
              panel.dataset.renderKey = '';
              renderOpsQueuePanel(panel, mode);
            } catch (error) {
              button.textContent = error instanceof Error ? error.message : 'Failed';
              button.classList.add('quick-ops-action-error');
            }
          };
          actions.appendChild(button);
        }

        if (mode === 'warehouse' && row.ops_status === 'RELEASED_TO_WAREHOUSE') addAction('Picked for driver', 'PICKED', 'Warehouse picked quick customer stock');
        if (mode === 'driver' && row.ops_status === 'PICKED') addAction('Take on run', 'OUT_FOR_DELIVERY', 'Driver took quick customer stock');
        if (mode === 'driver' && row.ops_status === 'OUT_FOR_DELIVERY') addAction('Delivered', 'DELIVERED', 'Driver completed quick customer stock delivery');
        if (mode === 'driver' && row.ops_status === 'RELEASED_TO_WAREHOUSE') {
          const wait = document.createElement('span');
          wait.className = 'quick-ops-waiting';
          wait.textContent = 'Waiting for warehouse pick';
          actions.appendChild(wait);
        }

        card.append(copy, actions);
        list.appendChild(card);
      });
      panel.appendChild(list);
    }

    function ensureOpsData(afterLoad: () => void) {
      if (opsRows || opsError) return;
      if (!opsLoading) {
        opsLoading = loadCustomerOpsQueue()
          .then((rows) => { opsRows = rows; opsError = ''; })
          .catch((error) => { opsRows = []; opsError = error instanceof Error ? error.message : String(error); })
          .finally(() => { opsLoading = null; afterLoad(); });
      }
    }

    function patchWarehouseMobileOpsPanel() {
      const title = document.querySelector<HTMLElement>('.mobile-title h1');
      if (title?.textContent?.trim() !== 'Warehouse') return;
      const host = document.querySelector<HTMLElement>('.mobile-content');
      const tabs = document.querySelector<HTMLElement>('.mobile-tabs');
      if (!host || !tabs) return;
      let panel = document.querySelector<HTMLElement>('.warehouse-mobile-quick-ops-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'mobile-card quick-ops-panel warehouse-mobile-quick-ops-panel';
        tabs.insertAdjacentElement('afterend', panel);
      }
      renderOpsQueuePanel(panel, 'warehouse');
      ensureOpsData(patchWarehouseMobileOpsPanel);
    }

    function patchDriverMobileOpsPanel() {
      const content = document.querySelector<HTMLElement>('.driver-content');
      if (!content) return;
      let panel = document.querySelector<HTMLElement>('.driver-mobile-quick-ops-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'driver-card quick-ops-panel driver-mobile-quick-ops-panel';
        content.insertAdjacentElement('afterbegin', panel);
      }
      renderOpsQueuePanel(panel, 'driver');
      ensureOpsData(patchDriverMobileOpsPanel);
    }

    function patchQuickCustomerStockPanel() {
      const page = document.querySelector<HTMLElement>('.warehouse-map-page');
      if (!page) return;
      let panel = document.querySelector<HTMLElement>('.quick-customer-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'warehouse-map-card quick-customer-panel';
        const bottomGrid = page.querySelector<HTMLElement>('.warehouse-bottom-grid');
        bottomGrid?.insertAdjacentElement('afterend', panel) ?? page.appendChild(panel);
      }
      renderQuickCustomerPanel(panel);
      if (!quickPanelScrolled && new URLSearchParams(window.location.search).get('quickIssue') === '1') {
        quickPanelScrolled = true;
        window.setTimeout(() => panel?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 140);
      }
      if (!warehouseRows && !warehouseLoading) {
        warehouseLoading = loadWarehouseLocationItems()
          .then((rows) => { warehouseRows = rows; warehouseError = ''; })
          .catch((error) => { warehouseRows = []; warehouseError = error instanceof Error ? error.message : String(error); })
          .finally(() => { warehouseLoading = null; patchQuickCustomerStockPanel(); });
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
      row.appendChild(asButtonLink('Quick customer stock', '/warehouse-map?quickIssue=1', 'inventory-map-link secondary'));
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
      patchQuickCustomerStockPanel();
      patchWarehouseMobileOpsPanel();
      patchDriverMobileOpsPanel();
      patchCompletedLabels();
    }

    patchAll();
    const observer = new MutationObserver(patchAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
