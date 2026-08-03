import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/app/Brand';
import { EmailLoginScreen } from '@/features/auth/EmailLoginScreen';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import type { Role } from '@/domain/types';
import { businessDateFromIso } from '@/domain/syncModel';
import { hasSupabaseAuthClient, supabase } from '@/lib/supabaseClient';
import {
  canRoleAccessIntelligenceWorkspace,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract';
import { readQuickActions } from '@/data/repositories/operationalStability';
import { ProductIdentityCommissioningWorkspace } from '@/features/commissioning/ProductIdentityCommissioningWorkspace';
import { NativeCoreOperationalWorkspace } from '@/features/operationalRoutes/NativeCoreOperationalWorkspace';
import {
  OperationalPagedWorkspace,
  OperationalSettingsWorkspace,
  WarehouseControlWorkspace,
} from './OperationalStabilityWorkspace';
import '@/features/navigation/nativeOperationalRoutes.css';

const PROFILE_CACHE_KEY = 'ecoflow:last-verified-profile';

type NavigationItem = {
  label: string;
  path: string;
  workspace: IntelligenceWorkspaceId;
  roles?: readonly Role[];
};

const ACTION_PATHS: Readonly<Record<string, NavigationItem>> = {
  CONTROL_ROOM: { label: 'Control Room', path: '/control-room', workspace: 'control-room' },
  ORDERS: { label: 'Orders', path: '/orders', workspace: 'orders' },
  INVENTORY: { label: 'Inventory', path: '/inventory', workspace: 'inventory' },
  CUSTOMERS: { label: 'Customers', path: '/customers', workspace: 'customers' },
  DELIVERY: { label: 'Delivery', path: '/delivery', workspace: 'delivery' },
  RETURNS: { label: 'Returns', path: '/returns', workspace: 'returns' },
  ANALYTICS: { label: 'Analytics', path: '/analytics', workspace: 'analytics' },
  EXCEPTIONS: { label: 'Exceptions', path: '/exceptions', workspace: 'exceptions' },
  LOGS: { label: 'Logs', path: '/logs', workspace: 'logs' },
  SETTINGS: { label: 'Settings', path: '/settings', workspace: 'settings' },
};

const NAVIGATION: readonly NavigationItem[] = [
  ACTION_PATHS.CONTROL_ROOM,
  { label: 'Ordermentum', path: '/ordermentum', workspace: 'ordermentum' },
  ACTION_PATHS.ORDERS,
  ACTION_PATHS.INVENTORY,
  { label: 'Product Setup', path: '/commissioning/product-identity', workspace: 'inventory', roles: ['owner', 'admin'] },
  ACTION_PATHS.CUSTOMERS,
  ACTION_PATHS.EXCEPTIONS,
  ACTION_PATHS.DELIVERY,
  { label: 'Reconciliation', path: '/reconciliation', workspace: 'reconciliation' },
  ACTION_PATHS.ANALYTICS,
  ACTION_PATHS.LOGS,
  ACTION_PATHS.SETTINGS,
];

function readCachedProfile(userId?: string | null) {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EcoFlowAuthProfile;
    if (!parsed.user_id || !parsed.app_role) return null;
    if (userId && parsed.user_id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: EcoFlowAuthProfile | null) {
  if (profile) window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  else window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
}

function roleFromProfile(profile: EcoFlowAuthProfile): Role {
  if (profile.app_role === 'ADMIN') return 'admin';
  if (profile.app_role === 'ACCOUNT') return 'account';
  if (profile.app_role === 'WAREHOUSE') return 'warehouse';
  if (profile.app_role === 'DRIVER') return 'driver';
  if (profile.app_role === 'VIEWER') return 'viewer';
  return 'owner';
}

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'account') return 'Accounts';
  if (role === 'warehouse') return 'Warehouse';
  if (role === 'driver') return 'Driver';
  if (role === 'viewer') return 'Viewer';
  return 'Owner';
}

function mayAccess(role: Role, workspace: IntelligenceWorkspaceId) {
  if (role === 'account' && workspace === 'exceptions') return true;
  return canRoleAccessIntelligenceWorkspace(role, workspace);
}

function mayAccessNavigation(role: Role, item: NavigationItem) {
  if (item.roles && !item.roles.includes(role)) return false;
  return mayAccess(role, item.workspace);
}

function AccessState({ title, detail, actions }: { title: string; detail: string; actions?: ReactNode }) {
  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <div className="login-brand-row"><BrandMark large /><div><div className="login-brand-name">EcoFlow</div><div className="login-brand-subtitle">CONTROLLED OPERATIONS</div></div></div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {actions ? <div className="row-actions">{actions}</div> : null}
      </section>
    </main>
  );
}

