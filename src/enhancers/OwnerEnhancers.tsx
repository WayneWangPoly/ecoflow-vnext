import { DeliveryRunHistory } from '../DeliveryRunHistory';
import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { CommercialSourceBoundary } from '../CommercialSourceBoundary';
import { InventoryControlCenter } from '../InventoryControlCenter';
import { InventoryMasterCatalog } from '../InventoryMasterCatalog';
import { OperationsClarityEnhancer } from '../OperationsClarityEnhancer';
import { ActiveExceptionClarityEnhancer } from '../ActiveExceptionClarityEnhancer';
import { OrderPlatformExperience } from '../OrderPlatformExperience';
import { OwnerDeliveryAlerts } from '../OwnerDeliveryAlerts';
import { OwnerDeliveryGovernance } from '../OwnerDeliveryGovernance';
import { OwnerDriverTrackingMap } from '../OwnerDriverTrackingMap';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import '../orderPlatformTable.css';
import '../orderOperationsV2.css';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../deliveryRunHistory.css';
import '../roleAwareNavigation.css';
import '../inventoryControlCenter.css';
import '../inventoryMovementLedger.css';
import '../ownerDriverTracking.css';
import '../deliveryOperations.css';
import '../commercialSourceBoundary.css';

/** Owner/Admin desktop capabilities only. */
export default function OwnerEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <CommercialSourceBoundary />
      <OperationsClarityEnhancer />
      <ActiveExceptionClarityEnhancer />
      <OwnerDeliveryAlerts />
      <OwnerDriverTrackingMap />
      <OwnerDeliveryGovernance />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <InventoryControlCenter />
      <InventoryMasterCatalog />
      <AccountsStatementWorkbench />
      <DeliveryRunHistory />
      <OrderPlatformExperience />
    </>
  );
}
