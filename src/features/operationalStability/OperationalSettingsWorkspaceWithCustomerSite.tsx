import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { CustomerSiteWave1PromotionCarrier } from '@/features/customerSite/CustomerSiteWave1PromotionCarrier';
import { useOperationalSession } from '@/features/navigation/OperationalSessionContext';
import { OperationalSettingsWorkspace as BaseOperationalSettingsWorkspace } from './OperationalStabilityWorkspaceV2';

export function OperationalSettingsWorkspace({ profile }: { profile: EcoFlowAuthProfile }) {
  const { role } = useOperationalSession();
  const mayPromote = role === 'owner' || role === 'admin';

  return (
    <>
      <BaseOperationalSettingsWorkspace profile={profile} />
      {mayPromote && role ? <CustomerSiteWave1PromotionCarrier role={role} /> : null}
    </>
  );
}
