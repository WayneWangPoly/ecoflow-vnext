import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../roleAwareNavigation.css';

/** Accounts desktop capabilities without owner tracking, warehouse control or owner governance. */
export default function AccountEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <AccountsStatementWorkbench />
    </>
  );
}
