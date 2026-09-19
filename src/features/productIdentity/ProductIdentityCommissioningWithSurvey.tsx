import { lazy, Suspense, useState } from 'react';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { BarcodeSurveyReconciliationPanel } from './BarcodeSurveyReconciliationPanel';
import { Batch2P2ResumeSubmitCarrier } from './Batch2P2ResumeSubmitCarrier';
import { BatchNextDraftOnlyCarrier } from './BatchNextDraftOnlyCarrier';
import { BatchNextP2ResumeSubmitCarrier } from './BatchNextP2ResumeSubmitCarrier';
import { BatchNextP3ResumePublishCarrier } from './BatchNextP3ResumePublishCarrier';
import { Batch2P3ResumePublishCarrier } from './Batch2P3ResumePublishCarrier';
import { Batch2ProductIdentityExecutionCarrier } from './Batch2ProductIdentityExecutionCarrier';
import { BoundedProductIdentityExecutionCarrier } from './BoundedProductIdentityExecutionCarrier';
import { CommercialWave2CanaryPromotionCarrier } from './CommercialWave2CanaryPromotionCarrier';
import { CommercialWave2CanaryVerificationCarrier } from './CommercialWave2CanaryVerificationCarrier';
import { CommercialWave2P4DPromotionReadinessCarrier } from './CommercialWave2P4DPromotionReadinessCarrier';
import { CommercialWave2P4EBatchPromotionCarrier } from './CommercialWave2P4EBatchPromotionCarrier';
import { CommercialWave2P4ExpansionCarrier } from './CommercialWave2P4ExpansionCarrier';
import { CommercialWave2P4ReadinessCarrier } from './CommercialWave2P4ReadinessCarrier';
import { CommercialWave2PlanCarrier } from './CommercialWave2PlanCarrier';
import { ProductIdentityCommissioningWorkspace } from './ProductIdentityCommissioningWorkspace';

const BatchNext2DraftOnlyCarrier = lazy(() => import('./BatchNext2DraftOnlyCarrier').then((module) => ({ default: module.BatchNext2DraftOnlyCarrier })));

type Props = {
  role: Role;
  profile: EcoFlowAuthProfile;
};

export function ProductIdentityCommissioningWithSurvey(props: Props) {
  const [commissioningRevision, setCommissioningRevision] = useState(0);

  return (
    <>
      <Suspense fallback={null}>
        <BatchNext2DraftOnlyCarrier
          role={props.role}
          onChanged={() => setCommissioningRevision((value) => value + 1)}
        />
      </Suspense>
      <BatchNextDraftOnlyCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <BatchNextP2ResumeSubmitCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <BatchNextP3ResumePublishCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <BoundedProductIdentityExecutionCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <Batch2ProductIdentityExecutionCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <Batch2P2ResumeSubmitCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <Batch2P3ResumePublishCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <CommercialWave2PlanCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <CommercialWave2CanaryPromotionCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <CommercialWave2CanaryVerificationCarrier role={props.role} />
      <CommercialWave2P4ReadinessCarrier role={props.role} />
      <CommercialWave2P4ExpansionCarrier
        role={props.role}
        onChanged={() => setCommissioningRevision((value) => value + 1)}
      />
      <CommercialWave2P4DPromotionReadinessCarrier role={props.role} />
      <CommercialWave2P4EBatchPromotionCarrier
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
