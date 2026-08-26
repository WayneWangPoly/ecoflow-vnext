import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BarcodeSurveyReconciliationStatus =
  | 'READY_TO_RECONCILE'
  | 'NEEDS_IDENTITY_CONFIRMATION'
  | 'DUPLICATE_CONFLICT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'DRAFT_CREATED'
  | 'ALREADY_RECONCILED_PUBLISHED';

export type BarcodeSurveyReconciliationRow = {
  surveyObservationId: string;
  sourceObservationId: string | null;
  skuContext: string | null;
  skuProductName: string | null;
  cartonBarcode: string;
  sleeveStatus: string;
  sleeveBarcode: string | null;
  evidenceSource: string | null;
  surveyNote: string | null;
  surveyOccurredAt: string;
  commercialMatchCount: number;
  commercialSkuId: string | null;
  commercialSkuCode: string | null;
  commercialName: string | null;
  ordermentumSku: string | null;
  existingPhysicalSkuCode: string | null;
  queueStatus: BarcodeSurveyReconciliationStatus;
  queueReason: string;
  reconciliationId: string | null;
  productIdentityObservationId: string | null;
  reconciliationStatus: 'DRAFTED' | 'CONFLICT' | null;
  reconciledAt: string | null;
};

export type BarcodeSurveyReconcileResult = {
  reconciliationId: string;
  surveyObservationId: string;
  productIdentityObservationId: string;
  commercialSkuId: string;
  barcode: string;
  reconciliationStatus: 'DRAFTED' | 'CONFLICT';
  commandStatus: 'APPLIED' | 'REPLAYED' | 'EXISTING';
  detail: string;
  reconciledAt: string;
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

async function rpc<T>(name: string, args?: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data as T;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function safeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function readBarcodeSurveyReconciliationQueue(
  limit = 200,
  client?: SupabaseClient | null,
): Promise<BarcodeSurveyReconciliationRow[]> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_read_barcode_survey_reconciliation_queue_v1', {
    p_limit: Math.min(500, Math.max(1, limit)),
  }, client) ?? [];

  return rows.map((row) => ({
    surveyObservationId: String(row.survey_observation_id),
    sourceObservationId: text(row.source_observation_id),
    skuContext: text(row.sku_context),
    skuProductName: text(row.sku_product_name),
    cartonBarcode: String(row.carton_barcode || ''),
    sleeveStatus: String(row.sleeve_status || ''),
    sleeveBarcode: text(row.sleeve_barcode),
    evidenceSource: text(row.evidence_source),
    surveyNote: text(row.survey_note),
    surveyOccurredAt: String(row.survey_occurred_at || ''),
    commercialMatchCount: safeInteger(row.commercial_match_count),
    commercialSkuId: text(row.commercial_sku_id),
    commercialSkuCode: text(row.commercial_sku_code),
    commercialName: text(row.commercial_name),
    ordermentumSku: text(row.ordermentum_sku),
    existingPhysicalSkuCode: text(row.existing_physical_sku_code),
    queueStatus: String(row.queue_status) as BarcodeSurveyReconciliationStatus,
    queueReason: String(row.queue_reason || ''),
    reconciliationId: text(row.reconciliation_id),
    productIdentityObservationId: text(row.product_identity_observation_id),
    reconciliationStatus: text(row.reconciliation_status) as BarcodeSurveyReconciliationRow['reconciliationStatus'],
    reconciledAt: text(row.reconciled_at),
  }));
}

export async function reconcileBarcodeSurveyObservation(input: {
  surveyObservationId: string;
  batchId: string;
  commandId: string;
  physicalSkuCode: string;
  physicalName: string;
  brand?: string;
  supplierName?: string;
  familyCode: string;
  familyName: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: number;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  note?: string;
}, client?: SupabaseClient | null): Promise<BarcodeSurveyReconcileResult> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_reconcile_barcode_survey_observation_v1', {
    p_survey_observation_id: input.surveyObservationId,
    p_batch_id: input.batchId,
    p_command_id: input.commandId,
    p_physical_sku_code: input.physicalSkuCode,
    p_physical_name: input.physicalName,
    p_brand: input.brand || null,
    p_supplier_name: input.supplierName || null,
    p_family_code: input.familyCode,
    p_family_name: input.familyName,
    p_package_level: input.packageLevel,
    p_units_in_base_unit: input.unitsInBaseUnit,
    p_substitution_policy: input.substitutionPolicy,
    p_is_preferred: input.isPreferred,
    p_note: input.note || null,
  }, client) ?? [];

  const row = rows[0];
  if (!row) throw new Error('Barcode Survey reconciliation returned no result.');
  return {
    reconciliationId: String(row.reconciliation_id),
    surveyObservationId: String(row.survey_observation_id),
    productIdentityObservationId: String(row.product_identity_observation_id),
    commercialSkuId: String(row.commercial_sku_id),
    barcode: String(row.barcode || ''),
    reconciliationStatus: String(row.reconciliation_status) as BarcodeSurveyReconcileResult['reconciliationStatus'],
    commandStatus: String(row.command_status) as BarcodeSurveyReconcileResult['commandStatus'],
    detail: String(row.detail || ''),
    reconciledAt: String(row.reconciled_at || ''),
  };
}
