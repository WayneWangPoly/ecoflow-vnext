\set ON_ERROR_STOP on

-- This fixture is loaded after the ordinary TRANSFORM-007 operational fixture
-- and 007A migration. Replace only the Accounts KPI source with a deliberately
-- slow live aggregate while keeping the Accounts row path cheap.

drop table public.v_ecoflow_accounts_live_ar_kpis;

create or replace function public.transform_007b_slow_accounts_kpi_value()
returns numeric
language plpgsql
volatile
as $$
begin
  perform pg_sleep(3);
  return 1250.50::numeric;
end;
$$;

create view public.v_ecoflow_accounts_live_ar_kpis as
select
  public.transform_007b_slow_accounts_kpi_value() as open_ar_value,
  450.25::numeric as overdue_ar_value,
  3::numeric as open_customers,
  2::numeric as overdue_customers,
  5::numeric as open_invoices,
  2::numeric as overdue_invoices,
  1::numeric as held_customers,
  now()-interval '5 minutes' as latest_invoice_at;

grant select on public.v_ecoflow_accounts_live_ar_kpis to authenticated;

create table if not exists public.ecoflow_read_model_refresh_state(
  read_model text primary key,
  refreshed_at timestamptz not null,
  row_count bigint not null check(row_count>=0)
);

create or replace function public.ecoflow_mark_dashboard_read_models_required()
returns timestamptz
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_required_at timestamptz:=clock_timestamp();
begin
  insert into public.ecoflow_read_model_refresh_state(read_model,refreshed_at,row_count)
  values('DASHBOARD_SOURCE_REQUIRED',v_required_at,0)
  on conflict(read_model) do update set
    refreshed_at=greatest(public.ecoflow_read_model_refresh_state.refreshed_at,excluded.refreshed_at),
    row_count=0;
  return v_required_at;
end;
$$;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language sql
security definer
set search_path=pg_catalog,public
as $$ select 0::integer $$;

create or replace function public.ecoflow_refresh_current_exception_snapshot()
returns integer
language sql
security definer
set search_path=pg_catalog,public
as $$ select 0::integer $$;

create or replace function public.ecoflow_refresh_dashboard_read_models()
returns jsonb
language sql
security definer
set search_path=pg_catalog,public
as $$ select jsonb_build_object('fixture',true) $$;

grant execute on function public.ecoflow_mark_dashboard_read_models_required() to service_role;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;
grant execute on function public.ecoflow_refresh_current_exception_snapshot() to service_role;
grant execute on function public.ecoflow_refresh_dashboard_read_models() to service_role;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values('77777777-7777-4777-8777-777777777777','ACCOUNT',true,'ACTIVE')
on conflict(user_id) do update set
  app_role=excluded.app_role,
  is_active=true,
  team_status='ACTIVE';

insert into public.v_ecoflow_customer_store_directory(
  store_id,purchaser_id,store_name,suburb,state,address,contact_phone,price_group_id,
  verified,store_signal,orders_30d,revenue_30d,units_30d,top_sku_30d,top_product_30d,
  last_order_at,site_updated_at
) values(
  'SUMMARY-SNAPSHOT-STORE','SUMMARY-PURCHASER','Summary Snapshot Store','Adelaide','SA',
  '1 Fixture Street','0800000000','PG-SUMMARY',true,'READY',4,850,22,'SKU-1','Fixture Product',
  now()-interval '1 day',now()
);

insert into public.v_ecoflow_accounts_live_statement_customers(
  store_id,store_name,invoice_count,open_invoice_count,overdue_invoice_count,
  open_statement_value,overdue_statement_value,worst_overdue_days,statement_signal,
  accounts_priority,billing_email,billing_contact_name,billing_enabled
) values(
  'SUMMARY-SNAPSHOT-STORE','Summary Snapshot Store',5,3,2,1250.50,450.25,18,
  'OVERDUE','ATTENTION','fixture@example.invalid','Fixture Account',true
);

analyze public.v_ecoflow_customer_store_directory;
analyze public.v_ecoflow_accounts_live_statement_customers;
