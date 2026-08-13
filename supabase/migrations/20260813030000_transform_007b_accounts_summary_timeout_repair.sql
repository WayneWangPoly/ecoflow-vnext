-- TRANSFORM-007B production repair: remove the live AR aggregate from the
-- interactive Accounts read path.
--
-- Production release verification after the keyed statement-line repair proved
-- that ecoflow_read_operational_records_v1('accounts', ...) still exceeded the
-- 8s budget while building summary_data from v_ecoflow_accounts_live_ar_kpis.
-- Keep the current live KPI definition as a background-only source, persist its
-- exact row shape in a snapshot, and make the existing public KPI view read the
-- freshness-guarded snapshot. The established dashboard read-model checkpoint
-- remains the single refresh/freshness authority.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.v_ecoflow_accounts_live_ar_kpis') is null then
    v_missing := array_append(v_missing,'public.v_ecoflow_accounts_live_ar_kpis');
  end if;
  if to_regclass('public.ecoflow_read_model_refresh_state') is null then
    v_missing := array_append(v_missing,'public.ecoflow_read_model_refresh_state');
  end if;
  if to_regprocedure('public.ecoflow_mark_dashboard_read_models_required()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_mark_dashboard_read_models_required()');
  end if;
  if to_regprocedure('public.ecoflow_refresh_ui_active_order_keys()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_refresh_ui_active_order_keys()');
  end if;
  if to_regprocedure('public.ecoflow_refresh_current_exception_snapshot()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_refresh_current_exception_snapshot()');
  end if;
  if to_regprocedure('public.ecoflow_refresh_dashboard_read_models()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_refresh_dashboard_read_models()');
  end if;
  if to_regclass('public.v_ecoflow_accounts_live_ar_kpis_live_v1') is not null
     or to_regclass('public.ecoflow_accounts_ar_kpi_snapshot') is not null then
    raise exception 'ACCOUNTS_SUMMARY_TIMEOUT_REPAIR_ALREADY_PARTIALLY_PRESENT';
  end if;
  if cardinality(v_missing)>0 then
    raise exception 'ACCOUNTS_SUMMARY_TIMEOUT_REPAIR_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

-- Capture the deployed live definition as an independent background-only view.
-- pg_get_viewdef expands the definition against its underlying authorities, so
-- this copy does not depend on the public KPI view that is replaced below.
do $capture_live$
declare
  v_definition text;
begin
  select pg_get_viewdef('public.v_ecoflow_accounts_live_ar_kpis'::regclass,true)
    into v_definition;
  if nullif(btrim(v_definition),'') is null then
    raise exception 'ACCOUNTS_SUMMARY_LIVE_VIEW_DEFINITION_MISSING';
  end if;
  execute 'create view public.v_ecoflow_accounts_live_ar_kpis_live_v1 as '
    || v_definition;
end;
$capture_live$;

revoke all on public.v_ecoflow_accounts_live_ar_kpis_live_v1
  from public,anon,authenticated;
grant select on public.v_ecoflow_accounts_live_ar_kpis_live_v1 to service_role;

-- Preserve the exact deployed KPI column names/types without hard-coding an
-- older fixture shape. The refresh timestamp is deliberately snapshot-only and
-- is not exposed through the public KPI view.
create table public.ecoflow_accounts_ar_kpi_snapshot as
select k.*
from public.v_ecoflow_accounts_live_ar_kpis_live_v1 k
with no data;

alter table public.ecoflow_accounts_ar_kpi_snapshot
  add column snapshot_refreshed_at timestamptz not null;

alter table public.ecoflow_accounts_ar_kpi_snapshot enable row level security;
revoke all on public.ecoflow_accounts_ar_kpi_snapshot
  from public,anon,authenticated;
grant select on public.ecoflow_accounts_ar_kpi_snapshot to service_role;

create or replace function public.ecoflow_assert_accounts_ar_kpi_snapshot()
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
  where s.read_model='ACCOUNTS_AR_KPIS';

  if v_required_at is null
     or v_refreshed_at is null
     or v_refreshed_at < v_required_at then
    raise exception using errcode='55000',
      message='ACCOUNTS_AR_KPI_SNAPSHOT_STALE',
      detail='Accounts AR KPI snapshot was not refreshed after the latest authoritative projection.',
      hint='Run ecoflow_refresh_dashboard_read_models with the service role.';
  end if;

  return true;
end;
$$;

revoke all on function public.ecoflow_assert_accounts_ar_kpi_snapshot()
  from public,anon,authenticated,service_role;

