import { supabase } from '@/lib/supabaseClient';
import type { CommercialWave2P4AReadinessReport } from '@/features/productIdentity/commercialWave2P4ReadinessContract';

const P4A_READ_RPC = 'ecoflow_read_commercial_wave2_p4_readiness' as const;

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2P4AReadiness(): Promise<CommercialWave2P4AReadinessReport> {
  const { data, error } = await activeClient().rpc(P4A_READ_RPC);
  if (error) throw new Error(`Wave-2 P4A authenticated readiness read failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Wave-2 P4A readiness returned an invalid report.');
  }
  const report = data as unknown as CommercialWave2P4AReadinessReport;
  if (report.mode !== 'P4A_READINESS_ONLY' || report.stage !== 'P4A_EXPANSION_READINESS') {
    throw new Error('Wave-2 P4A readiness returned an invalid report.');
  }
  return report;
}
