import { supabase } from '@/lib/supabaseClient';
import {
  buildCommercialWave2CanaryPromotionInput,
  buildCommercialWave2CanaryPromotionPreflightInput,
  type CommercialWave2CanaryPromotionPreflight,
  type CommercialWave2CanaryPromotionResult,
} from '@/features/productIdentity/commercialWave2CanaryPromotionContract';

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2CanaryPromotionPreflight(): Promise<CommercialWave2CanaryPromotionPreflight> {
  const { data, error } = await activeClient().functions.invoke('commercial-wave2-p2b-canary-promotion', {
    body: {
      mode: 'P2B_CANARY_PROMOTION_PREFLIGHT',
      ...buildCommercialWave2CanaryPromotionPreflightInput(),
    },
  });
  if (error) throw new Error(`Wave-2 P2B preflight failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'P2B_CANARY_PROMOTION_PREFLIGHT' || !data.preflight) {
    throw new Error('Wave-2 P2B preflight returned an invalid acknowledgement.');
  }
  return data.preflight as CommercialWave2CanaryPromotionPreflight;
}

export async function promoteCommercialWave2Canary(): Promise<CommercialWave2CanaryPromotionResult> {
  const { data, error } = await activeClient().functions.invoke('commercial-wave2-p2b-canary-promotion', {
    body: {
      mode: 'P2B_CANARY_PROMOTION',
      ...buildCommercialWave2CanaryPromotionInput(),
    },
  });
  if (error) throw new Error(`Wave-2 P2B promotion failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'P2B_CANARY_PROMOTION' || !data.promotion) {
    throw new Error('Wave-2 P2B promotion returned an invalid acknowledgement.');
  }
  return data.promotion as CommercialWave2CanaryPromotionResult;
}
