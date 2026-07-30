\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_metric_drill_access_expect_error(
  p_sql text,
  p_marker text
)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_METRIC_DRILL_ACCESS_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_METRIC_DRILL_ACCESS_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_METRIC_DRILL_ACCESS_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_metric_drill_access_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_metric_drill_access_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
begin
  if to_regprocedure('analytics.get_metric_drill_access()') is null then
    raise exception 'metric drill access RPC missing';
  end if;

  if has_function_privilege(
       'anon','analytics.get_metric_drill_access()','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_metric_drill_access()','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_metric_drill_access()','EXECUTE'
     ) then
    raise exception 'metric drill access RPC execute ACL is incorrect';
  end if;

  select pg_get_functiondef('analytics.get_metric_drill_access()'::regprocedure)
  into v_definition;

  if position('analytics.metric_projection_readiness' in v_definition)=0
     or position('analytics.metric_definition' in v_definition)=0 then
    raise exception 'metric drill access RPC is not sourced from governed metadata';
  end if;

  if v_definition ~* 'fact_[a-z_]+'
     or v_definition ~* 'v_initial_kpi_[a-z_]+_internal'
     or v_definition ~* 'metric_value'
     or v_definition ~* 'breakdown'
     or v_definition ~* 'affected_entit'
     or v_definition ~* 'refresh_[a-z_]+\(' then
    raise exception 'metric drill access RPC reads values, facts, breakdowns, entities or refreshes';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('95000000-0000-0000-0000-000000000001','drill-owner@example.test'),
  ('95000000-0000-0000-0000-000000000002','drill-admin@example.test'),
  ('95000000-0000-0000-0000-000000000003','drill-viewer@example.test'),
  ('95000000-0000-0000-0000-000000000004','drill-warehouse@example.test'),
  ('95000000-0000-0000-0000-000000000005','drill-driver@example.test'),
  ('95000000-0000-0000-0000-000000000006','drill-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('95000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000002','ADMIN',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000003','VIEWER',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000004','WAREHOUSE',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000005','DRIVER',true,'ACTIVE'),
  ('95000000-0000-0000-0000-000000000006','OWNER',false,'INACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000003',false);
select public.ecoflow_metric_drill_access_expect_error(
  $$select * from analytics.get_metric_drill_access()$$,
  'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000004',false);
select public.ecoflow_metric_drill_access_expect_error(
  $$select * from analytics.get_metric_drill_access()$$,
  'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000005',false);
select public.ecoflow_metric_drill_access_expect_error(
  $$select * from analytics.get_metric_drill_access()$$,
  'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000006',false);
select public.ecoflow_metric_drill_access_expect_error(
  $$select * from analytics.get_metric_drill_access()$$,
  'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','',false);
select public.ecoflow_metric_drill_access_expect_error(
  $$select * from analytics.get_metric_drill_access()$$,
  'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',false);

select (count(*)=10) as owner_received_ten_drill_rows
from analytics.get_metric_drill_access()
\gset
\if :owner_received_ten_drill_rows
\else
  \echo 'owner did not receive exactly ten metric drill access rows'
  \quit 1
\endif

select (
  array_agg(metric_key order by sequence_no)=array[
    'revenue','gross_margin','fill_rate','on_time_delivery_rate',
    'stockout_risk_count','dead_stock_value','substitution_rate',
    'lines_picked_per_hour','inventory_days_of_cover','customer_concentration'
  ]::text[]
) as canonical_metric_order
from (
  select metric_key,row_number() over() as sequence_no
  from analytics.get_metric_drill_access()
) ordered_rows
\gset
\if :canonical_metric_order
\else
  \echo 'metric drill access rows are not in canonical Operational Pulse order'
  \quit 1
\endif

select (
  count(*) filter(where drill_capability='UNAVAILABLE')=10
  and count(*) filter(where drill_capability='AVAILABLE')=0
  and count(*) filter(where cardinality(authorised_dimension_keys)<>0)=0
  and count(*) filter(where cardinality(declared_dimension_keys)=0)=0
) as current_drill_access_fails_closed
from analytics.get_metric_drill_access()
\gset
\if :current_drill_access_fails_closed
\else
  \echo 'current Shadow or Blocked metrics unexpectedly received drill authority'
  \quit 1
\endif

select (
  count(*) filter(where not ('METRIC_NOT_ACTIVE'=any(drill_reason_codes)))=0
  and count(*) filter(
    where projection_status='SHADOW'
      and not ('PROJECTION_SHADOW'=any(drill_reason_codes))
  )=0
  and count(*) filter(
    where projection_status='BLOCKED'
      and not ('PROJECTION_BLOCKED'=any(drill_reason_codes))
  )=0
  and count(*) filter(where cardinality(blocker_codes)=0)=0
) as current_blockers_preserved
from analytics.get_metric_drill_access()
\gset
\if :current_blockers_preserved
\else
  \echo 'metric drill access reasons or governed blocker codes were not preserved'
  \quit 1
\endif

select (count(distinct read_at)=1 and min(read_at) is not null) as one_server_read_timestamp
from analytics.get_metric_drill_access()
\gset
\if :one_server_read_timestamp
\else
  \echo 'metric drill access rows do not share one server read timestamp'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000002',false);
select (count(*)=10) as admin_received_ten_drill_rows
from analytics.get_metric_drill_access()
\gset
\if :admin_received_ten_drill_rows
\else
  \echo 'admin did not receive exactly ten metric drill access rows'
  \quit 1
\endif

reset role;

update analytics.metric_definition
set status='ACTIVE'
where metric_key='fill_rate' and metric_version=1;

update analytics.metric_projection_readiness
set projection_status='READY'
where metric_key='fill_rate' and metric_version=1;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',false);

select (
  drill_capability='AVAILABLE'
  and authorised_dimension_keys=declared_dimension_keys
  and cardinality(authorised_dimension_keys)>0
  and cardinality(drill_reason_codes)=0
) as ready_active_metric_received_authority
from analytics.get_metric_drill_access()
where metric_key='fill_rate'
\gset
\if :ready_active_metric_received_authority
\else
  \echo 'ACTIVE READY metric with governed dimensions did not receive drill authority'
  \quit 1
\endif

reset role;

update analytics.metric_projection_readiness
set supported_dimension_keys='{}'::text[]
where metric_key='fill_rate' and metric_version=1;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000001',false);

select (
  drill_capability='UNAVAILABLE'
  and cardinality(authorised_dimension_keys)=0
  and cardinality(declared_dimension_keys)=0
  and 'NO_SUPPORTED_DIMENSIONS'=any(drill_reason_codes)
) as ready_metric_without_dimensions_failed_closed
from analytics.get_metric_drill_access()
where metric_key='fill_rate'
\gset
\if :ready_metric_without_dimensions_failed_closed
\else
  \echo 'READY metric without governed dimensions did not fail closed'
  \quit 1
\endif

reset role;
rollback;
