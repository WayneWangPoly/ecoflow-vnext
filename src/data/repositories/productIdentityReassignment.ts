import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type BarcodeReassignmentResult = {
  authorizationId: string | null;
  commandId: string;
  authorizationStatus: 'APPLIED' | 'REPLAYED' | 'CONFLICT';
  barcode: string;
  retiredBindingId: string | null;
  replacementObservationId: string | null;
  physicalSkuId: string | null;
  familyId: string | null;
  batchRevision: number;
  detail: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function safeRevision(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Barcode reassignment returned an invalid batch revision.');
  return parsed;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

export function createBarcodeReassignmentCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure barcode reassignment command ID.');
}

export async function authorizeBarcodeReassignment(input: {
  batchId: string;
  conflictObservationId: string;
  expectedBindingRevision: number;
  reason: string;
  commandId: string;
}, client?: SupabaseClient | null): Promise<BarcodeReassignmentResult> {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');

  const result = await active.rpc('ecoflow_authorize_barcode_reassignment', {
    p_batch_id: input.batchId,
    p_conflict_observation_id: input.conflictObservationId,
    p_expected_binding_revision: input.expectedBindingRevision,
    p_reason: input.reason,
    p_command_id: input.commandId,
  });
  if (result.error) throw new Error(errorMessage(result.error));

  const row = (Array.isArray(result.data) ? result.data[0] : null) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Barcode reassignment authority returned no result.');
  const status = String(row.authorization_status || '');
  if (!['APPLIED', 'REPLAYED', 'CONFLICT'].includes(status)) {
    throw new Error('Barcode reassignment authority returned an invalid status.');
  }

  return {
    authorizationId: text(row.authorization_id),
    commandId: String(row.command_id || input.commandId),
    authorizationStatus: status as BarcodeReassignmentResult['authorizationStatus'],
    barcode: String(row.barcode || ''),
    retiredBindingId: text(row.retired_binding_id),
    replacementObservationId: text(row.replacement_observation_id),
    physicalSkuId: text(row.physical_sku_id),
    familyId: text(row.family_id),
    batchRevision: safeRevision(row.batch_revision),
    detail: String(row.detail || ''),
  };
}
