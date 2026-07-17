import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type AccountsArKpis = {
  open_ar_value: number | string | null; overdue_ar_value: number | string | null;
  open_customers: number | string | null; overdue_customers: number | string | null;
  open_invoices: number | string | null; overdue_invoices: number | string | null;
  statement_value_30d: number | string | null; worst_overdue_days: number | string | null;
  urgent_customers: number | string | null; held_customers: number | string | null; latest_invoice_at: string | null;
};

export type AccountsStatementCustomerRow = {
  store_id: string | null; store_name: string | null; suburb: string | null; address: string | null;
  contact_phone: string | null; price_group_id: string | null; invoice_count: number | string | null;
  open_invoice_count: number | string | null; overdue_invoice_count: number | string | null;
  total_statement_value: number | string | null; open_statement_value: number | string | null;
  overdue_statement_value: number | string | null; statement_value_30d: number | string | null;
  latest_invoice_at: string | null; worst_overdue_days: number | string | null; statement_signal: string | null;
  orders_30d: number | string | null; order_revenue_30d: number | string | null; top_sku_30d: string | null;
  top_product_30d: string | null; latest_action: string | null; latest_action_status: string | null;
  latest_action_note: string | null; latest_action_at: string | null; accounts_priority: string | null;
  billing_email: string | null; billing_contact_name: string | null; billing_enabled: boolean | null;
};

export type AccountsStatementLineRow = {
  store_id: string | null; store_name: string | null; internal_order_id: string | null;
  order_number: string | null; invoice_number: string | null; order_ts: string | null; due_at: string | null;
  invoice_value: number | string | null; allocated_amount: number | string | null; outstanding_amount: number | string | null;
  age_days: number | string | null; overdue_days: number | string | null; statement_status: string | null;
  order_status: string | null; account_release_status: string | null; warehouse_gate_status: string | null; accounts_signal: string | null;
};

export type AccountsFollowupRow = AccountsStatementCustomerRow & { next_action: string | null };
export type AccountsStatementAction = 'MARK_REVIEWED' | 'SEND_STATEMENT_DRAFT' | 'PROMISE_TO_PAY' | 'DISPUTE_RAISED' | 'HOLD_ACCOUNT' | 'CLEAR_HOLD';
export type AccountsStatementActionResult = { id: string; store_id: string; action: AccountsStatementAction; action_status: string; action_at: string };

export type StatementDocumentRow = {
  id: string; statement_number: string; store_id: string; store_name: string; period_start: string; period_end: string;
  issue_date: string; due_date: string | null; opening_balance: number | string; period_invoice_total: number | string;
  period_payment_total: number | string; closing_balance: number | string; document_status: string; storage_path: string | null;
  recipient_email: string | null; provider_message_id: string | null; generated_at: string | null; sent_at: string | null;
  error_message: string | null; created_at: string; line_count: number | string;
};

export type PaymentReceiptRow = {
  id: string; store_id: string; store_name: string | null; paid_at: string; amount: number | string;
  allocated_amount: number | string; unapplied_amount: number | string; payment_method: string;
  payment_reference: string; payment_note: string | null; created_at: string; allocation_count: number | string;
};

const CUSTOMER_FIELDS = 'store_id,store_name,suburb,address,contact_phone,price_group_id,invoice_count,open_invoice_count,overdue_invoice_count,total_statement_value,open_statement_value,overdue_statement_value,statement_value_30d,latest_invoice_at,worst_overdue_days,statement_signal,orders_30d,order_revenue_30d,top_sku_30d,top_product_30d,latest_action,latest_action_status,latest_action_note,latest_action_at,accounts_priority,billing_email,billing_contact_name,billing_enabled';
const LINE_FIELDS = 'store_id,store_name,internal_order_id,order_number,invoice_number,order_ts,due_at,invoice_value,allocated_amount,outstanding_amount,age_days,overdue_days,statement_status,order_status,account_release_status,warehouse_gate_status,accounts_signal';
const DOCUMENT_FIELDS = 'id,statement_number,store_id,store_name,period_start,period_end,issue_date,due_date,opening_balance,period_invoice_total,period_payment_total,closing_balance,document_status,storage_path,recipient_email,provider_message_id,generated_at,sent_at,error_message,created_at,line_count';

function requireSupabase(client?: SupabaseClient | null) { const value = client ?? supabase; if (!value) throw new Error('Supabase is not configured.'); return value; }
function errorMessage(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === 'object') { const record = error as Record<string, unknown>; return [record.message, record.details, record.hint, record.code].filter(Boolean).join(' · ') || JSON.stringify(record); } return String(error); }

