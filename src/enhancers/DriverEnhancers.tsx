import { DriverDeliveryExceptionEnhancer } from '../DriverDeliveryExceptionEnhancer';
import { DriverDepartureControl } from '../DriverDepartureControl';
import { DriverLocationTracker } from '../DriverLocationTracker';
import { DriverPodQualityEnhancer } from '../DriverPodQualityEnhancer';
import { DriverReturnZoneCheckin } from '../DriverReturnZoneCheckin';
import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { LoadRecoveryControl } from '../LoadRecoveryControl';
import { PickTaskOwnership } from '../PickTaskOwnership';
import { StageAndLoadExecution } from '../StageAndLoadExecution';
import '../fieldOpsGuardRails.css';
import '../pickTaskOwnership.css';
import '../stageAndLoadExecution.css';
import '../labelPrintBlackWhite.css';
import '../driverPodQuality.css';
import '../deliveryOperations.css';
import '../returnZoneOperations.css';
import '../returnZoneCopyFix.css';
import '../returnZoneGeofence.css';
import '../driverDeparture.css';

/** Driver-shell modules - loaded only when the driver app mounts. */
export default function DriverEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <PickTaskOwnership />
      <StageAndLoadExecution />
      <LoadRecoveryControl />
      <DriverPodQualityEnhancer />
      <DriverDeliveryExceptionEnhancer />
      <DriverReturnZoneCheckin />
      <DriverLocationTracker />
      <DriverDepartureControl />
    </>
  );
}
