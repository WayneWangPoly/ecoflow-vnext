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

/** Owner/Account desktop enhancer bundle - loaded only when the desktop shell mounts. */
export default function DesktopEnhancers() {
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
