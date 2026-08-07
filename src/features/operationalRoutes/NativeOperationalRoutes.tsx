import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { applySupabaseOrdermentumViews, loadSupabaseOrdermentumViews } from '@/data/repositories/resilientOrdermentumViews';
import { applyDayStateToOrders, loadDriverDayState, saveDriverDayState, type DriverDayState } from '@/domain/driverRun';
import { buildProductionEmptyData } from '@/domain/productionData';
import { resolveTrustedLiveSnapshot, type TrustedLiveSnapshot } from '@/domain/trustedLiveSnapshot';
import type { DesktopTab, EcoFlowDataSet, Role } from '@/domain/types';
import { usePickSync } from '@/app/usePickSync';
import { BrandMark } from '@/app/Brand';
import { EmailLoginScreen } from '@/features/auth/EmailLoginScreen';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { InventoryWorkspacePage } from '@/features/inventory/InventoryWorkspacePage';
import { OrdermentumWorkspacePage } from '@/features/ordermentum/OrdermentumWorkspacePage';
import { StoresWorkspacePage } from '@/features/stores/StoresWorkspacePage';
import { canRoleAccessIntelligenceWorkspace, pathForLegacyDesktopTab, type IntelligenceWorkspaceId } from '@/features/intelligence/navigation/routeContract';
import { hasSupabaseAuthClient, supabase } from '@/lib/supabaseClient';
import '@/features/navigation/nativeOperationalRoutes.css';

const initialData = buildProductionEmptyData();
const AUTH_PROFILE_CACHE_KEY = 'ecoflow:last-verified-profile';

type NativeWorkspace = 'dashboard' | 'ordermentum' | 'inventory' | 'stores';

type NavigationItem = {
  tab: DesktopTab;
  label: string;
  path: string;
  workspace: IntelligenceWorkspaceId;
};

const NAVIGATION: readonly NavigationItem[] = [
  { tab: 'dashboard', label: 'Dashboard', path: '/control-room', workspace: 'control-room' },
  { tab: 'ordermentum', label: 'Ordermentum', path: '/ordermentum', workspace: 'ordermentum' },
  { tab: 'orders', label: 'Orders', path: '/orders', workspace: 'orders' },
  { tab: 'delivery', label: 'Delivery', path: '/delivery', workspace: 'delivery' },
  { tab: 'inventory', label: 'Inventory', path: '/inventory', workspace: 'inventory' },
  { tab: 'stores', label: 'Stores', path: '/customers', workspace: 'stores' },
  { tab: 'reconciliation', label: 'Reconciliation', path: '/reconciliation', workspace: 'reconciliation' },
  { tab: 'analytics', label: 'Analytics', path: '/analytics', workspace: 'analytics' },
  { tab: 'logs', label: 'Logs', path: '/logs', workspace: 'logs' },
  { tab: 'settings', label: 'Settings', path: '/settings', workspace: 'settings' },
];

function readCachedProfile(userId?: string | null) {
  try {
    const raw = window.sessionStorage.getItem(AUTH_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EcoFlowAuthProfile;
    if (!parsed?.user_id || !parsed.app_role) return null;
    if (userId && parsed.user_id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: EcoFlowAuthProfile | null) {
  if (!profile) window.sessionStorage.removeItem(AUTH_PROFILE_CACHE_KEY);
  else window.sessionStorage.setItem(AUTH_PROFILE_CACHE_KEY, JSON.stringify(profile));
}

function roleFromProfile(profile: EcoFlowAuthProfile): Role {
  if (profile.app_role === 'ADMIN') return 'admin';
  if (profile.app_role === 'ACCOUNT') return 'account';
  if (profile.app_role === 'VIEWER') return 'viewer';
  if (profile.app_role === 'WAREHOUSE') return 'warehouse';
  if (profile.app_role === 'DRIVER') return 'driver';
  return 'owner';
}

function workspaceFromPath(pathname: string): NativeWorkspace | null {
  if (pathname === '/control-room') return 'dashboard';
  if (pathname === '/ordermentum') return 'ordermentum';
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory';
  if (pathname === '/customers' || pathname.startsWith('/customers/') || pathname === '/stores' || pathname.startsWith('/stores/')) return 'stores';
  return null;
}

function intelligenceWorkspace(workspace: NativeWorkspace): IntelligenceWorkspaceId {
  if (workspace === 'dashboard') return 'control-room';
  return workspace;
}

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'account') return 'Account';
  if (role === 'viewer') return 'Viewer';
  if (role === 'warehouse') return 'Warehouse';
  if (role === 'driver') return 'Driver';
  return 'Owner';
}

function ShellState({ title, detail, actions }: { title: string; detail: string; actions?: ReactNode }) {
  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <div className="login-brand-row">
          <BrandMark large />
          <div><div className="login-brand-name">EcoFlow</div><div className="login-brand-subtitle">NATIVE OPERATIONAL ROUTE</div></div>
        </div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {actions ? <div className="row-actions">{actions}</div> : null}
      </section>
    </main>
  );
}

