-- TRANSFORM-007B bounded repair: keep Accounts operational reads on keyed joins.
--
-- Production verification for 007B exposed SQLSTATE 57014 while /accounts loaded
-- ecoflow_read_operational_records_v1('accounts', ...). The source-finance line
-- view still matched each finance row to v_ecoflow_order_operations_v3 through
-- a three-way OR predicate (source order id / order number / invoice number).
-- This is the same query shape that previously made Owner KPI reads exceed the
-- Supabase statement timeout once real Ordermentum line volume was projected.
--
-- The complete mirror now carries source_order_id for normal rows, so make that
-- equality the primary path. Preserve number-based recovery only for historical
-- rows where source_order_id is genuinely absent. The view's columns, semantics,
-- grants and all downstream Accounts/RPC contracts remain unchanged.

begin;

create or replace view public.v_ecoflow_accounts_live_statement_lines as
with finance_lines as (
  select
    f.retailer_id::text as store_id,
    f.store_name::text as store_name,
    f.source_order_id::text as source_order_id,
    f.source_order_id::text as internal_order_id,
    f.order_number::text as order_number,
    f.invoice_number::text as invoice_number,
    coalesce(f.invoice_date, f.financial_observed_at)::timestamptz as order_ts,
    f.invoice_due_at::timestamptz as due_at,
    coalesce(f.invoice_total,0)::numeric as invoice_value,
    greatest(
      coalesce(f.invoice_total,0)-coalesce(
        case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.amount_due end,
        case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.invoice_total end,
        0
      ),
      0
    )::numeric as allocated_amount,
    coalesce(
      case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.amount_due end,
      case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.invoice_total end,
      0
    )::numeric as outstanding_amount,
    greatest(current_date-coalesce(f.invoice_date::date,current_date),0)::numeric as age_days,
    case
      when lower(coalesce(f.invoice_payment_status,''))='paid' or coalesce(f.amount_due,0)<=0 then 0::numeric
      when f.invoice_due_at is not null and f.invoice_due_at::date<current_date then (current_date-f.invoice_due_at::date)::numeric
      else 0::numeric
    end as overdue_days,
    case
      when lower(coalesce(f.invoice_payment_status,''))='paid' or coalesce(f.amount_due,0)<=0 then 'PAID'
      when f.invoice_due_at is not null and f.invoice_due_at<now() then 'OVERDUE'
      else 'OPEN'
    end::text as statement_status,
    f.source_order_status::text as order_status,
    case
      when lower(coalesce(f.invoice_payment_status,''))='paid' or coalesce(f.amount_due,0)<=0 then 'PAID'
      when f.invoice_due_at is not null and f.invoice_due_at<now()-interval '30 days' then 'OVERDUE_30_PLUS'
      when f.invoice_due_at is not null and f.invoice_due_at<now() then 'OVERDUE'
      when f.invoice_due_at is not null and f.invoice_due_at<=now()+interval '7 days' then 'DUE_THIS_WEEK'
      else 'OPEN'
    end::text as accounts_signal
  from public.v_ecoflow_order_financial_truth_v1 f
  where f.invoice_number is not null
), source_keyed as (
  select
    f.store_id,f.store_name,f.internal_order_id,f.order_number,f.invoice_number,
    f.order_ts,f.due_at,f.invoice_value,f.allocated_amount,f.outstanding_amount,
    f.age_days,f.overdue_days,f.statement_status,f.order_status,
    o.account_release_status::text as account_release_status,
    o.warehouse_gate_status::text as warehouse_gate_status,
    f.accounts_signal
  from finance_lines f
  left join public.v_ecoflow_order_operations_v3 o
    on o.external_order_id=f.source_order_id
  where nullif(f.source_order_id,'') is not null
), legacy_number_fallback as (
  select
    f.store_id,f.store_name,f.internal_order_id,f.order_number,f.invoice_number,
    f.order_ts,f.due_at,f.invoice_value,f.allocated_amount,f.outstanding_amount,
    f.age_days,f.overdue_days,f.statement_status,f.order_status,
    coalesce(oo.account_release_status,oi.account_release_status)::text as account_release_status,
    coalesce(oo.warehouse_gate_status,oi.warehouse_gate_status)::text as warehouse_gate_status,
    f.accounts_signal
  from finance_lines f
  left join public.v_ecoflow_order_operations_v3 oo
    on oo.order_number=f.order_number
  left join public.v_ecoflow_order_operations_v3 oi
    on oo.order_number is null
   and oi.invoice_number=f.invoice_number
  where nullif(f.source_order_id,'') is null
)
select * from source_keyed
union all
select * from legacy_number_fallback;

grant select on public.v_ecoflow_accounts_live_statement_lines to authenticated;
revoke all on public.v_ecoflow_accounts_live_statement_lines from anon;

comment on view public.v_ecoflow_accounts_live_statement_lines is
  'Ordermentum-owned finance mirror for Accounts. Normal rows join operational state by source_order_id; order/invoice fallback is reserved for legacy rows without a source id.';

notify pgrst, 'reload schema';
commit;
