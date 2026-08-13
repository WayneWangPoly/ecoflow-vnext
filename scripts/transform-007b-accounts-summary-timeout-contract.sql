\set ON_ERROR_STOP on

-- The migration must keep the expensive deployed KPI logic as background-only
-- and expose the same public KPI columns through the persisted snapshot.
do $$
declare
  v_public_cols text[];
  v_live_cols text[];
  v_public_def text;
  v_refresh_def text;
begin
  select array_agg(a.attname order by a.attnum) into v_public_cols
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_ar_kpis'::regclass
    and a.attnum>0 and not a.attisdropped;

  select array_agg(a.attname order by a.attnum) into v_live_cols
  from pg_attribute a
  where a.attrelid='public.v_ecoflow_accounts_live_ar_kpis_live_v1'::regclass
    and a.attnum>0 and not a.attisdropped;

  if v_public_cols is distinct from v_live_cols then
    raise exception 'summary snapshot changed public KPI contract';
  end if;

  select pg_get_viewdef('public.v_ecoflow_accounts_live_ar_kpis'::regclass,true)
    into v_public_def;
  if position('ecoflow_accounts_ar_kpi_snapshot' in v_public_def)=0
     or position('ecoflow_assert_accounts_ar_kpi_snapshot' in v_public_def)=0 then
    raise exception 'public Accounts KPI view is not freshness-guarded snapshot-backed';
  end if;

  select pg_get_functiondef('public.ecoflow_refresh_dashboard_read_models()'::regprocedure)
    into v_refresh_def;
  if position('ecoflow_refresh_accounts_ar_kpi_snapshot' in v_refresh_def)=0 then
    raise exception 'Accounts KPI refresh is outside authoritative refresh checkpoint';
  end if;

  if has_table_privilege('authenticated','public.v_ecoflow_accounts_live_ar_kpis_live_v1','SELECT') then
    raise exception 'authenticated can still expand background live Accounts KPI view';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_accounts_ar_kpi_snapshot','SELECT') then
    raise exception 'authenticated gained direct snapshot-table access';
  end if;
end
$$;

-- Initial migration refresh must have captured the deliberately slow live source.
do $$
declare
  v_payload jsonb;
begin
  select to_jsonb(k) into v_payload
  from public.v_ecoflow_accounts_live_ar_kpis k
  limit 1;

  if coalesce((v_payload->>'open_ar_value')::numeric,-1)<>1250.50::numeric then
    raise exception 'initial Accounts KPI snapshot payload mismatch: %',v_payload;
  end if;
  if not public.ecoflow_assert_accounts_ar_kpi_snapshot() then
    raise exception 'initial Accounts KPI snapshot was not current';
  end if;
end
$$;

-- The exact Accounts operational RPC must complete inside the interactive 2s
-- regression budget even though the background live KPI source sleeps for 3s.
begin;
set local statement_timeout='2000ms';
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;

do $$
declare
  v_count bigint;
  v_summary jsonb;
begin
  select r.total_count,r.summary_data
    into v_count,v_summary
  from public.ecoflow_read_operational_records_v1(
    'accounts','overview',1,25,null,null,null
  ) r
  limit 1;

  if v_count<>1 then
    raise exception 'bounded Accounts summary fixture row count mismatch: %',v_count;
  end if;
  if coalesce((v_summary->>'open_ar_value')::numeric,-1)<>1250.50::numeric then
    raise exception 'bounded Accounts summary payload mismatch: %',v_summary;
  end if;
end
$$;

reset role;
rollback;

-- Freshness fails closed after a new authoritative-source checkpoint instead of
-- silently serving an old summary.
select public.ecoflow_mark_dashboard_read_models_required();

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
    if sqlerrm='ACCOUNTS_AR_KPI_SNAPSHOT_STALE' then
      v_stale:=true;
    else
      raise;
    end if;
  end;
  if not v_stale then
    raise exception 'stale Accounts KPI snapshot did not fail closed';
  end if;
end
$$;

reset role;
rollback;

-- Background refresh is allowed to exceed the interactive budget. It refreshes
-- the slow live source under the existing 180s read-model budget, after which
-- the same 2s interactive RPC is healthy again.
select public.ecoflow_refresh_dashboard_read_models();

begin;
set local statement_timeout='2000ms';
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;

do $$
declare
  v_summary jsonb;
begin
  select r.summary_data into v_summary
  from public.ecoflow_read_operational_records_v1(
    'accounts','overview',1,25,null,null,null
  ) r
  limit 1;
  if coalesce((v_summary->>'open_ar_value')::numeric,-1)<>1250.50::numeric then
    raise exception 'refreshed bounded Accounts summary payload mismatch: %',v_summary;
  end if;
end
$$;

reset role;
rollback;

select 'TRANSFORM-007B Accounts summary timeout contract: PASS' as result;
