import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  BATCH2_P3_RESUME_TARGET,
  type Batch2P3EvidenceRow,
  type Batch2P3ResumeEvidence,
} from '@/features/productIdentity/batch2P3ResumePublishContract';

type ReadResult = {
  data: unknown;
  error: unknown;
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

function evidenceRows(data: unknown, label: string): Batch2P3EvidenceRow[] {
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`Batch 2 P3 ${label} read returned an invalid row set.`);
  }
  return data as Batch2P3EvidenceRow[];
}

async function readRows(label: string, query: PromiseLike<ReadResult>) {
  const result = await query;
  if (result.error) throw new Error(`Batch 2 P3 ${label} read failed: ${errorMessage(result.error)}`);
  return evidenceRows(result.data, label);
}

export async function readBatch2P3ResumeEvidence(
  phase: 'PRE' | 'POST',
  client?: SupabaseClient | null,
): Promise<Batch2P3ResumeEvidence> {
  const active = activeClient(client);
  const target = BATCH2_P3_RESUME_TARGET;
  const batchId = target.batchId;
  const skuCodes = Object.values(target.identities).map((identity) => identity.physicalSkuCode);
  const commercialSkuIds = Object.values(target.identities).map((identity) => identity.commercialSkuId);
  const label = phase === 'POST' ? 'postflight' : 'preflight';
  const [
    batches,
    scopeItems,
    reconciliations,
    observations,
    tasks,
    families,
    physicalSkus,
    packages,
    barcodeBindings,
    commercialFamilyLinks,
    publicationAudits,
    inventoryMovements,
    warehouseMovements,
    warehouseLocationItems,
    inventoryBalances,
    stockMovements,
  ] = await Promise.all([
    readRows(`${label} batch`, active
      .from('ecoflow_product_identity_batches')
      .select('id,batch_name,batch_status,revision,start_command_id,submit_command_id,publish_command_id,submitted_at,published_at')
      .eq('id', batchId)
      .limit(2)),
    readRows(`${label} scope`, active
      .from('ecoflow_product_identity_batch_scope_items')
      .select('batch_id,commercial_sku_id,start_command_id')
      .eq('batch_id', batchId)
      .limit(3)),
    readRows(`${label} reconciliation`, active
      .from('ecoflow_barcode_survey_identity_reconciliations')
      .select('survey_observation_id,batch_id,product_identity_observation_id,command_id,commercial_sku_id,carton_barcode,reconciliation_status')
      .eq('batch_id', batchId)
      .limit(3)),
    readRows(`${label} observation`, active
      .from('ecoflow_product_identity_observations')
      .select('id,batch_id,command_id,commercial_sku_id,physical_sku_id,family_id,barcode,package_level,units_in_base_unit,substitution_policy,is_preferred,observation_status,payload')
      .eq('batch_id', batchId)
      .limit(3)),
    readRows(`${label} task`, active
      .from('ecoflow_product_identity_tasks')
      .select('batch_id,commercial_sku_id,task_status,blocking')
      .eq('batch_id', batchId)
      .limit(3)),
    readRows(`${label} family`, active
      .from('ecoflow_sku_families')
      .select('id,family_code,family_name,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId)
      .limit(3)),
    readRows(`${label} Physical SKU`, active
      .from('ecoflow_physical_skus')
      .select('id,physical_sku_code,display_name,brand,supplier_name,family_id,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId)
      .limit(3)),
    readRows(`${label} package`, active
      .from('ecoflow_physical_sku_packages')
      .select('id,physical_sku_id,package_level,units_in_base_unit,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId)
      .limit(3)),
    readRows(`${label} barcode`, active
      .from('ecoflow_physical_barcode_bindings')
      .select('barcode,physical_sku_id,package_id,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId)
      .limit(3)),
    readRows(`${label} Commercial-family link`, active
      .from('ecoflow_commercial_family_links')
      .select('commercial_sku_id,family_id,preferred_physical_sku_id,substitution_policy,identity_status,created_in_batch_id')
      .eq('created_in_batch_id', batchId)
      .limit(3)),
    readRows(`${label} publication audit`, active
      .from('v_ecoflow_product_identity_publication_audit')
      .select('batch_id,batch_name,batch_status,revision,submitted_at,published_at,observation_count,conflict_observation_count')
      .eq('batch_id', batchId)
      .limit(2)),
    readRows(`${label} inventory movement sentinel`, active
      .from('ecoflow_inventory_movements')
      .select('id,sku')
      .in('sku', skuCodes)
      .limit(1)),
    readRows(`${label} warehouse movement sentinel`, active
      .from('ecoflow_warehouse_movements')
      .select('id,sku')
      .in('sku', skuCodes)
      .limit(1)),
    readRows(`${label} warehouse location sentinel`, active
      .from('ecoflow_warehouse_location_items')
      .select('id,sku')
      .in('sku', skuCodes)
      .limit(1)),
    readRows(`${label} canonical inventory balance sentinel`, active
      .from('inventory_balances')
      .select('id,sku_id')
      .in('sku_id', commercialSkuIds)
      .limit(1)),
    readRows(`${label} canonical stock movement sentinel`, active
      .from('stock_movements')
      .select('id,sku_id')
      .in('sku_id', commercialSkuIds)
      .limit(1)),
  ]);

  return {
    batches,
    scopeItems,
    reconciliations,
    observations,
    tasks,
    families,
    physicalSkus,
    packages,
    barcodeBindings,
    commercialFamilyLinks,
    publicationAudits,
    quantitySentinels: {
      inventoryMovements,
      warehouseMovements,
      warehouseLocationItems,
      inventoryBalances,
      stockMovements,
    },
  };
}
