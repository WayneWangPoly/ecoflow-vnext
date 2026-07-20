import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { ProductionWriteSafety } from './ProductionWriteSafety';
import { OperationalDensityEnhancer } from './OperationalDensityEnhancer';
import { RoleIdentityEnhancer } from './RoleIdentityEnhancer';
import { observeBody } from './lib/domObserver';
import { pruneEcoflowStorage } from './domain/driverRun';
import { hasSupabaseAuthClient } from './lib/supabaseClient';
import './styles.css';
import './fieldMode.css';
import './brandLockup.css';
import './industrialTheme.css';
import './ownerCommandCenter.css';
import './dashboardLayoutStability.css';
import './conciseOperationalUi.css';

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';
const productionConfigurationMissing = import.meta.env.PROD && !hasSupabaseAuthClient();

pruneEcoflowStorage();

// Warehouse Map is a protected route feature, not an authentication role.
const FieldModeEnhancer = lazy(() => import('./FieldModeEnhancer').then((m) => ({ default: m.FieldModeEnhancer })));
const OwnerEnhancers = lazy(() => import('./enhancers/OwnerEnhancers'));
const AccountEnhancers = lazy(() => import('./enhancers/AccountEnhancers'));
const ViewerEnhancers = lazy(() => import('./enhancers/ViewerEnhancers'));
const DriverEnhancers = lazy(() => import('./enhancers/DriverEnhancers'));
const WarehouseOpsEnhancers = lazy(() => import('./enhancers/WarehouseOpsEnhancers'));
const WarehouseMapRouteModules = lazy(() => import('./enhancers/WarehouseMapRouteModules'));
const WarehouseMapRoute = lazy(() => import('./features/warehouse/WarehouseMapRoute'));

type DesktopRole = 'owner' | 'account' | 'viewer' | null;
type SurfaceGroups = {
  desktopRole: DesktopRole;
  driver: boolean;
  warehouseOps: boolean;
  warehouseMapRoute: boolean;
};

function detectDesktopRole(): DesktopRole {
  const desktop = document.querySelector<HTMLElement>('.desktop-app');
  if (!desktop) return null;

  const roleText = document.querySelector<HTMLElement>('.sidebar-brand span')?.textContent?.trim().toUpperCase() || '';
  if (roleText.includes('ACCOUNT')) return 'account';
  if (roleText.includes('VIEWER')) return 'viewer';
  if (roleText.includes('OWNER') || roleText.includes('ADMIN')) return 'owner';

  if (desktop.querySelector('select[aria-label="Open workspace"]')) return 'owner';

  const navLabels = new Set(
    Array.from(desktop.querySelectorAll<HTMLButtonElement>('.sidebar-nav button'))
      .map((button) => button.textContent?.trim().toUpperCase() || '')
      .filter(Boolean),
  );
  if (navLabels.has('ORDERMENTUM') && navLabels.has('INVENTORY') && navLabels.has('LOGS')) return 'owner';
  if (navLabels.has('STORES') && navLabels.has('SETTINGS') && !navLabels.has('INVENTORY')) return 'account';
  if (navLabels.has('INVENTORY') && navLabels.has('LOGS') && !navLabels.has('SETTINGS')) return 'viewer';

  const stored = window.localStorage.getItem('ecoflow-role');
  if (stored === 'account') return 'account';
  if (stored === 'viewer') return 'viewer';
  if (stored === 'owner' || stored === 'admin') return 'owner';
  return null;
}

function detectSurfaces(): SurfaceGroups {
  const desktopPresent = Boolean(document.querySelector('.desktop-app'));
  return {
    desktopRole: desktopPresent ? detectDesktopRole() : null,
    driver: Boolean(document.querySelector('.driver-shell')),
    warehouseOps: !isWarehouseMapRoute && Boolean(document.querySelector('.mobile-shell')),
    warehouseMapRoute: isWarehouseMapRoute,
  };
}

function sameSurfaces(left: SurfaceGroups, right: SurfaceGroups) {
  return left.desktopRole === right.desktopRole
    && left.driver === right.driver
    && left.warehouseOps === right.warehouseOps
    && left.warehouseMapRoute === right.warehouseMapRoute;
}

function SurfaceModuleGate() {
  const [groups, setGroups] = useState<SurfaceGroups>(detectSurfaces);

  useEffect(() => {
    const stopObserving = observeBody(() => {
      setGroups((previous) => {
        const next = detectSurfaces();
        return sameSurfaces(previous, next) ? previous : next;
      });
    });
    return stopObserving;
  }, []);

  return (
    <Suspense fallback={null}>
      {groups.desktopRole === 'owner' ? <OwnerEnhancers /> : null}
      {groups.desktopRole === 'account' ? <AccountEnhancers /> : null}
      {groups.desktopRole === 'viewer' ? <ViewerEnhancers /> : null}
      {groups.driver ? <DriverEnhancers /> : null}
      {groups.warehouseOps ? <WarehouseOpsEnhancers /> : null}
      {groups.warehouseMapRoute ? <WarehouseMapRouteModules /> : null}
    </Suspense>
  );
}

function ProductionConfigurationError() {
  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <div className="login-brand-name">EcoFlow</div>
        <div className="login-brand-subtitle">SECURE ACCESS REQUIRED</div>
        <h1>Production configuration is incomplete</h1>
        <p>The live Supabase URL or anonymous access key is missing. EcoFlow is locked rather than falling back to shared role passcodes.</p>
        <p>Restore the production environment variables and redeploy before warehouse, driver, accounts or owner work continues.</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {productionConfigurationMissing ? (
        <ProductionConfigurationError />
      ) : (
        <>
          <ProductionWriteSafety />
          <OperationalDensityEnhancer />
          <RoleIdentityEnhancer />
          <Suspense fallback={null}>
            <FieldModeEnhancer />
          </Suspense>
          <SurfaceModuleGate />
          {isWarehouseMapRoute ? (
            <Suspense fallback={<main className="warehouse-map-page"><div className="warehouse-map-card">Checking Warehouse Map access…</div></main>}>
              <WarehouseMapRoute />
            </Suspense>
          ) : (
            <App />
          )}
        </>
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
