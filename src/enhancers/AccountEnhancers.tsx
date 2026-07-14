import { DeliveryRunHistory } from '../DeliveryRunHistory';
import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { CommercialSourceBoundary } from '../CommercialSourceBoundary';
import { OperationsClarityEnhancer } from '../OperationsClarityEnhancer';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../deliveryRunHistory.css';
import '../roleAwareNavigation.css';
import '../commercialSourceBoundary.css';

/** Accounts desktop capabilities without owner tracking, warehouse control or owner governance. */
export default function AccountEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <CommercialSourceBoundary />
      <OperationsClarityEnhancer />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <AccountsStatementWorkbench />
      <DeliveryRunHistory />
    </>
  );
}
