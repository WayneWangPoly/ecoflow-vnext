-- TRANSFORM-007B production repair: remove full-history customer aggregation
-- from the interactive Accounts row path.
--
-- Production rollback verification after the keyed statement-line repair and
-- persisted AR KPI repair still exceeded the 8s budget while reading
-- v_ecoflow_accounts_live_statement_customers. The deployed view aggregates all
-- statement lines by store and joins another full-history store-performance
-- aggregate before the outer operational RPC can apply search/pagination.
--
-- Keep that expensive computation as a background-only read-model source,
-- persist one row per statement customer, and preserve the existing public view
-- name/columns/role boundary through a freshness-guarded snapshot. Also rebuild
-- the #288 KPI background source from the customer snapshot rather than from the
-- app-role-filtered public view, so service/migration refreshes cannot silently
-- produce zero-valued KPIs merely because auth.uid() is absent.

begin;

do $preflight$
declare
  v_missing text[]:=array[]::text[];
  v_relkind "char";
begin
  if to_regclass('public.v_ecoflow_accounts_live_statement_customers') is null then
    v_missing:=array_append(v_missing,'public.v_ecoflow_accounts_live_statement_customers');
  else
    select c.relkind into v_relkind
    from pg_class c
    where c.oid='public.v_ecoflow_accounts_live_statement_customers'::regclass;
    if v_relkind<>'v' then
      raise exception 'ACCOUNTS_CUSTOMER_TIMEOUT_REPAIR_EXPECTED_VIEW:%',v_relkind;
    end if;
  end if;
  if to_regclass('public.v_ecoflow_accounts_live_statement_lines') is null then
    v_missing:=array_append(v_missing,'public.v_ecoflow_accounts_live_statement_lines');
  end if;
  if to_regclass('public.v_ecoflow_owner_store_performance') is null then
    v_missing:=array_append(v_missing,'public.v_ecoflow_owner_store_performance');
  end if;
  if to_regclass('public.v_ecoflow_accounts_statement_latest_actions') is null then
    v_missing:=array_append(v_missing,'public.v_ecoflow_accounts_statement_latest_actions');
  end if;
  if to_regclass('public.ecoflow_accounts_billing_contacts') is null then
    v_missing:=array_append(v_missing,'public.ecoflow_accounts_billing_contacts');
  end if;
  if to_regclass('public.ecoflow_read_model_refresh_state') is null then
    v_missing:=array_append(v_missing,'public.ecoflow_read_model_refresh_state');
  end if;
  if to_regclass('public.v_ecoflow_accounts_live_ar_kpis_live_v1') is null
     or to_regclass('public.ecoflow_accounts_ar_kpi_snapshot') is null then
    v_missing:=array_append(v_missing,'TRANSFORM-007B Accounts AR KPI snapshot repair');
  end if;
  if to_regprocedure('public.ecoflow_mark_dashboard_read_models_required()') is null
     or to_regprocedure('public.ecoflow_refresh_ui_active_order_keys()') is null
     or to_regprocedure('public.ecoflow_refresh_current_exception_snapshot()') is null
     or to_regprocedure('public.ecoflow_refresh_accounts_ar_kpi_snapshot()') is null
     or to_regprocedure('public.ecoflow_refresh_dashboard_read_models()') is null then
    v_missing:=array_append(v_missing,'dashboard read-model refresh checkpoint');
  end if;
  if to_regclass('public.v_ecoflow_accounts_live_statement_customers_live_v1') is not null
     or to_regclass('public.ecoflow_accounts_statement_customer_snapshot') is not null then
    raise exception 'ACCOUNTS_CUSTOMER_TIMEOUT_REPAIR_ALREADY_PARTIALLY_PRESENT';
  end if;
  if cardinality(v_missing)>0 then
    raise exception 'ACCOUNTS_CUSTOMER_TIMEOUT_REPAIR_PREREQUISITES_MISSING:%',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

