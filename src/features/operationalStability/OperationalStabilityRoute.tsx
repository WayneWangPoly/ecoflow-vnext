import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/app/Brand';
import { EmailLoginScreen } from '@/features/auth/EmailLoginScreen';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import type { Role } from '@/domain/types';
import { businessDateFromIso } from '@/domain/syncModel';
import { hasSupabaseAuthClient, supabase } from '@/lib/supabaseClient';
import { canRoleAccessIntelligenceWorkspace, type IntelligenceWorkspaceId } from '@/features/intelligence/navigation/routeContract';
import { readQuickActions } from '@/data/repositories/operationalStability';
import { OperationalPagedWorkspace, OperationalSettingsWorkspace, WarehouseControlWorkspace } from './OperationalStabilityWorkspace';
import '@/features/navigation/nativeOperationalRoutes.css';

const PROFILE_CACHE_KEY = 'ecoflow:last-verified-profile';
const ACTION_PATHS: Record<string, { label: string; path: string; workspace: IntelligenceWorkspaceId }> = {
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

const NAVIGATION = [
  ACTION_PATHS.CONTROL_ROOM,
  { label: 'Ordermentum', path: '/ordermentum', workspace: 'ordermentum' as const },
  ACTION_PATHS.ORDERS,
  ACTION_PATHS.INVENTORY,
  ACTION_PATHS.CUSTOMERS,
  ACTION_PATHS.EXCEPTIONS,
  ACTION_PATHS.DELIVERY,
  { label: 'Reconciliation', path: '/reconciliation', workspace: 'reconciliation' as const },
  ACTION_PATHS.ANALYTICS,
  ACTION_PATHS.LOGS,
  ACTION_PATHS.SETTINGS,
] as const;

function cachedProfile(userId?: string | null) {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EcoFlowAuthProfile;
    if (!parsed.user_id || !parsed.app_role || (userId && parsed.user_id !== userId)) return null;
    return parsed;
  } catch { return null; }
}

function cacheProfile(profile: EcoFlowAuthProfile | null) {
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

function AccessState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <main className="login-page"><section className="login-card" role="alert"><div className="login-brand-row"><BrandMark large /><div><div className="login-brand-name">EcoFlow</div><div className="login-brand-subtitle">CONTROLLED OPERATIONS</div></div></div><h1>{title}</h1><p>{detail}</p>{action ? <div className="row-actions">{action}</div> : null}</section></main>;
}

function DesktopShell({ role, profile, onLogout, children }: { role: Role; profile: EcoFlowAuthProfile; onLogout: () => void; children: ReactNode }) {
  const [quickKeys, setQuickKeys] = useState<string[]>([]);
  useEffect(() => { void readQuickActions().then((result) => setQuickKeys(result.actionKeys)).catch(() => setQuickKeys([])); }, [profile.user_id]);
  const navigation = NAVIGATION.filter((item) => canRoleAccessIntelligenceWorkspace(role, item.workspace));
  const quickActions = quickKeys.map((key) => ACTION_PATHS[key]).filter((item): item is { label: string; path: string; workspace: IntelligenceWorkspaceId } => Boolean(item) && canRoleAccessIntelligenceWorkspace(role, item.workspace));
  return <div className="desktop-app" data-app-role={role} data-navigation-owner="react-router">
    <aside className="sidebar"><div className="sidebar-brand"><BrandMark /><div><strong>EcoFlow</strong><span>{roleLabel(role).toUpperCase()}</span></div></div><nav className="sidebar-nav">{navigation.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : undefined}>{item.label}</NavLink>)}</nav></aside>
    <section className="desktop-main">
      <header className="desktop-topbar"><div className="topbar-title"><BrandMark /><div><strong>{profile.display_name || profile.email}</strong><span>{roleLabel(role).toUpperCase()} OPERATIONS</span></div></div><div className="topbar-actions">{quickActions.map((item) => <NavLink key={item.path} className="soft-button" to={item.path}>{item.label}</NavLink>)}{(role === 'owner' || role === 'admin') ? <a className="soft-button" href="/warehouse-control">Warehouse Control</a> : null}<button type="button" onClick={onLogout}>Logout</button></div></header>
      <nav className="desktop-mobile-nav" aria-label="Sections">{navigation.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : undefined}>{item.label}</NavLink>)}</nav>
      <main className="desktop-content">{children}</main>
    </section>
  </div>;
}

function workspaceFromPath(pathname: string) {
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'orders' as const;
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory' as const;
  if (pathname === '/customers' || pathname.startsWith('/customers/') || pathname === '/stores' || pathname.startsWith('/stores/')) return 'stores' as const;
  if (pathname === '/exceptions') return 'exceptions' as const;
  if (pathname === '/logs') return 'logs' as const;
  if (pathname === '/settings') return 'settings' as const;
  if (pathname === '/warehouse-control' || pathname.startsWith('/warehouse-control/')) return 'warehouse-control' as const;
  return null;
}

