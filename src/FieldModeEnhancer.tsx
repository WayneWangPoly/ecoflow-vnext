import { useEffect } from 'react';
import { loadOrderLifecycleBoard, type OrderLifecycleRow, type OrderLifecycleStatus } from '@/data/repositories/orderLifecycle';
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

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberText(value: unknown) {
  return String(numberValue(value, 0));
}

function normalise(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function mapUrlForLocation(location: string | null | undefined) {
  return location ? `/warehouse-map?location=${encodeURIComponent(location)}` : '/warehouse-map';
}

function mapUrlForSku(sku: string) {
  return `/warehouse-map?sku=${encodeURIComponent(sku)}`;
}

function shortTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function moneyText(value: unknown) {
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }) : '—';
}

function liveStockRows(rows: WarehouseLocationItemRow[] | null) {
  return (rows ?? []).filter((row) => row.item_id && row.sku && numberValue(row.quantity) > 0);
}

function lifecycleLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function lifecycleTone(status: string) {
  if (status === 'COMPLETED' || status === 'READY_TO_INTERNALISE') return 'good';
  if (status === 'BLOCKED_DATA' || status === 'BLOCKED_MAPPING') return 'danger';
  if (status === 'PICKING' || status === 'STAGED') return 'blue';
  return 'warn';
}

function pill(label: string, tone = 'neutral', className = '') {
  const el = document.createElement('span');
  el.className = `pill pill-${tone} ${className}`.trim();
  el.textContent = label;
  return el;
}

function lifecycleIds(row: OrderLifecycleRow) {
  return [row.order_number, row.invoice_number, row.external_order_id, row.lifecycle_id].map(normalise).filter(Boolean);
}

