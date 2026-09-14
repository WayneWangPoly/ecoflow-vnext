export const COMMERCIAL_WAVE2_P4D_TARGET = {
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  promotionPlanSha256: '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
  expansionCount: 163,
  batchSize: 25,
  batchCount: 7,
} as const;

export type CommercialWave2P4DBatch = {
  batchNo: number;
  candidateCount: number;
  firstCode: string;
  lastCode: string;
  batchSha256: string;
};

export type CommercialWave2P4DPromotionReadinessReport = {
  mode: 'P4D_PROMOTION_READINESS_ONLY';
  stage: 'P4D_PROMOTION_AUTHORITY_PLAN';
  verdict: 'PASS' | 'HOLD';
  status: 'READY_FOR_P4E_ENGINEERING' | 'HOLD';
  verifiedAt: string;
  verifierRole: string;
  cohort: {
    candidateSetSha256: string;
    expansionCandidateCount: number;
    enabledExpansionCount: number;
    eligibleForPromotionCount: number;
    nonCanaryPromotionCount: number;
    nonCanaryPromotionCommandCount: number;
  };
  p4c: { unlockCount: number; unlockCommandCount: number; auditCount: number; frozenCommandId: string };
  authority: {
    legacyServiceRoleExecute: boolean;
    legacyAuthenticatedExecute: boolean;
    p4cAuthenticatedExecute: boolean;
    v2AuthenticatedExecute: boolean;
    v2ServiceRoleExecute: boolean;
    v2AnonExecute: boolean;
    productionPromotionAuthorized: boolean;
    providerActionIncluded: boolean;
    physicalAuthorityIncluded: boolean;
    inventoryAuthorityIncluded: boolean;
  };
  batchPlan: {
    batchSize: number;
    batchCount: number;
    promotionPlanSha256: string;
    expectedPromotionPlanSha256: string;
    batches: CommercialWave2P4DBatch[];
  };
  failedChecks: string[];
};

export function assertCommercialWave2P4DPromotionReadiness(report: CommercialWave2P4DPromotionReadinessReport) {
  const t = COMMERCIAL_WAVE2_P4D_TARGET;
  if (report.verdict !== 'PASS' || report.status !== 'READY_FOR_P4E_ENGINEERING') throw new Error('P4D readiness verdict mismatch.');
  if (report.cohort.candidateSetSha256 !== t.candidateSetSha256) throw new Error('P4D cohort hash mismatch.');
  if (report.cohort.expansionCandidateCount !== t.expansionCount || report.cohort.enabledExpansionCount !== t.expansionCount || report.cohort.eligibleForPromotionCount !== t.expansionCount) throw new Error('P4D expansion cohort mismatch.');
  if (report.cohort.nonCanaryPromotionCount !== 0 || report.cohort.nonCanaryPromotionCommandCount !== 0) throw new Error('P4D promotion lineage is not clean.');
  if (report.p4c.unlockCount !== 1 || report.p4c.unlockCommandCount !== 1 || report.p4c.auditCount !== 1) throw new Error('P4D P4C closure mismatch.');
  if (report.authority.legacyServiceRoleExecute || report.authority.legacyAuthenticatedExecute || report.authority.p4cAuthenticatedExecute) throw new Error('P4D stale authority remains open.');
  if (report.authority.v2AuthenticatedExecute || report.authority.v2ServiceRoleExecute || report.authority.v2AnonExecute || report.authority.productionPromotionAuthorized) throw new Error('P4D replacement is not dormant.');
  if (report.batchPlan.batchSize !== t.batchSize || report.batchPlan.batchCount !== t.batchCount || report.batchPlan.batches.length !== t.batchCount) throw new Error('P4D batch shape mismatch.');
  if (report.batchPlan.promotionPlanSha256 !== t.promotionPlanSha256 || report.batchPlan.expectedPromotionPlanSha256 !== t.promotionPlanSha256) throw new Error('P4D batch-plan hash mismatch.');
  if (report.batchPlan.batches.reduce((sum, batch) => sum + batch.candidateCount, 0) !== t.expansionCount) throw new Error('P4D batch candidate total mismatch.');
  if (report.failedChecks.length !== 0) throw new Error(`P4D failed checks: ${report.failedChecks.join(', ')}`);
}

export function formatCommercialWave2P4DReadinessFailure(error: unknown) {
  return `ECOFLOW-R3-P4D — HOLD / ${error instanceof Error ? error.message : String(error)}`;
}
