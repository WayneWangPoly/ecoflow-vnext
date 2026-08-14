-- Forward repair for managed-Supabase safe-update enforcement.
--
-- TRANSFORM-007B introduced two Accounts read-model snapshot refresh functions
-- that replace derived snapshot rows transactionally. Their DELETE statements
-- omitted a WHERE clause, which managed Supabase rejects with SQLSTATE 21000
-- ("DELETE requires a WHERE clause"). Preserve the same replacement semantics,
-- but use the NOT NULL snapshot timestamp as an explicit predicate. Do not
-- disable safe-update protection and do not touch authoritative business data.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_customer_refresh_not_null boolean;
  v_kpi_refresh_not_null boolean;
begin
  if to_regclass('public.ecoflow_accounts_statement_customer_snapshot') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_accounts_statement_customer_snapshot');
  end if;
  if to_regclass('public.ecoflow_accounts_ar_kpi_snapshot') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_accounts_ar_kpi_snapshot');
  end if;
  if to_regclass('public.v_ecoflow_accounts_live_statement_customers_live_v1') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_accounts_live_statement_customers_live_v1');
  end if;
  if to_regclass('public.v_ecoflow_accounts_live_ar_kpis_live_v1') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_accounts_live_ar_kpis_live_v1');
  end if;
  if to_regclass('public.ecoflow_read_model_refresh_state') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_read_model_refresh_state');
  end if;
  if to_regprocedure('public.ecoflow_refresh_accounts_statement_customer_snapshot()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_refresh_accounts_statement_customer_snapshot()');
  end if;
  if to_regprocedure('public.ecoflow_refresh_accounts_ar_kpi_snapshot()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_refresh_accounts_ar_kpi_snapshot()');
  end if;
  if to_regprocedure('public.ecoflow_refresh_dashboard_read_models()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_refresh_dashboard_read_models()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'ACCOUNTS_SNAPSHOT_SAFE_REFRESH_PREREQUISITES_MISSING:%',
      array_to_string(v_missing, ', ');
  end if;

  select a.attnotnull into v_customer_refresh_not_null
  from pg_attribute a
  where a.attrelid = 'public.ecoflow_accounts_statement_customer_snapshot'::regclass
    and a.attname = 'snapshot_refreshed_at'
    and a.attnum > 0
    and not a.attisdropped;

  select a.attnotnull into v_kpi_refresh_not_null
  from pg_attribute a
  where a.attrelid = 'public.ecoflow_accounts_ar_kpi_snapshot'::regclass
    and a.attname = 'snapshot_refreshed_at'
    and a.attnum > 0
    and not a.attisdropped;

  if coalesce(v_customer_refresh_not_null, false) is not true
     or coalesce(v_kpi_refresh_not_null, false) is not true then
    raise exception 'ACCOUNTS_SNAPSHOT_SAFE_REFRESH_REQUIRES_NOT_NULL_REFRESH_TIMESTAMP';
  end if;
end;
$preflight$;

create or replace function public.ecoflow_refresh_accounts_statement_customer_snapshot()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
set statement_timeout='180s'
as $$
declare
  v_refresh_at timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ecoflow_accounts_statement_customer_snapshot', 0)
  );

  -- Managed Supabase safe-update requires an explicit predicate. This column is
  -- NOT NULL by contract, so the predicate intentionally matches every existing
  -- derived snapshot row without weakening the database safety guard.
  delete from public.ecoflow_accounts_statement_customer_snapshot s
  where s.snapshot_refreshed_at is not null;

  insert into public.ecoflow_accounts_statement_customer_snapshot
  select c.*, v_refresh_at
  from public.v_ecoflow_accounts_live_statement_customers_live_v1 c;

  get diagnostics v_count = row_count;

  insert into public.ecoflow_read_model_refresh_state(read_model, refreshed_at, row_count)
  values ('ACCOUNTS_STATEMENT_CUSTOMERS', v_refresh_at, v_count)
  on conflict(read_model) do update set
    refreshed_at = excluded.refreshed_at,
    row_count = excluded.row_count;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_accounts_statement_customer_snapshot()
  from public,anon,authenticated;
grant execute on function public.ecoflow_refresh_accounts_statement_customer_snapshot()
  to service_role;

create or replace function public.ecoflow_refresh_accounts_ar_kpi_snapshot()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
set statement_timeout='180s'
as $$
declare
  v_refresh_at timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ecoflow_accounts_ar_kpi_snapshot', 0)
  );

  -- Same managed-Supabase-safe replacement contract as the customer snapshot.
  delete from public.ecoflow_accounts_ar_kpi_snapshot s
  where s.snapshot_refreshed_at is not null;

  insert into public.ecoflow_accounts_ar_kpi_snapshot
  select k.*, v_refresh_at
  from public.v_ecoflow_accounts_live_ar_kpis_live_v1 k;

  get diagnostics v_count = row_count;
  if v_count > 1 then
    raise exception 'ACCOUNTS_AR_KPI_SNAPSHOT_NOT_SINGLETON:%', v_count;
  end if;

  insert into public.ecoflow_read_model_refresh_state(read_model, refreshed_at, row_count)
  values ('ACCOUNTS_AR_KPIS', v_refresh_at, v_count)
  on conflict(read_model) do update set
    refreshed_at = excluded.refreshed_at,
    row_count = excluded.row_count;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_accounts_ar_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.ecoflow_refresh_accounts_ar_kpi_snapshot()
  to service_role;

-- Repair the currently stale derived read models during deployment. The
-- dashboard checkpoint remains the single ordered refresh authority and will
-- fail this migration closed if any dependent snapshot cannot rebuild.
select public.ecoflow_refresh_dashboard_read_models();

do $verify$
declare
  v_customer_def text;
  v_kpi_def text;
  v_required_at timestamptz;
  v_customer_at timestamptz;
  v_kpi_at timestamptz;
begin
  select pg_get_functiondef(
    'public.ecoflow_refresh_accounts_statement_customer_snapshot()'::regprocedure
  ) into v_customer_def;
  select pg_get_functiondef(
    'public.ecoflow_refresh_accounts_ar_kpi_snapshot()'::regprocedure
  ) into v_kpi_def;

  if position('where s.snapshot_refreshed_at is not null' in lower(v_customer_def)) = 0
     or position('where s.snapshot_refreshed_at is not null' in lower(v_kpi_def)) = 0 then
    raise exception 'ACCOUNTS_SNAPSHOT_SAFE_REFRESH_PREDICATE_MISSING';
  end if;

  select refreshed_at into v_required_at
  from public.ecoflow_read_model_refresh_state
  where read_model = 'DASHBOARD_SOURCE_REQUIRED';
  select refreshed_at into v_customer_at
  from public.ecoflow_read_model_refresh_state
  where read_model = 'ACCOUNTS_STATEMENT_CUSTOMERS';
  select refreshed_at into v_kpi_at
  from public.ecoflow_read_model_refresh_state
  where read_model = 'ACCOUNTS_AR_KPIS';

  if v_required_at is not null
     and (v_customer_at is null or v_customer_at < v_required_at
          or v_kpi_at is null or v_kpi_at < v_required_at) then
    raise exception 'ACCOUNTS_SNAPSHOT_SAFE_REFRESH_VERIFY_FAILED:%/%/%',
      v_required_at, v_customer_at, v_kpi_at;
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
commit;
