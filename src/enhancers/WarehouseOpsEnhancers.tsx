import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { FirstStocktakeGuideEnhancer } from '../FirstStocktakeGuideEnhancer';
import { FirstStocktakePackagingRulesEnhancer } from '../FirstStocktakePackagingRulesEnhancer';
import { PickTaskOwnership } from '../PickTaskOwnership';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import { WarehouseBarcodeSprintMount } from '../WarehouseBarcodeSprintMount';
import { WarehouseBarcodeTargetBridge } from '../WarehouseBarcodeTargetBridge';
import { WarehouseCameraScanner } from '../WarehouseCameraScanner';
import { WarehousePickHandoffStatus } from '../WarehousePickHandoffStatus';
import { WarehousePutawayTargetBridge } from '../WarehousePutawayTargetBridge';
import '../warehouseReceivingFlow.css';
import '../warehouseBarcodeSprint.css';
import '../warehouseFirstStocktake.css';
import '../firstStocktakeFlow.css';
import '../warehousePickHandoff.css';
import '../fieldOpsGuardRails.css';
import '../pickTaskOwnership.css';
import '../stageAndLoadExecution.css';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';
import '../mobileOverflowSafety.css';
import '../firstStocktakeAssist.css';
import '../firstStocktakeGuide.css';

/** Warehouse phone modules: first stocktake, receive, pick, stage and scanner controls. */
export default function WarehouseOpsEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <FirstStocktakeGuideEnhancer />
      <FirstStocktakePackagingRulesEnhancer />
      <PickTaskOwnership />
      <StageAndLoadExecution />
      <WarehouseBarcodeSprintMount />
      <WarehouseBarcodeTargetBridge />
      <WarehousePutawayTargetBridge />
      <WarehousePickHandoffStatus />
      <WarehouseCameraScanner />
    </>
  );
}
