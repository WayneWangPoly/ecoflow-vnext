import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_003_STAGE_REQUEST = {
  requestKey: 'ECOFLOW-R5-003',
  confirm: true,
} as const;

export type R5003StageResult = {
  ok: true;
  requestKey: 'ECOFLOW-R5-003';
  commandId: '653bcfcc-7e3e-488c-bfb0-2f3a163a79cb';
  batchId: string;
  batchStatus: 'STAGED';
  revision: 0;
  sourceRunId: '5cd0e73b-956d-4c80-9e70-6d841d27b163';
  asAt: string;
  sourceSetSha256: string;
  sourceRowCount: 427;
  authorityEffect: 'NONE';
};

type StageError = { error?: string; details?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertStageResult(value: unknown): R5003StageResult {
  if (!isRecord(value)) throw new Error('R5_003_STAGE_CONTRACT_VIOLATION');
  if (
    value.ok !== true
    || value.requestKey !== 'ECOFLOW-R5-003'
    || value.commandId !== '653bcfcc-7e3e-488c-bfb0-2f3a163a79cb'
    || value.batchStatus !== 'STAGED'
    || value.revision !== 0
    || value.sourceRunId !== '5cd0e73b-956d-4c80-9e70-6d841d27b163'
    || value.sourceRowCount !== 427
    || value.authorityEffect !== 'NONE'
    || typeof value.batchId !== 'string'
    || typeof value.asAt !== 'string'
    || typeof value.sourceSetSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.sourceSetSha256)
  ) {
    throw new Error('R5_003_STAGE_RESULT_REJECTED');
  }
  return value as R5003StageResult;
}

export async function runR5003InventoryReferenceStage(
  supabase: SupabaseClient,
): Promise<R5003StageResult> {
  const { data, error } = await supabase.functions.invoke('stage-unleashed-inventory-reference', {
    body: R5_003_STAGE_REQUEST,
  });
  if (error) throw error;
  const carrierError = data as StageError | null;
  if (carrierError?.error) {
    throw new Error(`${carrierError.error}${carrierError.details ? `: ${carrierError.details}` : ''}`);
  }
  return assertStageResult(data);
}
