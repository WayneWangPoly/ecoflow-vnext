import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BarcodeSurveySleeveStatus = 'SCANNED' | 'NO_SEPARATE_BARCODE' | 'NOT_CHECKED';

export type BarcodeSurveyCommandResult = {
  accepted: true;
  replayed: boolean;
  status: 'APPLIED' | 'REPLAYED';
  commandId: string;
  observationId: string;
  cartonBarcode: string;
  sleeveStatus: BarcodeSurveySleeveStatus;
  sleeveBarcode: string | null;
  occurredAt: string;
};

export type RecordBarcodeSurveyInput = {
  commandId: string;
  cartonBarcode: string;
  sleeveStatus: BarcodeSurveySleeveStatus;
  sleeveBarcode?: string | null;
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

  return { cartonBarcode, sleeveBarcode, note };
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
    cartonBarcode: String(row.carton_barcode || ''),
    sleeveStatus: sleeveStatus as BarcodeSurveySleeveStatus,
    sleeveBarcode: typeof row.sleeve_barcode === 'string' ? row.sleeve_barcode : null,
    occurredAt: String(row.occurred_at || ''),
  };
}

export async function recordBarcodeSurveyObservation(input: RecordBarcodeSurveyInput, client?: SupabaseClient | null) {
  if (!input.commandId) throw new Error('Barcode Survey command ID is required.');
  if (!input.deviceId.trim() || input.deviceId.trim().length > 128) throw new Error('Barcode Survey device ID is invalid.');
  const normalized = validateBarcodeSurveyInput(input);
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_record_barcode_survey_observation_v1', {
    p_idempotency_key: input.commandId,
    p_carton_barcode: normalized.cartonBarcode,
    p_sleeve_status: input.sleeveStatus,
    p_sleeve_barcode: normalized.sleeveBarcode,
    p_note: normalized.note,
    p_device_id: input.deviceId.trim(),
  }, client) ?? [];
  return parseResult(rows[0]);
}

export async function recoverBarcodeSurveyObservation(commandId: string, client?: SupabaseClient | null) {
  if (!commandId) throw new Error('Barcode Survey command ID is required.');
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_recover_barcode_survey_observation_v1', {
    p_idempotency_key: commandId,
  }, client) ?? [];
  if (!rows[0]) return null;
  return parseResult(rows[0]);
}
