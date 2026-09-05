import { PRODUCT_STAGING_PLAN } from './unleashedProductStagingPlan';

export const PRODUCT_STAGING_EXECUTION_CLOSED = {
  issue: 338,
  authorizationStatus: PRODUCT_STAGING_PLAN.authorization.status,
  finalRunId: PRODUCT_STAGING_PLAN.finalAcceptance.finalRunId,
  snapshots: PRODUCT_STAGING_PLAN.finalAcceptance.snapshots,
  identities: PRODUCT_STAGING_PLAN.finalAcceptance.identities,
  nonDryGate: PRODUCT_STAGING_PLAN.postClosureNonDryGate.state,
} as const;

export function assertProductStagingExecutionClosed(): never {
  throw new Error('UNLEASHED_PRODUCT_STAGING_AUTHORIZATION_CONSUMED');
}
