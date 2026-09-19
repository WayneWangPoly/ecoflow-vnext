import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BatchNext5ResumeEvidence = {
  batchRows: Array<Record<string, unknown>>;
  scopeRows: Array<Record<string, unknown>>;
  reconciliationRows: Array<Record<string, unknown>>;
};

function activeClient(input?: SupabaseClient | null) {
  const client = input ?? supabase;
  if (!client) throw new Error('Supabase is not configured.');
  return client;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

async function readRows(label: string, query: PromiseLike<{ data: unknown; error: unknown }>) {
  const result = await query;
  if (result.error) throw new Error(`Batch Next 5 ${label} read failed: ${errorMessage(result.error)}`);
  if (!Array.isArray(result.data)) throw new Error(`Batch Next 5 ${label} returned invalid data.`);
  return result.data as Array<Record<string, unknown>>;
}

export async function readBatchNext5ResumeEvidence(
  batchId: string,
  client?: SupabaseClient | null,
): Promise<BatchNext5ResumeEvidence> {
  const active = activeClient(client);
  const [batchRows, scopeRows, reconciliationRows] = await Promise.all([
    readRows('batch evidence', active
      .from('ecoflow_product_identity_batches')
      .select('id,batch_name,batch_status,revision,start_command_id,submit_command_id,publish_command_id')
      .eq('id', batchId)
      .limit(2)),
    readRows('scope evidence', active
      .from('ecoflow_product_identity_batch_scope_items')
      .select('batch_id,commercial_sku_id,start_command_id')
      .eq('batch_id', batchId)
      .limit(9)),
    readRows('reconciliation evidence', active
      .from('ecoflow_barcode_survey_identity_reconciliations')
      .select('id,batch_id,survey_observation_id,product_identity_observation_id,command_id,commercial_sku_id,sku_context,carton_barcode,reconciliation_status')
      .eq('batch_id', batchId)
      .limit(9)),
  ]);
  return { batchRows, scopeRows, reconciliationRows };
}