-- Background-only source. This is the current production customer calculation
-- with its browser/app-role predicate intentionally removed. Authorization
-- belongs on the public snapshot-backed view, not on the service read-model
-- source, because dashboard refresh runs without an end-user auth.uid().
create view public.v_ecoflow_accounts_live_statement_customers_live_v1 as
with sums as (
  select
    l.store_id,
    max(l.store_name) as store_name,
    count(*)::numeric as invoice_count,
    count(*) filter(where l.outstanding_amount>0)::numeric as open_invoice_count,
    count(*) filter(where l.statement_status='OVERDUE' and l.outstanding_amount>0)::numeric as overdue_invoice_count,
    coalesce(sum(l.invoice_value),0)::numeric as total_statement_value,
    coalesce(sum(l.outstanding_amount),0)::numeric as open_statement_value,
    coalesce(sum(l.outstanding_amount) filter(where l.statement_status='OVERDUE'),0)::numeric as overdue_statement_value,
    coalesce(sum(l.invoice_value) filter(where l.order_ts>=now()-interval '30 days'),0)::numeric as statement_value_30d,
    max(l.order_ts) as latest_invoice_at,
    coalesce(max(l.overdue_days) filter(where l.statement_status='OVERDUE' and l.outstanding_amount>0),0)::numeric as worst_overdue_days
  from public.v_ecoflow_accounts_live_statement_lines l
  group by l.store_id
)
select
  s.store_id,
  s.store_name,
  p.suburb,
  p.address,
  p.contact_phone,
  p.price_group_id,
  s.invoice_count,
  s.open_invoice_count,
  s.overdue_invoice_count,
  s.total_statement_value,
  s.open_statement_value,
  s.overdue_statement_value,
  s.statement_value_30d,
  s.latest_invoice_at,
  s.worst_overdue_days,
  case
    when s.overdue_statement_value>0 then 'OVERDUE_ATTENTION'::text
    when s.open_statement_value>0 then 'OPEN_BALANCE'::text
    else 'CLEAR'::text
  end as statement_signal,
  p.orders_30d,
  p.revenue_30d as order_revenue_30d,
  p.top_sku_30d,
  p.top_product_30d,
  la.latest_action,
  la.latest_action_status,
  la.latest_action_note,
  la.latest_action_at,
  case
    when la.latest_action='HOLD_ACCOUNT' then 'ON_HOLD'::text
    when s.overdue_statement_value>0 and s.worst_overdue_days>=30 then 'URGENT_COLLECTION'::text
    when s.overdue_statement_value>0 then 'COLLECTION'::text
    when s.open_statement_value>0 then 'SEND_STATEMENT'::text
    else 'CLEAR'::text
  end as accounts_priority,
  bc.billing_email,
  bc.contact_name as billing_contact_name,
  coalesce(bc.enabled,false) as billing_enabled
from sums s
left join public.v_ecoflow_owner_store_performance p on p.store_id=s.store_id
left join public.v_ecoflow_accounts_statement_latest_actions la on la.store_id=s.store_id
left join public.ecoflow_accounts_billing_contacts bc on bc.store_id=s.store_id;

revoke all on public.v_ecoflow_accounts_live_statement_customers_live_v1
  from public,anon,authenticated;
grant select on public.v_ecoflow_accounts_live_statement_customers_live_v1 to service_role;

-- Snapshot exact customer row shape plus internal refresh metadata.
create table public.ecoflow_accounts_statement_customer_snapshot as
select c.*
from public.v_ecoflow_accounts_live_statement_customers_live_v1 c
with no data;

alter table public.ecoflow_accounts_statement_customer_snapshot
  add column snapshot_refreshed_at timestamptz not null;

create unique index ecoflow_accounts_statement_customer_snapshot_store_idx
  on public.ecoflow_accounts_statement_customer_snapshot(store_id);
create index ecoflow_accounts_statement_customer_snapshot_name_idx
  on public.ecoflow_accounts_statement_customer_snapshot(lower(store_name));
create index ecoflow_accounts_statement_customer_snapshot_priority_idx
  on public.ecoflow_accounts_statement_customer_snapshot(accounts_priority,overdue_statement_value desc,open_statement_value desc);

alter table public.ecoflow_accounts_statement_customer_snapshot enable row level security;
revoke all on public.ecoflow_accounts_statement_customer_snapshot
  from public,anon,authenticated;
grant select on public.ecoflow_accounts_statement_customer_snapshot to service_role;

create or replace function public.ecoflow_assert_accounts_statement_customer_snapshot()
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_required_at timestamptz;
  v_refreshed_at timestamptz;
begin
  select s.refreshed_at into v_required_at
  from public.ecoflow_read_model_refresh_state s
  where s.read_model='DASHBOARD_SOURCE_REQUIRED';

  select s.refreshed_at into v_refreshed_at
  from public.ecoflow_read_model_refresh_state s
  where s.read_model='ACCOUNTS_STATEMENT_CUSTOMERS';

  if v_required_at is null
     or v_refreshed_at is null
     or v_refreshed_at<v_required_at then
    raise exception using errcode='55000',
      message='ACCOUNTS_STATEMENT_CUSTOMER_SNAPSHOT_STALE',
      detail='Accounts statement-customer snapshot was not refreshed after the latest authoritative projection.',
      hint='Run ecoflow_refresh_dashboard_read_models with the service role.';
  end if;
  return true;
end;
$$;

revoke all on function public.ecoflow_assert_accounts_statement_customer_snapshot()
  from public,anon,authenticated,service_role;
