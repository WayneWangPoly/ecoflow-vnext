import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { InventoryControlCenter } from '../InventoryControlCenter';
import { OrderPlatformExperience } from '../OrderPlatformExperience';
import { OwnerCommandCenter } from '../OwnerCommandCenter';
import { OwnerDeliveryAlerts } from '../OwnerDeliveryAlerts';
import { OwnerDeliveryGovernance } from '../OwnerDeliveryGovernance';
import { OwnerDriverTrackingMap } from '../OwnerDriverTrackingMap';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import '../orderPlatformTable.css';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../roleAwareNavigation.css';
import '../ownerCommandCenter.css';
import '../inventoryControlCenter.css';
import '../inventoryMovementLedger.css';
import '../ownerDriverTracking.css';
import '../deliveryOperations.css';

/** Owner/Admin desktop capabilities only. */
export default function OwnerEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <OwnerCommandCenter />
      <OwnerDeliveryAlerts />
      <OwnerDriverTrackingMap />
      <OwnerDeliveryGovernance />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <InventoryControlCenter />
      <AccountsStatementWorkbench />
      <OrderPlatformExperience />
    </>
  );
}
