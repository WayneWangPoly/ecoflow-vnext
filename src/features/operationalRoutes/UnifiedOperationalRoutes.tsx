import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { applySupabaseOrdermentumViews, loadSupabaseOrdermentumViews } from '@/data/repositories/resilientOrdermentumViews';
import { applyDayStateToOrders, loadDriverDayState, saveDriverDayState, type DriverDayState } from '@/domain/driverRun';
import { buildProductionEmptyData } from '@/domain/productionData';
import { resolveTrustedLiveSnapshot, type TrustedLiveSnapshot } from '@/domain/trustedLiveSnapshot';
import type { DesktopTab, EcoFlowDataSet, Role } from '@/domain/types';
import { businessDateFromIso } from '@/domain/syncModel';
import { usePickSync } from '@/app/usePickSync';
import { BrandMark } from '@/app/Brand';
import { EmailLoginScreen } from '@/features/auth/EmailLoginScreen';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { OrdermentumWorkspacePage } from '@/features/ordermentum/OrdermentumWorkspacePage';
import { ProductIdentityCommissioningWorkspace } from '@/features/productIdentity/ProductIdentityCommissioningWorkspace';
import {
  OperationalPagedWorkspace,
  OperationalSettingsWorkspace,
  WarehouseControlWorkspace,
} from '@/features/operationalStability/OperationalStabilityWorkspace';
import {
  pathForLegacyDesktopTab,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract';
import {
  OperationalAccessState,
  OperationalAppShell,
  mayAccessOperationalWorkspace,
  roleLabel,
} from '@/features/navigation/OperationalAppShell';
import { useOperationalSession } from '@/features/navigation/OperationalSessionContext';
import { WorkspaceRuntimeBoundary } from '@/features/navigation/WorkspaceRuntimeBoundary';
import { supabase } from '@/lib/supabaseClient';

const initialData = buildProductionEmptyData();

type UnifiedWorkspace =
  | 'dashboard'
  | 'ordermentum'
  | 'orders'
  | 'inventory'
  | 'product-identity'
  | 'stores'
  | 'exceptions'
  | 'logs'
  | 'settings'
  | 'warehouse-control';

type NativeWorkspace = Extract<UnifiedWorkspace, 'dashboard' | 'ordermentum'>;

export function unifiedOperationalWorkspace(pathname: string): UnifiedWorkspace | null {
  if (pathname === '/control-room') return 'dashboard';
  if (pathname === '/ordermentum') return 'ordermentum';
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'orders';
  if (pathname === '/inventory' || pathname.startsWith('/inventory/')) return 'inventory';
  if (pathname === '/commissioning/product-identity') return 'product-identity';
  if (pathname === '/customers' || pathname.startsWith('/customers/') || pathname === '/stores' || pathname.startsWith('/stores/')) return 'stores';
  if (pathname === '/exceptions') return 'exceptions';
  if (pathname === '/logs') return 'logs';
  if (pathname === '/settings') return 'settings';
  if (pathname === '/warehouse-control' || pathname.startsWith('/warehouse-control/')) return 'warehouse-control';
  return null;
}

function NativeUnifiedWorkspace({
  workspace,
  role,
  profile,
}: {
  workspace: NativeWorkspace;
  role: Role;
  profile: EcoFlowAuthProfile;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<EcoFlowDataSet>(initialData);
  const [orders, setOrders] = useState(initialData.orders);
  const [loadError, setLoadError] = useState('');
  const [healthNotice, setHealthNotice] = useState('');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const trustedRef = useRef<TrustedLiveSnapshot<EcoFlowDataSet> | null>(null);
  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(initialData.businessDay.date));

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
    if (import.meta.env.DEV && !supabase) {
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
    // Ordermentum still needs its aggregate operational model today. Control
    // Room owns the bounded bootstrap introduced by TRANSFORM-001 and calls
    // reloadViews only as secondary flow enrichment.
    if (workspace === 'ordermentum') void reloadViews();
    return undefined;
  }, [reloadViews, workspace]);

  useEffect(() => {
    setDay(loadDriverDayState(data.businessDay.date));
  }, [data.businessDay.date]);
  useEffect(() => saveDriverDayState(day), [day]);
  usePickSync(data.businessDay.date, day, setDay, profile.display_name || profile.email || 'Unified office route');

  const effectiveOrders = useMemo(() => applyDayStateToOrders(orders, day), [day, orders]);
  const openTab = (tab: DesktopTab) => navigate(pathForLegacyDesktopTab(tab));

  if (workspace === 'dashboard') {
    return (
      <DashboardPage
        role={role}
        data={data}
        orders={effectiveOrders}
        snapshotReady={snapshotReady}
        loading={snapshotLoading}
        loadError={loadError || undefined}
        healthNotice={healthNotice || undefined}
        onReload={reloadViews}
        onOpenTab={openTab}
      />
    );
  }

  return (
    <OrdermentumWorkspacePage
      orders={effectiveOrders}
      setOrders={setOrders}
      data={data}
      mappingExceptions={data.mappingExceptions}
      day={day}
      setDay={setDay}
      loading={snapshotLoading}
      available={snapshotReady}
      loadError={loadError || undefined}
      healthNotice={healthNotice || undefined}
      onReload={reloadViews}
    />
  );
}

