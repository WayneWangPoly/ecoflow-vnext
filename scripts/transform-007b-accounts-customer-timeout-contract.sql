\set ON_ERROR_STOP on

-- Structural contract: the interactive customer view is snapshot-backed and
-- role/freshness guarded; live expansion and storage remain background-only.
do $$
declare
  v_public_cols text[];
  v_live_cols text[];
  v_public_def text;
  v_kpi_live_def text;
  v_refresh_def text;
begin
  select array_agg(a.attname order by a.attnum) into v_public_cols
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_statement_customers'::regclass
    and a.attnum>0 and not a.attisdropped;

  select array_agg(a.attname order by a.attnum) into v_live_cols
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_statement_customers_live_v1'::regclass
    and a.attnum>0 and not a.attisdropped;

  if v_public_cols is distinct from v_live_cols then
    raise exception 'customer snapshot changed public column contract';
  end if;

  select pg_get_viewdef('public.v_ecoflow_accounts_live_statement_customers'::regclass,true)
    into v_public_def;
  if position('ecoflow_accounts_statement_customer_snapshot' in v_public_def)=0
     or position('ecoflow_assert_accounts_statement_customer_snapshot' in v_public_def)=0
     or position('ecoflow_active_app_role' in v_public_def)=0 then
    raise exception 'public customer view lost snapshot, freshness or role boundary';
  end if;

  select pg_get_viewdef('public.v_ecoflow_accounts_live_ar_kpis_live_v1'::regclass,true)
    into v_kpi_live_def;
  if position('ecoflow_accounts_statement_customer_snapshot' in v_kpi_live_def)=0
     or position('v_ecoflow_accounts_live_statement_customers' in v_kpi_live_def)>0
     or position('ecoflow_active_app_role' in v_kpi_live_def)>0 then
    raise exception 'background KPI still traverses end-user-filtered customer view';
  end if;

  select pg_get_functiondef('public.ecoflow_refresh_dashboard_read_models()'::regprocedure)
    into v_refresh_def;
  if position('ecoflow_refresh_accounts_statement_customer_snapshot' in v_refresh_def)=0
     or position('ecoflow_refresh_accounts_ar_kpi_snapshot' in v_refresh_def)=0
     or position('ecoflow_refresh_accounts_statement_customer_snapshot' in v_refresh_def)
        > position('ecoflow_refresh_accounts_ar_kpi_snapshot' in v_refresh_def) then
    raise exception 'dashboard checkpoint does not refresh customer snapshot before KPI';
  end if;

  if has_table_privilege('authenticated','public.v_ecoflow_accounts_live_statement_customers_live_v1','SELECT') then
    raise exception 'authenticated can expand background statement customers';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_accounts_statement_customer_snapshot','SELECT') then
    raise exception 'authenticated gained direct statement-customer snapshot access';
  end if;
end
$$;

-- Prove the background source really exceeds the interactive budget. This keeps
-- the regression meaningful: a passing RPC cannot be explained by a cheap test
-- fixture.
begin;
set local statement_timeout='2000ms';
do $$
declare
  v_timed_out boolean:=false;
begin
  begin
    perform count(*) from public.v_ecoflow_accounts_live_statement_customers_live_v1;
  exception when sqlstate '57014' then
    v_timed_out:=true;
  end;
  if not v_timed_out then
    raise exception 'slow live customer source unexpectedly completed inside 2s';
  end if;
end
$$;
rollback;

-- Initial migration refresh runs without an end-user auth.uid(). It must still
-- materialize real customer data and rebuild #288 KPI values from that snapshot,
-- not collapse to zero because the old public view had an app-role predicate.
do $$
declare
  v_customer_count bigint;
  v_customer_open numeric;
  v_kpi_open numeric;
  v_kpi_row_count bigint;
