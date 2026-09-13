import { supabase } from '@/lib/supabaseClient';
import {
  buildCommercialWave2P3VerificationInput,
  type CommercialWave2P3VerificationReport,
} from '@/features/productIdentity/commercialWave2CanaryVerificationContract';

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
  const { data, error } = await activeClient().functions.invoke('commercial-wave2-p3-verification', {
    body: {
      mode: 'P3_VERIFY_READ_ONLY',
      ...buildCommercialWave2P3VerificationInput(),
    },
  });
  if (error) throw new Error(`Wave-2 P3 verification read failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'P3_VERIFY_READ_ONLY' || data.stage !== 'P3_VERIFICATION_ONLY') {
    throw new Error('Wave-2 P3 verification returned an invalid report.');
  }
  return data as CommercialWave2P3VerificationReport;
}
