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

function client(input?: SupabaseClient | null) {
  const active = input ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

function commandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure command ID.');
}

export async function readOperationalPage(input: {
  resource: OperationalPageResource;
  page: number;
  pageSize: 10 | 20 | 25 | 50 | 100;
  search?: string | null;
  filter?: string | null;
  sort?: string | null;
}, activeClient?: SupabaseClient | null): Promise<OperationalPageResult> {
  const { data, error } = await client(activeClient).rpc('ecoflow_read_operational_page', {
    p_resource: input.resource,
    p_page: input.page,
    p_page_size: input.pageSize,
    p_search: input.search?.trim() || null,
    p_filter: input.filter?.trim() || null,
    p_sort: input.sort?.trim() || null,
  });
  if (error) throw new Error(message(error));
  const rows = (data ?? []) as Array<{ total_count: number | string; row_data: Record<string, unknown>; read_at: string }>;
  return {
    rows: rows.map((row) => row.row_data),
    totalCount: rows.length ? Number(rows[0].total_count) : 0,
    readAt: rows[0]?.read_at ?? null,
  };
}

export async function readWarehouseControl(sessionId?: string | null, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_read_warehouse_control', {
    p_session_id: sessionId ?? null,
    p_limit: 500,
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as WarehouseControlRecord[];
}

export async function startStocktake(input: {
  sessionType: 'INITIAL' | 'CYCLE_COUNT';
  title: string;
  rackId?: string | null;
  assignedUserId?: string | null;
  blindCount?: boolean;
  reason: string;
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_start_stocktake_session', {
    p_session_type: input.sessionType,
    p_title: input.title,
    p_rack_id: input.rackId ?? null,
    p_assigned_user_id: input.assignedUserId ?? null,
    p_blind_count: Boolean(input.blindCount),
    p_reason: input.reason,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
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
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_record_stocktake_observation', {
    p_session_id: input.sessionId,
    p_location_code: input.locationCode,
    p_sku: input.sku,
    p_product_name: input.productName ?? null,
    p_barcode: input.barcode ?? null,
    p_unit_level: input.unitLevel,
    p_units_per_package: input.unitsPerPackage,
    p_quantity_packages: input.quantityPackages,
    p_note: input.note ?? null,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function reviewStocktakeObservation(input: {
  observationId: string;
  accept: boolean;
  note: string;
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_review_stocktake_observation', {
    p_observation_id: input.observationId,
    p_accept: input.accept,
    p_note: input.note,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function completeStocktakeLocation(input: {
  sessionId: string;
  locationCode: string;
  reason: string;
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_complete_stocktake_location', {
    p_session_id: input.sessionId,
    p_location_code: input.locationCode,
    p_reason: input.reason,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function reopenStocktakeLocation(input: {
  sessionId: string;
  locationCode: string;
  reason: string;
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_reopen_stocktake_location', {
    p_session_id: input.sessionId,
    p_location_code: input.locationCode,
    p_reason: input.reason,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function submitStocktake(sessionId: string, reason: string, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_submit_stocktake_session', {
    p_session_id: sessionId,
    p_reason: reason,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function approveStocktake(input: {
  sessionId: string;
  expectedRevision: number;
  approvalNote: string;
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_approve_stocktake_session', {
    p_session_id: input.sessionId,
    p_expected_revision: input.expectedRevision,
    p_approval_note: input.approvalNote,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
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
}, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_move_warehouse_sku', {
    p_source_location: input.sourceLocation,
    p_destination_location: input.destinationLocation,
    p_sku: input.sku,
    p_unit_level: input.unitLevel,
    p_quantity: input.quantity,
    p_move_all: input.moveAll,
    p_expected_source_quantity: input.expectedSourceQuantity,
    p_reason: input.reason,
    p_command_id: commandId(),
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function readQuickActions(activeClient?: SupabaseClient | null): Promise<QuickActionState> {
  const { data, error } = await client(activeClient).rpc('ecoflow_read_quick_actions');
  if (error) throw new Error(message(error));
  const row = (data ?? [])[0] as { action_keys?: unknown; source?: unknown; revision?: unknown; read_at?: unknown } | undefined;
  if (!row || !Array.isArray(row.action_keys)) throw new Error('Quick Action configuration is unavailable.');
  return {
    actionKeys: row.action_keys.filter((value): value is string => typeof value === 'string').slice(0, 4),
    source: row.source === 'USER' ? 'USER' : 'ROLE_DEFAULT',
    revision: Number(row.revision || 0),
    readAt: typeof row.read_at === 'string' ? row.read_at : new Date(0).toISOString(),
  };
}

export async function setQuickActions(actionKeys: string[], expectedRevision: number, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_set_quick_actions', {
    p_action_keys: actionKeys.slice(0, 4),
    p_expected_revision: expectedRevision,
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}

export async function readBusinessDayCloseReadiness(businessDay: string, activeClient?: SupabaseClient | null) {
  const { data, error } = await client(activeClient).rpc('ecoflow_business_day_close_readiness', { p_business_day: businessDay });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ check_key: string; check_status: string; detail: string; blocking: boolean; read_at: string }>;
}

export async function completeBusinessDayClose(input: {
  businessDay: string;
  nextBusinessDay: string;
  expectedRevision: number;
  reason: string;
  acknowledgementNote: string;
  actorLabel?: string | null;
}, activeClient?: SupabaseClient | null) {
  const id = commandId();
  const { data, error } = await client(activeClient).rpc('ecoflow_complete_business_day_close', {
    p_business_day: input.businessDay,
    p_next_business_day: input.nextBusinessDay,
    p_expected_revision: input.expectedRevision,
    p_reason: input.reason,
    p_command_id: id,
    p_checklist: { accountsVarianceAcknowledged: true, commandId: id },
    p_acknowledgement_note: input.acknowledgementNote,
    p_actor_label: input.actorLabel ?? null,
  });
  if (error) throw new Error(message(error));
  return (data ?? [])[0] as Record<string, unknown> | undefined;
}
