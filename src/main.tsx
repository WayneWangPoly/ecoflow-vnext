import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { FieldModeEnhancer } from './FieldModeEnhancer';
import { ProductionWriteSafety } from './ProductionWriteSafety';
import { TextEncodingRepair } from './TextEncodingRepair';
import { observeBody } from './lib/domObserver';
import { pruneEcoflowStorage } from './domain/driverRun';
import './styles.css';
import './fieldMode.css';
import './brandLockup.css';
import './orderPlatformTable.css';
import './ownerOrderIntelligence.css';
import './ownerStoreIntelligence.css';
import './storeStatementPressure.css';
import './accountsStatementWorkbench.css';
import './roleAwareNavigation.css';
import './ownerCommandCenter.css';
import './inventoryControlCenter.css';
import './inventoryMovementLedger.css';
import './warehouseReceivingFlow.css';
import './warehouseBarcodeSprint.css';
import './warehousePickHandoff.css';
import './fieldOpsGuardRails.css';
import './stageAndLoadExecution.css';
import './labelPrintBlackWhite.css';
import './driverPodQuality.css';
import './deliveryOperations.css';
import './returnZoneOperations.css';
import './returnZoneCopyFix.css';
import './returnZoneGeofence.css';
import './industrialTheme.css';
import './warehouseProductisation.css';
import './warehouseProductisationFixes.css';
import './ownerDriverTracking.css';
import './driverDeparture.css';

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';

// Drop day-scoped storage older than the retention window before anything mounts,
// so the localStorage quota never fills up from weeks of accumulated day states.
pruneEcoflowStorage();

// Role bundles: a driver phone must not download owner analytics, and the owner
// desktop must not download the warehouse camera scanner. Each group loads only
// when its shell is actually on screen.
const DesktopEnhancers = lazy(() => import('./enhancers/DesktopEnhancers'));
const DriverEnhancers = lazy(() => import('./enhancers/DriverEnhancers'));
const WarehouseEnhancers = lazy(() => import('./enhancers/WarehouseEnhancers'));
const WarehouseMapPage = lazy(() => import('./features/warehouse/WarehouseMapPage').then((m) => ({ default: m.WarehouseMapPage })));

type ShellGroups = { desktop: boolean; driver: boolean; warehouse: boolean };

function detectShells(): ShellGroups {
  return {
    desktop: Boolean(document.querySelector('.desktop-app')),
    driver: Boolean(document.querySelector('.driver-shell')),
    warehouse: isWarehouseMapRoute || Boolean(document.querySelector('.mobile-shell')),
  };
}

function sameShells(a: ShellGroups, b: ShellGroups) {
  return a.desktop === b.desktop && a.driver === b.driver && a.warehouse === b.warehouse;
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
      {groups.desktop ? <DesktopEnhancers /> : null}
      {groups.driver ? <DriverEnhancers /> : null}
      {groups.warehouse ? <WarehouseEnhancers /> : null}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProductionWriteSafety />
      <TextEncodingRepair />
      <FieldModeEnhancer />
      <EnhancerGate />
      {isWarehouseMapRoute ? (
        <Suspense fallback={null}>
          <WarehouseMapPage />
        </Suspense>
      ) : (
        <App />
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
