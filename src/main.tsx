import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AccountsStatementWorkbench } from './AccountsStatementWorkbench';
import { App } from './app/App';
import { DriverDeliveryExceptionEnhancer } from './DriverDeliveryExceptionEnhancer';
import { DriverPodQualityEnhancer } from './DriverPodQualityEnhancer';
import { DriverReturnZoneCheckin } from './DriverReturnZoneCheckin';
import { FieldModeEnhancer } from './FieldModeEnhancer';
import { FieldOpsGuardRails } from './FieldOpsGuardRails';
import { InventoryControlCenter } from './InventoryControlCenter';
import { OrderPlatformExperience } from './OrderPlatformExperience';
import { OwnerCommandCenter } from './OwnerCommandCenter';
import { OwnerDeliveryAlerts } from './OwnerDeliveryAlerts';
import { OwnerOrderIntelligence } from './OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from './OwnerStoreIntelligence';
import { ProductionWriteSafety } from './ProductionWriteSafety';
import { RoleAwareDesktopNavigation } from './RoleAwareDesktopNavigation';
import { StageAndLoadExecution } from './StageAndLoadExecution';
import { TextEncodingRepair } from './TextEncodingRepair';
import { WarehouseBarcodeSprintMount } from './WarehouseBarcodeSprintMount';
import { WarehouseCameraScanner } from './WarehouseCameraScanner';
import { WarehouseMapOwnerEdit } from './WarehouseMapOwnerEdit';
import { WarehouseMapPutawayControl } from './WarehouseMapPutawayControl';
import { WarehouseMapPage } from './features/warehouse/WarehouseMapPage';
import { WarehousePickHandoffStatus } from './WarehousePickHandoffStatus';
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

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProductionWriteSafety />
      <TextEncodingRepair />
      <FieldModeEnhancer />
      <FieldOpsGuardRails />
      <StageAndLoadExecution />
      <DriverPodQualityEnhancer />
      <DriverDeliveryExceptionEnhancer />
      <DriverReturnZoneCheckin />
      <RoleAwareDesktopNavigation />
      <OwnerCommandCenter />
      <OwnerDeliveryAlerts />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <InventoryControlCenter />
      <WarehouseBarcodeSprintMount />
      <WarehousePickHandoffStatus />
      <AccountsStatementWorkbench />
      <OrderPlatformExperience />
      <WarehouseCameraScanner />
      <WarehouseMapOwnerEdit />
      <WarehouseMapPutawayControl />
      {isWarehouseMapRoute ? <WarehouseMapPage /> : <App />}
    </BrowserRouter>
  </React.StrictMode>,
);
