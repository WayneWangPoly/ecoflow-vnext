import { PriceMatrixWorkbench } from '../PriceMatrixWorkbench';
import { DeliveryRunHistory } from '../DeliveryRunHistory';
import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { OwnerCommandCenter } from '../OwnerCommandCenter';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../priceMatrixWorkbench.css';
import '../deliveryRunHistory.css';
import '../roleAwareNavigation.css';
import '../ownerCommandCenter.css';

/** Accounts desktop capabilities without owner tracking, warehouse control or owner governance. */
export default function AccountEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <OwnerCommandCenter />
      <OwnerOrderIntelligence />
      <PriceMatrixWorkbench />
      <OwnerStoreIntelligence />
      <AccountsStatementWorkbench />
      <DeliveryRunHistory />
    </>
  );
}