begin
  select count(*),coalesce(sum(open_statement_value),0)
    into v_customer_count,v_customer_open
  from public.ecoflow_accounts_statement_customer_snapshot;

  if v_customer_count<1 or v_customer_open<=0 then
    raise exception 'background initial customer refresh produced no financial data: %/%',v_customer_count,v_customer_open;
  end if;

  select count(*),coalesce(max(open_ar_value),-1)
    into v_kpi_row_count,v_kpi_open
  from public.ecoflow_accounts_ar_kpi_snapshot;

  if v_kpi_row_count<>1 then
    raise exception 'KPI snapshot is not singleton after customer repair: %',v_kpi_row_count;
  end if;
  if v_kpi_open is distinct from v_customer_open then
    raise exception 'KPI snapshot does not equal customer snapshot AR: %/%',v_kpi_open,v_customer_open;
  end if;
  if not exists(
    select 1 from public.ecoflow_accounts_statement_customer_snapshot
    where store_id='store-1' and open_statement_value>0
  ) then
    raise exception 'expected scale customer store-1 was not persisted';
  end if;
end
$$;

-- Public customer view and exact Accounts operational RPC must now stay under
-- the 2s interactive budget even though their background source is >3s.
begin;
set local statement_timeout='2000ms';
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;

do $$
declare
  v_open numeric;
  v_total bigint;
  v_summary jsonb;
begin
  select open_statement_value into v_open
  from public.v_ecoflow_accounts_live_statement_customers
  where store_id='store-1';
  if coalesce(v_open,0)<=0 then
    raise exception 'snapshot-backed public customer row missing financial state: %',v_open;
  end if;

  select r.total_count,r.summary_data
    into v_total,v_summary
  from public.ecoflow_read_operational_records_v1(
    'accounts','overview',1,25,null,null,null
  ) r
  limit 1;

  if coalesce(v_total,0)<1 then
    raise exception 'bounded Accounts RPC returned no directory rows';
  end if;
  if coalesce((v_summary->>'open_ar_value')::numeric,0)<=0 then
    raise exception 'Accounts RPC KPI summary collapsed to zero: %',v_summary;
  end if;
end
$$;

reset role;
rollback;

-- Preserve the old public role boundary: an authenticated VIEWER cannot expand
-- statement-customer data even though the owner-backed snapshot table exists.
insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values('88888888-8888-4888-8888-888888888888','VIEWER',true,'ACTIVE')
on conflict(user_id) do update set app_role='VIEWER',is_active=true,team_status='ACTIVE';

begin;
set local statement_timeout='2000ms';
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
set local role authenticated;
do $$
declare v_count bigint;
begin
  select count(*) into v_count
  from public.v_ecoflow_accounts_live_statement_customers;
  if v_count<>0 then
    raise exception 'VIEWER crossed Accounts statement-customer role boundary: %',v_count;
  end if;
end
$$;
reset role;
rollback;

-- Isolate the customer freshness guard: advance the authoritative checkpoint,
-- refresh only KPI state, then prove the exact Accounts RPC fails closed on the
-- still-stale customer projection rather than serving old rows.
select public.ecoflow_mark_dashboard_read_models_required();
select public.ecoflow_refresh_accounts_ar_kpi_snapshot();

begin;
set local statement_timeout='2000ms';
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;
do $$
declare
  v_stale boolean:=false;
begin
  begin
    perform * from public.ecoflow_read_operational_records_v1(
      'accounts','overview',1,25,null,null,null
    );
  exception when sqlstate '55000' then
    if sqlerrm='ACCOUNTS_STATEMENT_CUSTOMER_SNAPSHOT_STALE' then
      v_stale:=true;
    else
      raise;
    end if;
  end;
  if not v_stale then
    raise exception 'stale statement-customer snapshot did not fail closed';
  end if;
end
$$;
reset role;
rollback;

-- The authoritative background checkpoint may spend >2s rebuilding customer
-- aggregates. Once complete, both customer and KPI states must be current and
-- the same exact interactive RPC becomes healthy again under 2s.
select public.ecoflow_refresh_dashboard_read_models();

begin;
set local statement_timeout='2000ms';
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;
do $$
declare
  v_total bigint;
  v_summary jsonb;
begin
  select r.total_count,r.summary_data into v_total,v_summary
  from public.ecoflow_read_operational_records_v1(
    'accounts','overview',1,25,null,null,null
  ) r
  limit 1;
  if coalesce(v_total,0)<1 or coalesce((v_summary->>'open_ar_value')::numeric,0)<=0 then
    raise exception 'Accounts RPC did not recover after authoritative refresh: %/%',v_total,v_summary;
  end if;
end
$$;
reset role;
rollback;

select 'TRANSFORM-007B Accounts customer timeout contract: PASS' as result;