function StandaloneWarehouseShell({ profile, onLogout, children }: { profile: EcoFlowAuthProfile; onLogout: () => void; children: ReactNode }) {
  return (
    <div className="warehouse-control-standalone" data-app-role="warehouse">
      <header className="warehouse-control-standalone-header">
        <BrandMark />
        <div><strong>EcoFlow Warehouse</strong><span>{profile.display_name || profile.email}</span></div>
        <nav><NavLink to="/warehouse-control">Warehouse Control</NavLink><NavLink to="/commissioning/product-identity">Product Setup</NavLink></nav>
        <button type="button" onClick={onLogout}>Logout</button>
      </header>
      <main>{children}</main>
    </div>
  );
}

function DesktopShell({
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
  const [quickKeys, setQuickKeys] = useState<string[]>([]);

  useEffect(() => {
    void readQuickActions()
      .then((result) => setQuickKeys(result.actionKeys))
      .catch(() => setQuickKeys([]));
  }, [profile.user_id]);

  const navigation = NAVIGATION.filter((item) => mayAccessNavigation(role, item));
  const quickActions = quickKeys
    .map((key) => ACTION_PATHS[key])
    .filter((item): item is NavigationItem => Boolean(item) && mayAccessNavigation(role, item));

  return (
    <div className="desktop-app" data-app-role={role} data-navigation-owner="react-router">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /><div><strong>EcoFlow</strong><span>{roleLabel(role).toUpperCase()}</span></div></div>
        <nav className="sidebar-nav">{navigation.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : undefined}>{item.label}</NavLink>)}</nav>
      </aside>
      <section className="desktop-main">
        <header className="desktop-topbar">
          <div className="topbar-title"><BrandMark /><div><strong>{profile.display_name || profile.email}</strong><span>{roleLabel(role).toUpperCase()} OPERATIONS</span></div></div>
          <div className="topbar-actions">
            {quickActions.map((item) => <NavLink key={item.path} className="soft-button" to={item.path}>{item.label}</NavLink>)}
            {(role === 'owner' || role === 'admin') ? <NavLink className="soft-button" to="/warehouse-control">Warehouse Control</NavLink> : null}
            <button type="button" onClick={onLogout}>Logout</button>
          </div>
        </header>
        <nav className="desktop-mobile-nav" aria-label="Sections">{navigation.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : undefined}>{item.label}</NavLink>)}</nav>
        <main className="desktop-content">{children}</main>
      </section>
    </div>
  );
}

function workspaceFromPath(pathname: string) {
  if (pathname === '/control-room') return 'control-room' as const;
  if (pathname === '/ordermentum') return 'ordermentum' as const;
  if (pathname === '/delivery') return 'delivery' as const;
  if (pathname === '/reconciliation') return 'reconciliation' as const;
  if (pathname === '/analytics') return 'analytics' as const;
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'orders' as const;
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory' as const;
  if (pathname === '/customers' || pathname.startsWith('/customers/') || pathname === '/stores' || pathname.startsWith('/stores/')) return 'stores' as const;
  if (pathname === '/exceptions') return 'exceptions' as const;
  if (pathname === '/logs') return 'logs' as const;
  if (pathname === '/settings') return 'settings' as const;
  if (pathname === '/warehouse-control' || pathname.startsWith('/warehouse-control/')) return 'warehouse-control' as const;
  if (pathname === '/commissioning/product-identity') return 'product-identity' as const;
  return null;
}

