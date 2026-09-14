import { supabase } from '@/lib/supabaseClient';
import type {
  CommercialWave2P4EBatchExecutionResult,
  CommercialWave2P4EBatchGateReport,
  CommercialWave2P4EPostflightResult,
} from '@/features/productIdentity/commercialWave2P4EBatchPromotionContract';

const P4E_GATE_RPC = 'ecoflow_read_commercial_wave2_p4e_batch_gate' as const;
const P4E_EXECUTE_RPC = 'ecoflow_promote_commercial_wave2_expansion_batch_v1' as const;
const P4E_VERIFY_RPC = 'ecoflow_verify_commercial_wave2_expansion_batch_v1' as const;

function activeClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export async function readCommercialWave2P4EBatchGate(): Promise<CommercialWave2P4EBatchGateReport> {
  const { data, error } = await activeClient().rpc(P4E_GATE_RPC);
  if (error) throw new Error(`Wave-2 P4E authenticated batch gate failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Wave-2 P4E batch gate returned an invalid report.');
  const report = data as unknown as CommercialWave2P4EBatchGateReport;
  if (report.mode !== 'P4E_BATCH_GATE' || report.stage !== 'P4E_BATCH_PROMOTION') throw new Error('Wave-2 P4E batch gate returned an invalid report.');
  return report;
}

export async function executeCommercialWave2P4EBatch(batchNo: number): Promise<CommercialWave2P4EBatchExecutionResult> {
  const { data, error } = await activeClient().rpc(P4E_EXECUTE_RPC, { p_batch_no: batchNo });
  if (error) throw new Error(`Wave-2 P4E batch ${batchNo} promotion failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Wave-2 P4E batch ${batchNo} returned an invalid acknowledgement.`);
  return data as unknown as CommercialWave2P4EBatchExecutionResult;
}

export async function verifyCommercialWave2P4EBatch(batchNo: number): Promise<CommercialWave2P4EPostflightResult> {
  const { data, error } = await activeClient().rpc(P4E_VERIFY_RPC, { p_batch_no: batchNo });
  if (error) throw new Error(`Wave-2 P4E batch ${batchNo} postflight failed: ${errorMessage(error)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Wave-2 P4E batch ${batchNo} postflight returned an invalid acknowledgement.`);
  return data as unknown as CommercialWave2P4EPostflightResult;
}
