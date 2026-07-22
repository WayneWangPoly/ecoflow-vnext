import { DeliveryRunHistory } from '../DeliveryRunHistory';
import { AccountsStatementWorkbench } from '../AccountsStatementWorkbench';
import { AuthoritativeDashboard } from '../AuthoritativeDashboard';
import { CommercialSourceBoundary } from '../CommercialSourceBoundary';
import { DesktopReceivingHistory } from '../DesktopReceivingHistory';
import { OperationsClarityEnhancer } from '../OperationsClarityEnhancer';
import { OwnerOrderIntelligence } from '../OwnerOrderIntelligence';
import { OwnerStoreIntelligence } from '../OwnerStoreIntelligence';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import { CustomerOrderPodPreviewEnhancer } from './CustomerOrderPodPreviewEnhancer';
import { DesktopCopyCleanup } from './DesktopCopyCleanup';
import { IndustrialDesktopWorkbench } from './IndustrialDesktopWorkbench';
import { IndustrialOperationalClarity } from './IndustrialOperationalClarity';
import { PersistentDesktopWorkspaces } from './PersistentDesktopWorkspaces';
import '../authoritativeDashboard.css';
import '../ownerOrderIntelligence.css';
import '../ownerStoreIntelligence.css';
import '../storeStatementPressure.css';
import '../accountsStatementWorkbench.css';
import '../deliveryRunHistory.css';
import '../roleAwareNavigation.css';
import '../commercialSourceBoundary.css';
import '../industrialDesktopFoundation.css';

/** Accounts capabilities with one persistent industrial desktop workspace. */
export default function AccountEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <PersistentDesktopWorkspaces />
      <DesktopCopyCleanup />
      <IndustrialDesktopWorkbench />
      <IndustrialOperationalClarity />
      <DesktopReceivingHistory />
      <CustomerOrderPodPreviewEnhancer />
      <AuthoritativeDashboard />
      <CommercialSourceBoundary />
      <OperationsClarityEnhancer />
      <OwnerOrderIntelligence />
      <OwnerStoreIntelligence />
      <AccountsStatementWorkbench />
      <DeliveryRunHistory />
    </>
  );
}