function NativeDesktopShell({ role, onLogout, children }: { role: Role; onLogout: () => void; children: ReactNode }) {
  const items = NAVIGATION.filter((item) => canRoleAccessIntelligenceWorkspace(role, item.workspace));
  return (
    <div className="desktop-app" data-app-role={role} data-navigation-owner="react-router">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /><div><strong>EcoFlow</strong><span>{roleLabel(role).toUpperCase()}</span></div></div>
        <nav className="sidebar-nav">
          {items.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : ''}>{item.label}</NavLink>)}
        </nav>
      </aside>
      <section className="desktop-main">
        <header className="desktop-topbar">
          <div className="topbar-title"><BrandMark /><div><strong>EcoFlow</strong><span>{role === 'account' ? 'ACCOUNTS OPERATIONS' : `${roleLabel(role).toUpperCase()} OPERATIONS`}</span></div></div>
          <div className="topbar-actions">
            {(role === 'owner' || role === 'admin') ? <a className="soft-button" href="/warehouse-map">Warehouse Map</a> : null}
            <button type="button" onClick={onLogout}>Logout</button>
          </div>
        </header>
        <nav className="desktop-mobile-nav" aria-label="Sections">
          {items.map((item) => <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? 'active' : ''}>{item.label}</NavLink>)}
        </nav>
        <main className="desktop-content">{children}</main>
      </section>
    </div>
  );
}

