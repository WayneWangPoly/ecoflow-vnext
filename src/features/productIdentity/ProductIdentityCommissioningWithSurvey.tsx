import { useState } from 'react';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { BarcodeSurveyReconciliationPanel } from './BarcodeSurveyReconciliationPanel';
import { Batch2ProductIdentityExecutionCarrier } from './Batch2ProductIdentityExecutionCarrier';
import { BoundedProductIdentityExecutionCarrier } from './BoundedProductIdentityExecutionCarrier';
import { ProductIdentityCommissioningWorkspace } from './ProductIdentityCommissioningWorkspace';

type Props = {
  role: Role;
  profile: EcoFlowAuthProfile;
};

export function ProductIdentityCommissioningWithSurvey(props: Props) {
  const [commissioningRevision, setCommissioningRevision] = useState(0);

  return (
    <>
      <BoundedProductIdentityExecutionCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <Batch2ProductIdentityExecutionCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <BarcodeSurveyReconciliationPanel
        key={`survey-${commissioningRevision}`}
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <ProductIdentityCommissioningWorkspace
        key={`commissioning-${commissioningRevision}`}
        role={props.role}
        profile={props.profile}
      />
    </>
  );
}
