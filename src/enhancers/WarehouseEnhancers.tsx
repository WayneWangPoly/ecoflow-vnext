import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import { WarehouseBarcodeSprintMount } from '../WarehouseBarcodeSprintMount';
import { WarehouseCameraScanner } from '../WarehouseCameraScanner';
import { WarehouseMapOwnerEdit } from '../WarehouseMapOwnerEdit';
import { WarehouseMapPutawayControl } from '../WarehouseMapPutawayControl';
import { WarehousePickHandoffStatus } from '../WarehousePickHandoffStatus';
import { WarehousePutawayTargetBridge } from '../WarehousePutawayTargetBridge';

/** Warehouse mobile + warehouse-map enhancer bundle - loaded only for warehouse surfaces. */
export default function WarehouseEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <StageAndLoadExecution />
      <WarehouseBarcodeSprintMount />
      <WarehousePutawayTargetBridge />
      <WarehousePickHandoffStatus />
      <WarehouseCameraScanner />
      <WarehouseMapOwnerEdit />
      <WarehouseMapPutawayControl />
    </>
  );
}
