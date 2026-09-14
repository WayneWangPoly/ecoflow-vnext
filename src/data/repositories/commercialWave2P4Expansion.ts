import { supabase } from '@/lib/supabaseClient';
import type {
  CommercialWave2P4CActivationReport,
  CommercialWave2P4CExpansionResult,
} from '@/features/productIdentity/commercialWave2P4ExpansionContract';
import { COMMERCIAL_WAVE2_P4C_TARGET } from '@/features/productIdentity/commercialWave2P4ExpansionContract';

const P4C_READ_RPC = 'ecoflow_read_commercial_wave2_p4c_activation' as const;
const P4C_EXECUTE_RPC = 'ecoflow_unlock_commercial_wave2_expansion_v2' as const;

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2P4CActivation(): Promise<CommercialWave2P4CActivationReport> {
  const { data, error } = await activeClient().rpc(P4C_READ_RPC);
  if (error) throw new Error(`Wave-2 P4C activation preflight failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Wave-2 P4C activation returned an invalid report.');
  const report = data as unknown as CommercialWave2P4CActivationReport;
  if (report.mode !== 'P4C_ACTIVATION_PREFLIGHT' || report.stage !== 'P4C_EXPANSION_ACTIVATION') {
    throw new Error('Wave-2 P4C activation returned an invalid report.');
  }
  return report;
}

export async function executeCommercialWave2P4CExpansion(): Promise<CommercialWave2P4CExpansionResult> {
  const target = COMMERCIAL_WAVE2_P4C_TARGET;
  const { data, error } = await activeClient().rpc(P4C_EXECUTE_RPC, {
    p_command_id: target.commandId,
    p_expected_candidate_set_sha256: target.candidateSetSha256,
    p_reason: target.reason,
  });
  if (error) throw new Error(`Wave-2 P4C expansion unlock failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Wave-2 P4C expansion unlock returned an invalid acknowledgement.');
  return data as unknown as CommercialWave2P4CExpansionResult;
}
