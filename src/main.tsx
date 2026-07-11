import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { FieldModeEnhancer } from './FieldModeEnhancer';
import { ProductionWriteSafety } from './ProductionWriteSafety';
import { TextEncodingRepair } from './TextEncodingRepair';
import { observeBody } from './lib/domObserver';
import { pruneEcoflowStorage } from './domain/driverRun';
import { hasSupabaseAuthClient } from './lib/supabaseClient';
import './styles.css';
import './fieldMode.css';
import './brandLockup.css';
import './industrialTheme.css';

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';
const productionConfigurationMissing = import.meta.env.PROD && !hasSupabaseAuthClient();

// Drop day-scoped storage older than the retention window before anything mounts,
// so the localStorage quota never fills up from weeks of accumulated day states.
pruneEcoflowStorage();

// Role bundles are isolated so each device downloads only its operational surface.
const OwnerEnhancers = lazy(() => import('./enhancers/OwnerEnhancers'));
const AccountEnhancers = lazy(() => import('./enhancers/AccountEnhancers'));
const DriverEnhancers = lazy(() => import('./enhancers/DriverEnhancers'));
const WarehouseOpsEnhancers = lazy(() => import('./enhancers/WarehouseOpsEnhancers'));
const WarehouseMapEnhancers = lazy(() => import('./enhancers/WarehouseMapEnhancers'));
const WarehouseMapPage = lazy(() => import('./features/warehouse/WarehouseMapPage').then((module) => ({ default: module.WarehouseMapPage })));

type DesktopRole = 'owner' | 'account' | null;
type ShellGroups = {
  desktopRole: DesktopRole;
  driver: boolean;
  warehouseOps: boolean;
  warehouseMap: boolean;
};

function detectDesktopRole(): DesktopRole {
  const roleText = document.querySelector<HTMLElement>('.sidebar-brand span')?.textContent?.trim().toUpperCase() || '';
  if (roleText.includes('ACCOUNT')) return 'account';
  if (roleText.includes('OWNER') || roleText.includes('ADMIN')) return 'owner';
  const stored = window.localStorage.getItem('ecoflow-role');
  if (stored === 'account') return 'account';
  if (stored === 'owner') return 'owner';
  return null;
}

function detectShells(): ShellGroups {
  const desktopPresent = Boolean(document.querySelector('.desktop-app'));
  return {
    desktopRole: desktopPresent ? detectDesktopRole() : null,
    driver: Boolean(document.querySelector('.driver-shell')),
    warehouseOps: !isWarehouseMapRoute && Boolean(document.querySelector('.mobile-shell')),
    warehouseMap: isWarehouseMapRoute,
  };
}

function sameShells(left: ShellGroups, right: ShellGroups) {
  return left.desktopRole === right.desktopRole
    && left.driver === right.driver
    && left.warehouseOps === right.warehouseOps
    && left.warehouseMap === right.warehouseMap;
}

function EnhancerGate() {
  const [groups, setGroups] = useState<ShellGroups>(detectShells);

  useEffect(() => {
    const stopObserving = observeBody(() => {
      setGroups((previous) => {
        const next = detectShells();
        return sameShells(previous, next) ? previous : next;
      });
    });
    return stopObserving;
  }, []);

  return (
    <Suspense fallback={null}>
      {groups.desktopRole === 'owner' ? <OwnerEnhancers /> : null}
      {groups.desktopRole === 'account' ? <AccountEnhancers /> : null}
      {groups.driver ? <DriverEnhancers /> : null}
      {groups.warehouseOps ? <WarehouseOpsEnhancers /> : null}
      {groups.warehouseMap ? <WarehouseMapEnhancers /> : null}
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
          <TextEncodingRepair />
          <FieldModeEnhancer />
          <EnhancerGate />
          {isWarehouseMapRoute ? (
            <Suspense fallback={<main className="warehouse-map-page"><div className="warehouse-map-card">Loading warehouse map…</div></main>}>
              <WarehouseMapPage />
            </Suspense>
          ) : (
            <App />
          )}
        </>
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
