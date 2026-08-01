import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OperationalPageResource = 'orders' | 'stores' | 'inventory' | 'exceptions' | 'logs';
export type OperationalPageResult = {
  rows: Record<string, unknown>[];
  totalCount: number;
  readAt: string | null;
};
export type WarehouseControlRecord = {
  record_kind: 'SESSION' | 'LOCATION' | 'OBSERVATION' | 'BALANCE';
  record_data: Record<string, unknown>;
  read_at: string;
};
export type QuickActionState = {
  actionKeys: string[];
  source: 'USER' | 'ROLE_DEFAULT';
  revision: number;
  readAt: string;
};

function activeClient(input?: SupabaseClient | null) {
  const value = input ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message,row.details,row.hint,row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

function createCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure command ID.');
}

async function rpc<T>(name: string, args?: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data as T;
}

export async function readOperationalPage(input: {
  resource: OperationalPageResource;
  page: number;
  pageSize: 10 | 20 | 25 | 50 | 100;
  search?: string | null;
  filter?: string | null;
  sort?: string | null;
}, client?: SupabaseClient | null): Promise<OperationalPageResult> {
  const data = await rpc<Array<{
    total_count: number | string;
    row_data: Record<string, unknown> | null;
    read_at: string;
  }>>('ecoflow_read_operational_page', {
    p_resource: input.resource,
    p_page: input.page,
    p_page_size: input.pageSize,
    p_search: input.search?.trim() || null,
    p_filter: input.filter?.trim() || null,
    p_sort: input.sort?.trim() || null,
  }, client) ?? [];
  return {
    rows: data.flatMap((row) => row.row_data ? [row.row_data] : []),
    totalCount: data.length ? Number(data[0].total_count) : 0,
    readAt: data[0]?.read_at ?? null,
  };
}

export async function readWarehouseControl(sessionId?: string | null, client?: SupabaseClient | null) {
  return await rpc<WarehouseControlRecord[]>('ecoflow_read_warehouse_control', {
    p_session_id: sessionId || null,
    p_limit: 500,
  }, client) ?? [];
}

export async function startStocktake(input: {
  sessionType: 'INITIAL' | 'CYCLE_COUNT';
  title: string;
  rackId?: string | null;
  assignedUserId?: string | null;
  blindCount?: boolean;
  reason: string;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_start_stocktake_session', {
    p_session_type: input.sessionType,
    p_title: input.title,
    p_rack_id: input.rackId || null,
    p_assigned_user_id: input.assignedUserId || null,
    p_blind_count: Boolean(input.blindCount),
    p_reason: input.reason,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function recordStocktakeObservation(input: {
  sessionId: string;
  locationCode: string;
  sku: string;
  productName?: string | null;
  barcode?: string | null;
  unitLevel: 'carton' | 'sleeve' | 'each';
  unitsPerPackage: number;
  quantityPackages: number;
  note?: string | null;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_record_stocktake_observation', {
    p_session_id: input.sessionId,
    p_location_code: input.locationCode,
    p_sku: input.sku,
    p_product_name: input.productName || null,
    p_barcode: input.barcode || null,
    p_unit_level: input.unitLevel,
    p_units_per_package: input.unitsPerPackage,
    p_quantity_packages: input.quantityPackages,
    p_note: input.note || null,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function reviewStocktakeObservation(input: {
  observationId: string;
  accept: boolean;
  note: string;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_review_stocktake_observation', {
    p_observation_id: input.observationId,
    p_accept: input.accept,
    p_note: input.note,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function completeStocktakeLocation(input: {
  sessionId: string;
  locationCode: string;
  reason: string;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_complete_stocktake_location', {
    p_session_id: input.sessionId,
    p_location_code: input.locationCode,
    p_reason: input.reason,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function reopenStocktakeLocation(input: {
  sessionId: string;
  locationCode: string;
  reason: string;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_reopen_stocktake_location', {
    p_session_id: input.sessionId,
    p_location_code: input.locationCode,
    p_reason: input.reason,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function submitStocktake(sessionId: string, reason: string, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_submit_stocktake_session', {
    p_session_id: sessionId,
    p_reason: reason,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function approveStocktake(input: {
  sessionId: string;
  expectedRevision: number;
  approvalNote: string;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_approve_stocktake_session', {
    p_session_id: input.sessionId,
    p_expected_revision: input.expectedRevision,
    p_approval_note: input.approvalNote,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function moveWarehouseSku(input: {
  sourceLocation: string;
  destinationLocation: string;
  sku: string;
  unitLevel: 'carton' | 'sleeve' | 'each';
  quantity: number;
  moveAll: boolean;
  expectedSourceQuantity: number;
  reason: string;
}, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_move_warehouse_sku', {
    p_source_location: input.sourceLocation,
    p_destination_location: input.destinationLocation,
    p_sku: input.sku,
    p_unit_level: input.unitLevel,
    p_quantity: input.quantity,
    p_move_all: input.moveAll,
    p_expected_source_quantity: input.expectedSourceQuantity,
    p_reason: input.reason,
    p_command_id: createCommandId(),
  }, client) ?? [];
  return data[0];
}

export async function readQuickActions(client?: SupabaseClient | null): Promise<QuickActionState> {
  const data = await rpc<Array<{
    action_keys: unknown;
    source: unknown;
    revision: unknown;
    read_at: unknown;
  }>>('ecoflow_read_quick_actions', undefined, client) ?? [];
  const row = data[0];
  if (!row || !Array.isArray(row.action_keys)) throw new Error('Quick Action configuration is unavailable.');
  return {
    actionKeys: row.action_keys.filter((value): value is string => typeof value === 'string').slice(0,4),
    source: row.source === 'USER' ? 'USER' : 'ROLE_DEFAULT',
    revision: Number(row.revision || 0),
    readAt: typeof row.read_at === 'string' ? row.read_at : new Date(0).toISOString(),
  };
}

export async function setQuickActions(actionKeys: string[], expectedRevision: number, client?: SupabaseClient | null) {
  const data = await rpc<Record<string, unknown>[]>('ecoflow_set_quick_actions', {
    p_action_keys: actionKeys.slice(0,4),
    p_expected_revision: expectedRevision,
  }, client) ?? [];
  return data[0];
}

export async function readBusinessDayCloseReadiness(businessDay: string, client?: SupabaseClient | null) {
  return await rpc<Array<{
    check_key: string;
    check_status: string;
    detail: string;
    blocking: boolean;
    read_at: string;
  }>>('ecoflow_business_day_close_readiness', { p_business_day: businessDay }, client) ?? [];
}

export async function completeBusinessDayClose(input: {
  businessDay: string;
  nextBusinessDay: string;
  expectedRevision: number;
  reason: string;
  acknowledgementNote: string;
  actorLabel?: string | null;
}, client?: SupabaseClient | null) {
  const commandId = createCommandId();
  const data = await rpc<Record<string, unknown>[]>('ecoflow_complete_business_day_close', {
    p_business_day: input.businessDay,
    p_next_business_day: input.nextBusinessDay,
    p_expected_revision: input.expectedRevision,
    p_reason: input.reason,
    p_command_id: commandId,
    p_checklist: { accountsVarianceAcknowledged: true, commandId },
    p_acknowledgement_note: input.acknowledgementNote,
    p_actor_label: input.actorLabel || null,
  }, client) ?? [];
  return data[0];
}
