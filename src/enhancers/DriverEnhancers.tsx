import { DriverDeliveryExceptionEnhancer } from '../DriverDeliveryExceptionEnhancer';
import { DriverDepartureControl } from '../DriverDepartureControl';
import { DriverLocationTracker } from '../DriverLocationTracker';
import { DriverPodQualityEnhancer } from '../DriverPodQualityEnhancer';
import { DriverReturnZoneCheckin } from '../DriverReturnZoneCheckin';
import { FieldOpsGuardRails } from '../FieldOpsGuardRails';
import { StageAndLoadExecution } from '../StageAndLoadExecution';

/** Driver-shell enhancer bundle - loaded only when the driver app mounts. */
export default function DriverEnhancers() {
  return (
    <>
      <FieldOpsGuardRails />
      <StageAndLoadExecution />
      <DriverPodQualityEnhancer />
      <DriverDeliveryExceptionEnhancer />
      <DriverReturnZoneCheckin />
      <DriverLocationTracker />
      <DriverDepartureControl />
    </>
  );
}
