import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { BrandMark } from '@/app/Brand';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import {
  canRoleAccessIntelligenceWorkspace,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract';
import '@/features/navigation/nativeOperationalRoutes.css';
import '@/features/dashboard/controlRoomVisualQc.css';

type NavigationItem = {
  label: string;
  path: string;
  workspace: IntelligenceWorkspaceId;
};

const ACTION_PATHS: Readonly<Record<string, NavigationItem>> = {
  CONTROL_ROOM: { label: 'Control Room', path: '/control-room', workspace: 'control-room' },
  ORDERS: { label: 'Sales Orders', path: '/orders', workspace: 'orders' },
  PRODUCTS: { label: 'Products', path: '/products', workspace: 'products' },
  CUSTOMERS: { label: 'Customers', path: '/customers', workspace: 'customers' },
  SUPPLIERS: { label: 'Suppliers', path: '/suppliers', workspace: 'suppliers' },
  PURCHASES: { label: 'Purchases', path: '/purchases', workspace: 'purchases' },
  INVENTORY: { label: 'Inventory', path: '/inventory', workspace: 'inventory' },
  PRODUCT_IDENTITY: { label: 'Product Identity', path: '/commissioning/product-identity', workspace: 'product-identity' },
  DELIVERY: { label: 'Delivery', path: '/delivery', workspace: 'delivery' },
  RETURNS: { label: 'Returns', path: '/returns', workspace: 'returns' },
  ACCOUNTS: { label: 'Accounts', path: '/accounts', workspace: 'accounts' },
  ANALYTICS: { label: 'Analytics', path: '/analytics', workspace: 'analytics' },
  EXCEPTIONS: { label: 'Exceptions', path: '/exceptions', workspace: 'exceptions' },
  LOGS: { label: 'Logs', path: '/logs', workspace: 'logs' },
  SETTINGS: { label: 'Settings', path: '/settings', workspace: 'settings' },
};

export const LEGACY_RECONCILIATION_ROUTE = {
  path: '/reconciliation',
  workspace: 'reconciliation',
} as const;

export const OPERATIONAL_NAVIGATION: readonly NavigationItem[] = [
  ACTION_PATHS.CONTROL_ROOM,
  ACTION_PATHS.ORDERS,
  ACTION_PATHS.PURCHASES,
  ACTION_PATHS.PRODUCTS,
  ACTION_PATHS.INVENTORY,
  ACTION_PATHS.PRODUCT_IDENTITY,
  ACTION_PATHS.CUSTOMERS,
  ACTION_PATHS.SUPPLIERS,
  ACTION_PATHS.EXCEPTIONS,
  ACTION_PATHS.DELIVERY,
  ACTION_PATHS.RETURNS,
  ACTION_PATHS.ACCOUNTS,
  ACTION_PATHS.ANALYTICS,
  ACTION_PATHS.LOGS,
  ACTION_PATHS.SETTINGS,
] as const;

export function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'account') return 'Accounts';
  if (role === 'warehouse') return 'Warehouse';
  if (role === 'driver') return 'Driver';
  if (role === 'viewer') return 'Viewer';
  return 'Owner';
}

export function mayAccessOperationalWorkspace(role: Role, workspace: IntelligenceWorkspaceId) {
  // Accounts already operate the governed exception queue in the stability
  // surface. Keep that capability while the central route contract catches up.
  if (role === 'account' && workspace === 'exceptions') return true;
  return canRoleAccessIntelligenceWorkspace(role, workspace);
}

export function OperationalAccessState({ title, detail, actions }: { title: string; detail: string; actions?: ReactNode }) {
  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <div className="login-brand-row">
          <BrandMark large />
          <div><div className="login-brand-name">EcoFlow</div><div className="login-brand-subtitle">CONTROLLED OPERATIONS</div></div>
        </div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {actions ? <div className="row-actions">{actions}</div> : null}
      </section>
    </main>
  );
}

export function OperationalAppShell({
  role,
  profile,
  onLogout,
  children,
}: {
  role: Role;
  profile: EcoFlowAuthProfile;
  onLogout: () => void;
  children: ReactNode;
}) {
  const navigation = OPERATIONAL_NAVIGATION.filter((item) => mayAccessOperationalWorkspace(role, item.workspace));

  return (
    <div className="desktop-app" data-app-role={role} data-navigation-owner="unified-operational-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark />
          <div><strong>EcoFlow</strong><span>{roleLabel(role).toUpperCase()}</span></div>
        </div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : undefined}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="desktop-main">
        <header className="desktop-topbar">
          <div className="topbar-title">
            <BrandMark />
            <div>
              <strong>{profile.display_name || profile.email}</strong>
              <span>{roleLabel(role).toUpperCase()} OPERATIONS</span>
            </div>
          </div>
          <div className="topbar-actions topbar-utility-actions">
            {(role === 'owner' || role === 'admin') ? <NavLink className="soft-button topbar-owner-tool" to="/warehouse-control">Warehouse Control</NavLink> : null}
            {(role === 'owner' || role === 'admin') ? <a className="soft-button topbar-owner-tool" href="/warehouse-map">Warehouse Map</a> : null}
            <button className="topbar-logout" type="button" onClick={onLogout}>Logout</button>
          </div>
        </header>
        <nav className="desktop-mobile-nav" aria-label="Primary sections">
          {navigation.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : undefined}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="desktop-content">{children}</main>
      </section>
    </div>
  );
}
