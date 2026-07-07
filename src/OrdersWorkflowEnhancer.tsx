import { useEffect } from 'react';
import { loadOrderLifecycleArchive, type OrderLifecycleRow, type OrderLifecycleStatus } from '@/data/repositories/orderLifecycle';

function norm(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function ids(row: OrderLifecycleRow) {
  return [row.order_number, row.invoice_number, row.external_order_id, row.lifecycle_id].map(norm).filter(Boolean);
}

function findMatch(rows: OrderLifecycleRow[], text: string) {
  const body = norm(text);
  return rows.find((row) => ids(row).some((id) => id.length >= 3 && body.includes(id))) || null;
}

function money(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }) : '—';
}

function title(status: OrderLifecycleStatus) {
  return status.replace(/_/g, ' ');
}

function card(row: OrderLifecycleRow) {
  const el = document.createElement('article');
  el.className = `orders-workflow-card orders-workflow-${row.lifecycle_status.toLowerCase()}`;
  const a = document.createElement('strong');
  a.textContent = row.order_number || row.lifecycle_id || 'Unknown order';
  const b = document.createElement('span');
  b.textContent = [row.invoice_number, row.ordermentum_order_status, row.warehouse_gate_status].filter(Boolean).join(' · ') || 'No status detail';
  const c = document.createElement('small');
  c.textContent = `${title(row.lifecycle_status)} · ${money(row.invoice_total)}`;
  el.append(a, b, c);
  return el;
}

export function OrdersWorkflowEnhancer() {
  useEffect(() => {
    let rows: OrderLifecycleRow[] | null = null;
    let error = '';
    let loading: Promise<void> | null = null;

    function byStatus(status: OrderLifecycleStatus) {
      return (rows || []).filter((row) => row.lifecycle_status === status);
    }

    function render(panel: HTMLElement) {
      const key = `${error}|${rows?.map((row) => `${row.lifecycle_id}:${row.lifecycle_status}:${row.lifecycle_updated_at}`).join('|') ?? 'loading'}`;
      if (panel.dataset.renderKey === key) return;
      panel.dataset.renderKey = key;
      panel.textContent = '';

      const head = document.createElement('div');
      head.className = 'panel-head orders-workflow-head';
      const h2 = document.createElement('h2');
      h2.textContent = 'Active order workflow';
      const meta = document.createElement('span');
      const active = (rows || []).filter((row) => row.lifecycle_status !== 'COMPLETED').length;
      const done = (rows || []).filter((row) => row.lifecycle_status === 'COMPLETED').length;
      meta.textContent = error ? 'schema pending' : rows ? `${active} active · ${done} archived` : 'loading';
      head.append(h2, meta);
      panel.appendChild(head);

      const rule = document.createElement('p');
      rule.className = 'orders-workflow-rule';
      rule.textContent = 'Only orders that still need action appear here. Completed and historical imports are kept out of the active workflow.';
      panel.appendChild(rule);

      if (error || !rows) {
        const note = document.createElement('div');
        note.className = 'driver-inline-hint lifecycle-error';
        note.textContent = error || 'Loading active order workflow…';
        panel.appendChild(note);
        return;
      }

      const lanes: Array<[string, string, OrderLifecycleRow[], string]> = [
        ['ready', 'Ready to internalise', byStatus('READY_TO_INTERNALISE'), 'Safe to convert into internal work.'],
        ['mapping', 'Mapping blocked', byStatus('BLOCKED_MAPPING'), 'SKU, barcode or store mapping needs fixing.'],
        ['data', 'Data blocked', byStatus('BLOCKED_DATA'), 'Ordermentum data is missing or incomplete.'],
        ['internal', 'Internal order', byStatus('INTERNAL_ORDER_CREATED'), 'Created internally, not yet in warehouse flow.'],
        ['warehouse', 'Picking', byStatus('PICKING'), 'Warehouse is picking.'],
        ['staged', 'Staged', byStatus('STAGED'), 'Ready for driver route.'],
      ];

      const grid = document.createElement('div');
      grid.className = 'orders-workflow-grid';
      lanes.forEach(([keyName, name, laneRows, hint]) => {
        const lane = document.createElement('section');
        lane.className = `orders-workflow-lane orders-lane-${keyName}`;
        const laneHead = document.createElement('div');
        laneHead.className = 'orders-workflow-lane-head';
        const laneTitle = document.createElement('strong');
        laneTitle.textContent = name;
        const count = document.createElement('span');
        count.textContent = String(laneRows.length);
        laneHead.append(laneTitle, count);
        const laneHint = document.createElement('small');
        laneHint.textContent = hint;
        lane.append(laneHead, laneHint);
        const list = document.createElement('div');
        list.className = 'orders-workflow-lane-list';
        laneRows.slice(0, 4).forEach((row) => list.appendChild(card(row)));
        if (laneRows.length > 4) {
          const more = document.createElement('div');
          more.className = 'orders-workflow-more';
          more.textContent = `+${laneRows.length - 4} more`;
          list.appendChild(more);
        }
        if (!laneRows.length) {
          const empty = document.createElement('div');
          empty.className = 'orders-workflow-empty';
          empty.textContent = 'Clear';
          list.appendChild(empty);
        }
        lane.appendChild(list);
        grid.appendChild(lane);
      });
      panel.appendChild(grid);
    }

    function markRows() {
      if (!rows?.length) return;
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Order control');
      const orderPanel = heading?.closest<HTMLElement>('.panel');
      if (!orderPanel) return;
      const list = Array.from(orderPanel.querySelectorAll<HTMLElement>('.table-row, .order-list-item'));
      let archived = 0;
      list.forEach((node) => {
        const match = findMatch(rows || [], node.textContent || '');
        if (!match) return;
        const done = match.lifecycle_status === 'COMPLETED';
        node.classList.toggle('orders-row-archived', done);
        if (done) archived += 1;
      });
      let note = orderPanel.querySelector<HTMLElement>('.orders-archive-note');
      if (!note) {
        note = document.createElement('div');
        note.className = 'orders-archive-note';
        orderPanel.querySelector<HTMLElement>('.panel-head')?.insertAdjacentElement('afterend', note);
      }
      if (note) note.textContent = archived ? `${archived} completed or historical rows archived from this active view.` : 'Only active rows are shown below.';
    }

    function patch() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Order control');
      const orderPanel = heading?.closest<HTMLElement>('.panel');
      if (!orderPanel) return;
      let panel = document.querySelector<HTMLElement>('.orders-workflow-panel');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'panel orders-workflow-panel';
        orderPanel.insertAdjacentElement('beforebegin', panel);
      }
      render(panel);
      markRows();
      if (!rows && !error && !loading) {
        loading = loadOrderLifecycleArchive()
          .then((next) => { rows = next; error = ''; })
          .catch((err) => { rows = []; error = err instanceof Error ? err.message : String(err); })
          .finally(() => { loading = null; patch(); });
      }
    }

    patch();
    const observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