-- The public customer view invokes this read-only freshness guard as the
-- authenticated caller. It exposes no row data and has no mutation path.
grant execute on function public.ecoflow_assert_accounts_statement_customer_snapshot()
  to authenticated;

create or replace function public.ecoflow_refresh_accounts_statement_customer_snapshot()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
set statement_timeout='180s'
as $$
declare
  v_refresh_at timestamptz:=clock_timestamp();
  v_count integer:=0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ecoflow_accounts_statement_customer_snapshot',0)
  );

  delete from public.ecoflow_accounts_statement_customer_snapshot;
  insert into public.ecoflow_accounts_statement_customer_snapshot
  select c.*,v_refresh_at
  from public.v_ecoflow_accounts_live_statement_customers_live_v1 c;

  get diagnostics v_count=row_count;

  insert into public.ecoflow_read_model_refresh_state(read_model,refreshed_at,row_count)
  values('ACCOUNTS_STATEMENT_CUSTOMERS',v_refresh_at,v_count)
  on conflict(read_model) do update set
    refreshed_at=excluded.refreshed_at,
    row_count=excluded.row_count;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_accounts_statement_customer_snapshot()
  from public,anon,authenticated;
grant execute on function public.ecoflow_refresh_accounts_statement_customer_snapshot()
  to service_role;

-- Replace the public customer view in-place. Existing dependent views/functions
-- keep the same OID and column contract. Browser authorization remains exactly
-- at this public surface; the snapshot table/background view stay inaccessible.
do $replace_public_customer_view$
declare
  v_columns text;
begin
  select string_agg(format('s.%I',a.attname),', ' order by a.attnum)
    into v_columns
  from pg_attribute a
  where a.attrelid='public.ecoflow_accounts_statement_customer_snapshot'::regclass
    and a.attnum>0
    and not a.attisdropped
    and a.attname<>'snapshot_refreshed_at';

  if nullif(v_columns,'') is null then
    raise exception 'ACCOUNTS_STATEMENT_CUSTOMER_SNAPSHOT_COLUMNS_MISSING';
  end if;

  execute format(
    'create or replace view public.v_ecoflow_accounts_live_statement_customers as '
    || 'with freshness as materialized ('
    || 'select public.ecoflow_assert_accounts_statement_customer_snapshot() as current'
    || ') select %s from freshness f cross join public.ecoflow_accounts_statement_customer_snapshot s '
    || 'where f.current and public.ecoflow_active_app_role()=any(array[''OWNER''::text,''ADMIN''::text,''ACCOUNT''::text])',
    v_columns
  );
end;
$replace_public_customer_view$;

revoke all on public.v_ecoflow_accounts_live_statement_customers from anon;
grant select on public.v_ecoflow_accounts_live_statement_customers to authenticated;

-- Repair #288's background KPI source. Its original captured definition still
-- traversed the app-role-filtered customer view, so a service/migration refresh
-- without auth.uid() could legitimately see zero customers. Aggregate directly
-- from the freshly populated internal customer snapshot instead.
create or replace view public.v_ecoflow_accounts_live_ar_kpis_live_v1 as
select
  coalesce(sum(open_statement_value),0)::numeric as open_ar_value,
  coalesce(sum(overdue_statement_value),0)::numeric as overdue_ar_value,
  count(*) filter(where open_statement_value>0)::numeric as open_customers,
  count(*) filter(where overdue_statement_value>0)::numeric as overdue_customers,
  coalesce(sum(open_invoice_count),0)::numeric as open_invoices,
  coalesce(sum(overdue_invoice_count),0)::numeric as overdue_invoices,
  coalesce(sum(statement_value_30d),0)::numeric as statement_value_30d,
  coalesce(max(worst_overdue_days),0)::numeric as worst_overdue_days,
  count(*) filter(where accounts_priority='URGENT_COLLECTION')::numeric as urgent_customers,
  count(*) filter(where accounts_priority='ON_HOLD')::numeric as held_customers,
  max(latest_invoice_at) as latest_invoice_at
from public.ecoflow_accounts_statement_customer_snapshot;

revoke all on public.v_ecoflow_accounts_live_ar_kpis_live_v1
  from public,anon,authenticated;
grant select on public.v_ecoflow_accounts_live_ar_kpis_live_v1 to service_role;

-- One authoritative refresh checkpoint, ordered by dependency: source-derived
-- customer rows first, then KPI aggregate over that same snapshot.
create or replace function public.ecoflow_refresh_dashboard_read_models()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
set statement_timeout='180s'
as $$
declare
  v_active_keys integer;
  v_exceptions integer;
  v_accounts_statement_customers integer;
  v_accounts_ar_kpis integer;
