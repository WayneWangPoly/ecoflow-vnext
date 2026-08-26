import { useState } from 'react';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { BarcodeSurveyReconciliationPanel } from './BarcodeSurveyReconciliationPanel';
import { ProductIdentityCommissioningWorkspace } from './ProductIdentityCommissioningWorkspace';

type Props = {
  role: Role;
  profile: EcoFlowAuthProfile;
};

export function ProductIdentityCommissioningWithSurvey(props: Props) {
  const [commissioningRevision, setCommissioningRevision] = useState(0);

  return (
    <>
      <BarcodeSurveyReconciliationPanel
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <ProductIdentityCommissioningWorkspace
        key={commissioningRevision}
        role={props.role}
        profile={props.profile}
      />
    </>
  );
}