export default function NativeOperationalRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = workspaceFromPath(location.pathname);
  const authEnabled = hasSupabaseAuthClient() && Boolean(supabase);
  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [hasSession, setHasSession] = useState(false);
  const [profile, setProfile] = useState<EcoFlowAuthProfile | null>(() => readCachedProfile());
  const [authError, setAuthError] = useState('');
  const [data, setData] = useState<EcoFlowDataSet>(initialData);
  const [orders, setOrders] = useState(initialData.orders);
  const [loadError, setLoadError] = useState('');
  const [healthNotice, setHealthNotice] = useState('');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const trustedRef = useRef<TrustedLiveSnapshot<EcoFlowDataSet> | null>(null);
  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(initialData.businessDay.date));

  const role = profile
    ? roleFromProfile(profile)
    : import.meta.env.DEV
      ? ((window.localStorage.getItem('ecoflow-role') as Role | null) || 'owner')
      : null;

  const refreshProfile = useCallback(async () => {
    if (!supabase) return null;
    const { data: current, error } = await supabase.from('v_ecoflow_current_user').select('*').maybeSingle();
    if (error) {
      setAuthError(error.message);
      const sessionResult = await supabase.auth.getSession();
      const cached = readCachedProfile(sessionResult.data.session?.user.id);
      if (cached) {
        setProfile(cached);
        return cached;
      }
      return null;
    }
    const next = (current ?? null) as EcoFlowAuthProfile | null;
    setProfile(next);
    writeCachedProfile(next);
    setAuthError('');
    return next;
  }, []);

  useEffect(() => {
    if (!authEnabled || !supabase) return;
    const client = supabase;
    let active = true;
    void client.auth.getSession().then(async ({ data: sessionData, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(error.message);
        setAuthChecked(true);
        return;
      }
      setHasSession(Boolean(sessionData.session));
      if (sessionData.session) await refreshProfile();
      else {
        setProfile(null);
        writeCachedProfile(null);
      }
      if (active) setAuthChecked(true);
    });
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
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
      subscription.subscription.unsubscribe();
    };
  }, [authEnabled, refreshProfile]);

  const reloadViews = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const views = await loadSupabaseOrdermentumViews();
      if (!views) throw new Error('Supabase live views are not configured.');
      const next = applySupabaseOrdermentumViews(initialData, views);
      const resolved = resolveTrustedLiveSnapshot(trustedRef.current, next, Date.now());
      if (!resolved.snapshot) throw new Error('Supabase returned no trusted live snapshot.');
      trustedRef.current = resolved.snapshot;
      setData(resolved.snapshot.data);
      setOrders(resolved.snapshot.data.orders);
      setSnapshotReady(true);
      setHealthNotice(views.diagnostics.filter((row) => row.status === 'DEGRADED').map((row) => row.source).join(', '));
      setLoadError('');
    } catch (error) {
      const resolved = resolveTrustedLiveSnapshot(trustedRef.current, null, Date.now());
      const safeData = resolved.snapshot?.data ?? initialData;
      setData(safeData);
      setOrders(safeData.orders);
      setSnapshotReady(resolved.source === 'last-trusted');
      setLoadError(error instanceof Error ? error.message : 'Live operational data is unavailable.');
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && !authEnabled) {
      let active = true;
      void import('@/domain/sampleEcoflowData').then(({ buildDevelopmentSampleData }) => {
        if (!active) return;
        const sample = buildDevelopmentSampleData();
        trustedRef.current = { data: sample, acceptedSequence: Date.now() };
        setData(sample);
        setOrders(sample.orders);
        setSnapshotReady(true);
      }).catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
      return () => { active = false; };
    }
    // Control Room has its own bounded bootstrap. Loading the aggregate
    // operational snapshot here made the homepage wait for thousands of rows.
    // Other native workspaces keep the legacy aggregate loader until their
    // transformation phases move them to bounded read models too.
    if (authEnabled && profile?.user_id && workspace !== 'dashboard') void reloadViews();
    return undefined;
  }, [authEnabled, profile?.user_id, reloadViews, workspace]);

  useEffect(() => {
    setDay(loadDriverDayState(data.businessDay.date));
  }, [data.businessDay.date]);
  useEffect(() => saveDriverDayState(day), [day]);
  usePickSync(data.businessDay.date, day, setDay, profile?.display_name || profile?.email || 'Native office route');

  const effectiveOrders = useMemo(() => applyDayStateToOrders(orders, day), [day, orders]);

  async function logout() {
    writeCachedProfile(null);
    if (supabase) await supabase.auth.signOut();
    setHasSession(false);
    setProfile(null);
    trustedRef.current = null;
    navigate('/control-room', { replace: true });
  }

  if (!workspace) return <ShellState title="Route unavailable" detail="This path is not owned by the native operational route shell." />;
  if (authEnabled && !authChecked) return <ShellState title="Checking secure session" detail="EcoFlow is verifying the authenticated user and application role." />;
  if (authEnabled && !hasSession && supabase) {
    return <EmailLoginScreen supabase={supabase} authError={authError} onSignedIn={async () => { await refreshProfile(); }} redirectTo={`${location.pathname}${location.search}`} />;
  }
  if (authEnabled && hasSession && !profile) {
    return <ShellState title="Access profile unavailable" detail={authError || 'The secure session is active, but the application profile could not be read.'} actions={<><button type="button" className="primary-button" onClick={() => void refreshProfile()}>Retry profile</button><button type="button" onClick={() => void logout()}>Logout</button></>} />;
  }
  if (!role || role === 'warehouse' || role === 'driver') {
    return <ShellState title="Desktop workspace not available for this role" detail="Warehouse and Driver accounts use their dedicated operational surfaces. Branding text cannot change this capability boundary." actions={<button type="button" onClick={() => void logout()}>Logout</button>} />;
  }

  const accessWorkspace = intelligenceWorkspace(workspace);
  if (!canRoleAccessIntelligenceWorkspace(role, accessWorkspace)) {
    return (
      <NativeDesktopShell role={role} onLogout={() => void logout()}>
        <ShellState title="Workspace not authorised" detail={`${roleLabel(role)} does not have access to ${accessWorkspace}. The decision comes from typed role state, not visible navigation text.`} />
      </NativeDesktopShell>
    );
  }

  const openTab = (tab: DesktopTab) => navigate(pathForLegacyDesktopTab(tab));

  return (
    <NativeDesktopShell role={role} onLogout={() => void logout()}>
      {workspace === 'dashboard' ? <DashboardPage role={role} data={data} orders={effectiveOrders} snapshotReady={snapshotReady} loading={snapshotLoading} loadError={loadError || undefined} healthNotice={healthNotice || undefined} onReload={reloadViews} onOpenTab={openTab} /> : null}
      {workspace === 'ordermentum' ? <OrdermentumWorkspacePage orders={effectiveOrders} setOrders={setOrders} data={data} mappingExceptions={data.mappingExceptions} day={day} setDay={setDay} loading={snapshotLoading} available={snapshotReady} loadError={loadError || undefined} healthNotice={healthNotice || undefined} onReload={reloadViews} /> : null}
      {workspace === 'inventory' ? <InventoryWorkspacePage stock={data.stock} catalog={data.catalog} loading={snapshotLoading} available={snapshotReady} loadError={loadError || undefined} healthNotice={healthNotice || undefined} onReload={reloadViews} /> : null}
      {workspace === 'stores' ? <StoresWorkspacePage stores={data.stores} loading={snapshotLoading} available={snapshotReady} loadError={loadError || undefined} healthNotice={healthNotice || undefined} onReload={reloadViews} /> : null}
    </NativeDesktopShell>
  );
}