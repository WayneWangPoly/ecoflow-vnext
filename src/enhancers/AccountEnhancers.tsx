import { DeliveryRunHistory } from '../DeliveryRunHistory';
import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { CommercialSourceBoundary } from '../CommercialSourceBoundary';
import { OperationsClarityEnhancer } from '../OperationsClarityEnhancer';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import { IndustrialDesktopUiV2 } from './IndustrialDesktopUiV2';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../deliveryRunHistory.css';
import '../roleAwareNavigation.css';
import '../commercialSourceBoundary.css';

/** Accounts capabilities with the same dense industrial workspace and read/write boundaries unchanged. */
export default function AccountEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <IndustrialDesktopUiV2 />
      <CommercialSourceBoundary />
      <OperationsClarityEnhancer />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <AccountsStatementWorkbench />
      <DeliveryRunHistory />
    </>
  );
}
