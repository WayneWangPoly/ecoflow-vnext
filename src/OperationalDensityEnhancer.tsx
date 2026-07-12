import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

const STYLE_ID = 'ecoflow-operational-density-styles';

const styles = `
  .operational-section-tabs {
    position: sticky;
    top: 8px;
    z-index: 18;
    display: flex;
    gap: 7px;
    align-items: center;
    flex-wrap: wrap;
    padding: 9px;
    margin: 0 0 14px;
    border: 1px solid rgba(16,47,40,.12);
    border-radius: 15px;
    background: rgba(255,255,255,.94);
    box-shadow: 0 10px 26px rgba(16,47,40,.08);
    backdrop-filter: blur(12px);
  }
  .operational-section-tabs button {
    min-height: 38px;
    border: 1px solid rgba(16,47,40,.13);
    border-radius: 10px;
    background: #fff;
    color: #4f6259;
    padding: 0 13px;
    font-weight: 800;
    cursor: pointer;
  }
  .operational-section-tabs button[aria-selected="true"] {
    border-color: #103d2f;
    background: #103d2f;
    color: #fff;
  }
  .operational-pager {
    display: grid;
    grid-template-columns: auto minmax(130px,1fr) auto;
    gap: 9px;
    align-items: center;
    margin-top: 10px;
    padding: 9px 10px;
    border: 1px solid rgba(16,47,40,.1);
    border-radius: 12px;
    background: #f7faf8;
  }
  .operational-pager span {
    text-align: center;
    color: #60716a;
    font-size: 12px;
    font-weight: 800;
  }
  .operational-pager button {
    min-height: 34px;
    border: 1px solid rgba(16,47,40,.14);
    border-radius: 9px;
    background: #fff;
    color: #103d2f;
    padding: 0 12px;
    font-weight: 800;
    cursor: pointer;
  }
  .operational-pager button:disabled { opacity: .4; cursor: default; }
  .owner-store-shell[data-operational-view="customers"] > .owner-store-bottom-grid,
  .owner-store-shell[data-operational-view="customers"] > .customer-campaign-workbench { display:none!important; }
  .owner-store-shell[data-operational-view="insights"] > .owner-store-controlbar,
  .owner-store-shell[data-operational-view="insights"] > .owner-store-grid,
  .owner-store-shell[data-operational-view="insights"] > .customer-campaign-workbench { display:none!important; }
  .owner-store-shell[data-operational-view="communications"] > .owner-store-controlbar,
  .owner-store-shell[data-operational-view="communications"] > .owner-store-grid,
  .owner-store-shell[data-operational-view="communications"] > .owner-store-bottom-grid { display:none!important; }
  @media (max-width: 700px) {
    .operational-section-tabs { position: static; overflow-x: auto; flex-wrap: nowrap; }
    .operational-section-tabs button { white-space: nowrap; }
    .operational-pager { grid-template-columns: 1fr 1fr; }
    .operational-pager span { grid-column: 1 / -1; grid-row: 1; }
  }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = styles;
  document.head.appendChild(style);
}

function directChildren<T extends HTMLElement>(container: HTMLElement, selector: string) {
  return Array.from(container.children).filter((node): node is T => node instanceof HTMLElement && node.matches(selector));
}

function ensurePager(list: HTMLElement | null, selector: string, pageSize: number, key: string) {
  if (!list || !list.parentElement) return;
  const items = directChildren<HTMLElement>(list, selector);
  const previousCount = Number(list.dataset.operationalItemCount || 0);
  let page = Number(list.dataset.operationalPage || 1);
  if (previousCount !== items.length) page = 1;
  list.dataset.operationalItemCount = String(items.length);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  list.dataset.operationalPage = String(page);

  items.forEach((item, index) => {
    const shouldHide = index < (page - 1) * pageSize || index >= page * pageSize;
    if (item.hidden !== shouldHide) item.hidden = shouldHide;
  });

  let pager = Array.from(list.parentElement.children).find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('operational-pager') && node.dataset.pagerKey === key,
  );

  if (items.length <= pageSize) {
    pager?.remove();
    return;
  }

  if (!pager) {
    pager = document.createElement('div');
    pager.className = 'operational-pager';
    pager.dataset.pagerKey = key;
    pager.innerHTML = '<button type="button" data-pager-action="previous">Previous</button><span></span><button type="button" data-pager-action="next">Next</button>';
    list.insertAdjacentElement('afterend', pager);
  }

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, items.length);
  const label = pager.querySelector<HTMLElement>('span');
  if (label) label.textContent = `${first}–${last} of ${items.length} · page ${page} of ${totalPages}`;
  const previous = pager.querySelector<HTMLButtonElement>('[data-pager-action="previous"]');
  const next = pager.querySelector<HTMLButtonElement>('[data-pager-action="next"]');
  if (previous) {
    previous.disabled = page <= 1;
    previous.onclick = () => {
      list.dataset.operationalPage = String(Math.max(1, page - 1));
      applyOperationalDensity();
      list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
  if (next) {
    next.disabled = page >= totalPages;
    next.onclick = () => {
      list.dataset.operationalPage = String(Math.min(totalPages, page + 1));
      applyOperationalDensity();
      list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
}

function makeTabs(key: string, options: Array<{ value: string; label: string }>) {
  const nav = document.createElement('nav');
  nav.className = 'operational-section-tabs';
  nav.dataset.workspaceTabs = key;
  nav.setAttribute('aria-label', `${key} sections`);
  options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = option.value;
    button.textContent = option.label;
    nav.appendChild(button);
  });
  return nav;
}

function ensureStoreWorkspace() {
  const storeMount = document.querySelector<HTMLElement>('.owner-store-intelligence-mount');
  const priceMount = document.querySelector<HTMLElement>('.price-matrix-workbench-mount');
  const shell = storeMount?.querySelector<HTMLElement>('.owner-store-shell');
  const anchor = priceMount || storeMount;
  const parent = anchor?.parentElement;
  if (!anchor || !parent) return;

  let nav = Array.from(parent.children).find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.dataset.workspaceTabs === 'stores',
  );
  if (!nav) {
    nav = makeTabs('stores', [
      { value: 'customers', label: 'Customers' },
      { value: 'pricing', label: 'Price matrix' },
      { value: 'insights', label: 'Insights' },
      { value: 'communications', label: 'Communications' },
    ]);
    anchor.insertAdjacentElement('beforebegin', nav);
    nav.dataset.activeView = 'customers';
  }

  const availableViews = new Set(['customers', 'insights', 'communications']);
  if (priceMount) availableViews.add('pricing');
  let active = nav.dataset.activeView || 'customers';
  if (!availableViews.has(active)) active = 'customers';
  nav.dataset.activeView = active;

  nav.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
    const value = button.dataset.view || '';
    button.hidden = !availableViews.has(value);
    button.setAttribute('aria-selected', String(value === active));
    button.onclick = () => {
      nav!.dataset.activeView = value;
      applyOperationalDensity();
      nav!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  if (priceMount) priceMount.style.display = active === 'pricing' ? '' : 'none';
  if (storeMount) storeMount.style.display = active === 'pricing' ? 'none' : '';
  if (shell) shell.dataset.operationalView = active === 'pricing' ? 'customers' : active;

  ensurePager(shell?.querySelector<HTMLElement>('.customer-directory-panel .owner-store-list') ?? null, '.owner-store-row', 25, 'stores-directory');
}

function ensureInventoryWorkspace() {
  const controlMount = document.querySelector<HTMLElement>('.inventory-control-center-mount');
  const catalogMount = document.querySelector<HTMLElement>('.inventory-master-catalog-mount');
  const anchor = controlMount || catalogMount;
  const parent = anchor?.parentElement;
  if (!anchor || !parent) return;

  let nav = Array.from(parent.children).find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.dataset.workspaceTabs === 'inventory',
  );
  if (!nav) {
    nav = makeTabs('inventory', [
      { value: 'control', label: 'Control queue' },
      { value: 'catalog', label: 'All SKUs' },
    ]);
    anchor.insertAdjacentElement('beforebegin', nav);
    nav.dataset.activeView = 'control';
  }

  const catalogAvailable = Boolean(catalogMount);
  let active = nav.dataset.activeView || 'control';
  if (active === 'catalog' && !catalogAvailable) active = 'control';
  nav.dataset.activeView = active;

  nav.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
    const value = button.dataset.view || '';
    button.hidden = value === 'catalog' && !catalogAvailable;
    button.setAttribute('aria-selected', String(value === active));
    button.onclick = () => {
      nav!.dataset.activeView = value;
      applyOperationalDensity();
      nav!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  if (controlMount) controlMount.style.display = active === 'control' ? '' : 'none';
  if (catalogMount) catalogMount.style.display = active === 'catalog' ? '' : 'none';

  ensurePager(controlMount?.querySelector<HTMLElement>('.inventory-sku-list') ?? null, '.inventory-sku-row', 20, 'inventory-control');
  ensurePager(catalogMount?.querySelector<HTMLElement>('.inventory-master-list') ?? null, 'article', 50, 'inventory-catalog');
}

function ensureExceptionPager() {
  const panel = Array.from(document.querySelectorAll<HTMLElement>('.panel')).find(
    (node) => node.querySelector('h2')?.textContent?.trim() === 'Exception control',
  );
  if (!panel) return;
  const firstCard = panel.querySelector<HTMLElement>('.exception-card');
  ensurePager(firstCard?.parentElement ?? null, '.exception-card', 20, 'active-exceptions');
}

function applyOperationalDensity() {
  ensureStyles();
  ensureStoreWorkspace();
  ensureInventoryWorkspace();
  ensureExceptionPager();
}

export function OperationalDensityEnhancer() {
  useEffect(() => observeBody(applyOperationalDensity), []);
  return null;
}
