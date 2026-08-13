import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type ReturnDisposition = 'RESTOCK' | 'SUPPLIER_CLAIM' | 'DISPOSE';
export type ReturnCommandStatus = 'APPLIED' | 'REPLAYED' | 'CONFLICT';

export type ReturnAuthorityState = {
  exceptionId: string;
  returnCode: string;
  returnStatus: string;
  lifecycleStage: string;
  physicallyReceived: boolean;
  revision: number;
  inspectionLineCount: number;
  dispositions: ReturnDisposition[];
  inventoryConsequenceStatus: string;
  latestInventoryMovementId: string | null;
  warehouseLocation: string | null;
  updatedAt: string | null;
  inspectionCompletedAt: string | null;
};

export type ReturnCommandResult = {
  accepted: boolean;
  replayed: boolean;
  status: ReturnCommandStatus;
  commandId: string;
  commandType: 'RECORD_DISPOSITION' | 'CLOSE_RETURN';
  exceptionId: string;
  returnCode: string;
  returnStatus: string;
  revision: number;
  lifecycleStage: string;
  inspectionLineId: string | null;
  inventoryMovementId: string | null;
  inventoryConsequenceStatus: string;
  occurredAt: string | null;
};

export type ReturnDispositionCommandInput = {
  returnId: string;
  disposition: ReturnDisposition;
  barcode: string | null;
  quantityPackages: number;
  targetLocation: string | null;
  manualItem: string | null;
  expectedRevision: number;
  idempotencyKey: string;
  deviceId: string;
  note: string;
  evidence: Record<string, unknown>;
};

export type CloseReturnCommandInput = {
  returnId: string;
  expectedRevision: number;
  idempotencyKey: string;
  deviceId: string;
  note: string;
  evidence: Record<string, unknown>;
};

type RpcRow = Record<string, unknown>;

function activeClient(input?: SupabaseClient | null) {
  const value = input ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code]
      .filter(Boolean)
      .map(String)
      .join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

function singleRow(data: unknown, context: string): RpcRow {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw new Error(`${context} returned ${rows.length} rows; expected exactly one.`);
  }
  return rows[0] as RpcRow;
}

function nullableString(value: unknown) {
  if (value == null || value === '') return null;
  return String(value);
}

