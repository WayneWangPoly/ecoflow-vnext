import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderKanban,
  GitCompareArrows,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { CustomerOperationalWorkspace, type CustomerWorkContext } from './CustomerOperationalWorkspace';
import '../industrialDesktopV2.css';
import '../industrialDesktopWorkbench.css';
import '../industrialDesktopConsistency.css';

type DesktopRole = 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'VIEWER';
type SortMode = 'priority' | 'az' | 'value' | 'status';
type WorkField = { label: string; value: string };
type WorkItem = {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  fields: WorkField[];
  entity?: 'customer' | 'generic';
  customerContext?: CustomerWorkContext;
};
type WorkItemDetail = WorkItem;

const ROW_SELECTOR = [
  '.desktop-content .table-row',
  '.desktop-content .order-list-item',
  '.desktop-content .stop-row',
  '.desktop-content .store-card',
  '.desktop-content .exception-card',
  '.desktop-content .stock-watch-row',
  '.desktop-content .ops-order-row:not(.head)',
  '.desktop-content .accounts-invoice-row',
  '.desktop-content .order-platform-table-row',
].join(', ');
const SORT_CONTAINER_SELECTOR = '.desktop-content .table-like, .desktop-content .list-stack, .desktop-content .store-grid, .desktop-content .stock-watch, .desktop-content .order-platform-table';

