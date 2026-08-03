import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applySupabaseOrdermentumViews, loadSupabaseOrdermentumViews } from '@/data/repositories/resilientOrdermentumViews';
import { applyDayStateToOrders, loadDriverDayState, saveDriverDayState, type DriverDayState } from '@/domain/driverRun';
import { buildProductionEmptyData } from '@/domain/productionData';
import { resolveTrustedLiveSnapshot, type TrustedLiveSnapshot } from '@/domain/trustedLiveSnapshot';
import type { DesktopTab, EcoFlowDataSet, Role } from '@/domain/types';
import { usePickSync } from '@/app/usePickSync';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NativeDeliveryWorkspace } from '@/features/delivery/NativeDeliveryWorkspace';
import { AnalyticsHealthConsole } from '@/features/intelligence/analytics';
import { OrdermentumWorkspacePage } from '@/features/ordermentum/OrdermentumWorkspacePage';
import { NativeReconciliationWorkspace } from '@/features/reconciliation/NativeReconciliationWorkspace';
import { NativeReturnsWorkspace } from '@/features/returns/NativeReturnsWorkspace';
import { pathForLegacyDesktopTab } from '@/features/intelligence/navigation/routeContract';
import { NativeWorkspaceUnavailable } from '@/features/navigation/NativeWorkspaceFrame';
import { hasSupabaseAuthClient } from '@/lib/supabaseClient';

const initialData = buildProductionEmptyData();

type NativeCoreWorkspace = 'dashboard' | 'ordermentum' | 'delivery' | 'returns' | 'reconciliation' | 'analytics';

type Props = {
  workspace: NativeCoreWorkspace;
  role: Role;
  profile: EcoFlowAuthProfile;
};

/**
 * Native business content without authentication or navigation ownership.
 * OperationalStabilityRouteV2 supplies the one authenticated App Shell.
 */
export function NativeCoreOperationalWorkspace({ workspace, role, profile }: Props) {
  const navigate = useNavigate();
  const authEnabled = hasSupabaseAuthClient();
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
      setHealthNotice(views.diagnostics
        .filter((row) => row.status === 'DEGRADED')
        .map((row) => row.source)
        .join(', '));
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
      void import('@/domain/sampleEcoflowData')
        .then(({ buildDevelopmentSampleData }) => {
          if (!active) return;
          const sample = buildDevelopmentSampleData();
          trustedRef.current = { data: sample, acceptedSequence: Date.now() };
          setData(sample);
          setOrders(sample.orders);
          setSnapshotReady(true);
        })
        .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
      return () => { active = false; };
    }
    void reloadViews();
    return undefined;
  }, [authEnabled, profile.user_id, reloadViews]);

  useEffect(() => {
    setDay(loadDriverDayState(data.businessDay.date));
  }, [data.businessDay.date]);

  useEffect(() => {
    saveDriverDayState(day);
  }, [day]);

  usePickSync(
    data.businessDay.date,
    day,
    setDay,
    profile.display_name || profile.email || 'Unified office route',
  );

  const effectiveOrders = useMemo(() => applyDayStateToOrders(orders, day), [day, orders]);
  const openTab = (tab: DesktopTab) => navigate(pathForLegacyDesktopTab(tab));

  if (workspace === 'analytics') return <AnalyticsHealthConsole role={role} />;
  if (workspace === 'returns') return <NativeReturnsWorkspace />;

  if (loadError && !snapshotReady && workspace !== 'dashboard' && workspace !== 'ordermentum') {
    return <NativeWorkspaceUnavailable label={workspace} detail={loadError} onRetry={() => void reloadViews()} />;
  }

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

  if (workspace === 'ordermentum') {
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

  if (workspace === 'delivery') {
    return (
      <NativeDeliveryWorkspace
        orders={effectiveOrders}
        day={day}
        setDay={setDay}
        businessDay={data.businessDay}
        canPlan={role === 'owner' || role === 'admin'}
      />
    );
  }

  return <NativeReconciliationWorkspace orders={effectiveOrders} businessDay={data.businessDay.date} />;
}
