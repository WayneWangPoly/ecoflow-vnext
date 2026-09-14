import { supabase } from '@/lib/supabaseClient';
import type { CommercialWave2P4DPromotionReadinessReport } from '@/features/productIdentity/commercialWave2P4DPromotionReadinessContract';

const P4D_READ_RPC = 'ecoflow_read_commercial_wave2_p4d_promotion_readiness' as const;

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2P4DPromotionReadiness(): Promise<CommercialWave2P4DPromotionReadinessReport> {
  const { data, error } = await activeClient().rpc(P4D_READ_RPC);
  if (error) throw new Error(`Wave-2 P4D authenticated readiness read failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Wave-2 P4D readiness returned an invalid report.');
  const report = data as unknown as CommercialWave2P4DPromotionReadinessReport;
  if (report.mode !== 'P4D_PROMOTION_READINESS_ONLY' || report.stage !== 'P4D_PROMOTION_AUTHORITY_PLAN') {
    throw new Error('Wave-2 P4D readiness returned an invalid report.');
  }
  return report;
}
