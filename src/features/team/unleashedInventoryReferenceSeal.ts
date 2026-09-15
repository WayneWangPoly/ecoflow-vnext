import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_004B_REFERENCE_BATCH_ID = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9' as const;
export const R5_004B_REFERENCE_ROW_ID = '7156d372-b12f-419e-b05e-2f12571ca525' as const;
export const R5_004B_SOURCE_RUN_ID = '5cd0e73b-956d-4c80-9e70-6d841d27b163' as const;
export const R5_004B_SOURCE_SET_SHA256 = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d' as const;
export const R5_004B_SEAL_COMMAND_ID = 'a11f638c-0738-4d16-a3fb-3ed29bf079b7' as const;
export const R5_004B_SEAL_REASON = 'ECOFLOW-R5-004B seal R5-003 ADL1 reference for bounded BPB8 INITIAL opening-balance canary' as const;

export type R5004BSealResult = {
  batchId: typeof R5_004B_REFERENCE_BATCH_ID;
  batchStatus: 'SEALED';
  revision: 1;
  sourceSetSha256: typeof R5_004B_SOURCE_SET_SHA256;
  sourceRowCount: 427;
  supersedingBatchId: null;
  authorityEffect: 'NONE';
};

type ReferenceBatch = {
  id: string;
  batch_status: string;
  revision: number;
  source_run_id: string;
  source_set_sha256: string;
  source_row_count: number;
  sealed_at: string | null;
};

type ReferenceRow = {
  reference_row_id: string;
  batch_id: string;
  batch_status: string;
  batch_revision: number;
  source_run_id: string;
  source_product_code: string;
  source_warehouse_code: string;
  qty_on_hand: number;
  allocated_qty: number;
  on_purchase_qty: number;
  available_qty_source: number;
  source_available_formula_delta: number;
  product_mapping_status: string;
  warehouse_mapping_status: string;
  commercial_sku_id: string | null;
  family_id: string | null;
  preferred_physical_sku_context_id: string | null;
  readiness_status: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactPreflight(batch: ReferenceBatch, row: ReferenceRow) {
  if (
    batch.id !== R5_004B_REFERENCE_BATCH_ID
    || batch.batch_status !== 'STAGED'
    || batch.revision !== 0
    || batch.source_run_id !== R5_004B_SOURCE_RUN_ID
    || batch.source_set_sha256 !== R5_004B_SOURCE_SET_SHA256
    || batch.source_row_count !== 427
    || batch.sealed_at !== null
  ) throw new Error('R5_004B_REFERENCE_BATCH_PREFLIGHT_MISMATCH');

  if (
    row.reference_row_id !== R5_004B_REFERENCE_ROW_ID
    || row.batch_id !== R5_004B_REFERENCE_BATCH_ID
    || row.batch_status !== 'STAGED'
    || row.batch_revision !== 0
    || row.source_run_id !== R5_004B_SOURCE_RUN_ID
    || row.source_product_code !== 'BPB8'
    || row.source_warehouse_code !== 'ADL1'
    || Number(row.qty_on_hand) !== 3
    || Number(row.allocated_qty) !== 0
    || Number(row.on_purchase_qty) !== 0
    || Number(row.available_qty_source) !== 3
    || Number(row.source_available_formula_delta) !== 0
    || row.product_mapping_status !== 'MATCHED'
    || row.warehouse_mapping_status !== 'MATCHED'
    || row.commercial_sku_id !== 'ec67ca0a-67b5-437f-96a8-81e6268faa44'
    || row.family_id !== '1ff1f446-6e97-4ce6-bf6c-ef063265783a'
    || row.preferred_physical_sku_context_id !== '7dcaa2ed-a7db-4722-b91a-e8f17ffe2281'
    || row.readiness_status !== 'READY_FOR_LOCATION_EVIDENCE'
  ) throw new Error('R5_004B_BPB8_PREFLIGHT_MISMATCH');
}

function assertSealResult(value: unknown): R5004BSealResult {
  if (!isRecord(value)) throw new Error('R5_004B_SEAL_CONTRACT_VIOLATION');
  if (
    value.batchId !== R5_004B_REFERENCE_BATCH_ID
    || value.batchStatus !== 'SEALED'
    || value.revision !== 1
    || value.sourceSetSha256 !== R5_004B_SOURCE_SET_SHA256
    || value.sourceRowCount !== 427
    || value.supersedingBatchId !== null
    || value.authorityEffect !== 'NONE'
  ) throw new Error('R5_004B_SEAL_RESULT_REJECTED');
  return value as R5004BSealResult;
}

export async function runR5004BInventoryReferenceSeal(
  supabase: SupabaseClient,
): Promise<R5004BSealResult> {
  const [batchRead, rowRead] = await Promise.all([
    supabase
      .from('ecoflow_unleashed_inventory_reference_batches')
      .select('id,batch_status,revision,source_run_id,source_set_sha256,source_row_count,sealed_at')
      .eq('id', R5_004B_REFERENCE_BATCH_ID)
      .single(),
    supabase
      .from('v_ecoflow_unleashed_inventory_reference_rows')
      .select('reference_row_id,batch_id,batch_status,batch_revision,source_run_id,source_product_code,source_warehouse_code,qty_on_hand,allocated_qty,on_purchase_qty,available_qty_source,source_available_formula_delta,product_mapping_status,warehouse_mapping_status,commercial_sku_id,family_id,preferred_physical_sku_context_id,readiness_status')
      .eq('reference_row_id', R5_004B_REFERENCE_ROW_ID)
      .single(),
  ]);

  if (batchRead.error) throw batchRead.error;
  if (rowRead.error) throw rowRead.error;
  assertExactPreflight(batchRead.data as ReferenceBatch, rowRead.data as ReferenceRow);

  const { data, error } = await supabase.rpc('ecoflow_seal_unleashed_inventory_reference_batch', {
    p_batch_id: R5_004B_REFERENCE_BATCH_ID,
    p_expected_revision: 0,
    p_command_id: R5_004B_SEAL_COMMAND_ID,
    p_reason: R5_004B_SEAL_REASON,
  });
  if (error) throw error;
  const result = assertSealResult(data);

  const { data: postflight, error: postflightError } = await supabase
    .from('ecoflow_unleashed_inventory_reference_batches')
    .select('id,batch_status,revision,source_run_id,source_set_sha256,source_row_count,sealed_at,seal_command_id')
    .eq('id', R5_004B_REFERENCE_BATCH_ID)
    .single();
  if (postflightError) throw postflightError;
  if (
    postflight.id !== R5_004B_REFERENCE_BATCH_ID
    || postflight.batch_status !== 'SEALED'
    || postflight.revision !== 1
    || postflight.source_run_id !== R5_004B_SOURCE_RUN_ID
    || postflight.source_set_sha256 !== R5_004B_SOURCE_SET_SHA256
    || postflight.source_row_count !== 427
    || postflight.seal_command_id !== R5_004B_SEAL_COMMAND_ID
    || typeof postflight.sealed_at !== 'string'
  ) throw new Error('R5_004B_SEAL_POSTFLIGHT_MISMATCH');

  return result;
}
