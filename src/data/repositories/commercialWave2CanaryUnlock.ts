import { supabase } from '@/lib/supabaseClient';
import {
  buildCommercialWave2CanaryUnlockInput,
  buildCommercialWave2CanaryUnlockPreflightInput,
  type CommercialWave2CanaryUnlockPreflight,
  type CommercialWave2CanaryUnlockResult,
} from '@/features/productIdentity/commercialWave2CanaryUnlockContract';

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2CanaryUnlockPreflight(): Promise<CommercialWave2CanaryUnlockPreflight> {
  const { data, error } = await activeClient().functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'WAVE2_CANARY_UNLOCK_PREFLIGHT',
      ...buildCommercialWave2CanaryUnlockPreflightInput(),
    },
  });
  if (error) throw new Error(`Wave-2 P2A preflight failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'WAVE2_CANARY_UNLOCK_PREFLIGHT' || !data.preflight) {
    throw new Error('Wave-2 P2A preflight returned an invalid acknowledgement.');
  }
  return data.preflight as CommercialWave2CanaryUnlockPreflight;
}

export async function unlockCommercialWave2Canary(): Promise<CommercialWave2CanaryUnlockResult> {
  const { data, error } = await activeClient().functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'WAVE2_CANARY_UNLOCK',
      ...buildCommercialWave2CanaryUnlockInput(),
    },
  });
  if (error) throw new Error(`Wave-2 P2A unlock failed: ${errorMessage(error)}`);
  if (!data || data.mode !== 'WAVE2_CANARY_UNLOCK' || !data.unlock) {
    throw new Error('Wave-2 P2A unlock returned an invalid acknowledgement.');
  }
  return data.unlock as CommercialWave2CanaryUnlockResult;
}
