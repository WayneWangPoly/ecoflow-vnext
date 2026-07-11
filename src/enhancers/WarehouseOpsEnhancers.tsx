import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import { WarehouseBarcodeSprintMount } from '../WarehouseBarcodeSprintMount';
import { WarehouseCameraScanner } from '../WarehouseCameraScanner';
import { WarehousePickHandoffStatus } from '../WarehousePickHandoffStatus';
import { WarehousePutawayTargetBridge } from '../WarehousePutawayTargetBridge';
import '../warehouseReceivingFlow.css';
import '../warehouseBarcodeSprint.css';
import '../warehousePickHandoff.css';
import '../fieldOpsGuardRails.css';
import '../stageAndLoadExecution.css';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';

/** Warehouse phone operations: receive, pick, stage and scanner controls. */
export default function WarehouseOpsEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <StageAndLoadExecution />
      <WarehouseBarcodeSprintMount />
      <WarehousePutawayTargetBridge />
      <WarehousePickHandoffStatus />
      <WarehouseCameraScanner />
    </>
  );
}