export default function OperationalStabilityRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = workspaceFromPath(location.pathname);
  const authEnabled = hasSupabaseAuthClient() && Boolean(supabase);
  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [hasSession, setHasSession] = useState(false);
  const [profile, setProfile] = useState<EcoFlowAuthProfile | null>(() => cachedProfile());
  const [authError, setAuthError] = useState('');

  const refreshProfile = useCallback(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('v_ecoflow_current_user').select('*').maybeSingle();
    if (error) {
      setAuthError(error.message);
      const session = await supabase.auth.getSession();
      const cached = cachedProfile(session.data.session?.user.id);
      if (cached) setProfile(cached);
      return cached;
    }
    const next = (data ?? null) as EcoFlowAuthProfile | null;
    setProfile(next); cacheProfile(next); setAuthError('');
    return next;
  }, []);

  useEffect(() => {
    if (!authEnabled || !supabase) return;
    let active = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      setHasSession(Boolean(data.session));
      if (data.session) await refreshProfile();
      else { setProfile(null); cacheProfile(null); }
      if (active) setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session));
      if (session) void refreshProfile().finally(() => setAuthChecked(true));
      else { setProfile(null); cacheProfile(null); setAuthChecked(true); }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [authEnabled, refreshProfile]);

  const developmentProfile = useMemo<EcoFlowAuthProfile | null>(() => {
    if (!import.meta.env.DEV || authEnabled) return null;
    const role = (window.localStorage.getItem('ecoflow-role') || 'owner').toUpperCase() as EcoFlowAuthProfile['app_role'];
    return { user_id: '00000000-0000-4000-8000-000000000001', email: 'development@ecoflow.local', display_name: 'Development user', app_role: role, team_status: 'ACTIVE', is_active: true, invited_at: null, accepted_at: null, last_seen_at: null };
  }, [authEnabled]);
  const effectiveProfile = profile ?? developmentProfile;
  const role = effectiveProfile ? roleFromProfile(effectiveProfile) : null;

  async function logout() {
    cacheProfile(null);
    if (supabase) await supabase.auth.signOut();
    setProfile(null); setHasSession(false); navigate('/control-room', { replace: true });
  }

  if (!workspace) return <AccessState title="Route unavailable" detail="This route is not part of the operational stability surface." />;
  if (authEnabled && !authChecked) return <AccessState title="Checking secure session" detail="EcoFlow is verifying your authenticated application role." />;
  if (authEnabled && !hasSession && supabase) return <EmailLoginScreen supabase={supabase} authError={authError} onSignedIn={refreshProfile} redirectTo={`${location.pathname}${location.search}`} />;
  if (!effectiveProfile || !role) return <AccessState title="Access profile unavailable" detail={authError || 'The secure session has no active EcoFlow application profile.'} action={<button type="button" onClick={() => void refreshProfile()}>Retry profile</button>} />;

  if (workspace === 'warehouse-control') {
    if (!['owner', 'admin', 'warehouse'].includes(role)) return <AccessState title="Warehouse Control not authorised" detail="Only Owner, Admin and Warehouse roles can use physical inventory commands." action={<button type="button" onClick={() => void logout()}>Logout</button>} />;
    if (role === 'warehouse') return <div className="warehouse-control-standalone"><header className="warehouse-control-standalone-header"><BrandMark /><strong>EcoFlow Warehouse Control</strong><button type="button" onClick={() => void logout()}>Logout</button></header><main><WarehouseControlWorkspace role={role} /></main></div>;
    return <DesktopShell role={role} profile={effectiveProfile} onLogout={() => void logout()}><WarehouseControlWorkspace role={role} /></DesktopShell>;
  }

  const intelligenceWorkspace: IntelligenceWorkspaceId = workspace === 'stores' ? 'customers' : workspace;
  if (!canRoleAccessIntelligenceWorkspace(role, intelligenceWorkspace)) return <AccessState title="Workspace not authorised" detail={`${roleLabel(role)} does not have access to ${intelligenceWorkspace}.`} action={<button type="button" onClick={() => void logout()}>Logout</button>} />;
  const businessDay = businessDateFromIso(new Date().toISOString());

  return <DesktopShell role={role} profile={effectiveProfile} onLogout={() => void logout()}>
    {workspace === 'settings' ? <OperationalSettingsWorkspace profile={effectiveProfile} /> : <OperationalPagedWorkspace resource={workspace} role={role} profile={effectiveProfile} businessDay={businessDay} />}
  </DesktopShell>;
}
