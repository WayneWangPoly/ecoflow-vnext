import { useEffect, useRef } from 'react';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import { loadSupabaseOrdermentumViews } from '@/data/repositories/resilientOrdermentumViews';
import { triggerStoreMasterRefresh } from '@/data/repositories/customerStoreCenter';
import './operationsClarityEnhancer.css';

type Role = 'OWNER' | 'ADMIN' | 'ACCOUNT';
type OrderTime = { at: string; source: 'ordered' | 'captured' };

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function detectRoleFromDom(): Role {
  const nav = document.querySelector<HTMLElement>('.sidebar-nav');
  if (nav?.classList.contains('role-nav-account')) return 'ACCOUNT';
  const stored = window.localStorage.getItem('ecoflow-role');
  if (stored === 'account') return 'ACCOUNT';
  const visible = document.querySelector<HTMLElement>('.sidebar-brand > div:last-child > span')?.textContent?.toUpperCase() || '';
  if (visible.includes('ADMIN')) return 'ADMIN';
  if (visible.includes('ACCOUNT')) return 'ACCOUNT';
  return 'OWNER';
}

function roleLabel(role: Role) {
  return role === 'ACCOUNT' ? 'ACCOUNTS OPERATIONS' : `${role} OPERATIONS`;
}

function relabelPill(pill: HTMLElement) {
  const raw = pill.textContent?.trim().toUpperCase() || '';
  if (raw === 'UNCHANGED') {
    pill.hidden = true;
    pill.title = 'No fields changed in the latest Ordermentum sync.';
    return;
  }
  pill.hidden = false;
  if (raw === 'MAPPING EXCEPTION') {
    pill.textContent = 'NEEDS MAPPING';
    pill.title = 'A product/SKU, barcode or imported order line cannot yet be matched safely.';
  } else if (raw === 'BLOCKED DATA') {
    pill.textContent = 'MISSING ORDER DETAIL';
    pill.title = 'Invoice detail or line-item data is incomplete, so the order cannot be released.';
  } else if (raw === 'BLOCKED MAPPING') {
    pill.textContent = 'SKU MAPPING BLOCK';
    pill.title = 'At least one order line still needs an approved internal SKU mapping.';
  }
}

function ensureQueueGuide() {
  const header = document.querySelector<HTMLElement>('.owner-command-queue-panel .owner-command-panel-header');
  if (!header || header.parentElement?.querySelector(':scope > .owner-command-queue-guide')) return;
  const guide = document.createElement('div');
  guide.className = 'owner-command-queue-guide';
  guide.innerHTML = '<span><b>Needs mapping</b> = SKU/barcode/import match required</span><span><b>Missing order detail</b> = invoice or line data must be fetched</span><span>Unchanged sync records are hidden here because this queue is for action only.</span>';
  header.insertAdjacentElement('afterend', guide);
}

function ensureInventoryShortcuts() {
  const actions = document.querySelector<HTMLElement>('.inventory-hero .inventory-actions');
  if (!actions || actions.querySelector('.inventory-workspace-shortcuts')) return;
  const wrap = document.createElement('div');
  wrap.className = 'inventory-workspace-shortcuts';
  const map = document.createElement('a');
  map.href = '/warehouse-map';
  map.textContent = 'Warehouse map';
  const pick = document.createElement('a');
  pick.href = '/?workspace=warehouse&tab=pick';
  pick.textContent = 'Quick pick';
  wrap.append(map, pick);
  actions.prepend(wrap);
}

function ensurePriceGroupRecovery() {
  const warning = document.querySelector<HTMLElement>('.price-matrix-warning');
  if (!warning || warning.querySelector('button')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Sync price groups now';
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Starting Ordermentum sync…';
    try {
      await triggerStoreMasterRefresh('Owner recovered missing price groups from the Store price matrix');
      button.textContent = 'Sync requested · refresh shortly';
      window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>('.price-matrix-hero button')?.click();
        button.disabled = false;
        button.textContent = 'Sync price groups now';
      }, 30000);
    } catch (error) {
      button.disabled = false;
      button.textContent = error instanceof Error ? 'Sync failed · retry' : 'Sync failed · retry';
      button.title = error instanceof Error ? error.message : String(error);
    }
  };
  warning.appendChild(button);
}

export function OperationsClarityEnhancer() {
  const roleRef = useRef<Role>(detectRoleFromDom());
  const timesRef = useRef<Map<string, OrderTime>>(new Map());

  useEffect(() => {
    if (supabase) {
      void supabase.from('v_ecoflow_current_user').select('app_role,is_active').maybeSingle().then(({ data }) => {
        if (data?.is_active && ['OWNER', 'ADMIN', 'ACCOUNT'].includes(String(data.app_role))) roleRef.current = data.app_role as Role;
      });
    }

    void loadSupabaseOrdermentumViews().then((views) => {
      const map = new Map<string, OrderTime>();
      views?.inbox.forEach((row) => {
        const at = row.order_created_at || row.first_seen_at || row.raw_created_at;
        if (!at) return;
        const source: OrderTime['source'] = row.order_created_at ? 'ordered' : 'captured';
        [row.order_number, row.external_order_number, row.invoice_number, row.external_invoice_number]
          .filter((key): key is string => Boolean(key))
          .forEach((key) => map.set(key, { at, source }));
      });
      timesRef.current = map;
    }).catch(() => undefined);

    function apply() {
      const role = roleRef.current || detectRoleFromDom();
      const operationLabel = roleLabel(role);
      const topbar = document.querySelector<HTMLElement>('.topbar-title > div > span');
      if (topbar && topbar.textContent !== operationLabel) topbar.textContent = operationLabel;
      const sidebar = document.querySelector<HTMLElement>('.sidebar-brand > div:last-child > span');
      if (sidebar && sidebar.textContent !== role) sidebar.textContent = role;

      document.querySelectorAll<HTMLElement>('.owner-command-order-pills .owner-command-pill').forEach(relabelPill);
      ensureQueueGuide();
      ensureInventoryShortcuts();
      ensurePriceGroupRecovery();

      document.querySelectorAll<HTMLElement>('.owner-command-metric').forEach((metric) => {
        const label = metric.querySelector<HTMLElement>('span')?.textContent?.trim();
        if (label !== 'Active orders') return;
        const helper = metric.querySelector<HTMLElement>('small');
        if (helper) {
          helper.textContent = 'Current operational workflow · full history remains in Ordermentum Inbox';
          helper.title = 'This excludes completed/cancelled orders and is not the total lifetime order count.';
        }
      });

      document.querySelectorAll<HTMLElement>('.owner-command-order-row').forEach((row) => {
        const orderNo = row.querySelector<HTMLElement>('.owner-command-order-title > strong')?.textContent?.trim() || '';
        const time = timesRef.current.get(orderNo);
        const side = row.querySelector<HTMLElement>('.owner-command-order-side');
        if (!side || !time) return;
        let node = side.querySelector<HTMLElement>('.owner-command-order-time');
        if (!node) {
          node = document.createElement('small');
          node.className = 'owner-command-order-time';
          side.appendChild(node);
        }
        node.textContent = `${time.source === 'ordered' ? 'Ordered' : 'First captured'} ${formatTime(time.at)}`;
      });
    }

    return observeBody(apply);
  }, []);

  return null;
}
