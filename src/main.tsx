import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { App } from './app/App';
import { OverlayManagerProvider } from './features/intelligence/overlays';
import { OperationalSessionProvider } from './features/navigation/OperationalSessionContext';
import { OperationalSessionIdentityBinder } from './OperationalSessionIdentityBinder';
import { OperationalSafetyCenter } from './OperationalSafetyCenter';
import { ProductionWriteSafety } from './ProductionWriteSafety';
import { OperationalDensityEnhancer } from './OperationalDensityEnhancer';
import { observeBody } from './lib/domObserver';
import { pruneEcoflowStorage } from './domain/driverRun';
import { hasSupabaseAuthClient } from './lib/supabaseClient';
import './styles.css';
import './features/intelligence/designSystem/tokens.css';
import './fieldMode.css';
import './brandLockup.css';
import './industrialTheme.css';
import './ownerCommandCenter.css';
import './dashboardLayoutStability.css';
import './conciseOperationalUi.css';
import './operationalContinuity.css';
import './industrialDesktopFoundation.css';
import './mobileViewportLock.css';

const productionConfigurationMissing = import.meta.env.PROD && !hasSupabaseAuthClient();

pruneEcoflowStorage();

const FieldModeEnhancer = lazy(() => import('./FieldModeEnhancer').then((module) => ({ default: module.FieldModeEnhancer })));
const DriverEnhancers = lazy(() => import('./enhancers/DriverEnhancers'));
const WarehouseOpsEnhancers = lazy(() => import('./enhancers/WarehouseOpsEnhancers'));
// Warehouse Map is a protected route feature, not an authentication role.
const WarehouseMapRoute = lazy(() => import('./features/warehouse/WarehouseMapRoute'));
const UnifiedOperationalRoutes = lazy(() => import('./features/operationalRoutes/UnifiedOperationalRoutes'));

type MobileSurfaces = {
  driver: boolean;
  warehouse: boolean;
};

type RouteSurface = 'unified' | 'legacy' | 'warehouse-map';

function detectMobileSurfaces(): MobileSurfaces {
  return {
    driver: Boolean(document.querySelector('.driver-shell')),
    warehouse: Boolean(document.querySelector('.mobile-shell')),
  };
}

function sameMobileSurfaces(left: MobileSurfaces, right: MobileSurfaces) {
  return left.driver === right.driver && left.warehouse === right.warehouse;
}

export function isUnifiedOperationalPath(pathname: string) {
  return pathname === '/control-room'
    || pathname === '/ordermentum'
    || pathname === '/exceptions'
    || pathname === '/logs'
    || pathname === '/settings'
    || pathname === '/warehouse-control'
    || pathname.startsWith('/warehouse-control/')
    || pathname === '/commissioning/product-identity'
    || pathname === '/orders'
    || pathname.startsWith('/orders/')
    || pathname === '/inventory'
    || pathname.startsWith('/inventory/')
    || pathname === '/customers'
    || pathname.startsWith('/customers/')
    || pathname === '/stores'
    || pathname.startsWith('/stores/');
}

function routeSurface(pathname: string): RouteSurface {
  if (pathname === '/warehouse-map') return 'warehouse-map';
  if (isUnifiedOperationalPath(pathname)) return 'unified';
  return 'legacy';
}

/**
 * The unified operational root now owns migrated desktop workspaces. A hard
 * document navigation is retained only when crossing into a still-legacy root
 * or the separately protected Warehouse Map. It must never fire between two
 * migrated operational routes.
 */
function CrossSurfaceNavigationBridge() {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname
        && destination.search === window.location.search
        && destination.hash === window.location.hash
      ) return;
      if (routeSurface(destination.pathname) === routeSurface(window.location.pathname)) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
}

/**
 * Driver and Warehouse observer modules remain migration bridges for mobile-only
 * surfaces. Desktop role and capability are never inferred from visible brand,
 * sidebar or button text.
 */
function MobileSurfaceModuleGate() {
  const [surfaces, setSurfaces] = useState<MobileSurfaces>(detectMobileSurfaces);

  useEffect(() => observeBody(() => {
    setSurfaces((current) => {
      const next = detectMobileSurfaces();
      return sameMobileSurfaces(current, next) ? current : next;
    });
  }), []);

  return (
    <Suspense fallback={null}>
      {surfaces.driver ? <DriverEnhancers /> : null}
      {surfaces.warehouse ? <WarehouseOpsEnhancers /> : null}
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

function ApplicationSurfaceRouter() {
  const location = useLocation();
  if (location.pathname === '/') return <Navigate to="/control-room" replace />;
  if (location.pathname === '/warehouse-map') {
    return (
      <Suspense fallback={<main className="warehouse-map-page"><div className="warehouse-map-card">Checking Warehouse Map access…</div></main>}>
        <WarehouseMapRoute />
      </Suspense>
    );
  }
  if (isUnifiedOperationalPath(location.pathname)) {
    return (
      <OperationalSessionProvider>
        <Suspense fallback={null}><UnifiedOperationalRoutes /></Suspense>
      </OperationalSessionProvider>
    );
  }
  return <App />;
}

function ApplicationRoutes() {
  // A single route element keeps ApplicationSurfaceRouter mounted as the URL
  // changes. Inside the unified surface, React therefore preserves the shared
  // session authority and AppShell across workspace navigation.
  return (
    <Routes>
      <Route path="*" element={<ApplicationSurfaceRouter />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {productionConfigurationMissing ? (
        <ProductionConfigurationError />
      ) : (
        <OverlayManagerProvider>
          <ProductionWriteSafety />
          <OperationalSessionIdentityBinder />
          <OperationalSafetyCenter />
          <OperationalDensityEnhancer />
          <Suspense fallback={null}><FieldModeEnhancer /></Suspense>
          <MobileSurfaceModuleGate />
          <CrossSurfaceNavigationBridge />
          <ApplicationRoutes />
        </OverlayManagerProvider>
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
