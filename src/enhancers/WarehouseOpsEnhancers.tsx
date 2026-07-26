import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { FirstStocktakeBackendVerifier } from '../FirstStocktakeBackendVerifier';
import { FirstStocktakeFieldJournal } from '../FirstStocktakeFieldJournal';
import { FirstStocktakeGoLiveCheck } from '../FirstStocktakeGoLiveCheck';
import { FirstStocktakePackagingRulesEnhancer } from '../FirstStocktakePackagingRulesEnhancer';
import { PickTaskOwnership } from '../PickTaskOwnership';
import { QuickSleeveBarcodeCapture } from '../QuickSleeveBarcodeCapture';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import { WarehouseBarcodeSprintMount } from '../WarehouseBarcodeSprintMount';
import { WarehouseBarcodeTargetBridge } from '../WarehouseBarcodeTargetBridge';
import { WarehouseCameraAngleAssist } from '../WarehouseCameraAngleAssist';
import { WarehouseCameraScanner } from '../WarehouseCameraScanner';
import { WarehousePickHandoffStatus } from '../WarehousePickHandoffStatus';
import { WarehousePurchaseOrderReceiving } from '../WarehousePurchaseOrderReceiving';
import { WarehousePutawayTargetBridge } from '../WarehousePutawayTargetBridge';
import { WarehouseScannerGalleryEnhancer } from '../WarehouseScannerGalleryEnhancer';
import '../warehouseReceivingFlow.css';
import '../warehouseUnreferencedInbound.css';
import '../warehouseBarcodeSprint.css';
import '../warehouseFirstStocktake.css';
import '../firstStocktakeFlow.css';
import '../firstStocktakeCoverage.css';
import '../firstStocktakeFieldJournal.css';
import '../firstStocktakeGoLiveCheck.css';
import '../firstStocktakeWorkspace.css';
import '../firstStocktakePackageClarify.css';
import '../firstStocktakeBackendVerifier.css';
import '../warehousePickHandoff.css';
import '../fieldOpsGuardRails.css';
import '../pickTaskOwnership.css';
import '../stageAndLoadExecution.css';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';
import '../mobileOverflowSafety.css';
import '../firstStocktakeAssist.css';
import '../firstStocktakeGuide.css';
import '../firstStocktakeCompact.css';
import '../warehouseCameraPerformance.css';
import '../warehousePurchaseOrderReceiving.css';
import '../quickSleeveBarcodeCapture.css';

/** Warehouse phone modules: first stocktake, receive, pick, stage and scanner controls. */
export default function WarehouseOpsEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <FirstStocktakeFieldJournal />
      <FirstStocktakeGoLiveCheck />
      <FirstStocktakePackagingRulesEnhancer />
      <FirstStocktakeBackendVerifier />
      <PickTaskOwnership />
      <StageAndLoadExecution />
      <WarehouseBarcodeSprintMount />
      <WarehouseBarcodeTargetBridge />
      <WarehousePutawayTargetBridge />
      <WarehousePickHandoffStatus />
      <WarehousePurchaseOrderReceiving />
      <QuickSleeveBarcodeCapture />
      <WarehouseCameraScanner />
      <WarehouseCameraAngleAssist />
      <WarehouseScannerGalleryEnhancer />
    </>
  );
}