export async function loadAccountsArKpis(client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).from('v_ecoflow_accounts_live_ar_kpis').select('open_ar_value,overdue_ar_value,open_customers,overdue_customers,open_invoices,overdue_invoices,statement_value_30d,worst_overdue_days,urgent_customers,held_customers,latest_invoice_at').maybeSingle();
  if (error) throw new Error(errorMessage(error)); return (data ?? null) as AccountsArKpis | null;
}
export async function loadAccountsStatementCustomers(client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).from('v_ecoflow_accounts_live_statement_customers').select(CUSTOMER_FIELDS).limit(500);
  if (error) throw new Error(errorMessage(error)); return (data ?? []) as unknown as AccountsStatementCustomerRow[];
}
export async function loadAccountsStatementLines(storeId: string, client?: SupabaseClient | null) {
  const cleanStoreId = storeId.trim();
  if (!cleanStoreId) return [];
  const { data, error } = await requireSupabase(client)
    .from('v_ecoflow_accounts_live_statement_lines')
    .select(LINE_FIELDS)
    .eq('store_id', cleanStoreId)
    .order('due_at', { ascending: true })
    .limit(250);
  if (error) throw new Error(errorMessage(error)); return (data ?? []) as unknown as AccountsStatementLineRow[];
}
export async function loadAccountsFollowupQueue(client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).from('v_ecoflow_accounts_live_followup_queue').select(`${CUSTOMER_FIELDS},next_action`).limit(300);
  if (error) throw new Error(errorMessage(error)); return (data ?? []) as unknown as AccountsFollowupRow[];
}
export async function loadAccountsStatementExportRows(client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).from('v_ecoflow_accounts_live_statement_lines').select(LINE_FIELDS).limit(10000);
  if (error) throw new Error(errorMessage(error)); return (data ?? []) as Record<string, unknown>[];
}
export async function loadStatementDocuments(storeId?: string, client?: SupabaseClient | null) {
  let query = requireSupabase(client).from('v_ecoflow_statement_document_history').select(DOCUMENT_FIELDS).order('created_at', { ascending: false }).limit(storeId ? 50 : 150);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query; if (error) throw new Error(errorMessage(error)); return (data ?? []) as unknown as StatementDocumentRow[];
}
/** Legacy payment receipts remain readable for historical audit only. They do not change mirrored AR. */
export async function loadPaymentHistory(storeId?: string, client?: SupabaseClient | null) {
  let query = requireSupabase(client).from('v_ecoflow_customer_payment_history').select('*').order('paid_at', { ascending: false }).limit(100);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query; if (error) throw new Error(errorMessage(error)); return (data ?? []) as PaymentReceiptRow[];
}
export async function recordAccountsStatementAction(input: { storeId: string; action: AccountsStatementAction; note?: string | null; value?: string | null }, client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).rpc('ecoflow_record_accounts_statement_action', { p_store_id: input.storeId, p_action: input.action, p_note: input.note ?? null, p_value: input.value ?? null });
  if (error) throw new Error(errorMessage(error)); return (data ?? []) as AccountsStatementActionResult[];
}
export async function saveBillingContact(input: { storeId: string; storeName: string; email: string; contactName?: string; enabled: boolean }, client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).rpc('ecoflow_upsert_billing_contact', { p_store_id: input.storeId, p_store_name: input.storeName, p_billing_email: input.email || null, p_contact_name: input.contactName || null, p_enabled: input.enabled });
  if (error) throw new Error(errorMessage(error)); return data ?? [];
}
export async function createStatementDocument(input: { storeId: string; periodStart: string; periodEnd: string }, client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).rpc('ecoflow_create_statement_document', { p_store_id: input.storeId, p_period_start: input.periodStart, p_period_end: input.periodEnd });
  if (error) throw new Error(errorMessage(error)); return (data ?? []) as StatementDocumentRow[];
}
export async function dispatchStatement(input: { statementId: string; send: boolean }, client?: SupabaseClient | null) {
  const current = requireSupabase(client); const { data, error } = await current.functions.invoke('statement-dispatch', { body: { statementId: input.statementId, send: input.send } });
  if (error) throw new Error(errorMessage(error)); if (data?.error) throw new Error(String(data.error)); return data as Record<string, unknown>;
}
export async function recordCustomerPayment() {
  throw new Error('ORDERMENTUM_SOURCE_OWNED · Record or correct payments in Ordermentum, then refresh the finance mirror.');
}
export async function statementSignedUrl(path: string, client?: SupabaseClient | null) {
  const { data, error } = await requireSupabase(client).storage.from('account-statements').createSignedUrl(path, 60 * 30);
  if (error) throw new Error(errorMessage(error)); return data.signedUrl;
}