function boundedInteger(value: unknown, label: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is not a non-negative safe integer.`);
  }
  return parsed;
}

function requiredString(value: unknown, label: string) {
  const parsed = String(value ?? '').trim();
  if (!parsed) throw new Error(`${label} is empty.`);
  return parsed;
}

function parseDisposition(value: unknown): ReturnDisposition {
  const parsed = String(value ?? '').trim();
  if (parsed === 'RESTOCK' || parsed === 'SUPPLIER_CLAIM' || parsed === 'DISPOSE') return parsed;
  throw new Error(`Return authority returned unsupported disposition ${parsed || '<empty>'}.`);
}

function parseState(row: RpcRow): ReturnAuthorityState {
  if (typeof row.physically_received !== 'boolean') {
    throw new Error('Return authority returned an invalid physical-receipt state.');
  }
  const rawDispositions = Array.isArray(row.dispositions) ? row.dispositions : [];
  return {
    exceptionId: requiredString(row.exception_id, 'Return exception id'),
    returnCode: requiredString(row.return_code, 'Return code'),
    returnStatus: requiredString(row.return_status, 'Return status'),
    lifecycleStage: requiredString(row.lifecycle_stage, 'Return lifecycle stage'),
    physicallyReceived: row.physically_received,
    revision: boundedInteger(row.revision, 'Return revision'),
    inspectionLineCount: boundedInteger(row.inspection_line_count, 'Return inspection-line count'),
    dispositions: rawDispositions.map(parseDisposition),
    inventoryConsequenceStatus: requiredString(row.inventory_consequence_status, 'Return inventory consequence status'),
    latestInventoryMovementId: nullableString(row.latest_inventory_movement_id),
    warehouseLocation: nullableString(row.warehouse_location),
    updatedAt: nullableString(row.updated_at),
    inspectionCompletedAt: nullableString(row.inspection_completed_at),
  };
}

function parseCommand(row: RpcRow, expectedCommandId: string): ReturnCommandResult {
  const status = String(row.status ?? '');
  if (status !== 'APPLIED' && status !== 'REPLAYED' && status !== 'CONFLICT') {
    throw new Error(`Return command authority returned unsupported status ${status || '<empty>'}.`);
  }
  const commandId = requiredString(row.command_id, 'Return command id');
  if (commandId !== expectedCommandId) throw new Error('Return command authority returned a mismatched command id.');
  const commandType = String(row.command_type ?? '');
  if (commandType !== 'RECORD_DISPOSITION' && commandType !== 'CLOSE_RETURN') {
    throw new Error(`Return command authority returned unsupported command type ${commandType || '<empty>'}.`);
  }
  if (typeof row.accepted !== 'boolean' || typeof row.replayed !== 'boolean') {
    throw new Error('Return command authority returned invalid acknowledgement flags.');
  }
  if ((status === 'CONFLICT' && (row.accepted || row.replayed))
    || (status === 'APPLIED' && (!row.accepted || row.replayed))
    || (status === 'REPLAYED' && (!row.accepted || !row.replayed))) {
    throw new Error('Return command authority returned inconsistent acknowledgement flags.');
  }
  return {
    accepted: row.accepted,
    replayed: row.replayed,
    status,
    commandId,
    commandType,
    exceptionId: requiredString(row.exception_id, 'Return command exception id'),
    returnCode: requiredString(row.return_code, 'Return command return code'),
    returnStatus: requiredString(row.return_status, 'Return command return status'),
    revision: boundedInteger(row.revision, 'Return command revision'),
    lifecycleStage: requiredString(row.lifecycle_stage, 'Return command lifecycle stage'),
    inspectionLineId: nullableString(row.inspection_line_id),
    inventoryMovementId: nullableString(row.inventory_movement_id),
    inventoryConsequenceStatus: requiredString(row.inventory_consequence_status, 'Return command consequence status'),
    occurredAt: nullableString(row.occurred_at),
  };
}

function validateCommandEnvelope(input: {
  returnId: string;
  expectedRevision: number;
  idempotencyKey: string;
  deviceId: string;
  note: string;
  evidence: Record<string, unknown>;
}) {
  const returnId = input.returnId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const deviceId = input.deviceId.trim();
  const note = input.note.trim();
  if (!returnId || returnId.length > 180) throw new Error('Return id must be 1–180 characters.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Expected revision must be a non-negative safe integer.');
  }
  if (!idempotencyKey) throw new Error('Idempotency key is required.');
  if (!deviceId || deviceId.length > 128) throw new Error('Device id must be 1–128 characters.');
  if (!note || note.length > 1000) throw new Error('Note must be 1–1000 characters.');
  const evidenceText = JSON.stringify(input.evidence ?? {});
  if (!input.evidence || Array.isArray(input.evidence) || Object.keys(input.evidence).length === 0 || evidenceText.length > 12000) {
    throw new Error('Evidence must be a non-empty bounded object.');
  }
  return { returnId, idempotencyKey, deviceId, note };
}

export async function readReturnAuthorityState(
  returnId: string,
  client?: SupabaseClient | null,
): Promise<ReturnAuthorityState> {
  const cleanReturnId = returnId.trim();
  if (!cleanReturnId) throw new Error('Return id is required.');
  const { data, error } = await activeClient(client).rpc('ecoflow_read_return_state_v1', {
    p_return_id: cleanReturnId,
  });
  if (error) throw new Error(errorMessage(error));
  return parseState(singleRow(data, 'Return authority state read'));
}

export async function recoverReturnCommand(
  idempotencyKey: string,
  client?: SupabaseClient | null,
): Promise<ReturnCommandResult | null> {
  const cleanKey = idempotencyKey.trim();
  if (!cleanKey) throw new Error('Idempotency key is required.');
  const { data, error } = await activeClient(client).rpc('ecoflow_recover_return_command_v1', {
    p_idempotency_key: cleanKey,
  });
  if (error) throw new Error(errorMessage(error));
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  return parseCommand(singleRow(rows, 'Return command recovery'), cleanKey);
}

export async function recordReturnDisposition(
  input: ReturnDispositionCommandInput,
  client?: SupabaseClient | null,
): Promise<ReturnCommandResult> {
  const clean = validateCommandEnvelope(input);
  if (!Number.isFinite(input.quantityPackages) || input.quantityPackages <= 0) {
    throw new Error('Quantity packages must be greater than zero.');
  }
  const barcode = input.barcode?.trim() || null;
  const targetLocation = input.targetLocation?.trim() || null;
  const manualItem = input.manualItem?.trim() || null;
  if (input.disposition === 'RESTOCK' && (!barcode || !targetLocation)) {
    throw new Error('RESTOCK requires barcode and target location.');
  }
  if (input.disposition !== 'RESTOCK' && !barcode && !manualItem) {
    throw new Error('Non-restock disposition requires barcode or manual item.');
  }

  const clientValue = activeClient(client);
  const { data, error } = await clientValue.rpc('ecoflow_record_return_disposition_v1', {
    p_return_id: clean.returnId,
    p_disposition: input.disposition,
    p_barcode: barcode,
    p_qty_packages: input.quantityPackages,
    p_target_location: targetLocation,
    p_manual_item: manualItem,
    p_expected_revision: input.expectedRevision,
    p_idempotency_key: clean.idempotencyKey,
    p_device_id: clean.deviceId,
    p_note: clean.note,
    p_evidence: input.evidence,
  });
  if (!error) return parseCommand(singleRow(data, 'Return disposition command'), clean.idempotencyKey);

  try {
    const recovered = await recoverReturnCommand(clean.idempotencyKey, clientValue);
    if (recovered) return recovered;
  } catch {
    // Preserve the original mutation error: recovery is evidence, not a second intent.
  }
  throw new Error(errorMessage(error));
}

export async function closeReturn(
  input: CloseReturnCommandInput,
  client?: SupabaseClient | null,
): Promise<ReturnCommandResult> {
  const clean = validateCommandEnvelope(input);
  const clientValue = activeClient(client);
  const { data, error } = await clientValue.rpc('ecoflow_close_return_v1', {
    p_return_id: clean.returnId,
    p_expected_revision: input.expectedRevision,
    p_idempotency_key: clean.idempotencyKey,
    p_device_id: clean.deviceId,
    p_note: clean.note,
    p_evidence: input.evidence,
  });
  if (!error) return parseCommand(singleRow(data, 'Close return command'), clean.idempotencyKey);

  try {
    const recovered = await recoverReturnCommand(clean.idempotencyKey, clientValue);
    if (recovered) return recovered;
  } catch {
    // Preserve the original mutation error: recovery is evidence, not a second intent.
  }
  throw new Error(errorMessage(error));
}