function WarehouseStandalone({ role, onLogout }: { role: Role; onLogout: () => void }) {
  return (
    <div className="warehouse-control-standalone">
      <header className="warehouse-control-standalone-header">
        <BrandMark />
        <strong>EcoFlow Warehouse Control</strong>
        <button type="button" onClick={onLogout}>Logout</button>
      </header>
      <main><WarehouseControlWorkspace role={role} /></main>
    </div>
  );
}

function ProductIdentityStandalone({
  role,
  profile,
  onLogout,
}: {
  role: Role;
  profile: EcoFlowAuthProfile;
  onLogout: () => void;
}) {
  return (
    <div className="warehouse-control-standalone product-identity-standalone">
      <header className="warehouse-control-standalone-header">
        <BrandMark />
        <strong>EcoFlow Product Identity</strong>
        <button type="button" onClick={onLogout}>Logout</button>
      </header>
      <main>
        <WorkspaceRuntimeBoundary workspace="product-identity">
          <ProductIdentityCommissioningWorkspace role={role} profile={profile} />
        </WorkspaceRuntimeBoundary>
      </main>
    </div>
  );
}

export default function UnifiedOperationalRoutes() {
  const location = useLocation();
  const workspace = unifiedOperationalWorkspace(location.pathname);
  const {
    authEnabled,
    authChecked,
    hasSession,
    profile,
    role,
    authError,
    refreshProfile,
    logout,
  } = useOperationalSession();

  if (!workspace) {
    return <OperationalAccessState title="Route unavailable" detail="This path is not owned by the unified operational application." />;
  }
  if (authEnabled && !authChecked) {
    return <OperationalAccessState title="Checking secure session" detail="EcoFlow is verifying the authenticated application role once for the operational application." />;
  }
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
  if (!profile || !role) {
    return (
      <OperationalAccessState
        title="Access profile unavailable"
        detail={authError || 'The secure session has no active EcoFlow application profile.'}
        actions={<button type="button" onClick={() => void refreshProfile()}>Retry profile</button>}
      />
    );
  }

  if (workspace === 'warehouse-control') {
    if (!['owner', 'admin', 'warehouse'].includes(role)) {
      return (
        <OperationalAccessState
          title="Warehouse Control not authorised"
          detail="Only Owner, Admin and Warehouse roles can use physical inventory commands."
          actions={<button type="button" onClick={() => void logout()}>Logout</button>}
        />
      );
    }
    if (role === 'warehouse') return <WarehouseStandalone role={role} onLogout={() => void logout()} />;
    return (
      <OperationalAppShell role={role} profile={profile} onLogout={() => void logout()}>
        <WarehouseControlWorkspace role={role} />
      </OperationalAppShell>
    );
  }

  if (workspace === 'product-identity') {
    if (role === 'driver') {
      return (
        <OperationalAccessState
          title="Product Identity not authorised"
          detail="Driver accounts cannot read or change warehouse product identity."
          actions={<button type="button" onClick={() => void logout()}>Logout</button>}
        />
      );
    }
    if (role === 'warehouse') {
      return <ProductIdentityStandalone role={role} profile={profile} onLogout={() => void logout()} />;
    }
    if (!mayAccessOperationalWorkspace(role, 'product-identity')) {
      return (
        <OperationalAccessState
          title="Product Identity not authorised"
          detail={`${roleLabel(role)} does not have Product Identity access.`}
          actions={<button type="button" onClick={() => void logout()}>Logout</button>}
        />
      );
    }
    return (
      <OperationalAppShell role={role} profile={profile} onLogout={() => void logout()}>
        <WorkspaceRuntimeBoundary workspace="product-identity">
          <ProductIdentityCommissioningWorkspace role={role} profile={profile} />
        </WorkspaceRuntimeBoundary>
      </OperationalAppShell>
    );
  }

  if (role === 'warehouse' || role === 'driver') {
    return (
      <OperationalAccessState
        title="Desktop workspace not available for this role"
        detail="Warehouse and Driver accounts use their dedicated operational surfaces. Capability is determined from authenticated role state."
        actions={<button type="button" onClick={() => void logout()}>Logout</button>}
      />
    );
  }

  const routeWorkspace: IntelligenceWorkspaceId = workspace === 'dashboard'
    ? 'control-room'
    : workspace === 'stores'
      ? 'customers'
      : workspace;
  if (!mayAccessOperationalWorkspace(role, routeWorkspace)) {
    return (
      <OperationalAppShell role={role} profile={profile} onLogout={() => void logout()}>
        <OperationalAccessState title="Workspace not authorised" detail={`${roleLabel(role)} does not have access to ${routeWorkspace}.`} />
      </OperationalAppShell>
    );
  }

  const businessDay = businessDateFromIso(new Date().toISOString());
  let content;
  if (workspace === 'dashboard' || workspace === 'ordermentum') {
    content = <NativeUnifiedWorkspace workspace={workspace} role={role} profile={profile} />;
  } else if (workspace === 'settings') {
    content = <OperationalSettingsWorkspace profile={profile} />;
  } else {
    content = <OperationalPagedWorkspace resource={workspace} role={role} profile={profile} businessDay={businessDay} />;
  }

  return (
    <OperationalAppShell role={role} profile={profile} onLogout={() => void logout()}>
      <WorkspaceRuntimeBoundary workspace={workspace}>
        {content}
      </WorkspaceRuntimeBoundary>
    </OperationalAppShell>
  );
}
