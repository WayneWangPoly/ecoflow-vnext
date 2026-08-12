import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type AccountHoldState = {
  storeId: string;
  active: boolean;
  revision: number;
  holdReason: string | null;
  sourceActionId: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type AccountHoldCommandInput = {
  storeId: string;
  targetActive: boolean;
  expectedRevision: number;
  idempotencyKey: string;
  deviceId: string;
  reason: string;
};

export type AccountHoldCommandResult = AccountHoldState & {
  accepted: boolean;
  replayed: boolean;
  status: 'APPLIED' | 'REPLAYED' | 'CONFLICT';
  commandId: string;
  occurredAt: string | null;
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

function parseState(row: RpcRow): AccountHoldState {
  const storeId = String(row.store_id ?? '').trim();
  if (!storeId) throw new Error('Account hold authority returned an empty store id.');
  if (typeof row.active !== 'boolean') throw new Error('Account hold authority returned an invalid active state.');
  return {
    storeId,
    active: row.active,
    revision: boundedInteger(row.revision, 'Account hold revision'),
    holdReason: nullableString(row.hold_reason),
    sourceActionId: nullableString(row.source_action_id),
    updatedBy: nullableString(row.updated_by),
    updatedAt: nullableString(row.updated_at),
  };
}

function parseCommand(row: RpcRow, expectedCommandId: string): AccountHoldCommandResult {
  const status = String(row.status ?? '');
  if (status !== 'APPLIED' && status !== 'REPLAYED' && status !== 'CONFLICT') {
    throw new Error(`Account hold authority returned unsupported status ${status || '<empty>'}.`);
  }
  const commandId = String(row.command_id ?? '').trim();
  if (!commandId || commandId !== expectedCommandId) {
    throw new Error('Account hold authority returned a mismatched command id.');
  }
  const accepted = row.accepted;
  const replayed = row.replayed;
  if (typeof accepted !== 'boolean' || typeof replayed !== 'boolean') {
    throw new Error('Account hold authority returned invalid acknowledgement flags.');
  }
  if ((status === 'CONFLICT' && (accepted || replayed)) ||
      (status === 'APPLIED' && (!accepted || replayed)) ||
      (status === 'REPLAYED' && (!accepted || !replayed))) {
    throw new Error('Account hold authority returned inconsistent acknowledgement flags.');
  }
  return {
    ...parseState(row),
    accepted,
    replayed,
    status,
    commandId,
    occurredAt: nullableString(row.occurred_at),
  };
}

export async function readAccountHoldState(
  storeId: string,
  client?: SupabaseClient | null,
): Promise<AccountHoldState> {
  const cleanStoreId = storeId.trim();
  if (!cleanStoreId) throw new Error('Store id is required.');
  const { data, error } = await activeClient(client).rpc('ecoflow_read_account_hold_state_v1', {
    p_store_id: cleanStoreId,
  });
  if (error) throw new Error(errorMessage(error));
  return parseState(singleRow(data, 'Account hold state read'));
}

export async function recoverAccountHoldCommand(
  idempotencyKey: string,
  client?: SupabaseClient | null,
): Promise<AccountHoldCommandResult | null> {
  const cleanKey = idempotencyKey.trim();
  if (!cleanKey) throw new Error('Idempotency key is required.');
  const { data, error } = await activeClient(client).rpc('ecoflow_recover_account_hold_command_v1', {
    p_idempotency_key: cleanKey,
  });
  if (error) throw new Error(errorMessage(error));
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  return parseCommand(singleRow(rows, 'Account hold command recovery'), cleanKey);
}

export async function setAccountReleaseHold(
  input: AccountHoldCommandInput,
  client?: SupabaseClient | null,
): Promise<AccountHoldCommandResult> {
  const cleanStoreId = input.storeId.trim();
  const cleanDeviceId = input.deviceId.trim();
  const cleanReason = input.reason.trim();
  const cleanKey = input.idempotencyKey.trim();
  if (!cleanStoreId) throw new Error('Store id is required.');
  if (!cleanKey) throw new Error('Idempotency key is required.');
  if (!cleanDeviceId || cleanDeviceId.length > 128) throw new Error('Device id must be 1–128 characters.');
  if (!cleanReason || cleanReason.length > 500) throw new Error('Reason must be 1–500 characters.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Expected revision must be a non-negative safe integer.');
  }

  const clientValue = activeClient(client);
  const { data, error } = await clientValue.rpc('ecoflow_set_account_release_hold_v1', {
    p_store_id: cleanStoreId,
    p_target_active: input.targetActive,
    p_expected_revision: input.expectedRevision,
    p_idempotency_key: cleanKey,
    p_device_id: cleanDeviceId,
    p_reason: cleanReason,
  });

  if (!error) {
    return parseCommand(singleRow(data, 'Account hold command'), cleanKey);
  }

  // The transport may fail after the server committed. Resolve that uncertainty
  // with the same actor-bound idempotency key before surfacing the original error.
  try {
    const recovered = await recoverAccountHoldCommand(cleanKey, clientValue);
    if (recovered) return recovered;
  } catch {
    // Preserve the original mutation error: recovery is evidence, not a second intent.
  }
  throw new Error(errorMessage(error));
}