begin
  v_active_keys:=public.ecoflow_refresh_ui_active_order_keys();
  v_exceptions:=public.ecoflow_refresh_current_exception_snapshot();
  v_accounts_statement_customers:=public.ecoflow_refresh_accounts_statement_customer_snapshot();
  v_accounts_ar_kpis:=public.ecoflow_refresh_accounts_ar_kpi_snapshot();

  return jsonb_build_object(
    'active_order_keys',v_active_keys,
    'current_exceptions',v_exceptions,
    'accounts_statement_customers',v_accounts_statement_customers,
    'accounts_ar_kpis',v_accounts_ar_kpis,
    'refreshed_at',clock_timestamp()
  );
end;
$$;

revoke all on function public.ecoflow_refresh_dashboard_read_models()
  from public,anon,authenticated;
grant execute on function public.ecoflow_refresh_dashboard_read_models()
  to service_role;

-- Atomic first refresh fixes both the new customer projection and any #288 KPI
-- snapshot that may have been populated from an end-user-filtered source.
select public.ecoflow_mark_dashboard_read_models_required();
select public.ecoflow_refresh_dashboard_read_models();

do $verify$
declare
  v_public_columns text[];
  v_live_columns text[];
  v_public_def text;
  v_kpi_live_def text;
  v_refresh_def text;
  v_snapshot_count bigint;
  v_state_count bigint;
begin
  select array_agg(a.attname order by a.attnum) into v_public_columns
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_statement_customers'::regclass
    and a.attnum>0 and not a.attisdropped;

  select array_agg(a.attname order by a.attnum) into v_live_columns
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_statement_customers_live_v1'::regclass
    and a.attnum>0 and not a.attisdropped;

  if v_public_columns is distinct from v_live_columns then
    raise exception 'ACCOUNTS_STATEMENT_CUSTOMER_PUBLIC_CONTRACT_CHANGED';
  end if;

  if not public.ecoflow_assert_accounts_statement_customer_snapshot() then
    raise exception 'ACCOUNTS_STATEMENT_CUSTOMER_INITIAL_SNAPSHOT_NOT_CURRENT';
  end if;
  if not public.ecoflow_assert_accounts_ar_kpi_snapshot() then
    raise exception 'ACCOUNTS_AR_KPI_SNAPSHOT_NOT_CURRENT_AFTER_CUSTOMER_REPAIR';
  end if;

  select count(*) into v_snapshot_count
  from public.ecoflow_accounts_statement_customer_snapshot;
  select s.row_count into v_state_count
  from public.ecoflow_read_model_refresh_state s
  where s.read_model='ACCOUNTS_STATEMENT_CUSTOMERS';
  if v_snapshot_count is distinct from v_state_count then
    raise exception 'ACCOUNTS_STATEMENT_CUSTOMER_REFRESH_COUNT_MISMATCH:%/%',v_snapshot_count,v_state_count;
  end if;

  select pg_get_viewdef('public.v_ecoflow_accounts_live_statement_customers'::regclass,true)
    into v_public_def;
  if position('ecoflow_accounts_statement_customer_snapshot' in v_public_def)=0
     or position('ecoflow_assert_accounts_statement_customer_snapshot' in v_public_def)=0
     or position('ecoflow_active_app_role' in v_public_def)=0 then
    raise exception 'ACCOUNTS_STATEMENT_CUSTOMER_PUBLIC_SECURITY_OR_FRESHNESS_LOST';
  end if;

  select pg_get_viewdef('public.v_ecoflow_accounts_live_ar_kpis_live_v1'::regclass,true)
    into v_kpi_live_def;
  if position('ecoflow_accounts_statement_customer_snapshot' in v_kpi_live_def)=0
     or position('v_ecoflow_accounts_live_statement_customers' in v_kpi_live_def)>0
     or position('ecoflow_active_app_role' in v_kpi_live_def)>0 then
    raise exception 'ACCOUNTS_AR_KPI_BACKGROUND_SOURCE_STILL_USER_FILTERED';
  end if;

  select pg_get_functiondef('public.ecoflow_refresh_dashboard_read_models()'::regprocedure)
    into v_refresh_def;
  if position('ecoflow_refresh_accounts_statement_customer_snapshot' in v_refresh_def)=0
     or position('ecoflow_refresh_accounts_ar_kpi_snapshot' in v_refresh_def)=0
     or position('ecoflow_refresh_accounts_statement_customer_snapshot' in v_refresh_def)
        > position('ecoflow_refresh_accounts_ar_kpi_snapshot' in v_refresh_def) then
    raise exception 'ACCOUNTS_CUSTOMER_KPI_REFRESH_DEPENDENCY_ORDER_INVALID';
  end if;
end;
$verify$;

notify pgrst,'reload schema';
commit;
