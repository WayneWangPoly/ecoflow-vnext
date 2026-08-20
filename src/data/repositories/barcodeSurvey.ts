import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BarcodeSurveySleeveStatus = 'SCANNED' | 'NO_SEPARATE_BARCODE' | 'NOT_CHECKED';
export type BarcodeSurveyObservedSleeveStatus = Exclude<BarcodeSurveySleeveStatus, 'NOT_CHECKED'>;

export type BarcodeSurveyEvidenceSource =
  | 'OBSERVED_NOW'
  | 'REUSED_EXACT_PACKAGE'
  | 'DEFERRED_INACCESSIBLE'
  | 'DEFERRED_OPENING_REQUIRED'
  | 'LEGACY_NOT_CHECKED';

export type BarcodeSurveyCaptureMode = Exclude<BarcodeSurveyEvidenceSource, 'LEGACY_NOT_CHECKED'>;

export type BarcodeSurveyPackagingEvidenceStatus =
  | 'VERIFIED_SCANNED'
  | 'VERIFIED_NO_SEPARATE_BARCODE'
  | 'UNVERIFIED'
  | 'CONFLICT';

export type BarcodeSurveySkuSuggestion = {
  sku: string;
  productName: string | null;
  category: string | null;
  fixedShelf: string | null;
  primaryBarcode: string | null;
};

export type BarcodeSurveyCommandResult = {
  accepted: true;
  replayed: boolean;
  status: 'APPLIED' | 'REPLAYED';
  commandId: string;
  observationId: string;
  skuContext: string | null;
  skuProductName: string | null;
  cartonBarcode: string;
  sleeveStatus: BarcodeSurveySleeveStatus;
  sleeveBarcode: string | null;
  occurredAt: string;
};

export type SmartBarcodeSurveyCommandResult = BarcodeSurveyCommandResult & {
  evidenceSource: BarcodeSurveyCaptureMode;
  sourceObservationId: string | null;
};

export type BarcodeSurveyPackagingEvidence = {
  status: BarcodeSurveyPackagingEvidenceStatus;
  skuContext: string;
  cartonBarcode: string;
  sleeveBarcode: string | null;
  sourceObservationId: string | null;
  sourceOccurredAt: string | null;
  physicalObservationCount: number;
};

export type RecordBarcodeSurveyInput = {
  commandId: string;
  skuContext?: string | null;
  cartonBarcode: string;
  sleeveStatus: BarcodeSurveySleeveStatus;
  sleeveBarcode?: string | null;
  note?: string | null;
  deviceId: string;
};

export type RecordSmartBarcodeSurveyInput = {
  commandId: string;
  skuContext: string;
  cartonBarcode: string;
  captureMode: BarcodeSurveyCaptureMode;
  sleeveStatus?: BarcodeSurveyObservedSleeveStatus | null;
  sleeveBarcode?: string | null;
  sourceObservationId?: string | null;
  note?: string | null;
  deviceId: string;
};

const DEVICE_STORAGE_KEY = 'ecoflow.barcode-survey.device-id.v1';

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

async function rpc<T>(name: string, args: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data as T;
}

function createSecureUuid(label: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error(`This browser cannot create a secure ${label}.`);
}

