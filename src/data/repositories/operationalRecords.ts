import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type OperationalRecordsWorkspace = 'inventory' | 'customers' | 'accounts' | 'returns';
export type InventoryRecordsView = 'overview' | 'sku' | 'location' | 'below-target' | 'inconsistent' | 'movements' | 'cycle-count';
export type CustomerRecordsView = 'overview';
export type AccountsRecordsView = 'overview' | 'held' | 'overdue' | 'open';
export type ReturnsRecordsView = 'overview' | 'reported' | 'received' | 'inspection' | 'consequence' | 'closed';
export type OperationalRecordsView = InventoryRecordsView | CustomerRecordsView | AccountsRecordsView | ReturnsRecordsView;

export type OperationalRecordsPage = {
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
  totalCount: number;
  readAt: string | null;
};

export type OperationalRecordDetail = {
  kind: string;
  data: Record<string, unknown>;
  readAt: string | null;
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
    return [row.message,row.details,row.hint,row.code]
      .filter(Boolean)
      .map(String)
      .join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

export async function readOperationalRecordsPage(input: {
  workspace: OperationalRecordsWorkspace;
  view: OperationalRecordsView;
  page: number;
  pageSize: 10 | 20 | 25 | 50 | 100;
  search?: string | null;
  filter?: string | null;
  sort?: string | null;
}, client?: SupabaseClient | null): Promise<OperationalRecordsPage> {
  const { data, error } = await activeClient(client).rpc('ecoflow_read_operational_records_v1', {
    p_workspace: input.workspace,
    p_view: input.view,
    p_page: input.page,
    p_page_size: input.pageSize,
    p_search: input.search?.trim() || null,
    p_filter: input.filter?.trim() || null,
    p_sort: input.sort?.trim() || null,
  });
  if (error) throw new Error(errorMessage(error));

  const records = (data ?? []) as Array<{
    total_count: number | string;
    row_data: Record<string, unknown> | null;
    summary_data: Record<string, unknown> | null;
    read_at: string | null;
  }>;
  return {
    rows: records.flatMap((row) => row.row_data ? [row.row_data] : []),
    summary: records[0]?.summary_data ?? {},
    totalCount: records.length ? Number(records[0].total_count) : 0,
    readAt: records[0]?.read_at ?? null,
  };
}

export async function readOperationalRecordDetail(input: {
  workspace: OperationalRecordsWorkspace;
  recordId: string;
  limit?: number;
}, client?: SupabaseClient | null): Promise<OperationalRecordDetail[]> {
  const cleanId = input.recordId.trim();
  if (!cleanId) return [];
  const { data, error } = await activeClient(client).rpc('ecoflow_read_operational_record_detail_v1', {
    p_workspace: input.workspace,
    p_record_id: cleanId,
    p_limit: Math.min(Math.max(Math.trunc(input.limit ?? 50),1),100),
  });
  if (error) throw new Error(errorMessage(error));

  return ((data ?? []) as Array<{
    record_kind: string;
    record_data: Record<string, unknown> | null;
    read_at: string | null;
  }>).flatMap((row) => row.record_data ? [{
    kind: row.record_kind,
    data: row.record_data,
    readAt: row.read_at,
  }] : []);
}
