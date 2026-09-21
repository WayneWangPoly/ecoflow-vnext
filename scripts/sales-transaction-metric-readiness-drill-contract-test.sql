\set ON_ERROR_STOP on

begin;

do $structure$
declare
  v_readiness_definition text;
  v_drill_definition text;
begin
  if to_regprocedure('analytics.get_metric_projection_readiness()') is null
     or to_regprocedure('analytics.get_metric_drill_access()') is null then
    raise exception 'transaction metric readiness/drill RPCs missing';
  end if;

  if has_function_privilege('anon','analytics.get_metric_projection_readiness()','EXECUTE')
     or has_function_privilege('service_role','analytics.get_metric_projection_readiness()','EXECUTE')
     or not has_function_privilege('authenticated','analytics.get_metric_projection_readiness()','EXECUTE')
     or has_function_privilege('anon','analytics.get_metric_drill_access()','EXECUTE')
     or has_function_privilege('service_role','analytics.get_metric_drill_access()','EXECUTE')
     or not has_function_privilege('authenticated','analytics.get_metric_drill_access()','EXECUTE') then
    raise exception 'transaction metric governance RPC ACL widened';
  end if;

  if (select count(*) from analytics.metric_projection_readiness
      where (metric_key='revenue' and metric_version=2)
         or (metric_key='sales_orders' and metric_version=1)
         or (metric_key='average_revenue_per_order' and metric_version=1))<>3 then
    raise exception 'transaction metric readiness rows missing';
  end if;

  if exists(
    select 1 from analytics.metric_projection_readiness
    where ((metric_key='revenue' and metric_version=2)
        or (metric_key='sales_orders' and metric_version=1)
        or (metric_key='average_revenue_per_order' and metric_version=1))
      and (
        projection_status<>'READY'
        or projection_object<>'analytics.v_sales_transaction_metric_input_internal'
        or blocker_codes<>'{}'::text[]
        or supported_dimension_keys<>array['date','customer','order_source']::text[]
      )
  ) then
    raise exception 'transaction metric readiness contract is not READY/governed';
  end if;

  if not exists(
    select 1 from analytics.metric_projection_readiness
    where metric_key='revenue' and metric_version=1 and projection_status='BLOCKED'
  ) then
    raise exception 'historical Revenue v1 readiness was overwritten';
  end if;

  select pg_get_functiondef('analytics.get_metric_projection_readiness()'::regprocedure)
  into v_readiness_definition;
  select pg_get_functiondef('analytics.get_metric_drill_access()'::regprocedure)
  into v_drill_definition;

  if position('row_number() over' in lower(v_readiness_definition))=0
     or position('row_number() over' in lower(v_drill_definition))=0
     or position('when ''ACTIVE'' then 1' in v_readiness_definition)=0
     or position('when ''ACTIVE'' then 1' in v_drill_definition)=0 then
    raise exception 'canonical metric lifecycle ranking missing';
  end if;

  if v_drill_definition ~* 'fact_[a-z_]+'
     or v_drill_definition ~* 'metric_value'
     or v_drill_definition ~* 'breakdown'
     or v_drill_definition ~* 'affected_entit'
     or v_drill_definition ~* 'refresh_[a-z_]+\(' then
    raise exception 'drill authority RPC reads values/facts or refreshes';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values ('97000000-0000-0000-0000-000000000001','transaction-drill-owner@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values ('97000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',false);

select (count(*)=12) as readiness_has_twelve_current_metric_rows
from analytics.get_metric_projection_readiness()
\gset
\if :readiness_has_twelve_current_metric_rows
\else
  \echo 'canonical readiness did not return twelve metric identities'
  \quit 1
\endif

select (
  array_agg(metric_key order by sequence_no)=array[
    'revenue','sales_orders','average_revenue_per_order','gross_margin','fill_rate',
    'on_time_delivery_rate','stockout_risk_count','dead_stock_value','substitution_rate',
    'lines_picked_per_hour','inventory_days_of_cover','customer_concentration'
  ]::text[]
) as canonical_readiness_order
from (
  select metric_key,row_number() over() sequence_no
  from analytics.get_metric_projection_readiness()
) q
\gset
\if :canonical_readiness_order
\else
  \echo 'canonical readiness order changed'
  \quit 1
\endif

select (
  metric_version=2
  and projection_status='READY'
  and metric_status='DRAFT'
) as revenue_v2_selected_over_legacy_v1
from analytics.get_metric_projection_readiness()
where metric_key='revenue'
\gset
\if :revenue_v2_selected_over_legacy_v1
\else
  \echo 'Revenue v2 was not selected as canonical DRAFT version'
  \quit 1
\endif

select (
  count(*)=12
  and count(*) filter(where metric_key in ('revenue','sales_orders','average_revenue_per_order')
                      and projection_status='READY'
                      and drill_capability='UNAVAILABLE'
                      and 'METRIC_NOT_ACTIVE'=any(drill_reason_codes))=3
) as draft_transaction_metrics_fail_closed
from analytics.get_metric_drill_access()
\gset
\if :draft_transaction_metrics_fail_closed
\else
  \echo 'DRAFT transaction metrics unexpectedly gained drill authority'
  \quit 1
\endif

reset role;

update analytics.metric_definition
set status='DEPRECATED'
where metric_key='revenue' and metric_version=1;

update analytics.metric_definition
set status='ACTIVE'
where (metric_key='revenue' and metric_version=2)
   or (metric_key='sales_orders' and metric_version=1)
   or (metric_key='average_revenue_per_order' and metric_version=1);

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',false);

select (
  count(*)=3
  and count(*) filter(where metric_status='ACTIVE' and projection_status='READY')=3
) as lifecycle_cutover_visible_in_readiness
from analytics.get_metric_projection_readiness()
where metric_key in ('revenue','sales_orders','average_revenue_per_order')
\gset
\if :lifecycle_cutover_visible_in_readiness
\else
  \echo 'ACTIVE transaction metric lifecycle was not reflected in readiness'
  \quit 1
\endif

select (
  count(*)=3
  and count(*) filter(where drill_capability='AVAILABLE')=3
  and count(*) filter(where authorised_dimension_keys=array['date','customer','order_source']::text[])=3
  and count(*) filter(where cardinality(drill_reason_codes)=0)=3
) as active_ready_transaction_metrics_gain_bounded_drill_authority
from analytics.get_metric_drill_access()
where metric_key in ('revenue','sales_orders','average_revenue_per_order')
\gset
\if :active_ready_transaction_metrics_gain_bounded_drill_authority
\else
  \echo 'ACTIVE READY transaction metrics did not gain exact bounded drill authority'
  \quit 1
\endif

select (
  count(*)=1
  and min(metric_version)=2
  and max(metric_version)=2
) as deprecated_revenue_v1_hidden_from_current_envelope
from analytics.get_metric_drill_access()
where metric_key='revenue'
\gset
\if :deprecated_revenue_v1_hidden_from_current_envelope
\else
  \echo 'deprecated Revenue v1 leaked into current drill envelope'
  \quit 1
\endif

select (count(distinct read_at)=1 and min(read_at) is not null) as one_server_read_timestamp
from analytics.get_metric_drill_access()
\gset
\if :one_server_read_timestamp
\else
  \echo 'transaction metric drill rows do not share one server timestamp'
  \quit 1
\endif

reset role;

do $non_mutation$
begin
  if exists(
    select 1 from analytics.fact_sales_transaction_document
  ) or exists(
    select 1 from analytics.fact_sales_transaction_line
  ) then
    raise exception 'readiness/drill engineering materialised transaction facts';
  end if;
end;
$non_mutation$;

rollback;
