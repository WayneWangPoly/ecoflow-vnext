import { RoleAwareDesktopNavigation } from '../RoleAwareDesktopNavigation';
import { OperationsClarityEnhancer } from '../OperationsClarityEnhancer';
import { IndustrialDesktopUiV2 } from './IndustrialDesktopUiV2';
import '../roleAwareNavigation.css';

/** Viewer receives the same inspection, filtering and comparison UI with existing write controls still unavailable. */
export default function ViewerEnhancers() {
  return (
    <>
      <RoleAwareDesktopNavigation />
      <IndustrialDesktopUiV2 />
      <OperationsClarityEnhancer />
    </>
  );
}
