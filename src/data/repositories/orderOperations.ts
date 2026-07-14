import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OrderOperationsMode = 'current' | 'ready' | 'blocked' | 'progress' | 'history';

export type OrderOperationRow = {
  operation_key: string;
  raw_order_id: string | null;
  external_order_id: string | null;
  external_order_number: string | null;
  external_invoice_number: string | null;
  order_number: string;
  invoice_number: string | null;
  source_order_status: string | null;
  source_invoice_status: string | null;
  source_payment_status: string | null;
  invoice_payment_status: string | null;
  internal_order_id: string | null;
  internalisation_status: string | null;
  account_release_status: string | null;
  warehouse_gate_status: string | null;
  fulfilment_status: 'UNRELEASED' | 'BLOCKED' | 'SOURCE_REVIEW' | 'RELEASED' | 'PICKING' | 'STAGED' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED' | 'HISTORY' | string;
  data_quality_status: 'READY' | 'BLOCKED_DATA' | 'BLOCKED_MAPPING' | string;
  operational_scope: 'CURRENT' | 'REVIEW' | 'HISTORY' | string;
  release_eligible: boolean;
  classification_reason: string;
  order_value: number | string | null;
  line_count: number | string | null;
  unmapped_line_count: number | string | null;
  barcode_blocked_line_count: number | string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  source_business_at: string | null;
  observed_at: string | null;
};

export type OrderOperationsSummary = {
  total_orders: number | string | null;
  current_orders: number | string | null;
  source_review_orders: number | string | null;
  ready_to_release: number | string | null;
  blocked_orders: number | string | null;
  in_progress_orders: number | string | null;
  completed_orders: number | string | null;
  cancelled_orders: number | string | null;
  current_value: number | string | null;
  latest_source_update: string | null;
  last_observed_at: string | null;
};

export type OrderOperationsPage = {
  rows: OrderOperationRow[];
  total: number;
  page: number;
  pageSize: number;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code].filter(Boolean).map(String);
    return parts.length ? parts.join(' · ') : JSON.stringify(record);
  }
  return String(error);
}

function safeSearch(value: string) {
  return value.trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
}

function applyMode<T>(query: PostgrestFilterBuilder<any, any, T[], unknown>, mode: OrderOperationsMode) {
  if (mode === 'ready') return query.eq('release_eligible', true);
  if (mode === 'blocked') {
    return query
      .in('operational_scope', ['CURRENT', 'REVIEW'])
      .or('data_quality_status.neq.READY,fulfilment_status.eq.SOURCE_REVIEW');
  }
  if (mode === 'progress') {
    return query.in('fulfilment_status', ['RELEASED', 'PICKING', 'STAGED', 'OUT_FOR_DELIVERY']);
  }
  if (mode === 'history') return query.eq('operational_scope', 'HISTORY');
  return query.in('operational_scope', ['CURRENT', 'REVIEW']);
}

export async function loadOrderOperationsSummary(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_order_operations_summary_v2')
    .select('*')
    .maybeSingle();

  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as OrderOperationsSummary | null;
}

export async function loadOrderOperationsPage(input: {
  mode: OrderOperationsMode;
  page: number;
  pageSize: number;
  query?: string;
}, client?: SupabaseClient | null): Promise<OrderOperationsPage> {
  const active = requireSupabase(client);
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.max(10, Math.min(100, Math.floor(input.pageSize || 25)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let request = active
    .from('v_ecoflow_order_operations_v2')
    .select('*', { count: 'exact' });

  request = applyMode(request, input.mode);

  const needle = safeSearch(input.query || '');
  if (needle) {
    request = request.or([
      `order_number.ilike.%${needle}%`,
      `invoice_number.ilike.%${needle}%`,
      `internal_order_id.ilike.%${needle}%`,
      `external_order_number.ilike.%${needle}%`,
    ].join(','));
  }

  const { data, error, count } = await request
    .order('source_business_at', { ascending: false, nullsFirst: false })
    .order('observed_at', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (error) throw new Error(errorMessage(error));
  return {
    rows: (data ?? []) as OrderOperationRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}
