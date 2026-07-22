import { DesktopReceivingHistory } from '../DesktopReceivingHistory';
import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import { OperationsClarityEnhancer } from '../OperationsClarityEnhancer';
import { DesktopCopyCleanup } from './DesktopCopyCleanup';
import { IndustrialDesktopWorkbench } from './IndustrialDesktopWorkbench';
import { IndustrialOperationalClarity } from './IndustrialOperationalClarity';
import '../roleAwareNavigation.css';
import '../industrialDesktopFoundation.css';

/** Viewer receives the same inspection, filtering and comparison UI with write controls unavailable. */
export default function ViewerEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <DesktopCopyCleanup />
      <IndustrialDesktopWorkbench />
      <IndustrialOperationalClarity />
      <DesktopReceivingHistory />
      <OperationsClarityEnhancer />
    </>
  );
}
