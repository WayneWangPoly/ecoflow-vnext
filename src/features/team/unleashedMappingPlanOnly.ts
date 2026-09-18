import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_006_MAPPING_PLAN_ONLY_TARGET = {
  protectedMainSha: '4f463eedf8c8343739d032eb08dd862f7aa15fe1',
  cohortSha256: '8e5974ea2ef8725977c2c38c135d517d1595cc2064bd6f03b9801e1b03adb020',
} as const;

export type R5006MappingPlanOnlyReconciliation = {
  accepted: boolean;
  status: 'ACCEPTED' | 'HOLD';
  protectedMainSha: string;
  referenceBatchId: string;
  sourceSetSha256: string;
  referenceRowCount: number;
  pendingProductMappingCount: number;
  pendingPhysicalIdentityCount: number;
  readyForLocationEvidenceCount: number;
  intendedFrozenCohortCount: number;
  acceptedPotentialCount: number;
  acceptedExactMappingCount: number;
  acceptedReferenceCount: number;
  acceptedOutsideReferenceCount: number;
  acceptedCodeDriftReferenceCount: number;
  acceptedInvariantFailureCount: number;
  failedCommandId: string;
  audit: {
    rejectionCount: number;
    successAuditCount: number;
    plannerAuditCount: number;
    plannerAuditId: string | null;
    plannerAuditCreatedAt: string | null;
    plannerResult: Record<string, unknown>;
    auditAccepted: boolean;
  };
  executionDisabled: true;
  providerTrafficIncluded: false;
  imagePlanningIncluded: false;
  physicalAuthorityCreated: false;
  inventoryAuthorityCreated: false;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readR5006MappingPlanOnlyReconciliation(
  supabase: SupabaseClient,
): Promise<R5006MappingPlanOnlyReconciliation> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'MAPPING_PLAN_ONLY_RECONCILE',
      expectedProtectedMainSha: R5_006_MAPPING_PLAN_ONLY_TARGET.protectedMainSha,
      expectedCohortSha256: R5_006_MAPPING_PLAN_ONLY_TARGET.cohortSha256,
    },
  });
  if (error) throw new Error(`R5-006 mapping reconciliation failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'MAPPING_PLAN_ONLY_RECONCILE' || !data.reconciliation) {
    throw new Error('R5-006 mapping reconciliation returned an invalid acknowledgement.');
  }
  return data.reconciliation as R5006MappingPlanOnlyReconciliation;
}