export default function OperationalStabilityRouteV2() {
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = workspaceFromPath(location.pathname);
  const authEnabled = hasSupabaseAuthClient() && Boolean(supabase);
  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [hasSession, setHasSession] = useState(false);
  const [profile, setProfile] = useState<EcoFlowAuthProfile | null>(() => readCachedProfile());
  const [authError, setAuthError] = useState('');

  const refreshProfile = useCallback(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('v_ecoflow_current_user').select('*').maybeSingle();
    if (error) {
      setAuthError(error.message);
      const sessionResult = await supabase.auth.getSession();
      const cached = readCachedProfile(sessionResult.data.session?.user.id);
      if (cached) setProfile(cached);
      return cached;
    }
    const next = (data ?? null) as EcoFlowAuthProfile | null;
    setProfile(next);
    writeCachedProfile(next);
    setAuthError('');
    return next;
  }, []);

  useEffect(() => {
    if (!authEnabled || !supabase) return;
    const client = supabase;
    let active = true;
    void client.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      setHasSession(Boolean(data.session));
      if (data.session) await refreshProfile();
      else {
        setProfile(null);
        writeCachedProfile(null);
      }
      if (active) setAuthChecked(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session));
      if (session) void refreshProfile().finally(() => setAuthChecked(true));
      else {
        setProfile(null);
        writeCachedProfile(null);
        setAuthChecked(true);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [authEnabled, refreshProfile]);

  const developmentProfile = useMemo<EcoFlowAuthProfile | null>(() => {
    if (!import.meta.env.DEV || authEnabled) return null;
    const appRole = (window.localStorage.getItem('ecoflow-role') || 'owner').toUpperCase() as EcoFlowAuthProfile['app_role'];
    return {
      user_id: '00000000-0000-4000-8000-000000000001',
      email: 'development@ecoflow.local',
      display_name: 'Development user',
      app_role: appRole,
      team_status: 'ACTIVE',
      is_active: true,
      invited_at: null,
      accepted_at: null,
      last_seen_at: null,
    };
  }, [authEnabled]);

  const effectiveProfile = profile ?? developmentProfile;
  const role = effectiveProfile ? roleFromProfile(effectiveProfile) : null;

  async function logout() {
    writeCachedProfile(null);
    if (supabase) await supabase.auth.signOut();
    setProfile(null);
    setHasSession(false);
    navigate('/control-room', { replace: true });
  }

  if (!workspace) return <AccessState title="Route unavailable" detail="This route is not part of the operational stability surface." />;
  if (authEnabled && !authChecked) return <AccessState title="Checking secure session" detail="EcoFlow is verifying the authenticated application role." />;
  if (authEnabled && !hasSession && supabase) {
    return (
      <EmailLoginScreen
        supabase={supabase}
        authError={authError}
        onSignedIn={async () => { await refreshProfile(); }}
        redirectTo={`${location.pathname}${location.search}`}
      />
    );
  }
  if (!effectiveProfile || !role) {
    return <AccessState title="Access profile unavailable" detail={authError || 'The secure session has no active EcoFlow application profile.'} actions={<button type="button" onClick={() => void refreshProfile()}>Retry profile</button>} />;
  }

  if (workspace === 'warehouse-control') {
    if (!['owner', 'admin', 'warehouse'].includes(role)) {
      return <AccessState title="Warehouse Control not authorised" detail="Only Owner, Admin and Warehouse roles can use physical inventory commands." actions={<button type="button" onClick={() => void logout()}>Logout</button>} />;
    }
    if (role === 'warehouse') {
      return <StandaloneWarehouseShell profile={effectiveProfile} onLogout={() => void logout()}><WarehouseControlWorkspace role={role} /></StandaloneWarehouseShell>;
    }
    return <DesktopShell role={role} profile={effectiveProfile} onLogout={() => void logout()}><WarehouseControlWorkspace role={role} /></DesktopShell>;
  }

  if (workspace === 'product-identity') {
    if (!['owner', 'admin', 'warehouse'].includes(role)) {
      return <AccessState title="Product Setup not authorised" detail="Only Owner, Admin and Warehouse roles can capture physical product evidence. Only Owner and Admin can verify or publish it." actions={<button type="button" onClick={() => void logout()}>Logout</button>} />;
    }
    if (role === 'warehouse') {
      return <StandaloneWarehouseShell profile={effectiveProfile} onLogout={() => void logout()}><ProductIdentityCommissioningWorkspace role={role} profile={effectiveProfile} /></StandaloneWarehouseShell>;
    }
    return <DesktopShell role={role} profile={effectiveProfile} onLogout={() => void logout()}><ProductIdentityCommissioningWorkspace role={role} profile={effectiveProfile} /></DesktopShell>;
  }

  const routeWorkspace: IntelligenceWorkspaceId = workspace === 'stores' ? 'customers' : workspace;
  if (!mayAccess(role, routeWorkspace)) {
    return <AccessState title="Workspace not authorised" detail={`${roleLabel(role)} does not have access to ${routeWorkspace}.`} actions={<button type="button" onClick={() => void logout()}>Logout</button>} />;
  }

  if (
    workspace === 'control-room'
    || workspace === 'ordermentum'
    || workspace === 'delivery'
    || workspace === 'reconciliation'
    || workspace === 'analytics'
  ) {
    const coreWorkspace = workspace === 'control-room' ? 'dashboard' : workspace;
    return (
      <DesktopShell role={role} profile={effectiveProfile} onLogout={() => void logout()}>
        <NativeCoreOperationalWorkspace
          workspace={coreWorkspace}
          role={role}
          profile={effectiveProfile}
        />
      </DesktopShell>
    );
  }

  const businessDay = businessDateFromIso(new Date().toISOString());
  return (
    <DesktopShell role={role} profile={effectiveProfile} onLogout={() => void logout()}>
      {workspace === 'settings'
        ? <OperationalSettingsWorkspace profile={effectiveProfile} />
        : <OperationalPagedWorkspace resource={workspace} role={role} profile={effectiveProfile} businessDay={businessDay} />}
    </DesktopShell>
  );
}
