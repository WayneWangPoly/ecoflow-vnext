import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Boxes,
  ClipboardList,
  Command,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  Map,
  PackageSearch,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '../advancedIndustrialUi.css';

type NavAction = {
  label: string;
  aliases: string[];
  description: string;
  icon: LucideIcon;
  shortcut?: string;
};

type WorkspaceAction = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const NAV_ACTIONS: NavAction[] = [
  { label: 'Today', aliases: ['Today', 'Dashboard'], description: 'Daily operating picture and release readiness', icon: LayoutDashboard, shortcut: '1' },
  { label: 'Ordermentum', aliases: ['Ordermentum', 'Ordermentum Inbox'], description: 'Source orders, exceptions and release gate', icon: ShoppingCart, shortcut: '2' },
  { label: 'Orders', aliases: ['Orders'], description: 'Order lifecycle and fulfilment state', icon: ClipboardList, shortcut: '3' },
  { label: 'Delivery', aliases: ['Delivery'], description: 'Route planning, staging and dispatch control', icon: Truck, shortcut: '4' },
  { label: 'Inventory', aliases: ['Inventory'], description: 'Stock truth, barcode coverage and locations', icon: Boxes, shortcut: '5' },
  { label: 'Stores', aliases: ['Stores'], description: 'Customer master and commercial context', icon: Store, shortcut: '6' },
  { label: 'Reconciliation', aliases: ['Reconciliation', 'Accounts'], description: 'Payments, POD and account variance', icon: Gauge, shortcut: '7' },
  { label: 'Logs', aliases: ['Logs'], description: 'Operational audit trail', icon: Activity, shortcut: '8' },
  { label: 'Settings', aliases: ['Settings', 'System'], description: 'Access, integrations and operating rules', icon: Settings, shortcut: '9' },
];

const WORKSPACE_ACTIONS: WorkspaceAction[] = [
  { label: 'Warehouse map', description: 'Location and rack control', href: '/warehouse-map', icon: Map },
  { label: 'Warehouse operations', description: 'Receive, pick and stock', href: '/?workspace=warehouse', icon: PackageSearch },
  { label: 'Driver operations', description: 'Route and POD workspace', href: '/?workspace=driver', icon: Truck },
];

const ICON_GLYPHS: Record<string, string> = {
  today: '01',
  dashboard: '01',
  ordermentum: '02',
  'ordermentum inbox': '02',
  orders: '03',
  delivery: '04',
  inventory: '05',
  stores: '06',
  reconciliation: '07',
  accounts: '07',
  logs: '08',
  settings: '09',
  system: '09',
};

function normalise(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function findNavButton(aliases: string[]) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button'));
  const normalisedAliases = aliases.map(normalise);
  return buttons.find((button) => normalisedAliases.includes(normalise(button.textContent)));
}

function activateNavigation(action: NavAction) {
  const button = findNavButton(action.aliases);
  button?.click();
  button?.focus({ preventScroll: true });
}

function addNavigationMarkers() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button'));
  buttons.forEach((button) => {
    const key = normalise(button.textContent);
    button.dataset.uiIndex = ICON_GLYPHS[key] || '•';
  });
}

function readActiveSection() {
  return document.querySelector<HTMLButtonElement>('.sidebar-nav button.active')?.textContent?.trim() || 'Today';
}