function findLifecycle(rows: OrderLifecycleRow[] | null, text: string) {
  const haystack = normalise(text);
  if (!rows || !haystack) return null;
  return rows.find((row) => lifecycleIds(row).some((id) => id.length >= 3 && haystack.includes(id))) || null;
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
    let warehouseRows: WarehouseLocationItemRow[] | null = null;
    let opsRows: CustomerOpsQueueRow[] | null = null;
    let lifecycleRows: OrderLifecycleRow[] | null = null;
    let inventoryError = '';
    let warehouseError = '';
    let opsError = '';
    let lifecycleError = '';
    let inventoryLoading: Promise<void> | null = null;
    let warehouseLoading: Promise<void> | null = null;
    let opsLoading: Promise<void> | null = null;
    let lifecycleLoading: Promise<void> | null = null;
    let quickPanelScrolled = false;

    function clearPanelKeys(selector: string) {
      document.querySelectorAll<HTMLElement>(selector).forEach((panel) => { panel.dataset.renderKey = ''; });
    }

    async function reloadOpsQueue() {
      opsRows = await loadCustomerOpsQueue();
      opsError = '';
      clearPanelKeys('.quick-ops-panel');
    }

    function ensureInventory(after: () => void) {
      if (inventoryRows || inventoryError || inventoryLoading) return;
      inventoryLoading = loadInventoryLocationSummaries()
        .then((rows) => { inventoryRows = rows; inventoryError = ''; })
        .catch((error) => { inventoryRows = []; inventoryError = error instanceof Error ? error.message : String(error); })
        .finally(() => { inventoryLoading = null; after(); });
    }

    function ensureWarehouse(after: () => void) {
      if (warehouseRows || warehouseError || warehouseLoading) return;
      warehouseLoading = loadWarehouseLocationItems()
        .then((rows) => { warehouseRows = rows; warehouseError = ''; })
        .catch((error) => { warehouseRows = []; warehouseError = error instanceof Error ? error.message : String(error); })
        .finally(() => { warehouseLoading = null; after(); });
    }

    function ensureOps(after: () => void) {
      if (opsRows || opsError || opsLoading) return;
      opsLoading = loadCustomerOpsQueue()
        .then((rows) => { opsRows = rows; opsError = ''; })
        .catch((error) => { opsRows = []; opsError = error instanceof Error ? error.message : String(error); })
        .finally(() => { opsLoading = null; after(); });
    }

    function ensureLifecycle(after: () => void) {
      if (lifecycleRows || lifecycleError || lifecycleLoading) return;
      lifecycleLoading = loadOrderLifecycleBoard()
        .then((rows) => { lifecycleRows = rows; lifecycleError = ''; })
        .catch((error) => { lifecycleRows = []; lifecycleError = error instanceof Error ? error.message : String(error); })
        .finally(() => { lifecycleLoading = null; after(); });
    }

    function openRequestedInventoryTab() {
      if (new URLSearchParams(window.location.search).get('tab') !== 'inventory') return;
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button')).find((item) => item.textContent?.trim().toLowerCase() === 'inventory');
      if (button && !button.classList.contains('active')) button.click();
    }

    function renderInventoryPanel(panel: HTMLElement) {
      const key = `${inventoryError}|${inventoryRows?.map((row) => `${row.sku}:${row.total_quantity}:${row.updated_at}`).join('|') ?? 'loading'}`;
      if (panel.dataset.renderKey === key) return;
      panel.dataset.renderKey = key;
      panel.textContent = '';
      const head = document.createElement('div');
      head.className = 'panel-head';
      const h2 = document.createElement('h2');
      h2.textContent = 'Live warehouse locations';
      const meta = document.createElement('span');
      meta.textContent = inventoryError ? 'schema pending' : inventoryRows ? `${inventoryRows.length} SKU rows` : 'loading';
      head.append(h2, meta);
      panel.appendChild(head);
      if (inventoryError || !inventoryRows?.length) {
        const note = document.createElement('p');
        note.className = 'inventory-live-note';
        note.textContent = inventoryError || 'No live warehouse stock has been received yet.';
        panel.appendChild(note);
        return;
      }
      const table = document.createElement('div');
      table.className = 'table-like inventory-live-table';
      const header = document.createElement('div');
      header.className = 'table-head';
      ['SKU', 'Current location', 'Qty', 'Barcodes', 'Action'].forEach((label) => { const span = document.createElement('span'); span.textContent = label; header.appendChild(span); });
      table.appendChild(header);
      const targetSku = normalise(new URLSearchParams(window.location.search).get('sku'));
      inventoryRows.slice(0, 40).forEach((row) => {
        const item = document.createElement('div');
        item.className = `table-row inventory-location-row ${targetSku && normalise(row.sku) === targetSku ? 'target-sku' : ''}`;
        const sku = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = row.sku;
        const small = document.createElement('small');
        small.textContent = row.product_name || 'warehouse stock';
        sku.append(strong, small);
        const location = document.createElement('span');
        location.append(asButtonLink(row.current_locations || row.primary_location || 'no location', mapUrlForLocation(row.primary_location), 'inventory-location-map-link'));
        const fixed = document.createElement('small');
        fixed.textContent = row.fixed_shelf ? `Fixed shelf ${row.fixed_shelf}` : 'fixed shelf pending';
        location.appendChild(fixed);
        const qty = document.createElement('span');
        qty.textContent = numberText(row.total_quantity);
        const barcode = document.createElement('span');
        barcode.textContent = row.barcodes || '—';
        const action = document.createElement('span');
        action.className = 'row-actions';
        action.appendChild(asButtonLink('Map', mapUrlForSku(row.sku), 'inventory-map-link secondary'));
        item.append(sku, location, qty, barcode, action);
        table.appendChild(item);
      });
      panel.appendChild(table);
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
      ensureInventory(patchInventoryLocationsPanel);
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
      (heading.closest<HTMLElement>('.panel-head') || heading).insertAdjacentElement('afterend', row);
    }

    function renderQuickCustomerPanel(panel: HTMLElement) {
      const key = `${warehouseError}|${warehouseRows?.map((row) => `${row.location_code}:${row.sku}:${row.quantity}:${row.item_updated_at}`).join('|') ?? 'loading'}`;
      if (panel.dataset.renderKey === key) return;
      panel.dataset.renderKey = key;
      panel.textContent = '';
      const head = document.createElement('div');
      head.className = 'warehouse-map-card-head compact-head';
      const h2 = document.createElement('h2');
      h2.textContent = 'Quick customer stock';
      const meta = document.createElement('span');
      meta.textContent = warehouseError ? 'schema pending' : warehouseRows ? 'Choose owner take-away or driver delivery' : 'loading';
      head.append(h2, meta);
      panel.appendChild(head);
      if (warehouseError || !warehouseRows) {
        const note = document.createElement('p');
        note.className = 'inventory-live-note';
        note.textContent = warehouseError || 'Loading live stock…';
        panel.appendChild(note);
        return;
      }
      const rows = liveStockRows(warehouseRows);
      if (!rows.length) { const note = document.createElement('p'); note.className = 'inventory-live-note'; note.textContent = 'No live stock is available for quick customer stock yet.'; panel.appendChild(note); return; }
      const hint = document.createElement('div');
      hint.className = 'quick-customer-mode-hint';
      hint.innerHTML = '<b>Owner onsite</b>: no warehouse/driver release. <b>Warehouse + driver</b>: release to staff mobile queue; it does not change normal A–F route labels.';
      panel.appendChild(hint);
      const skuMap = new Map<string, WarehouseLocationItemRow[]>();
      rows.forEach((row) => { if (row.sku) skuMap.set(row.sku, [...(skuMap.get(row.sku) ?? []), row]); });
      const skuList = Array.from(skuMap.keys()).sort((a, b) => a.localeCompare(b));
      const form = document.createElement('div');
      form.className = 'quick-customer-grid';
      const wrap = (label: string, field: HTMLElement) => { const el = document.createElement('label'); const span = document.createElement('span'); span.textContent = label; el.append(span, field); return el; };
      const mode = document.createElement('select');
      [['OWNER_ONSITE', 'Owner onsite / no release'], ['OPS_DELIVERY', 'Warehouse + driver delivery']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; mode.appendChild(option); });
      const customer = document.createElement('input'); customer.placeholder = 'Store / customer name';
      const reference = document.createElement('input'); reference.placeholder = 'Optional reference';
      const sku = document.createElement('select');
      skuList.forEach((value) => { const option = document.createElement('option'); const first = skuMap.get(value)?.[0]; option.value = value; option.textContent = `${value} · ${first?.product_name || 'warehouse stock'}`; sku.appendChild(option); });
      const location = document.createElement('select');
      const qty = document.createElement('input'); qty.placeholder = 'Qty'; qty.inputMode = 'numeric'; qty.value = '1';
      const unit = document.createElement('select');
      ['carton', 'sleeve', 'each', 'unknown'].forEach((value) => { const option = document.createElement('option'); option.value = value; option.textContent = value; unit.appendChild(option); });
      const deliveryAddress = document.createElement('input'); deliveryAddress.placeholder = 'Delivery address / route note';
      const driverNote = document.createElement('input'); driverNote.placeholder = 'Driver instruction';
      const note = document.createElement('input'); note.placeholder = 'Reason / who approved';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'tactile quick-customer-save';
      const status = document.createElement('div'); status.className = 'quick-customer-status';
      function refreshMode() { const ops = mode.value === 'OPS_DELIVERY'; deliveryAddress.disabled = !ops; driverNote.disabled = !ops; save.textContent = ops ? 'Release to warehouse + driver' : 'Save owner onsite stock'; }
      function refreshLocations() { const options = (skuMap.get(sku.value) ?? []).filter((row) => numberValue(row.quantity) > 0); location.textContent = ''; options.forEach((row) => { const option = document.createElement('option'); option.value = row.location_code; option.textContent = `${row.location_code} · ${numberText(row.quantity)} ${row.unit_level || 'unit'}`; location.appendChild(option); }); unit.value = options[0]?.unit_level || 'carton'; }
      mode.onchange = refreshMode; sku.onchange = refreshLocations; refreshLocations(); refreshMode();
      save.onclick = async () => {
        const selectedRow = (skuMap.get(sku.value) ?? []).find((row) => row.location_code === location.value) ?? skuMap.get(sku.value)?.[0];
        const amount = Number(qty.value);
        const ops = mode.value === 'OPS_DELIVERY';
        if (!customer.value.trim() || !sku.value || !Number.isFinite(amount) || amount <= 0) { status.textContent = 'Customer, SKU and positive qty are required.'; status.className = 'quick-customer-status error'; return; }
        if (ops && !deliveryAddress.value.trim()) { status.textContent = 'Delivery address or route note is required when releasing to warehouse/driver.'; status.className = 'quick-customer-status error'; return; }
        save.disabled = true; save.textContent = 'Saving…';
        try {
          const result = await recordCustomerStockDrawdown({ customerName: customer.value.trim(), customerReference: reference.value.trim() || undefined, sku: sku.value, productName: selectedRow?.product_name || undefined, barcode: selectedRow?.source_barcode || undefined, quantity: amount, unitLevel: unit.value as 'carton' | 'sleeve' | 'each' | 'unknown', locationCode: location.value || undefined, note: note.value.trim() || undefined, fulfilmentMode: mode.value as 'OWNER_ONSITE' | 'OPS_DELIVERY', deliveryAddress: ops ? deliveryAddress.value.trim() : undefined, driverNote: ops ? driverNote.value.trim() || undefined : undefined });
          const tag = ops ? 'RELEASED_TO_WAREHOUSE · TO_BILL' : 'NOT_RELEASED · TO_BILL';
          status.textContent = result.length ? `Saved ${result[0].issue_no} · ${amount} ${unit.value} · ${customer.value.trim()} · ${tag}` : `Saved · ${tag}`;
          status.className = 'quick-customer-status ok';
          qty.value = '1'; note.value = ''; deliveryAddress.value = ''; driverNote.value = '';
          warehouseRows = await loadWarehouseLocationItems();
          if (ops) await reloadOpsQueue();
          panel.dataset.renderKey = '';
          renderQuickCustomerPanel(panel);
        } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); status.className = 'quick-customer-status error'; }
        finally { save.disabled = false; refreshMode(); }
      };
      form.append(wrap('Mode', mode), wrap('Customer', customer), wrap('Reference', reference), wrap('SKU', sku), wrap('Location', location), wrap('Qty', qty), wrap('Unit', unit), wrap('Delivery address', deliveryAddress), wrap('Driver note', driverNote), wrap('Note', note), save);
      panel.append(form, status);
    }

    function patchQuickCustomerStockPanel() {
      const page = document.querySelector<HTMLElement>('.warehouse-map-page');
      if (!page) return;
      let panel = document.querySelector<HTMLElement>('.quick-customer-panel');
      if (!panel) { panel = document.createElement('section'); panel.className = 'warehouse-map-card quick-customer-panel'; (page.querySelector<HTMLElement>('.warehouse-bottom-grid') || page).insertAdjacentElement('afterend', panel); }
      renderQuickCustomerPanel(panel);
      if (!quickPanelScrolled && new URLSearchParams(window.location.search).get('quickIssue') === '1') { quickPanelScrolled = true; window.setTimeout(() => panel?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 140); }
      ensureWarehouse(patchQuickCustomerStockPanel);
    }

    function renderOpsQueuePanel(panel: HTMLElement, mode: 'warehouse' | 'driver') {
      const key = `${mode}|${opsError}|${opsRows?.map((row) => `${row.id}:${row.ops_status}:${row.updated_at ?? ''}`).join('|') ?? 'loading'}`;
      if (panel.dataset.renderKey === key) return;
      panel.dataset.renderKey = key;
      panel.textContent = '';
      // Invisible while loading and when the queue is empty — no dead panel on the floor screens.
      if (!opsError && (!opsRows || !opsRows.length)) { panel.hidden = true; return; }
      panel.hidden = false;
      const head = document.createElement('div'); head.className = 'driver-card-head quick-ops-head'; const h2 = document.createElement('h2'); h2.textContent = mode === 'warehouse' ? 'Quick customer handoff' : 'Quick deliveries'; const meta = document.createElement('span'); meta.textContent = opsError ? 'schema pending' : `${opsRows?.length ?? 0} open`; head.append(h2, meta); panel.appendChild(head);
      const policy = document.createElement('p'); policy.className = 'driver-card-meta quick-ops-policy'; policy.textContent = 'Quick items use their QI number — normal stops and A–F labels stay unchanged.'; panel.appendChild(policy);
      if (opsError || !opsRows) { const note = document.createElement('div'); note.className = 'driver-inline-hint'; note.textContent = opsError; panel.appendChild(note); return; }
      const list = document.createElement('div'); list.className = 'quick-ops-list';
      opsRows.forEach((row) => {
        const card = document.createElement('article'); card.className = `quick-ops-row quick-ops-${row.ops_status.toLowerCase()}`;
        const copy = document.createElement('div'); copy.className = 'quick-ops-copy';
        const title = document.createElement('strong'); title.textContent = `${row.issue_no} · ${row.customer_name}`;
        const sku = document.createElement('span'); sku.textContent = `${row.quantity} ${row.unit_level} · ${row.sku}${row.product_name ? ` · ${row.product_name}` : ''}`;
        const detail = document.createElement('small'); detail.textContent = `${row.location_code || 'no location'} · ${opsStatusLabel(row.ops_status)} · released ${shortTime(row.released_at)}`;
        const address = document.createElement('small'); address.textContent = row.delivery_address ? `Deliver: ${row.delivery_address}` : 'No delivery address on record';
        const note = document.createElement('small'); note.textContent = [row.driver_note, row.note].filter(Boolean).join(' · ') || 'No driver note';
        copy.append(title, sku, detail, address, note);
        const actions = document.createElement('div'); actions.className = 'quick-ops-actions'; actions.appendChild(pill('NO A–F LABEL · USE QI', 'warn', 'quick-ops-label-chip'));
        function addAction(label: string, next: CustomerOpsStatus, actionNote: string) { const button = document.createElement('button'); button.type = 'button'; button.className = 'driver-ghost-button quick-ops-action'; button.textContent = label; button.onclick = async () => { button.disabled = true; button.textContent = 'Saving…'; try { await updateCustomerOpsStatus({ issueId: row.id, opsStatus: next, note: actionNote }); await reloadOpsQueue(); panel.dataset.renderKey = ''; renderOpsQueuePanel(panel, mode); } catch (error) { button.textContent = error instanceof Error ? error.message : 'Failed'; button.classList.add('quick-ops-action-error'); } }; actions.appendChild(button); }
        if (mode === 'warehouse' && row.ops_status === 'RELEASED_TO_WAREHOUSE') addAction('Picked for driver', 'PICKED', 'Warehouse picked quick customer stock');
        if (mode === 'driver' && row.ops_status === 'PICKED') addAction('Take on run', 'OUT_FOR_DELIVERY', 'Driver took quick customer stock');
        if (mode === 'driver' && row.ops_status === 'OUT_FOR_DELIVERY') addAction('Delivered', 'DELIVERED', 'Driver completed quick customer stock delivery');
        if (mode === 'driver' && row.ops_status === 'RELEASED_TO_WAREHOUSE') actions.appendChild(pill('Waiting for warehouse pick', 'neutral', 'quick-ops-waiting'));
        card.append(copy, actions); list.appendChild(card);
      });
      panel.appendChild(list);
    }

    function patchWarehouseMobileOpsPanel() {
      const title = document.querySelector<HTMLElement>('.mobile-title h1');
      if (title?.textContent?.trim() !== 'Warehouse') return;
      const tabs = document.querySelector<HTMLElement>('.mobile-tabs');
      if (!tabs) return;
      let panel = document.querySelector<HTMLElement>('.warehouse-mobile-quick-ops-panel');
      if (!panel) { panel = document.createElement('section'); panel.className = 'mobile-card quick-ops-panel warehouse-mobile-quick-ops-panel'; tabs.insertAdjacentElement('afterend', panel); }
      renderOpsQueuePanel(panel, 'warehouse');
      ensureOps(patchWarehouseMobileOpsPanel);
    }

    function patchDriverMobileOpsPanel() {
      const content = document.querySelector<HTMLElement>('.driver-content');
      const activeNav = Array.from(document.querySelectorAll<HTMLButtonElement>('.driver-nav button')).find((button) => button.classList.contains('active'))?.textContent?.trim();
      const existing = document.querySelector<HTMLElement>('.driver-mobile-quick-ops-panel');
      // Quick add-on deliveries belong on Today only — never on top of picking or stop navigation.
      if (!content || activeNav !== 'Today') { existing?.remove(); return; }
      let panel = existing;
      if (!panel) { panel = document.createElement('section'); panel.className = 'driver-card quick-ops-panel driver-mobile-quick-ops-panel'; content.insertAdjacentElement('afterbegin', panel); }
      renderOpsQueuePanel(panel, 'driver');
      ensureOps(patchDriverMobileOpsPanel);
    }


    function patchRowsWithLifecycle() {
      ensureLifecycle(patchRowsWithLifecycle);
      if (!lifecycleRows?.length) return;
      Array.from(document.querySelectorAll<HTMLElement>('.inbox-table-like .table-row, .panel .table-like > .table-row, .order-list-item')).forEach((node) => {
        if (node.classList.contains('lifecycle-board-row')) return;
        const row = findLifecycle(lifecycleRows, node.textContent || '');
        if (!row) return;
        node.dataset.lifecycleStatus = row.lifecycle_status;
        node.classList.toggle('lifecycle-row-completed', row.lifecycle_status === 'COMPLETED');
        if (!node.querySelector('.lifecycle-inline-pill')) {
          const host = node.querySelector<HTMLElement>('.order-title-line') || node.querySelector<HTMLElement>('span') || node;
          host.appendChild(pill(lifecycleLabel(row.lifecycle_status), lifecycleTone(row.lifecycle_status), 'lifecycle-inline-pill'));
        }
        if (row.lifecycle_status === 'COMPLETED') {
          Array.from(node.querySelectorAll<HTMLButtonElement>('button')).forEach((button) => {
            if (/release/i.test(button.textContent || '')) { button.disabled = true; button.textContent = 'Completed · locked'; button.classList.add('lifecycle-release-blocked'); }
          });
        }
      });
    }

    function patchCompletedLabels() {
      Array.from(document.querySelectorAll<HTMLElement>('.pill')).forEach((p) => {
        const text = p.textContent?.trim().toUpperCase();
        if (text === 'CLOSED' || text === 'DELIVERED') { p.textContent = 'COMPLETED'; p.classList.add('pill-good'); }
      });
    }

    function patchAll() {
      openRequestedInventoryTab();
      patchInventoryMapEntry();
      patchInventoryLocationsPanel();
      patchQuickCustomerStockPanel();
      patchWarehouseMobileOpsPanel();
      patchDriverMobileOpsPanel();
      patchRowsWithLifecycle();
      patchCompletedLabels();
    }

    patchAll();
    const observer = new MutationObserver(patchAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
