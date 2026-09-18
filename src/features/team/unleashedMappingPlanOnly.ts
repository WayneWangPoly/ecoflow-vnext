import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_006_MAPPING_PLAN_ONLY_TARGET = {
  protectedMainSha: '2545fd0c455f36f157c5609eff36d147f0c925b3',
  cohortSha256: '8e5974ea2ef8725977c2c38c135d517d1595cc2064bd6f03b9801e1b03adb020',
} as const;

export type R5006MappingPlanOnlyPreflight = {
  ready: boolean;
  status: 'READY' | 'HOLD';
  protectedMainSha: string;
  referenceBatchId: string;
  sourceSetSha256: string;
  referenceRowCount: number;
  pendingProductMappingCount: number;
  pendingPhysicalIdentityCount: number;
  readyForLocationEvidenceCount: number;
  autoMatchableCount: number;
  autoMatchablePositiveRows: number;
  autoMatchablePositiveQty: number;
  noTargetCount: number;
  ambiguousTargetCount: number;
  mappingInvariantFailureCount: number;
  cohortSha256: string;
  predictedPostflight: {
    pendingProductMappingCount: number;
    pendingPhysicalIdentityCount: number;
    readyForLocationEvidenceCount: number;
  };
};

export type R5006MappingPlanOnlyResult = {
  commandId: string;
  protectedMainSha: string;
  cohortSha256: string;
  mappings: Record<string, unknown>;
  preflight: R5006MappingPlanOnlyPreflight;
  postflight: R5006MappingPlanOnlyPreflight;
  providerTrafficIncluded: false;
  imagePlanningIncluded: false;
  physicalAuthorityCreated: false;
  inventoryAuthorityCreated: false;
  replayed: boolean;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readR5006MappingPlanOnlyPreflight(
  supabase: SupabaseClient,
): Promise<R5006MappingPlanOnlyPreflight> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'MAPPING_PLAN_ONLY_PREFLIGHT',
      expectedProtectedMainSha: R5_006_MAPPING_PLAN_ONLY_TARGET.protectedMainSha,
      expectedCohortSha256: R5_006_MAPPING_PLAN_ONLY_TARGET.cohortSha256,
    },
  });
  if (error) throw new Error(`R5-006 mapping PLAN preflight failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'MAPPING_PLAN_ONLY_PREFLIGHT' || !data.preflight) {
    throw new Error('R5-006 mapping PLAN preflight returned an invalid acknowledgement.');
  }
  return data.preflight as R5006MappingPlanOnlyPreflight;
}

export async function runR5006MappingPlanOnly(
  supabase: SupabaseClient,
  input: { commandId: string; reason: string },
): Promise<R5006MappingPlanOnlyResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) {
    throw new Error('R5-006 command ID is invalid.');
  }
  if (input.reason.trim().length < 3) throw new Error('R5-006 reason is required.');
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'MAPPING_PLAN_ONLY',
      commandId: input.commandId,
      reason: input.reason.trim(),
      expectedProtectedMainSha: R5_006_MAPPING_PLAN_ONLY_TARGET.protectedMainSha,
      expectedCohortSha256: R5_006_MAPPING_PLAN_ONLY_TARGET.cohortSha256,
    },
  });
  if (error) throw new Error(`R5-006 mapping PLAN failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'MAPPING_PLAN_ONLY' || !data.plan) {
    throw new Error('R5-006 mapping PLAN returned an invalid acknowledgement.');
  }
  return data.plan as R5006MappingPlanOnlyResult;
}
