\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_kpi_test_expect_error(
  p_sql text,
  p_marker text default null
)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_KPI_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_KPI_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if p_marker is not null and position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_KPI_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_kpi_test_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_kpi_test_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_object text;
begin
  foreach v_object in array array[
    'analytics.metric_projection_readiness',
    'analytics.metric_order_status_policy',
    'analytics.v_initial_kpi_line_projection_internal',
    'analytics.v_initial_kpi_reconciliation_internal'
  ]
  loop
    if to_regclass(v_object) is null then
      raise exception 'initial KPI object missing: %',v_object;
    end if;
  end loop;

  if to_regprocedure(
       'analytics.get_initial_kpi_shadow_projection(text,date,date)'
     ) is null
     or to_regprocedure(
       'analytics.get_initial_kpi_reconciliation(text,date,date)'
     ) is null then
    raise exception 'initial KPI read RPC missing';
  end if;

  if exists(
    select 1 from analytics.metric_definition
    where metric_key in (
      'revenue','gross_margin','fill_rate','substitution_rate',
      'on_time_delivery_rate','stockout_risk_count','dead_stock_value',
      'lines_picked_per_hour','inventory_days_of_cover','customer_concentration'
    ) and status<>'DRAFT'
  ) then
    raise exception 'initial KPI package activated a metric';
  end if;

  if (select projection_status from analytics.metric_projection_readiness
      where metric_key='fill_rate' and metric_version=1)<>'SHADOW'
     or (select projection_status from analytics.metric_projection_readiness
      where metric_key='substitution_rate' and metric_version=1)<>'SHADOW' then
    raise exception 'fill/substitution projections are not shadow-only';
  end if;

  if not ('ORDER_CURRENCY_NOT_CAPTURED'=any(
      (select blocker_codes from analytics.metric_projection_readiness
       where metric_key='revenue' and metric_version=1)
    )) then
    raise exception 'revenue currency blocker missing';
  end if;

  if (select count(*) from analytics.metric_order_status_policy
      where source_system='ORDERMENTUM')<>2
     or exists(
       select 1 from analytics.metric_order_status_policy
       where source_status_key<>'ACCEPTED'
     ) then
    raise exception 'v1 status policy guessed unsupported source statuses';
  end if;

  if has_table_privilege(
       'authenticated','analytics.v_initial_kpi_line_projection_internal','SELECT'
     )
     or has_table_privilege(
       'authenticated','analytics.v_initial_kpi_reconciliation_internal','SELECT'
     ) then
    raise exception 'internal KPI views are browser-readable';
  end if;

  if not has_table_privilege(
       'service_role','analytics.v_initial_kpi_line_projection_internal','SELECT'
     )
     or not has_table_privilege(
       'service_role','analytics.v_initial_kpi_reconciliation_internal','SELECT'
     ) then
    raise exception 'service role cannot inspect internal KPI projections';
  end if;

  if has_function_privilege(
       'anon','analytics.get_initial_kpi_shadow_projection(text,date,date)','EXECUTE'
     )
     or has_function_privilege(
       'anon','analytics.get_initial_kpi_reconciliation(text,date,date)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_initial_kpi_shadow_projection(text,date,date)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_initial_kpi_reconciliation(text,date,date)','EXECUTE'
     ) then
    raise exception 'initial KPI RPC execute ACL is incorrect';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('91000000-0000-0000-0000-000000000001','kpi-owner@example.test'),
  ('91000000-0000-0000-0000-000000000002','kpi-viewer@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('91000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('91000000-0000-0000-0000-000000000002','VIEWER',true,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,
    team_status=excluded.team_status;

update analytics.refresh_status
set status='CURRENT',
    as_of_at='2026-07-29 12:00:00+09:30',
    last_succeeded_at='2026-07-29 12:00:00+09:30',
    updated_at='2026-07-29 12:00:00+09:30'
where dataset_key in ('analytics.order_lines','analytics.fulfilment_lines');

insert into analytics.fact_order_line(
  source_system,source_order_key,source_order_line_id,source_order_line_key,
  requested_delivery_date,order_status,source_commercial_sku_key,
  commercial_sku_code,commercial_product_name,ordered_quantity,ordered_unit,
  line_type,source_version_hash,quality_status,effective_from,is_current,
  first_observed_at,last_observed_at,as_of_at
)
values
  (
    'ORDERMENTUM','KPI-O1','L1','KPI-O1:L1','2026-07-29','Accepted',
    'SKU-1','SKU-1','KPI Product 1',10,'CARTON','STOCK',repeat('a',64),
    'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O2','L1','KPI-O2:L1','2026-07-29','Accepted',
    'SKU-2','SKU-2','KPI Product 2',5,'EACH','STOCK',repeat('b',64),
    'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O3','L1','KPI-O3:L1','2026-07-29','Accepted',
    'SERVICE-1','SERVICE-1','Delivery Fee',1,'EACH','SERVICE',repeat('c',64),
    'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O4','L1','KPI-O4:L1','2026-07-29','Pending',
    'SKU-4','SKU-4','Unclassified Status Product',4,'CARTON','STOCK',
    repeat('d',64),'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O5','L1','KPI-O5:L1','2026-07-29','Accepted',
    'SKU-5','SKU-5','Degraded Product',3,'CARTON','STOCK',repeat('e',64),
    'DEGRADED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O6','L1','KPI-O6:L1','2026-07-29','Accepted',
    'SKU-6','SKU-6','Overfulfilled Product',3,'CARTON','STOCK',repeat('f',64),
    'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O7','L1','KPI-O7:L1','2026-07-29','Accepted',
    'SKU-7','SKU-7','Unit Mismatch Product',3,'CARTON','STOCK',repeat('1',64),
    'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    'ORDERMENTUM','KPI-O8','L1','KPI-O8:L1','2026-07-29','accepted',
    'SKU-8','SKU-8','Case Normalisation Product',2,'CARTON','STOCK',
    repeat('2',64),'TRUSTED','2026-07-29 10:00:00+09:30',true,
    '2026-07-29 10:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  );

insert into analytics.fact_fulfilment_line(
  allocation_id,source_system,source_order_key,source_order_line_id,
  source_order_line_key,source_commercial_sku_key,commercial_sku_code,
  commercial_product_name,source_physical_sku_key,physical_sku_code,
  physical_product_name,fulfilled_quantity,fulfilled_unit,actual_unit_cost,
  currency_code,allocation_type,substitution_flag,substitution_reason,
  approved_equivalence_context,allocation_status,occurred_at,source_revision,
  source_row_hash,first_observed_at,last_observed_at,as_of_at
)
values
  (
    '92000000-0000-0000-0000-000000000001','ORDERMENTUM','KPI-O1','L1',
    'KPI-O1:L1','SKU-1','SKU-1','KPI Product 1','PHYS-1A','PHYS-1A',
    'Physical Product 1A',6,'CARTON',6.5,'AUD','PRIMARY',false,null,
    '{}'::jsonb,'ACTIVE','2026-07-29 11:00:00+09:30',1,repeat('3',64),
    '2026-07-29 11:00:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    '92000000-0000-0000-0000-000000000002','ORDERMENTUM','KPI-O1','L1',
    'KPI-O1:L1','SKU-1','SKU-1','KPI Product 1','PHYS-1B','PHYS-1B',
    'Physical Product 1B',2,'CARTON',6.7,'AUD','APPROVED_SUBSTITUTE',true,
    'primary stock unavailable','{}'::jsonb,'ACTIVE',
    '2026-07-29 11:05:00+09:30',1,repeat('4',64),
    '2026-07-29 11:05:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    '92000000-0000-0000-0000-000000000006','ORDERMENTUM','KPI-O6','L1',
    'KPI-O6:L1','SKU-6','SKU-6','Overfulfilled Product','PHYS-6','PHYS-6',
    'Physical Product 6',4,'CARTON',null,'AUD','PRIMARY',false,null,
    '{}'::jsonb,'ACTIVE','2026-07-29 11:10:00+09:30',1,repeat('5',64),
    '2026-07-29 11:10:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    '92000000-0000-0000-0000-000000000007','ORDERMENTUM','KPI-O7','L1',
    'KPI-O7:L1','SKU-7','SKU-7','Unit Mismatch Product','PHYS-7','PHYS-7',
    'Physical Product 7',2,'EACH',null,'AUD','PRIMARY',false,null,
    '{}'::jsonb,'ACTIVE','2026-07-29 11:15:00+09:30',1,repeat('6',64),
    '2026-07-29 11:15:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  ),
  (
    '92000000-0000-0000-0000-000000000008','ORDERMENTUM','KPI-O8','L1',
    'KPI-O8:L1','SKU-8','SKU-8','Case Normalisation Product','PHYS-8','PHYS-8',
    'Physical Product 8',2,'CARTON',null,'AUD','PRIMARY',false,null,
    '{}'::jsonb,'ACTIVE','2026-07-29 11:20:00+09:30',1,repeat('7',64),
    '2026-07-29 11:20:00+09:30','2026-07-29 12:00:00+09:30',
    '2026-07-29 12:00:00+09:30'
  );

do $projection_values$
begin
  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where metric_key='fill_rate' and source_order_line_key='KPI-O1:L1'
      and projection_state='SHADOW_READY'
      and numerator_quantity=8 and denominator_quantity=10
      and metric_value_percent=80
  ) then
    raise exception 'fill rate shadow value is not 80 percent';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where metric_key='substitution_rate' and source_order_line_key='KPI-O1:L1'
      and projection_state='SHADOW_READY'
      and numerator_quantity=2 and denominator_quantity=8
      and metric_value_percent=25
  ) then
    raise exception 'substitution shadow value is not 25 percent';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where metric_key='fill_rate' and source_order_line_key='KPI-O2:L1'
      and projection_state='SHADOW_READY'
      and numerator_quantity=0 and denominator_quantity=5
      and metric_value_percent=0
  ) then
    raise exception 'confirmed zero numerator was not represented as real zero';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where metric_key='substitution_rate' and source_order_line_key='KPI-O2:L1'
      and projection_state='EMPTY'
      and blocker_code='ZERO_FULFILLED_DENOMINATOR'
      and metric_value_percent is null
  ) then
    raise exception 'zero substitution denominator was silently converted to zero';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where metric_key='substitution_rate' and source_order_line_key='KPI-O8:L1'
      and projection_state='SHADOW_READY'
      and numerator_quantity=0 and denominator_quantity=2
      and metric_value_percent=0
  ) then
    raise exception 'valid zero substitution numerator was not represented as zero';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where source_order_line_key='KPI-O3:L1'
      and projection_state='EXCLUDED'
      and blocker_code='SERVICE_LINE_EXCLUDED'
      and metric_value_percent is null
  ) then
    raise exception 'service line was not excluded';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where source_order_line_key='KPI-O4:L1'
      and projection_state='UNAVAILABLE'
      and blocker_code='ORDER_STATUS_UNCLASSIFIED'
      and metric_value_percent is null
  ) then
    raise exception 'unknown order status did not fail closed';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where source_order_line_key='KPI-O5:L1'
      and projection_state='UNAVAILABLE'
      and blocker_code='ORDER_FACT_DEGRADED'
      and metric_value_percent is null
  ) then
    raise exception 'degraded order fact did not fail closed';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where source_order_line_key='KPI-O6:L1'
      and projection_state='UNAVAILABLE'
      and blocker_code='OVERFULFILLED_SOURCE_LINE'
      and metric_value_percent is null
  ) then
    raise exception 'overfulfilment did not fail closed';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where source_order_line_key='KPI-O7:L1'
      and projection_state='UNAVAILABLE'
      and blocker_code='FULFILMENT_UNIT_MISMATCH'
      and metric_value_percent is null
  ) then
    raise exception 'unit mismatch did not fail closed';
  end if;
