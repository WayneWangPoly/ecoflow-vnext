\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_metric_readiness_expect_error(
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
  raise exception 'EXPECTED_METRIC_READINESS_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_METRIC_READINESS_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_METRIC_READINESS_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_metric_readiness_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_metric_readiness_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
begin
  if to_regprocedure('analytics.get_metric_projection_readiness()') is null then
    raise exception 'metric readiness read RPC missing';
  end if;

  if has_function_privilege(
       'anon','analytics.get_metric_projection_readiness()','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_metric_projection_readiness()','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_metric_projection_readiness()','EXECUTE'
     ) then
    raise exception 'metric readiness RPC execute ACL is incorrect';
  end if;

  select pg_get_functiondef('analytics.get_metric_projection_readiness()'::regprocedure)
  into v_definition;

  if position('analytics.metric_projection_readiness' in v_definition)=0
     or position('analytics.metric_definition' in v_definition)=0 then
    raise exception 'metric readiness RPC is not sourced from governed metadata';
  end if;

  if v_definition ~* 'fact_[a-z_]+'
     or v_definition ~* 'v_initial_kpi_[a-z_]+_internal'
     or v_definition ~* 'metric_value'
     or v_definition ~* 'refresh_[a-z_]+\(' then
    raise exception 'metric readiness RPC reads facts, internal projections, values or refreshes';
  end if;

  if exists(
    select 1
    from analytics.metric_definition
    where metric_key in (
      'revenue','gross_margin','fill_rate','on_time_delivery_rate',
      'stockout_risk_count','dead_stock_value','substitution_rate',
      'lines_picked_per_hour','inventory_days_of_cover','customer_concentration'
    )
      and status<>'DRAFT'
  ) then
    raise exception 'metric readiness read package activated a metric';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('93000000-0000-0000-0000-000000000001','readiness-owner@example.test'),
  ('93000000-0000-0000-0000-000000000002','readiness-viewer@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('93000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('93000000-0000-0000-0000-000000000002','VIEWER',true,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000002',false);

select public.ecoflow_metric_readiness_expect_error(
  $$select * from analytics.get_metric_projection_readiness()$$,
  'METRIC_READINESS_OWNER_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','93000000-0000-0000-0000-000000000001',false);

select (count(*)=10) as owner_received_ten_metrics
from analytics.get_metric_projection_readiness()
\gset
\if :owner_received_ten_metrics
\else
  \echo 'owner did not receive exactly ten metric readiness rows'
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
  from analytics.get_metric_projection_readiness()
) ordered_rows
\gset
\if :canonical_metric_order
\else
  \echo 'metric readiness rows are not in canonical Operational Pulse order'
  \quit 1
\endif

select (
  count(*) filter(where projection_status='SHADOW')=2
  and count(*) filter(where projection_status='BLOCKED')=8
  and count(*) filter(where metric_status<>'DRAFT')=0
) as readiness_states_preserved
from analytics.get_metric_projection_readiness()
\gset
\if :readiness_states_preserved
\else
  \echo 'metric readiness states or DRAFT registry status changed'
  \quit 1
\endif

select (
  count(*) filter(
    where metric_key in ('fill_rate','substitution_rate')
      and projection_status='SHADOW'
      and cardinality(blocker_codes)>0
  )=2
  and count(*) filter(
    where projection_status='BLOCKED'
      and cardinality(blocker_codes)>0
  )=8
) as blocker_codes_preserved
from analytics.get_metric_projection_readiness()
\gset
\if :blocker_codes_preserved
\else
  \echo 'shadow or blocked readiness rows lost blocker codes'
  \quit 1
\endif

select (
  count(*) filter(where display_name is null or btrim(display_name)='')=0
  and count(*) filter(where unit_kind is null or btrim(unit_kind)='')=0
  and count(*) filter(where exact_grain is null or btrim(exact_grain)='')=0
) as governed_metadata_present
from analytics.get_metric_projection_readiness()
\gset
\if :governed_metadata_present
\else
  \echo 'metric readiness read model lost governed display metadata'
  \quit 1
\endif

reset role;
rollback;