export function AdvancedOwnerUiEnhancer() {
  const [railMount, setRailMount] = useState<HTMLElement | null>(null);
  const [topbarMount, setTopbarMount] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState(readActiveSection);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [compact, setCompact] = useState(() => {
    try { return window.localStorage.getItem('ecoflow-owner-density') === 'compact'; } catch { return false; }
  });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const desktop = document.querySelector<HTMLElement>('.desktop-app');
    const topbarActions = document.querySelector<HTMLElement>('.topbar-actions');
    const sidebarNav = document.querySelector<HTMLElement>('.sidebar-nav');
    if (!desktop || !topbarActions || !sidebarNav) return;

    const railNode = document.createElement('aside');
    railNode.className = 'advanced-owner-rail-mount';
    railNode.setAttribute('aria-label', 'Owner control rail');
    desktop.appendChild(railNode);

    const topbarNode = document.createElement('div');
    topbarNode.className = 'advanced-owner-topbar-mount';
    topbarActions.insertBefore(topbarNode, topbarActions.lastElementChild);

    document.body.classList.add('advanced-owner-ui');
    addNavigationMarkers();
    setActiveSection(readActiveSection());
    setRailMount(railNode);
    setTopbarMount(topbarNode);

    const observer = new MutationObserver(() => {
      addNavigationMarkers();
      setActiveSection(readActiveSection());
    });
    observer.observe(sidebarNav, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
      railNode.remove();
      topbarNode.remove();
      document.body.classList.remove('advanced-owner-ui', 'advanced-owner-rail-collapsed', 'advanced-density-compact');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('advanced-owner-rail-collapsed', railCollapsed);
  }, [railCollapsed]);

  useEffect(() => {
    document.body.classList.toggle('advanced-density-compact', compact);
    try { window.localStorage.setItem('ecoflow-owner-density', compact ? 'compact' : 'comfortable'); } catch { /* UI preference persistence is optional. */ }
  }, [compact]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const action = NAV_ACTIONS.find((item) => item.shortcut === event.key);
      if (action) {
        event.preventDefault();
        activateNavigation(action);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!paletteOpen) {
      setQuery('');
      return;
    }
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [paletteOpen]);

  const filteredNav = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return NAV_ACTIONS;
    return NAV_ACTIONS.filter((action) => normalise(`${action.label} ${action.description}`).includes(needle));
  }, [query]);

  const filteredWorkspaces = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return WORKSPACE_ACTIONS;
    return WORKSPACE_ACTIONS.filter((action) => normalise(`${action.label} ${action.description}`).includes(needle));
  }, [query]);

  const topbar = topbarMount ? createPortal(
    <div className="advanced-owner-topbar-controls">
      <button className="advanced-command-trigger" type="button" onClick={() => setPaletteOpen(true)} aria-label="Open quick actions">
        <Command size={15} strokeWidth={2} />
        <span>Quick actions</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button className="advanced-rail-toggle" type="button" onClick={() => setRailCollapsed((current) => !current)} aria-label={railCollapsed ? 'Show control rail' : 'Hide control rail'}>
        {railCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
      </button>
    </div>,
    topbarMount,
  ) : null;

  const rail = railMount ? createPortal(
    <div className="advanced-owner-rail">
      <header className="advanced-rail-header">
        <div className="advanced-rail-signal"><span /><span /><span /></div>
        <small>ACTIVE CONTROL SURFACE</small>
        <strong>{activeSection}</strong>
        <p>Context remains visible while the centre workspace changes.</p>
      </header>

      <section className="advanced-rail-section">
        <div className="advanced-rail-section-title"><span>Navigate</span><kbd>Alt 1–9</kbd></div>
        <div className="advanced-rail-nav-grid">
          {NAV_ACTIONS.slice(0, 6).map((action) => {
            const Icon = action.icon;
            const isActive = action.aliases.map(normalise).includes(normalise(activeSection));
            return (
              <button key={action.label} type="button" className={isActive ? 'active' : ''} onClick={() => activateNavigation(action)}>
                <Icon size={16} strokeWidth={1.9} />
                <span>{action.label}</span>
                <small>{action.shortcut}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="advanced-rail-section">
        <div className="advanced-rail-section-title"><span>Workspaces</span></div>
        <div className="advanced-workspace-links">
          {WORKSPACE_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <a key={action.label} href={action.href} target="_blank" rel="noreferrer">
                <Icon size={16} strokeWidth={1.9} />
                <span><strong>{action.label}</strong><small>{action.description}</small></span>
                <ExternalLink size={13} />
              </a>
            );
          })}
        </div>
      </section>

      <section className="advanced-rail-section advanced-density-section">
        <div className="advanced-rail-section-title"><span>Workspace density</span></div>
        <div className="advanced-segmented-control" role="group" aria-label="Workspace density">
          <button type="button" className={!compact ? 'active' : ''} onClick={() => setCompact(false)}>Comfort</button>
          <button type="button" className={compact ? 'active' : ''} onClick={() => setCompact(true)}>Compact</button>
        </div>
      </section>

      <footer className="advanced-rail-footer">
        <div><span className="advanced-live-dot" /><strong>Interface layer active</strong></div>
        <small>No operational data or workflow logic is modified.</small>
      </footer>
    </div>,
    railMount,
  ) : null;

  const palette = paletteOpen ? createPortal(
    <div className="advanced-command-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setPaletteOpen(false);
    }}>
      <section className="advanced-command-palette" role="dialog" aria-modal="true" aria-label="EcoFlow quick actions">
        <header>
          <Search size={19} strokeWidth={1.9} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sections or workspaces…" />
          <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close quick actions"><X size={18} /></button>
        </header>
        <div className="advanced-command-results">
          {filteredNav.length ? (
            <section>
              <span className="advanced-command-group-label">OPERATIONS</span>
              {filteredNav.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.label} type="button" onClick={() => { activateNavigation(action); setPaletteOpen(false); }}>
                    <Icon size={18} strokeWidth={1.9} />
                    <span><strong>{action.label}</strong><small>{action.description}</small></span>
                    {action.shortcut ? <kbd>Alt {action.shortcut}</kbd> : null}
                  </button>
                );
              })}
            </section>
          ) : null}
          {filteredWorkspaces.length ? (
            <section>
              <span className="advanced-command-group-label">OPEN WORKSPACE</span>
              {filteredWorkspaces.map((action) => {
                const Icon = action.icon;
                return (
                  <a key={action.label} href={action.href} target="_blank" rel="noreferrer" onClick={() => setPaletteOpen(false)}>
                    <Icon size={18} strokeWidth={1.9} />
                    <span><strong>{action.label}</strong><small>{action.description}</small></span>
                    <ExternalLink size={14} />
                  </a>
                );
              })}
            </section>
          ) : null}
          {!filteredNav.length && !filteredWorkspaces.length ? <div className="advanced-command-empty">No matching control surface.</div> : null}
        </div>
        <footer><span>Type to filter</span><span><kbd>Esc</kbd> close</span></footer>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{topbar}{rail}{palette}</>;
}
