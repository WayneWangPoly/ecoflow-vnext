import { useEffect } from 'react';
import { loadOrderLifecycleBoard, type OrderLifecycleRow, type OrderLifecycleStatus } from '@/data/repositories/orderLifecycle';

function normalise(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function lifecycleLabel(status: OrderLifecycleStatus | string) {
  return String(status || 'UNKNOWN').replace(/_/g, ' ');
}

function lifecycleTone(status: OrderLifecycleStatus | string) {
  if (status === 'COMPLETED') return 'good';
  if (status === 'READY_TO_INTERNALISE') return 'good';
  if (status === 'BLOCKED_DATA' || status === 'BLOCKED_MAPPING') return 'danger';
  if (status === 'PICKING' || status === 'STAGED') return 'blue';
  return 'warn';
}

function moneyText(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusCounts(rows: OrderLifecycleRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.lifecycle_status] = (acc[row.lifecycle_status] || 0) + 1;
    return acc;
  }, {});
}

function rowIdentity(row: OrderLifecycleRow) {
  return [row.order_number, row.invoice_number, row.external_order_id, row.lifecycle_id]
    .map(normalise)
    .filter(Boolean);
}

function findLifecycleInText(rows: OrderLifecycleRow[], text: string) {
  const haystack = normalise(text);
  if (!haystack) return null;
  return rows.find((row) => rowIdentity(row).some((id) => id.length >= 3 && haystack.includes(id))) || null;
}

function renderPill(label: string, tone: string) {
  const pill = document.createElement('span');
  pill.className = `pill pill-${tone} lifecycle-pill`;
  pill.textContent = label;
  return pill;
}

function renderLifecycleSummary(panel: HTMLElement, rows: OrderLifecycleRow[] | null, error: string, context: 'ordermentum' | 'orders') {
  const key = `${context}|${error}|${rows?.map((row) => `${row.lifecycle_id}:${row.lifecycle_status}:${row.lifecycle_updated_at}`).join('|') ?? 'loading'}`;
  if (panel.dataset.renderKey === key) return;
  panel.dataset.renderKey = key;
  panel.textContent = '';

  const head = document.createElement('div');
  head.className = 'panel-head lifecycle-head';
  const title = document.createElement('h2');
  title.textContent = context === 'ordermentum' ? 'Lifecycle gate' : 'Order lifecycle status';
  const meta = document.createElement('span');
  meta.textContent = error ? 'schema pending' : rows ? `${rows.length} orders` : 'loading';
  head.append(title, meta);
  panel.appendChild(head);

  const policy = document.createElement('p');
  policy.className = 'lifecycle-policy';
  policy.textContent = 'Gate rule: Ordermentum completed/closed/delivered/fulfilled orders are EcoFlow COMPLETED and cannot be released, internalised, picked, or routed again.';
  panel.appendChild(policy);

  if (error || !rows) {
    const note = document.createElement('div');
    note.className = 'driver-inline-hint lifecycle-error';
    note.textContent = error || 'Loading lifecycle board…';
    panel.appendChild(note);
    return;
  }

  const counts = statusCounts(rows);
  const statGrid = document.createElement('div');
  statGrid.className = 'lifecycle-stat-grid';
  [
    ['READY_TO_INTERNALISE', 'Ready'],
    ['BLOCKED_DATA', 'Data blocked'],
    ['BLOCKED_MAPPING', 'Mapping blocked'],
    ['INTERNAL_ORDER_CREATED', 'Internal'],
    ['PICKING', 'Picking'],
    ['STAGED', 'Staged'],
    ['COMPLETED', 'Completed'],
  ].forEach(([status, label]) => {
    const item = document.createElement('div');
    item.className = `lifecycle-stat lifecycle-stat-${status.toLowerCase()}`;
    const strong = document.createElement('strong');
    strong.textContent = String(counts[status] || 0);
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    statGrid.appendChild(item);
  });
  panel.appendChild(statGrid);

  const table = document.createElement('div');
  table.className = 'table-like lifecycle-table';
  const header = document.createElement('div');
  header.className = 'table-head';
  ['Order', 'OM status', 'Internal', 'Lifecycle', 'Gate', 'Value'].forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    header.appendChild(span);
  });
  table.appendChild(header);

  rows.slice(0, context === 'ordermentum' ? 12 : 20).forEach((row) => {
    const item = document.createElement('div');
    item.className = `table-row lifecycle-board-row lifecycle-status-${row.lifecycle_status.toLowerCase()}`;

    const order = document.createElement('span');
    const orderStrong = document.createElement('strong');
    orderStrong.textContent = row.order_number || row.lifecycle_id || 'Unknown order';
    const invoice = document.createElement('small');
    invoice.textContent = row.invoice_number || 'no invoice';
    order.append(orderStrong, invoice);

    const om = document.createElement('span');
    om.textContent = [row.ordermentum_order_status, row.ordermentum_invoice_status].filter(Boolean).join(' / ') || '—';

    const internal = document.createElement('span');
    const internalStrong = document.createElement('strong');
    internalStrong.textContent = row.internal_order_id ? 'created' : 'not created';
    const internalSmall = document.createElement('small');
    internalSmall.textContent = [row.internalisation_status, row.warehouse_gate_status].filter(Boolean).join(' · ') || 'no internal state';
    internal.append(internalStrong, internalSmall);

    const lifecycle = document.createElement('span');
    lifecycle.appendChild(renderPill(lifecycleLabel(row.lifecycle_status), lifecycleTone(row.lifecycle_status)));

    const gate = document.createElement('span');
    gate.appendChild(renderPill(row.can_internalise ? 'CAN INTERNALISE' : row.lifecycle_status === 'COMPLETED' ? 'COMPLETED GATE' : 'LOCKED', row.can_internalise ? 'good' : row.lifecycle_status === 'COMPLETED' ? 'good' : 'warn'));
    const gateSmall = document.createElement('small');
    gateSmall.textContent = timeText(row.lifecycle_updated_at);
    gate.appendChild(gateSmall);

    const value = document.createElement('span');
    value.textContent = moneyText(row.invoice_total);

    item.append(order, om, internal, lifecycle, gate, value);
    table.appendChild(item);
  });

  panel.appendChild(table);
}

