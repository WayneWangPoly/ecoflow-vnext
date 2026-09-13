import { supabase } from '@/lib/supabaseClient';
import type { CommercialWave2P3VerificationReport } from '@/features/productIdentity/commercialWave2CanaryVerificationContract';

const P3_READ_RPC = 'ecoflow_read_commercial_wave2_p3_verification_v2' as const;

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2P3Verification(): Promise<CommercialWave2P3VerificationReport> {
  const { data, error } = await activeClient().rpc(P3_READ_RPC);
  if (error) throw new Error(`Wave-2 P3 authenticated read failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Wave-2 P3 verification returned an invalid report.');
  }
  const report = data as unknown as CommercialWave2P3VerificationReport;
  if (report.mode !== 'P3_VERIFY_READ_ONLY' || report.stage !== 'P3_VERIFICATION_ONLY') {
    throw new Error('Wave-2 P3 verification returned an invalid report.');
  }
  return report;
}
