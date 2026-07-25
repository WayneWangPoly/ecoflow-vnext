import { DriverDeliveryExceptionEnhancer } from '../DriverDeliveryExceptionEnhancer';
import { DriverDepartureControl } from '../DriverDepartureControl';
import { DriverLocationTracker } from '../DriverLocationTracker';
import { DriverReturnZoneCheckin } from '../DriverReturnZoneCheckin';
import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { PickTaskOwnership } from '../PickTaskOwnership';
import { QuickSleeveBarcodeCapture } from '../QuickSleeveBarcodeCapture';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import { WarehouseCameraAngleAssist } from '../WarehouseCameraAngleAssist';
import { WarehouseCameraScanner } from '../WarehouseCameraScanner';
import { WarehouseScannerGalleryEnhancer } from '../WarehouseScannerGalleryEnhancer';
import { DriverOperationalInstructionEnhancer } from './DriverOperationalInstructionEnhancer';
import '../fieldOpsGuardRails.css';
import '../pickTaskOwnership.css';
import '../stageAndLoadExecution.css';
import '../labelPrintBlackWhite.css';
import '../deliveryOperations.css';
import '../returnZoneOperations.css';
import '../returnZoneCopyFix.css';
import '../returnZoneGeofence.css';
import '../driverDeparture.css';
import '../warehouseProductisation.css';
import '../warehouseCameraPerformance.css';
import '../quickSleeveBarcodeCapture.css';

/** Driver-shell modules - loaded only when the driver app mounts. */
export default function DriverEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <PickTaskOwnership />
      <StageAndLoadExecution />
      <DriverDeliveryExceptionEnhancer />
      <DriverReturnZoneCheckin />
      <DriverLocationTracker />
      <DriverDepartureControl />
      <DriverOperationalInstructionEnhancer />
      <QuickSleeveBarcodeCapture />
      <WarehouseCameraScanner />
      <WarehouseCameraAngleAssist />
      <WarehouseScannerGalleryEnhancer />
    </>
  );
}