function clean(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function currentRole(): DesktopRole {
  const text = clean(document.querySelector<HTMLElement>('.sidebar-brand span')?.textContent).toUpperCase();
  if (text.includes('ACCOUNT')) return 'ACCOUNT';
  if (text.includes('VIEWER')) return 'VIEWER';
  if (text.includes('ADMIN')) return 'ADMIN';
  return 'OWNER';
}

function stableId(parts: string[]) {
  return parts.join('|').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function customerRowToItem(row: HTMLElement): WorkItem | null {
  const main = row.querySelector<HTMLElement>('.owner-store-main');
  const storeName = clean(row.dataset.storeName || main?.querySelector<HTMLElement>('strong')?.textContent);
  if (!storeName) return null;
  const address = clean(row.dataset.storeAddress || main?.querySelector<HTMLElement>('span')?.textContent);
  const deliveryInstruction = clean(row.dataset.deliveryInstruction || main?.querySelector<HTMLElement>('small')?.textContent);
  return {
    id: stableId(['customer', row.dataset.storeId || storeName]),
    title: storeName,
    subtitle: address || 'Customer',
    kind: 'Customer',
    fields: [],
    entity: 'customer',
    customerContext: {
      storeId: row.dataset.storeId,
      storeName,
      address,
      deliveryInstruction: deliveryInstruction && !/^no delivery instructions/i.test(deliveryInstruction)
        ? deliveryInstruction
        : undefined,
    },
  };
}

function rowToItem(row: HTMLElement): WorkItem | null {
  const panel = row.closest<HTMLElement>('.panel, .ops-home-panel, .accounts-panel, .owner-store-panel, .order-platform-compact-table-panel');
  const kind = clean(panel?.querySelector<HTMLElement>('.panel-head h2, header h2, header h3, h2, h3')?.textContent) || 'Work item';
  const cells = Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  const table = row.closest<HTMLElement>('.table-like, .ops-order-table, .order-platform-table');
  const headings = table
    ? Array.from(table.querySelectorAll<HTMLElement>(':scope > .table-head > span, :scope > .ops-order-row.head > span, :scope > .order-platform-table-header > span')).map((node) => clean(node.textContent))
    : [];
  const title = clean(row.querySelector<HTMLElement>('strong')?.textContent) || clean(cells[0]?.textContent) || kind;
  const subtitle = clean(cells[1]?.textContent) || clean(row.querySelector<HTMLElement>('small, p')?.textContent) || kind;
  const fields = cells
    .map((cell, index) => ({ label: headings[index] || `Field ${index + 1}`, value: clean(cell.textContent) || '—' }))
    .filter((field) => field.value !== '—');
  if (!fields.length) fields.push({ label: 'Summary', value: clean(row.textContent) || title });
  return { id: stableId([kind, title, subtitle]), title, subtitle, kind, fields, entity: 'generic' };
}

function sourceField(field: WorkField) {
  return /(order|invoice|store|customer|account|payment|amount|value|tier|source|received|updated|due)/i.test(field.label);
}

function numericValue(text: string) {
  const values = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  return values?.length ? Number(values[values.length - 1]) : 0;
}

function applyFilter(query: string) {
  const needle = clean(query).toLowerCase();
  document.querySelectorAll<HTMLElement>(`${ROW_SELECTOR}, .desktop-content .owner-store-row, .desktop-content .accounts-customer-row`).forEach((row) => {
    row.classList.toggle('industrial-row-filtered', Boolean(needle) && !clean(row.textContent).toLowerCase().includes(needle));
  });
}

function applySort(mode: SortMode) {
  document.querySelectorAll<HTMLElement>(SORT_CONTAINER_SELECTOR).forEach((container) => {
    const rows = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement
      && !child.classList.contains('table-head')
      && !child.classList.contains('order-platform-table-header')
      && !child.classList.contains('empty-state'));
    rows.forEach((row, index) => {
      if (row.dataset.originalIndex === undefined) row.dataset.originalIndex = String(index);
    });
    const sorted = [...rows].sort((left, right) => {
      if (mode === 'priority') return Number(left.dataset.originalIndex) - Number(right.dataset.originalIndex);
      const leftText = clean(left.textContent);
      const rightText = clean(right.textContent);
      if (mode === 'value') return numericValue(rightText) - numericValue(leftText);
      if (mode === 'status') {
        return clean(left.querySelector<HTMLElement>('.status-pill, .pill, b')?.textContent || leftText)
          .localeCompare(clean(right.querySelector<HTMLElement>('.status-pill, .pill, b')?.textContent || rightText));
      }
      return clean(left.querySelector<HTMLElement>('strong')?.textContent || leftText)
        .localeCompare(clean(right.querySelector<HTMLElement>('strong')?.textContent || rightText));
    });
    if (sorted.every((row, index) => row === rows[index])) return;
    sorted.forEach((row) => container.appendChild(row));
  });
}

function Fields({ fields }: { fields: WorkField[] }) {
  return (
    <dl className="industrial-field-grid">
      {fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
    </dl>
  );
}

export function IndustrialDesktopWorkbench() {
  const [role, setRole] = useState<DesktopRole>(currentRole);
  const [topbarMount, setTopbarMount] = useState<HTMLElement | null>(null);
  const [inspectorMount, setInspectorMount] = useState<HTMLElement | null>(null);
  const [workbarMount, setWorkbarMount] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [inspectorView, setInspectorView] = useState<'overview' | 'source' | 'operations'>('overview');
  const [detailHidden, setDetailHidden] = useState(false);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [compact, setCompact] = useState(() => {
    try { return window.localStorage.getItem('ecoflow-density-v2') !== 'comfortable'; }
    catch { return true; }
  });
  const [modal, setModal] = useState<'expanded' | 'compare' | null>(null);
  const queryRef = useRef(query);
  const sortRef = useRef(sortMode);

  const activeItem = items.find((item) => item.id === activeId) || null;
  const compareItems = items.filter((item) => compareIds.includes(item.id) && item.entity !== 'customer');
  const activeIsCustomer = activeItem?.entity === 'customer' && Boolean(activeItem.customerContext);
  const genericInspectorOpen = Boolean(activeItem && !activeIsCustomer && !detailHidden);
  const customerWindowOpen = Boolean(activeIsCustomer && !detailHidden);
  const inspectorFields = activeItem
    ? inspectorView === 'source'
      ? activeItem.fields.filter(sourceField)
      : inspectorView === 'operations'
        ? activeItem.fields.filter((field) => !sourceField(field))
        : activeItem.fields
    : [];

  function openItem(item: WorkItemDetail) {
    setItems((current) => [...current.filter((existing) => existing.id !== item.id), item].slice(-8));
    setActiveId(item.id);
    setDetailHidden(false);
    setInspectorView('overview');
  }

  function activateItem(id: string) {
    setActiveId(id);
    setDetailHidden(false);
  }

  function closeItem(id: string) {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      if (activeId === id) setActiveId(next[next.length - 1]?.id || '');
      return next;
    });
    setCompareIds((current) => current.filter((candidate) => candidate !== id));
  }

  function toggleCompare(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (item?.entity === 'customer') return;
    setCompareIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id].slice(-4));
  }

  useEffect(() => {
    const desktop = document.querySelector<HTMLElement>('.desktop-app');
    const topbar = document.querySelector<HTMLElement>('.topbar-actions');
    if (!desktop || !topbar) return;

    const topbarNode = document.createElement('div');
    topbarNode.className = 'industrial-v2-topbar-mount';
    topbar.insertBefore(topbarNode, topbar.lastElementChild);

    const inspectorNode = document.createElement('aside');
    inspectorNode.className = 'industrial-v2-inspector-mount';
    desktop.appendChild(inspectorNode);

    const workbarNode = document.createElement('div');
    workbarNode.className = 'industrial-v2-workbar-mount';
    desktop.appendChild(workbarNode);

    document.body.classList.add('industrial-desktop-v2', 'industrial-v2-workbar-active');
    setTopbarMount(topbarNode);
    setInspectorMount(inspectorNode);
    setWorkbarMount(workbarNode);
    setRole(currentRole());

    let frame = 0;
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setRole(currentRole());
        applyFilter(queryRef.current);
        if (sortRef.current !== 'priority') applySort(sortRef.current);
      });
    });
    observer.observe(document.querySelector<HTMLElement>('.desktop-content') || desktop, { subtree: true, childList: true });

    function onCustomerClickCapture(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest<HTMLElement>('.owner-store-row');
      if (!row || target.closest('button, a, input, select, textarea, label, [role="button"]')) return;
      const item = customerRowToItem(row);
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openItem(item);
    }

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest('button, a, input, select, textarea, label, [role="button"]')) return;
      const row = target.closest<HTMLElement>(ROW_SELECTOR);
      const item = row ? rowToItem(row) : null;
      if (item) openItem(item);
    }

    function onCustom(event: Event) {
      const item = (event as CustomEvent<WorkItemDetail>).detail;
      if (item?.id && item?.title) openItem(item);
    }

    document.addEventListener('click', onCustomerClickCapture, true);
    document.addEventListener('click', onClick);
    window.addEventListener('ecoflow:open-work-item', onCustom);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      document.removeEventListener('click', onCustomerClickCapture, true);
      document.removeEventListener('click', onClick);
      window.removeEventListener('ecoflow:open-work-item', onCustom);
      topbarNode.remove();
      inspectorNode.remove();
      workbarNode.remove();
      document.body.classList.remove(
        'industrial-desktop-v2',
        'industrial-v2-workbar-active',
        'industrial-v2-compact',
        'industrial-v2-inspector-open',
        'industrial-v2-customer-inspector',
        'industrial-v2-customer-window-open',
      );
    };
  }, []);

  useEffect(() => {
    queryRef.current = query;
    applyFilter(query);
  }, [query]);

  useEffect(() => {
    sortRef.current = sortMode;
    applySort(sortMode);
  }, [sortMode]);

  useEffect(() => {
    document.body.classList.toggle('industrial-v2-compact', compact);
    try { window.localStorage.setItem('ecoflow-density-v2', compact ? 'compact' : 'comfortable'); }
    catch { /* optional preference */ }
  }, [compact]);

  useEffect(() => {
    document.body.classList.toggle('industrial-v2-inspector-open', genericInspectorOpen);
    document.body.classList.remove('industrial-v2-customer-inspector');
    document.body.classList.toggle('industrial-v2-customer-window-open', customerWindowOpen);
  }, [genericInspectorOpen, customerWindowOpen]);

  const topbar = topbarMount ? createPortal(
    <div className="industrial-v2-topbar">
      <label className="industrial-view-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in this view" />{query ? <button type="button" onClick={() => setQuery('')}><X size={13} /></button> : null}</label>
      <label className="industrial-sort-control"><SlidersHorizontal size={14} /><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="priority">Operational priority</option><option value="az">A–Z</option><option value="value">Highest value</option><option value="status">Status</option></select></label>
      <button type="button" className="industrial-density-button" onClick={() => setCompact((current) => !current)}><Rows3 size={15} />{compact ? 'Compact' : 'Comfort'}</button>
      {activeItem && detailHidden ? <button type="button" onClick={() => setDetailHidden(false)} aria-label={activeIsCustomer ? 'Open customer window' : 'Open inspector'}><PanelRightOpen size={16} /></button> : null}
    </div>,
    topbarMount,
  ) : null;

  const workbar = workbarMount ? createPortal(
    <section className="industrial-workbar" aria-label="Open work items">
      <div className="industrial-workbar-identity"><FolderKanban size={16} /><strong>Work tabs</strong><b>{items.length}</b></div>
      <div className="industrial-work-tabs">
        {items.map((item) => (
          <div key={item.id} className={`industrial-work-tab ${item.id === activeId ? 'active' : ''} ${compareIds.includes(item.id) ? 'compare' : ''}`}>
            <button type="button" className="industrial-work-tab-main" onClick={() => activateItem(item.id)}><span>{item.kind}</span><strong>{item.title}</strong></button>
            {item.entity !== 'customer' ? <button type="button" onClick={() => toggleCompare(item.id)} aria-label={`Compare ${item.title}`}><GitCompareArrows size={12} /></button> : null}
            <button type="button" onClick={() => closeItem(item.id)} aria-label={`Close ${item.title}`}><X size={12} /></button>
          </div>
        ))}
      </div>
      <div className="industrial-workbar-actions">
        <button type="button" disabled={compareItems.length < 2} onClick={() => setModal('compare')}><GitCompareArrows size={14} />Compare {compareItems.length || ''}</button>
        <button
          type="button"
          disabled={!activeItem}
          onClick={() => setDetailHidden((current) => !current)}
          aria-label={activeIsCustomer ? 'Toggle customer window' : 'Toggle inspector'}
        >
          {detailHidden ? <PanelRightOpen size={15} /> : <Minimize2 size={15} />}
        </button>
      </div>
    </section>,
    workbarMount,
  ) : null;

  const inspector = inspectorMount && activeItem && !activeIsCustomer && !detailHidden ? createPortal(
    <div className="industrial-inspector">
      <header>
        <div><span>{activeItem.kind}</span><strong>{activeItem.title}</strong><small>{activeItem.subtitle}</small></div>
        <div>
          <button type="button" onClick={() => setModal('expanded')} aria-label="Expand"><Maximize2 size={16} /></button>
          <button type="button" onClick={() => setDetailHidden(true)} aria-label="Close inspector"><PanelRightClose size={16} /></button>
        </div>
      </header>
      <nav>{(['overview', 'source', 'operations'] as const).map((view) => <button key={view} type="button" className={inspectorView === view ? 'active' : ''} onClick={() => setInspectorView(view)}>{view}</button>)}</nav>
      <div className="industrial-inspector-body"><Fields fields={inspectorFields} /></div>
      <footer><button type="button" className={compareIds.includes(activeItem.id) ? 'active' : ''} onClick={() => toggleCompare(activeItem.id)}><GitCompareArrows size={14} />{compareIds.includes(activeItem.id) ? 'Selected' : 'Add to compare'}</button></footer>
    </div>,
    inspectorMount,
  ) : null;

  const customerWindow = activeItem && activeIsCustomer && activeItem.customerContext && !detailHidden ? createPortal(
    <section
      className="industrial-customer-work-window"
      role="dialog"
      aria-label={`Customer workspace: ${activeItem.title}`}
    >
      <header>
        <div><span>CUSTOMER WORK ITEM</span><strong>{activeItem.title}</strong><small>{activeItem.subtitle}</small></div>
        <div>
          <button type="button" onClick={() => setDetailHidden(true)} aria-label="Minimise customer window"><Minimize2 size={16} /></button>
          <button type="button" onClick={() => closeItem(activeItem.id)} aria-label={`Close ${activeItem.title}`}><X size={17} /></button>
        </div>
      </header>
      <CustomerOperationalWorkspace context={activeItem.customerContext} editable={role !== 'VIEWER'} />
    </section>,
    document.body,
  ) : null;

  const modalView = modal && (activeItem || compareItems.length) ? createPortal(
    <div className="industrial-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <section className={`industrial-work-modal ${modal === 'compare' ? 'compare' : ''}`} role="dialog" aria-modal="true">
        <header><div><span>{modal === 'compare' ? 'WORKSPACE COMPARISON' : activeItem?.kind}</span><strong>{modal === 'compare' ? `${compareItems.length} items side by side` : activeItem?.title}</strong></div><button type="button" onClick={() => setModal(null)}><X size={18} /></button></header>
        {modal === 'compare'
          ? <div className="industrial-compare-grid">{compareItems.map((item) => <article key={item.id}><div><span>{item.kind}</span><strong>{item.title}</strong><small>{item.subtitle}</small></div><Fields fields={item.fields} /></article>)}</div>
          : activeItem && activeItem.entity !== 'customer' ? <div className="industrial-expanded-item"><Fields fields={activeItem.fields} /></div> : null}
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{topbar}{workbar}{inspector}{customerWindow}{modalView}</>;
}
