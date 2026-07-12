import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { PickTaskOwnership } from '../PickTaskOwnership';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import { WarehouseBarcodeSprintMount } from '../WarehouseBarcodeSprintMount';
import { WarehouseBarcodeTargetBridge } from '../WarehouseBarcodeTargetBridge';
import { WarehouseCameraScanner } from '../WarehouseCameraScanner';
import { WarehousePickHandoffStatus } from '../WarehousePickHandoffStatus';
import { WarehousePutawayTargetBridge } from '../WarehousePutawayTargetBridge';
import '../warehouseReceivingFlow.css';
import '../warehouseBarcodeSprint.css';
import '../warehousePickHandoff.css';
import '../fieldOpsGuardRails.css';
import '../pickTaskOwnership.css';
import '../stageAndLoadExecution.css';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';

/** Warehouse phone modules: receive, pick, stage and scanner controls. */
export default function WarehouseOpsEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
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