function normalizedOptional(value?: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function normalizedRequired(value: string, label: string, maxLength = 128) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required and must be ${maxLength} characters or fewer.`);
  return normalized;
}

export function createBarcodeSurveyCommandId() {
  return createSecureUuid('Barcode Survey command ID');
}

export function getBarcodeSurveyDeviceId() {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Barcode Survey requires browser local storage for stable device identity.');
  }
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const created = createSecureUuid('Barcode Survey device ID');
  window.localStorage.setItem(DEVICE_STORAGE_KEY, created);
  return created;
}

export function validateBarcodeSurveyInput(input: Omit<RecordBarcodeSurveyInput, 'commandId' | 'deviceId'>) {
  const skuContext = normalizedOptional(input.skuContext);
  if (skuContext && skuContext.length > 128) throw new Error('SKU is invalid.');

  const cartonBarcode = input.cartonBarcode.trim();
  if (!cartonBarcode || cartonBarcode.length > 128) throw new Error('Carton barcode is required and must be 128 characters or fewer.');

  const sleeveBarcode = normalizedOptional(input.sleeveBarcode);
  if (input.sleeveStatus === 'SCANNED') {
    if (!sleeveBarcode || sleeveBarcode.length > 128) throw new Error('Scan the sleeve barcode before saving.');
    if (sleeveBarcode === cartonBarcode) throw new Error('Sleeve barcode must differ from the carton barcode.');
  } else if (sleeveBarcode) {
    throw new Error('Sleeve barcode must be empty unless Sleeve status is Scanned.');
  }

  const note = normalizedOptional(input.note);
  if (note && note.length > 2000) throw new Error('Note must be 2000 characters or fewer.');

  return { skuContext, cartonBarcode, sleeveBarcode, note };
}

function parseResult(row: Record<string, unknown> | undefined): BarcodeSurveyCommandResult {
  if (!row) throw new Error('Barcode Survey command returned no result.');
  const status = String(row.status || '');
  if (status !== 'APPLIED' && status !== 'REPLAYED') throw new Error(`Barcode Survey returned invalid status: ${status || 'empty'}.`);
  if (row.accepted !== true) throw new Error('Barcode Survey command was not accepted.');
  const sleeveStatus = String(row.sleeve_status || '');
  if (!['SCANNED', 'NO_SEPARATE_BARCODE', 'NOT_CHECKED'].includes(sleeveStatus)) {
    throw new Error('Barcode Survey returned an invalid sleeve status.');
  }
  return {
    accepted: true,
    replayed: row.replayed === true,
    status,
    commandId: String(row.command_id || ''),
    observationId: String(row.observation_id || ''),
    skuContext: typeof row.sku_context === 'string' ? row.sku_context : null,
    skuProductName: typeof row.sku_product_name === 'string' ? row.sku_product_name : null,
    cartonBarcode: String(row.carton_barcode || ''),
    sleeveStatus: sleeveStatus as BarcodeSurveySleeveStatus,
    sleeveBarcode: typeof row.sleeve_barcode === 'string' ? row.sleeve_barcode : null,
    occurredAt: String(row.occurred_at || ''),
  };
}

function parseSmartResult(row: Record<string, unknown> | undefined): SmartBarcodeSurveyCommandResult {
  const base = parseResult(row);
  const evidenceSource = String(row?.evidence_source || '');
  if (!['OBSERVED_NOW', 'REUSED_EXACT_PACKAGE', 'DEFERRED_INACCESSIBLE', 'DEFERRED_OPENING_REQUIRED'].includes(evidenceSource)) {
    throw new Error('Barcode Survey returned an invalid evidence source.');
  }
  return {
    ...base,
    evidenceSource: evidenceSource as BarcodeSurveyCaptureMode,
    sourceObservationId: typeof row?.source_observation_id === 'string' ? row.source_observation_id : null,
  };
}

function parsePackagingEvidence(row: Record<string, unknown> | undefined): BarcodeSurveyPackagingEvidence {
  if (!row) throw new Error('Packaging evidence lookup returned no result.');
  const status = String(row.status || '');
  if (!['VERIFIED_SCANNED', 'VERIFIED_NO_SEPARATE_BARCODE', 'UNVERIFIED', 'CONFLICT'].includes(status)) {
    throw new Error('Packaging evidence lookup returned an invalid status.');
  }
  const physicalObservationCount = Number(row.physical_observation_count ?? 0);
  if (!Number.isFinite(physicalObservationCount) || physicalObservationCount < 0) {
    throw new Error('Packaging evidence lookup returned an invalid observation count.');
  }
  return {
    status: status as BarcodeSurveyPackagingEvidenceStatus,
    skuContext: String(row.sku_context || ''),
    cartonBarcode: String(row.carton_barcode || ''),
    sleeveBarcode: typeof row.sleeve_barcode === 'string' ? row.sleeve_barcode : null,
    sourceObservationId: typeof row.source_observation_id === 'string' ? row.source_observation_id : null,
    sourceOccurredAt: typeof row.source_occurred_at === 'string' ? row.source_occurred_at : null,
    physicalObservationCount,
  };
}

export async function searchBarcodeSurveySkus(query: string, client?: SupabaseClient | null) {
  const normalized = query.trim();
  if (!normalized) return [];
  if (normalized.length > 128) throw new Error('SKU search is too long.');
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_search_barcode_survey_skus_v1', {
    p_query: normalized,
    p_limit: 12,
  }, client) ?? [];
  return rows
    .filter((row) => typeof row.sku === 'string' && row.sku.trim())
    .map((row) => ({
      sku: String(row.sku),
      productName: typeof row.product_name === 'string' ? row.product_name : null,
      category: typeof row.category === 'string' ? row.category : null,
      fixedShelf: typeof row.fixed_shelf === 'string' ? row.fixed_shelf : null,
      primaryBarcode: typeof row.primary_barcode === 'string' ? row.primary_barcode : null,
    } satisfies BarcodeSurveySkuSuggestion));
}

export async function getBarcodeSurveyPackagingEvidence(
  skuContext: string,
  cartonBarcode: string,
  client?: SupabaseClient | null,
) {
  const normalizedSku = normalizedRequired(skuContext, 'SKU');
  const normalizedCarton = normalizedRequired(cartonBarcode, 'Carton barcode');
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_get_barcode_survey_packaging_evidence_v1', {
    p_sku_context: normalizedSku,
    p_carton_barcode: normalizedCarton,
  }, client) ?? [];
  return parsePackagingEvidence(rows[0]);
}

export async function recordBarcodeSurveyObservation(input: RecordBarcodeSurveyInput, client?: SupabaseClient | null) {
  if (!input.commandId) throw new Error('Barcode Survey command ID is required.');
  if (!input.deviceId.trim() || input.deviceId.trim().length > 128) throw new Error('Barcode Survey device ID is invalid.');
  const normalized = validateBarcodeSurveyInput(input);
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_record_barcode_survey_observation_v2', {
    p_idempotency_key: input.commandId,
    p_sku_context: normalized.skuContext,
    p_carton_barcode: normalized.cartonBarcode,
    p_sleeve_status: input.sleeveStatus,
    p_sleeve_barcode: normalized.sleeveBarcode,
    p_note: normalized.note,
    p_device_id: input.deviceId.trim(),
  }, client) ?? [];
  return parseResult(rows[0]);
}

export async function recordSmartBarcodeSurveyObservation(input: RecordSmartBarcodeSurveyInput, client?: SupabaseClient | null) {
  if (!input.commandId) throw new Error('Barcode Survey command ID is required.');
  const skuContext = normalizedRequired(input.skuContext, 'SKU');
  const cartonBarcode = normalizedRequired(input.cartonBarcode, 'Carton barcode');
  const deviceId = normalizedRequired(input.deviceId, 'Barcode Survey device ID');
  const note = normalizedOptional(input.note);
  if (note && note.length > 2000) throw new Error('Note must be 2000 characters or fewer.');

  let sleeveStatus: BarcodeSurveyObservedSleeveStatus | null = null;
  let sleeveBarcode: string | null = null;
  let sourceObservationId: string | null = null;

  if (input.captureMode === 'OBSERVED_NOW') {
    if (!input.sleeveStatus) throw new Error('Choose the physical sleeve result before saving.');
    const normalized = validateBarcodeSurveyInput({
      skuContext,
      cartonBarcode,
      sleeveStatus: input.sleeveStatus,
      sleeveBarcode: input.sleeveBarcode,
      note,
    });
    sleeveStatus = input.sleeveStatus;
    sleeveBarcode = normalized.sleeveBarcode;
  } else if (input.captureMode === 'REUSED_EXACT_PACKAGE') {
    sourceObservationId = normalizedOptional(input.sourceObservationId);
    if (!sourceObservationId) throw new Error('Verified packaging evidence is missing its source observation.');
    if (input.sleeveStatus || normalizedOptional(input.sleeveBarcode)) {
      throw new Error('Reused packaging evidence derives sleeve data from its original physical observation.');
    }
  } else if (input.captureMode === 'DEFERRED_INACCESSIBLE' || input.captureMode === 'DEFERRED_OPENING_REQUIRED') {
    if (input.sourceObservationId || input.sleeveStatus || normalizedOptional(input.sleeveBarcode)) {
      throw new Error('Deferred packaging evidence cannot include a sleeve result.');
    }
  } else {
    throw new Error('Barcode Survey capture mode is invalid.');
  }

  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_record_barcode_survey_observation_v3', {
    p_idempotency_key: input.commandId,
    p_sku_context: skuContext,
    p_carton_barcode: cartonBarcode,
    p_capture_mode: input.captureMode,
    p_sleeve_status: sleeveStatus,
    p_sleeve_barcode: sleeveBarcode,
    p_source_observation_id: sourceObservationId,
    p_note: note,
    p_device_id: deviceId,
  }, client) ?? [];
  return parseSmartResult(rows[0]);
}

export async function recoverBarcodeSurveyObservation(commandId: string, client?: SupabaseClient | null) {
  if (!commandId) throw new Error('Barcode Survey command ID is required.');
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_recover_barcode_survey_observation_v1', {
    p_idempotency_key: commandId,
  }, client) ?? [];
  if (!rows[0]) return null;
  return parseResult(rows[0]);
}