function patchRowsWithLifecycle(rows: OrderLifecycleRow[]) {
  const rowNodes = Array.from(document.querySelectorAll<HTMLElement>('.inbox-table-like .table-row, .panel .table-like > .table-row, .order-list-item'));
  rowNodes.forEach((node) => {
    if (node.classList.contains('lifecycle-board-row')) return;
    const lifecycle = findLifecycleInText(rows, node.textContent || '');
    if (!lifecycle) return;
    node.dataset.lifecycleStatus = lifecycle.lifecycle_status;
    node.classList.toggle('lifecycle-row-completed', lifecycle.lifecycle_status === 'COMPLETED');

    if (!node.querySelector('.lifecycle-inline-pill')) {
      const host = node.querySelector<HTMLElement>('.order-title-line') || node.querySelector<HTMLElement>('span') || node;
      const pill = renderPill(lifecycleLabel(lifecycle.lifecycle_status), lifecycleTone(lifecycle.lifecycle_status));
      pill.classList.add('lifecycle-inline-pill');
      host.appendChild(pill);
    }

    if (lifecycle.lifecycle_status === 'COMPLETED') {
      Array.from(node.querySelectorAll<HTMLButtonElement>('button')).forEach((button) => {
        if (/release/i.test(button.textContent || '')) {
          button.disabled = true;
          button.textContent = 'Completed · locked';
          button.classList.add('lifecycle-release-blocked');
        }
      });
    }
  });
}

export function LifecycleEnhancer() {
  useEffect(() => {
    let rows: OrderLifecycleRow[] | null = null;
    let error = '';
    let loading: Promise<void> | null = null;

    function ensureRows(afterLoad: () => void) {
      if (rows || error || loading) return;
      loading = loadOrderLifecycleBoard()
        .then((next) => { rows = next; error = ''; })
        .catch((err) => { rows = []; error = err instanceof Error ? err.message : String(err); })
        .finally(() => { loading = null; afterLoad(); });
    }

    function patchOrdermentumTab() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((item) => item.textContent?.trim() === 'Daily order intake');
      if (!heading) return;
      const syncPanel = heading.closest<HTMLElement>('.panel');
      if (!syncPanel) return;
      let panel = document.querySelector<HTMLElement>('.lifecycle-ordermentum-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'panel lifecycle-panel lifecycle-ordermentum-panel';
        syncPanel.insertAdjacentElement('afterend', panel);
      }
      renderLifecycleSummary(panel, rows, error, 'ordermentum');
      ensureRows(patchOrdermentumTab);
    }

    function patchOrdersTab() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((item) => item.textContent?.trim() === 'Order control');
      if (!heading) return;
      const orderPanel = heading.closest<HTMLElement>('.panel');
      if (!orderPanel) return;
      let panel = document.querySelector<HTMLElement>('.lifecycle-orders-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'panel lifecycle-panel lifecycle-orders-panel';
        orderPanel.insertAdjacentElement('beforebegin', panel);
      }
      renderLifecycleSummary(panel, rows, error, 'orders');
      ensureRows(patchOrdersTab);
    }

    function patchAll() {
      patchOrdermentumTab();
      patchOrdersTab();
      if (rows?.length) patchRowsWithLifecycle(rows);
    }

    patchAll();
    const observer = new MutationObserver(patchAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
