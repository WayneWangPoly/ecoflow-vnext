import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const HIDE_SELECTORS = [
  '.ops-home-heading > p',
  '.ops-home-panel > header > span',
  '.order-platform-hero p',
  '.order-ops-flow-strip',
  '.order-platform-table-headline p',
  '.owner-store-hero p',
  '.owner-store-panel > header p',
  '.owner-store-bottom-grid header p',
  '.customer-campaign-workbench > header p',
  '.accounts-hero p',
  '.accounts-panel > header p',
  '.source-boundary-inline',
  '.source-boundary-panel',
  '.settings-panel',
  '.desktop-readonly-banner',
];

const TITLE_REPLACEMENTS = new Map([
  ['One commercial truth, from Ordermentum to delivery.', 'Order search'],
  ['Every customer, their value, their history and the next action.', 'Customers'],
  ['Invoice truth from Ordermentum. Workflow and statements in EcoFlow.', 'Invoices and statements'],
]);

const CHECK_LABELS: Record<string, string> = {
  orders: 'Order summary is using the loaded order list',
  'barcode coverage': 'Barcode coverage count is temporarily unavailable; saved mappings are unchanged',
  inventory: 'Inventory summary is temporarily unavailable',
  'warehouse locations': 'Warehouse location summary is temporarily unavailable',
  'source verification': 'Source verification status is temporarily unavailable',
};

function clarifyReadinessNotice(node: HTMLElement) {
  const text = node.textContent?.trim() || '';
  const prefix = 'Some checks are unavailable:';
  if (!text.startsWith(prefix)) return;
  const checks = text.slice(prefix.length).replace(/\.$/, '').split(',').map((value) => value.trim()).filter(Boolean);
  const messages = checks.map((check) => CHECK_LABELS[check] || `${check} check is temporarily unavailable`);
  node.textContent = `${messages.join(' · ')}. No source data was deleted.`;
}

function cleanDesktopCopy() {
  HIDE_SELECTORS.forEach((selector) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      node.hidden = true;
      node.setAttribute('aria-hidden', 'true');
    });
  });

  document.querySelectorAll<HTMLElement>('h1, h2, h3').forEach((heading) => {
    const replacement = TITLE_REPLACEMENTS.get(heading.textContent?.trim() || '');
    if (replacement && heading.textContent !== replacement) heading.textContent = replacement;
  });

  document.querySelectorAll<HTMLElement>('.field-readiness-note').forEach(clarifyReadinessNotice);
}

export function DesktopCopyCleanup() {
  useEffect(() => observeBody(cleanDesktopCopy), []);
  return null;
}