end;
$projection_values$;

do $reconciliation$
begin
  if exists(
    select 1 from analytics.v_initial_kpi_reconciliation_internal
    where source_order_line_key in ('KPI-O1:L1','KPI-O2:L1','KPI-O8:L1')
      and projection_state='SHADOW_READY'
      and reconciliation_state<>'MATCHED'
  ) then
    raise exception 'a comparable initial KPI line did not reconcile';
  end if;

  if not exists(
    select 1 from analytics.v_initial_kpi_reconciliation_internal
    where metric_key='substitution_rate'
      and source_order_line_key='KPI-O2:L1'
      and reconciliation_state='NOT_COMPARABLE'
  ) then
    raise exception 'empty denominator line was incorrectly reconciled as a KPI';
  end if;
end;
$reconciliation$;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',false);

select public.ecoflow_kpi_test_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_projection(
    'fill_rate','2026-07-29','2026-07-29'
  )$$,
  'INITIAL_KPI_OWNER_ROLE_REQUIRED'
);

select (count(*)=0) as viewer_readiness_hidden
from analytics.metric_projection_readiness
\gset
\if :viewer_readiness_hidden
\else
  \echo 'viewer could read DRAFT KPI readiness rows'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',false);

select (count(*)=8) as owner_fill_rpc_count
from analytics.get_initial_kpi_shadow_projection(
  'fill_rate','2026-07-29','2026-07-29'
)
\gset
\if :owner_fill_rpc_count
\else
  \echo 'owner did not receive bounded fill-rate shadow rows'
  \quit 1
