import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type AccountsArKpis = {
  open_ar_value: number | string | null;
  overdue_ar_value: number | string | null;
  open_customers: number | string | null;
  overdue_customers: number | string | null;
  open_invoices: number | string | null;
  overdue_invoices: number | string | null;
  statement_value_30d: number | string | null;
  worst_overdue_days: number | string | null;
  urgent_customers: number | string | null;
  held_customers: number | string | null;
  latest_invoice_at: string | null;
};

export type AccountsStatementCustomerRow = {
  store_id: string | null;
  store_name: string | null;
  suburb: string | null;
  address: string | null;
  contact_phone: string | null;
  price_group_id: string | null;
  invoice_count: number | string | null;
  open_invoice_count: number | string | null;
  overdue_invoice_count: number | string | null;
  total_statement_value: number | string | null;
  open_statement_value: number | string | null;
  overdue_statement_value: number | string | null;
  statement_value_30d: number | string | null;
  latest_invoice_at: string | null;
  worst_overdue_days: number | string | null;
  statement_signal: string | null;
  orders_30d: number | string | null;
  order_revenue_30d: number | string | null;
  top_sku_30d: string | null;
  top_product_30d: string | null;
  latest_action: string | null;
  latest_action_status: string | null;
  latest_action_note: string | null;
  latest_action_at: string | null;
  accounts_priority: string | null;
};

export type AccountsStatementLineRow = {
  store_id: string | null;
  store_name: string | null;
  internal_order_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  order_ts: string | null;
  due_at: string | null;
  invoice_value: number | string | null;
  age_days: number | string | null;
  overdue_days: number | string | null;
  statement_status: string | null;
  order_status: string | null;
  account_release_status: string | null;
  warehouse_gate_status: string | null;
  accounts_signal: string | null;
};

export type AccountsFollowupRow = {
  store_id: string | null;
  store_name: string | null;
  suburb: string | null;
  contact_phone: string | null;
  open_invoice_count: number | string | null;
  overdue_invoice_count: number | string | null;
  open_statement_value: number | string | null;
  overdue_statement_value: number | string | null;
  worst_overdue_days: number | string | null;
  statement_signal: string | null;
  accounts_priority: string | null;
  latest_action: string | null;
  latest_action_status: string | null;
  latest_action_at: string | null;
  next_action: string | null;
};

export type AccountsStatementAction = 'MARK_REVIEWED' | 'SEND_STATEMENT_DRAFT' | 'PROMISE_TO_PAY' | 'DISPUTE_RAISED' | 'HOLD_ACCOUNT' | 'CLEAR_HOLD';

export type AccountsStatementActionResult = {
  id: string;
  store_id: string;
  action: AccountsStatementAction;
  action_status: string;
  action_at: string;
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

export async function loadAccountsArKpis(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.from('v_ecoflow_accounts_ar_kpis').select('*').maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data ?? null) as AccountsArKpis | null;
}

export async function loadAccountsStatementCustomers(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_accounts_statement_customers')
    .select('*')
    .limit(120);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as AccountsStatementCustomerRow[];
}

export async function loadAccountsStatementLines(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_accounts_statement_lines')
    .select('*')
    .limit(300);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as AccountsStatementLineRow[];
}

export async function loadAccountsFollowupQueue(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_accounts_followup_queue')
    .select('*')
    .limit(80);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as AccountsFollowupRow[];
}

export async function loadAccountsStatementExportRows(client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('v_ecoflow_accounts_statement_export')
    .select('*')
    .limit(500);
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as Record<string, unknown>[];
}

export async function recordAccountsStatementAction(input: { storeId: string; action: AccountsStatementAction; note?: string | null; value?: string | null }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active.rpc('ecoflow_record_accounts_statement_action', {
    p_store_id: input.storeId,
    p_action: input.action,
    p_note: input.note ?? null,
    p_value: input.value ?? null,
  });
  if (error) throw new Error(errorMessage(error));
  return (data ?? []) as AccountsStatementActionResult[];
}
