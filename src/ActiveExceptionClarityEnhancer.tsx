import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

function applyClarity() {
  document.querySelectorAll<HTMLElement>('.owner-command-sync-metrics > div').forEach((metric) => {
    const label = metric.querySelector<HTMLElement>('span');
    if (label?.textContent?.trim() !== 'Warnings') return;
    label.textContent = 'Active data checks';
    metric.title = 'Current operational data checks, not server failures or HTTP 502 errors.';
  });

  const panel = Array.from(document.querySelectorAll<HTMLElement>('.panel')).find(
    (node) => node.querySelector('h2')?.textContent?.trim() === 'Exception control',
  );
  if (!panel) return;

  const openPill = panel.querySelector<HTMLElement>('.panel-head .pill');
  if (openPill) {
    openPill.title = 'Only exceptions linked to the current active order lifecycle. Historical exceptions remain in the audit archive.';
  }

  panel.querySelectorAll<HTMLElement>('.exception-card').forEach((card) => {
    const summary = card.querySelector<HTMLElement>('p');
    const detail = card.querySelector<HTMLElement>('small');
    const meta = card.querySelector<HTMLElement>('div > span');
    const raw = `${summary?.textContent || ''} ${detail?.textContent || ''}`.toUpperCase();
    if (!raw.includes('INVOICE DETAIL MISSING')) return;
    if (meta) meta.textContent = (meta.textContent || '').replace(/PAYMENT$/i, 'DATA COMPLETENESS');
    if (summary) summary.textContent = 'ORDER DATA INCOMPLETE';
    if (detail) detail.textContent = 'EcoFlow has the order header but not the mirrored invoice or line detail. This does not prove the customer invoice was never issued.';
  });
}

export function ActiveExceptionClarityEnhancer() {
  useEffect(() => observeBody(applyClarity), []);
  return null;
}
