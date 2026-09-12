import { supabase } from '@/lib/supabaseClient';
import {
  COMMERCIAL_WAVE2_PLAN_TARGET,
  buildCommercialWave2PlanInput,
  type CommercialWave2PlanPreflight,
  type CommercialWave2PlanResult,
} from '@/features/productIdentity/commercialWave2PlanContract';

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2PlanPreflight(): Promise<CommercialWave2PlanPreflight> {
  const target = COMMERCIAL_WAVE2_PLAN_TARGET;
  const { data, error } = await activeClient().functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'WAVE2_PLAN_PREFLIGHT',
      expectedProtectedMainSha: target.protectedMainSha,
      expectedCandidateCount: target.candidateCount,
      expectedCandidateSetSha256: target.candidateSetSha256,
      expectedCanaryExternalProductCode: target.canaryExternalProductCode,
    },
  });
  if (error) throw new Error(`Wave-2 P0 preflight failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'WAVE2_PLAN_PREFLIGHT' || !data.preflight) {
    throw new Error('Wave-2 P0 preflight returned an invalid acknowledgement.');
  }
  return data.preflight as CommercialWave2PlanPreflight;
}

export async function planCommercialWave2(): Promise<CommercialWave2PlanResult> {
  const { data, error } = await activeClient().functions.invoke('trigger-unleashed-master-migration', {
    body: { mode: 'WAVE2_PLAN', ...buildCommercialWave2PlanInput() },
  });
  if (error) throw new Error(`Wave-2 P1 PLAN failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'WAVE2_PLAN' || !data.plan) {
    throw new Error('Wave-2 P1 PLAN returned an invalid acknowledgement.');
  }
  return data.plan as CommercialWave2PlanResult;
}
