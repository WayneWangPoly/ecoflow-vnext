import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  BATCH_NEXT5_P2_TARGET,
  type BatchNext5P2Evidence,
  type BatchNext5P2EvidenceRow,
} from '@/features/productIdentity/batchNext5P2ResumeSubmitContract';

type ReadResult = { data: unknown; error: unknown };

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

function evidenceRows(data: unknown, label: string): BatchNext5P2EvidenceRow[] {
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`Batch Next 5 P2 ${label} read returned an invalid row set.`);
  }
  return data as BatchNext5P2EvidenceRow[];
}

async function readRows(label: string, query: PromiseLike<ReadResult>) {
  const result = await query;
  if (result.error) throw new Error(`Batch Next 5 P2 ${label} read failed: ${errorMessage(result.error)}`);
  return evidenceRows(result.data, label);
}

export async function readBatchNext5P2ResumeEvidence(client?: SupabaseClient | null): Promise<BatchNext5P2Evidence> {
  const active = activeClient(client);
  const batchId = BATCH_NEXT5_P2_TARGET.batchId;
  const [
    batches,
    scopeItems,
    reconciliations,
    observations,
    families,
    physicalSkus,
    packages,
    barcodeBindings,
    commercialFamilyLinks,
  ] = await Promise.all([
    readRows('batch', active
      .from('ecoflow_product_identity_batches')
      .select('id,batch_name,batch_status,revision,start_command_id,submit_command_id,publish_command_id,submitted_at,published_at')
      .eq('id', batchId).limit(2)),
    readRows('scope', active
      .from('ecoflow_product_identity_batch_scope_items')
      .select('batch_id,commercial_sku_id,start_command_id')
      .eq('batch_id', batchId).limit(9)),
    readRows('reconciliation', active
      .from('ecoflow_barcode_survey_identity_reconciliations')
      .select('id,survey_observation_id,batch_id,product_identity_observation_id,command_id,commercial_sku_id,carton_barcode,reconciliation_status')
      .eq('batch_id', batchId).limit(9)),
    readRows('observation', active
      .from('ecoflow_product_identity_observations')
      .select('id,batch_id,command_id,commercial_sku_id,physical_sku_id,family_id,barcode,package_level,units_in_base_unit,substitution_policy,is_preferred,observation_status,payload')
      .eq('batch_id', batchId).limit(9)),
    readRows('family', active
      .from('ecoflow_sku_families')
      .select('id,family_code,family_name,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId).limit(9)),
    readRows('Physical SKU', active
      .from('ecoflow_physical_skus')
      .select('id,physical_sku_code,display_name,brand,supplier_name,family_id,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId).limit(9)),
    readRows('package', active
      .from('ecoflow_physical_sku_packages')
      .select('id,physical_sku_id,package_level,units_in_base_unit,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId).limit(9)),
    readRows('barcode', active
      .from('ecoflow_physical_barcode_bindings')
      .select('id,barcode,physical_sku_id,package_id,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId).limit(9)),
    readRows('Commercial-family link', active
      .from('ecoflow_commercial_family_links')
      .select('id,commercial_sku_id,family_id,preferred_physical_sku_id,substitution_policy,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId).limit(9)),
  ]);

  return {
    batches,
    scopeItems,
    reconciliations,
    observations,
    families,
    physicalSkus,
    packages,
    barcodeBindings,
    commercialFamilyLinks,
  };
}
