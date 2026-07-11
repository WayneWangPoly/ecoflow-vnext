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

function requireSupabase(client?: SupabaseClient | null) { const value = client ?? supabase; if (!value) throw new Error('Supabase is not configured.'); return value; }
function errorMessage(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === 'object') { const r=error as Record<string,unknown>; return [r.message,r.details,r.hint,r.code].filter(Boolean).join(' · ') || JSON.stringify(r); } return String(error); }

export async function loadAccountsArKpis(client?: SupabaseClient | null) {
  const { data,error }=await requireSupabase(client).from('v_ecoflow_accounts_live_ar_kpis').select('*').maybeSingle();
  if(error) throw new Error(errorMessage(error)); return (data??null) as AccountsArKpis|null;
}
export async function loadAccountsStatementCustomers(client?: SupabaseClient | null) {
  const {data,error}=await requireSupabase(client).from('v_ecoflow_accounts_live_statement_customers').select('*').limit(160);
  if(error) throw new Error(errorMessage(error)); return (data??[]) as AccountsStatementCustomerRow[];
}
export async function loadAccountsStatementLines(client?: SupabaseClient | null) {
  const {data,error}=await requireSupabase(client).from('v_ecoflow_accounts_live_statement_lines').select('*').order('due_at',{ascending:true}).limit(600);
  if(error) throw new Error(errorMessage(error)); return (data??[]) as AccountsStatementLineRow[];
}
export async function loadAccountsFollowupQueue(client?: SupabaseClient | null) {
  const {data,error}=await requireSupabase(client).from('v_ecoflow_accounts_live_followup_queue').select('*').limit(120);
  if(error) throw new Error(errorMessage(error)); return (data??[]) as AccountsFollowupRow[];
}
export async function loadAccountsStatementExportRows(client?: SupabaseClient | null) {
  const {data,error}=await requireSupabase(client).from('v_ecoflow_accounts_live_statement_lines').select('*').limit(1000);
  if(error) throw new Error(errorMessage(error)); return (data??[]) as Record<string,unknown>[];
}
export async function loadStatementDocuments(storeId?: string,client?: SupabaseClient|null) {
  let query=requireSupabase(client).from('v_ecoflow_statement_document_history').select('*').order('created_at',{ascending:false}).limit(100);
  if(storeId) query=query.eq('store_id',storeId);
  const {data,error}=await query; if(error) throw new Error(errorMessage(error)); return (data??[]) as StatementDocumentRow[];
}
export async function loadPaymentHistory(storeId?: string,client?: SupabaseClient|null) {
  let query=requireSupabase(client).from('v_ecoflow_customer_payment_history').select('*').order('paid_at',{ascending:false}).limit(100);
  if(storeId) query=query.eq('store_id',storeId);
  const {data,error}=await query; if(error) throw new Error(errorMessage(error)); return (data??[]) as PaymentReceiptRow[];
}
export async function recordAccountsStatementAction(input:{storeId:string;action:AccountsStatementAction;note?:string|null;value?:string|null},client?:SupabaseClient|null){
  const {data,error}=await requireSupabase(client).rpc('ecoflow_record_accounts_statement_action',{p_store_id:input.storeId,p_action:input.action,p_note:input.note??null,p_value:input.value??null});
  if(error) throw new Error(errorMessage(error)); return (data??[]) as AccountsStatementActionResult[];
}
export async function saveBillingContact(input:{storeId:string;storeName:string;email:string;contactName?:string;enabled:boolean},client?:SupabaseClient|null){
  const {data,error}=await requireSupabase(client).rpc('ecoflow_upsert_billing_contact',{p_store_id:input.storeId,p_store_name:input.storeName,p_billing_email:input.email||null,p_contact_name:input.contactName||null,p_enabled:input.enabled});
  if(error) throw new Error(errorMessage(error)); return data??[];
}
export async function createStatementDocument(input:{storeId:string;periodStart:string;periodEnd:string},client?:SupabaseClient|null){
  const {data,error}=await requireSupabase(client).rpc('ecoflow_create_statement_document',{p_store_id:input.storeId,p_period_start:input.periodStart,p_period_end:input.periodEnd});
  if(error) throw new Error(errorMessage(error)); return (data??[]) as StatementDocumentRow[];
}
export async function dispatchStatement(input:{statementId:string;send:boolean},client?:SupabaseClient|null){
  const active=requireSupabase(client); const {data,error}=await active.functions.invoke('statement-dispatch',{body:{statementId:input.statementId,send:input.send}});
  if(error) throw new Error(errorMessage(error)); if(data?.error) throw new Error(String(data.error)); return data as Record<string,unknown>;
}
export async function recordCustomerPayment(input:{storeId:string;storeName:string;amount:number;paidAt:string;method:string;reference:string;note?:string},client?:SupabaseClient|null){
  const {data,error}=await requireSupabase(client).rpc('ecoflow_record_customer_payment',{p_store_id:input.storeId,p_store_name:input.storeName,p_amount:input.amount,p_paid_at:input.paidAt,p_method:input.method,p_reference:input.reference,p_note:input.note??null});
  if(error) throw new Error(errorMessage(error)); return data??[];
}
export async function statementSignedUrl(path:string,client?:SupabaseClient|null){
  const {data,error}=await requireSupabase(client).storage.from('account-statements').createSignedUrl(path,60*30);
  if(error) throw new Error(errorMessage(error)); return data.signedUrl;
}