create or replace function public.ecoflow_refresh_accounts_ar_kpi_snapshot()
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
    hashtextextended('ecoflow_accounts_ar_kpi_snapshot',0)
  );

  delete from public.ecoflow_accounts_ar_kpi_snapshot;

  insert into public.ecoflow_accounts_ar_kpi_snapshot
  select k.*,v_refresh_at
  from public.v_ecoflow_accounts_live_ar_kpis_live_v1 k;

  get diagnostics v_count=row_count;
  if v_count>1 then
    raise exception 'ACCOUNTS_AR_KPI_SNAPSHOT_NOT_SINGLETON:%',v_count;
  end if;

  insert into public.ecoflow_read_model_refresh_state(read_model,refreshed_at,row_count)
  values ('ACCOUNTS_AR_KPIS',v_refresh_at,v_count)
  on conflict(read_model) do update set
    refreshed_at=excluded.refreshed_at,
    row_count=excluded.row_count;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_accounts_ar_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.ecoflow_refresh_accounts_ar_kpi_snapshot()
  to service_role;

-- Replace the existing KPI view in-place, preserving its OID, grants and exact
-- output column contract for all existing consumers. Build the select-list from
-- the snapshot relation so production column evolution is retained verbatim.
do $replace_public_view$
declare
  v_columns text;
begin
  select string_agg(format('s.%I',a.attname),', ' order by a.attnum)
    into v_columns
  from pg_attribute a
  where a.attrelid='public.ecoflow_accounts_ar_kpi_snapshot'::regclass
    and a.attnum>0
    and not a.attisdropped
    and a.attname<>'snapshot_refreshed_at';

  if nullif(v_columns,'') is null then
    raise exception 'ACCOUNTS_AR_KPI_SNAPSHOT_COLUMNS_MISSING';
  end if;

  execute format(
    'create or replace view public.v_ecoflow_accounts_live_ar_kpis as '
    || 'with freshness as materialized ('
    || 'select public.ecoflow_assert_accounts_ar_kpi_snapshot() as current'
    || ') select %s from freshness f cross join public.ecoflow_accounts_ar_kpi_snapshot s '
    || 'where f.current',
    v_columns
  );
end;
$replace_public_view$;

-- Extend the already-authoritative Ordermentum projection checkpoint instead of
-- creating a second scheduler/freshness clock. project-ordermentum-raw-orders
-- marks DASHBOARD_SOURCE_REQUIRED only after real authoritative mutations, then
-- calls this RPC and fails closed if any derived read model cannot refresh.
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
  v_accounts_ar_kpis integer;
begin
  v_active_keys:=public.ecoflow_refresh_ui_active_order_keys();
  v_exceptions:=public.ecoflow_refresh_current_exception_snapshot();
  v_accounts_ar_kpis:=public.ecoflow_refresh_accounts_ar_kpi_snapshot();

  return jsonb_build_object(
    'active_order_keys',v_active_keys,
    'current_exceptions',v_exceptions,
    'accounts_ar_kpis',v_accounts_ar_kpis,
    'refreshed_at',clock_timestamp()
  );
end;
$$;

revoke all on function public.ecoflow_refresh_dashboard_read_models()
  from public,anon,authenticated;
grant execute on function public.ecoflow_refresh_dashboard_read_models()
  to service_role;

-- Establish an atomic initial checkpoint. Until this transaction commits,
-- external sessions continue to see the old live view; after commit they see a
-- populated and freshness-valid snapshot.
select public.ecoflow_mark_dashboard_read_models_required();
select public.ecoflow_refresh_dashboard_read_models();

do $verify$
declare
  v_public_columns text[];
  v_live_columns text[];
  v_refresh_definition text;
begin
  select array_agg(a.attname order by a.attnum)
    into v_public_columns
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_ar_kpis'::regclass
    and a.attnum>0 and not a.attisdropped;

  select array_agg(a.attname order by a.attnum)
    into v_live_columns
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_ar_kpis_live_v1'::regclass
    and a.attnum>0 and not a.attisdropped;

  if v_public_columns is distinct from v_live_columns then
    raise exception 'ACCOUNTS_AR_KPI_PUBLIC_CONTRACT_CHANGED';
  end if;

  if not public.ecoflow_assert_accounts_ar_kpi_snapshot() then
    raise exception 'ACCOUNTS_AR_KPI_INITIAL_SNAPSHOT_NOT_CURRENT';
  end if;

  select pg_get_functiondef('public.ecoflow_refresh_dashboard_read_models()'::regprocedure)
    into v_refresh_definition;
  if position('ecoflow_refresh_accounts_ar_kpi_snapshot' in v_refresh_definition)=0 then
    raise exception 'ACCOUNTS_AR_KPI_REFRESH_NOT_IN_AUTHORITATIVE_CHECKPOINT';
  end if;
end;
$verify$;

notify pgrst,'reload schema';
commit;