\endif

select (count(*)>=10) as owner_readiness_visible
from analytics.metric_projection_readiness
\gset
\if :owner_readiness_visible
\else
  \echo 'owner could not read KPI readiness blockers'
  \quit 1
\endif

select public.ecoflow_kpi_test_expect_error(
  $$select * from analytics.get_initial_kpi_shadow_projection(
    'revenue','2026-07-29','2026-07-29'
  )$$,
  'INITIAL_KPI_METRIC_NOT_AVAILABLE'
);
select public.ecoflow_kpi_test_expect_error(
  $$select * from analytics.get_initial_kpi_reconciliation(
    'fill_rate','2025-01-01','2026-07-29'
  )$$,
  'INITIAL_KPI_DATE_RANGE_TOO_LARGE'
);
reset role;

update analytics.refresh_status
set status='STALE',updated_at='2026-07-29 12:05:00+09:30'
where dataset_key='analytics.fulfilment_lines';

do $stale_fail_closed$
begin
  if not exists(
    select 1 from analytics.v_initial_kpi_line_projection_internal
    where metric_key='fill_rate' and source_order_line_key='KPI-O1:L1'
      and projection_state='UNAVAILABLE'
      and blocker_code='FULFILMENT_FACTS_STALE'
      and metric_value_percent is null
  ) then
    raise exception 'stale fulfilment source did not suppress the metric value';
  end if;
end;
$stale_fail_closed$;

rollback;
