import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { App } from './app/App';
import { OverlayManagerProvider } from './features/intelligence/overlays';
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
const NativeOperationalRoutes = lazy(() => import('./features/operationalRoutes/NativeOperationalRoutes'));

type MobileSurfaces = {
  driver: boolean;
  warehouse: boolean;
};

function detectMobileSurfaces(): MobileSurfaces {
  return {
    driver: Boolean(document.querySelector('.driver-shell')),
    warehouse: Boolean(document.querySelector('.mobile-shell')),
  };
}

function sameMobileSurfaces(left: MobileSurfaces, right: MobileSurfaces) {
  return left.driver === right.driver && left.warehouse === right.warehouse;
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

function ApplicationRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/control-room" replace />} />
      <Route path="/warehouse-map" element={<Suspense fallback={<main className="warehouse-map-page"><div className="warehouse-map-card">Checking Warehouse Map access…</div></main>}><WarehouseMapRoute /></Suspense>} />
      <Route path="/control-room" element={<Suspense fallback={null}><NativeOperationalRoutes /></Suspense>} />
      <Route path="/ordermentum" element={<Suspense fallback={null}><NativeOperationalRoutes /></Suspense>} />
      <Route path="/inventory/*" element={<Suspense fallback={null}><NativeOperationalRoutes /></Suspense>} />
      <Route path="/customers/*" element={<Suspense fallback={null}><NativeOperationalRoutes /></Suspense>} />
      <Route path="/stores/*" element={<Suspense fallback={null}><NativeOperationalRoutes /></Suspense>} />
      <Route path="/exceptions" element={<Navigate to="/ordermentum?tab=exceptions" replace />} />
      <Route path="*" element={<App />} />
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
          <ApplicationRoutes />
        </OverlayManagerProvider>
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
