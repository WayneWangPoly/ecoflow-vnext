import { useEffect, useRef } from 'react';
import { observeBody } from '@/lib/domObserver';

const accountAllowedTabs = new Set(['Dashboard', 'Orders', 'Stores', 'Reconciliation', 'Settings']);
const businessLabels: Record<string, string> = {
  Ordermentum: 'Inbox',
  Reconciliation: 'Accounts',
};

function normaliseRole(value?: string | null) {
  const text = String(value || '').toUpperCase();
  if (text.includes('ACCOUNT')) return 'ACCOUNT';
  if (text.includes('OWNER') || text.includes('ADMIN')) return 'OWNER';
  if (text.includes('WAREHOUSE')) return 'WAREHOUSE';
  if (text.includes('DRIVER')) return 'DRIVER';
  const stored = window.localStorage.getItem('ecoflow-role');
  if (stored === 'account') return 'ACCOUNT';
  if (stored === 'owner') return 'OWNER';
  if (stored === 'warehouse') return 'WAREHOUSE';
  if (stored === 'driver') return 'DRIVER';
  return 'OWNER';
}

function buttonBaseLabel(button?: HTMLButtonElement | null) {
  if (!button) return '';
  const existing = button.dataset.ecoflowBaseLabel;
  if (existing) return existing;
  const text = button.textContent?.trim() || '';
  button.dataset.ecoflowBaseLabel = text;
  return text;
}

export function RoleAwareDesktopNavigation() {
  const accountDefaultApplied = useRef(false);

  useEffect(() => {
    function apply() {
      const nav = document.querySelector<HTMLElement>('.sidebar-nav');
      const roleNode = document.querySelector<HTMLElement>('.sidebar-brand span');
      if (!nav) return;

      const role = normaliseRole(roleNode?.textContent);
      const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'));
      if (!buttons.length) return;

      nav.classList.toggle('role-nav-account', role === 'ACCOUNT');
      nav.classList.toggle('role-nav-owner', role === 'OWNER');

      buttons.forEach((button) => {
        const base = buttonBaseLabel(button);
        const allowed = role !== 'ACCOUNT' || accountAllowedTabs.has(base);
        button.hidden = !allowed;
        button.classList.toggle('role-nav-hidden', !allowed);
        const label = businessLabels[base] || base;
        if (button.textContent !== label) button.textContent = label;
      });

      let helper = nav.querySelector<HTMLElement>('.role-nav-helper');
      if (!helper) {
        helper = document.createElement('div');
        helper.className = 'role-nav-helper';
        nav.appendChild(helper);
      }
      helper.textContent = role === 'ACCOUNT'
        ? 'Accounts workspace: statements, stores, order controls.'
        : 'Owner workspace: full operating command centre.';

      if (role === 'ACCOUNT' && !accountDefaultApplied.current) {
        const accountsButton = buttons.find((button) => buttonBaseLabel(button) === 'Reconciliation');
        const activeButton = buttons.find((button) => button.classList.contains('active'));
        if (accountsButton && buttonBaseLabel(activeButton) !== 'Reconciliation') {
          accountDefaultApplied.current = true;
          window.setTimeout(() => accountsButton.click(), 80);
        }
      }
    }

    const stopObserving = observeBody(apply);
    return stopObserving;
  }, []);

  return null;
}
