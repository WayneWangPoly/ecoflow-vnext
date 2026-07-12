import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const STYLE_ID = 'ecoflow-role-identity-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sidebar-role-badge {
      width: fit-content;
      margin: 8px 14px 2px;
      padding: 5px 9px;
      border: 1px solid rgba(188,232,196,.28);
      border-radius: 999px;
      background: rgba(47,191,127,.12);
      color: #bce8c4;
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
  `;
  document.head.appendChild(style);
}

function applyRoleIdentity() {
  ensureStyle();
  const roleNode = document.querySelector<HTMLElement>('.sidebar-brand > div:not(.brand-logo-lockup) span');
  const rawRole = roleNode?.textContent?.trim().toUpperCase() || '';
  if (!['OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER'].includes(rawRole)) return;

  const operationLabel = rawRole === 'ACCOUNT' ? 'ACCOUNTS OPERATIONS' : `${rawRole} OPERATIONS`;
  const topbarSubtitle = document.querySelector<HTMLElement>('.topbar-title > div:not(.brand-logo-lockup) span');
  if (topbarSubtitle && topbarSubtitle.textContent !== operationLabel) topbarSubtitle.textContent = operationLabel;

  const brand = document.querySelector<HTMLElement>('.sidebar-brand');
  const sidebar = brand?.parentElement;
  if (!brand || !sidebar) return;
  let badge = sidebar.querySelector<HTMLElement>(':scope > .sidebar-role-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'sidebar-role-badge';
    brand.insertAdjacentElement('afterend', badge);
  }
  const badgeText = `${rawRole} ACCESS`;
  if (badge.textContent !== badgeText) badge.textContent = badgeText;
}

export function RoleIdentityEnhancer() {
  useEffect(() => observeBody(applyRoleIdentity), []);
  return null;
}
