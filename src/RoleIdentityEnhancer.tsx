import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

function applyRoleIdentity() {
  document.querySelector('.sidebar-role-badge')?.remove();

  const roleNode = document.querySelector<HTMLElement>('.sidebar-brand > div:not(.brand-logo-lockup) span');
  const rawRole = roleNode?.textContent?.trim().toUpperCase() || '';
  if (!['OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER'].includes(rawRole)) return;

  const operationLabel = rawRole === 'ACCOUNT' ? 'ACCOUNTS OPERATIONS' : `${rawRole} OPERATIONS`;
  const topbarSubtitle = document.querySelector<HTMLElement>('.topbar-title > div:not(.brand-logo-lockup) span');
  if (topbarSubtitle && topbarSubtitle.textContent !== operationLabel) topbarSubtitle.textContent = operationLabel;
}

export function RoleIdentityEnhancer() {
  useEffect(() => observeBody(applyRoleIdentity), []);
  return null;
}
