-- INTEL-KPI-001: initial governed KPI projections and reconciliation.
--
-- This package does not activate a metric, refresh facts, backfill production, or
-- infer missing business semantics. Fill rate and substitution rate are exposed
-- only as Owner/Admin shadow projections at one current stock order-line grain.
-- All other initial metrics retain explicit blockers until their source contracts
-- exist. Unknown order statuses, stale sources, mixed units, degraded facts and
-- over-fulfilment fail closed with a null metric value.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('analytics.metric_definition') is null then
    v_missing := array_append(v_missing,'analytics.metric_definition');
  end if;
  if to_regclass('analytics.refresh_status') is null then
    v_missing := array_append(v_missing,'analytics.refresh_status');
  end if;
  if to_regclass('analytics.fact_order_line') is null then
    v_missing := array_append(v_missing,'analytics.fact_order_line');
  end if;
  if to_regclass('analytics.fact_fulfilment_line') is null then
    v_missing := array_append(v_missing,'analytics.fact_fulfilment_line');
  end if;
  if to_regclass('analytics.v_order_fulfilment_coverage') is null then
    v_missing := array_append(v_missing,'analytics.v_order_fulfilment_coverage');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_active_app_role()');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'INITIAL_KPI_PROJECTION_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create table analytics.metric_projection_readiness (
  metric_key text not null,
  metric_version integer not null,
  projection_status text not null,
  projection_object text,
  exact_grain text not null,
  required_dataset_keys text[] not null default '{}'::text[],
  supported_dimension_keys text[] not null default '{}'::text[],
  blocked_dimension_keys text[] not null default '{}'::text[],
  blocker_codes text[] not null default '{}'::text[],
  reconciliation_tolerance numeric not null default 0,
  notes text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(metric_key,metric_version),
  foreign key(metric_key,metric_version)
    references analytics.metric_definition(metric_key,metric_version),
  constraint metric_projection_status check (
    projection_status in ('SHADOW','BLOCKED','READY')
  ),
  constraint metric_projection_grain_not_blank check (btrim(exact_grain)<>''),
  constraint metric_projection_tolerance_nonnegative check (
    reconciliation_tolerance>=0
  ),
  constraint metric_projection_ready_object check (
    projection_status='BLOCKED' or nullif(btrim(coalesce(projection_object,'')),'') is not null
  ),
  constraint metric_projection_blocked_has_reason check (
    projection_status<>'BLOCKED' or cardinality(blocker_codes)>0
  )
);

create table analytics.metric_order_status_policy (
  metric_key text not null,
  metric_version integer not null,
  source_system text not null,
  source_status_key text not null,
  eligibility text not null,
  normalized_category text not null,
  policy_reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(metric_key,metric_version,source_system,source_status_key),
  foreign key(metric_key,metric_version)
    references analytics.metric_definition(metric_key,metric_version),
  constraint metric_order_status_key_not_blank check (
    btrim(source_system)<>'' and btrim(source_status_key)<>''
  ),
  constraint metric_order_status_eligibility check (
    eligibility in ('INCLUDE','EXCLUDE')
  ),
  constraint metric_order_status_category_not_blank check (
    btrim(normalized_category)<>'' and btrim(policy_reason)<>''
  )
);

alter table analytics.metric_projection_readiness enable row level security;
alter table analytics.metric_order_status_policy enable row level security;

revoke all on table analytics.metric_projection_readiness
  from public,anon,authenticated,service_role;
revoke all on table analytics.metric_order_status_policy
  from public,anon,authenticated,service_role;

grant select on table analytics.metric_projection_readiness
  to authenticated,service_role;
grant select on table analytics.metric_order_status_policy
  to authenticated,service_role;

create policy metric_projection_readiness_owner_read
on analytics.metric_projection_readiness
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));

create policy metric_order_status_policy_owner_read
on analytics.metric_order_status_policy
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));

insert into analytics.metric_projection_readiness(
  metric_key,metric_version,projection_status,projection_object,exact_grain,
  required_dataset_keys,supported_dimension_keys,blocked_dimension_keys,
  blocker_codes,reconciliation_tolerance,notes
)
values
  (
    'fill_rate',1,'SHADOW','analytics.v_initial_kpi_line_projection_internal',
    'one current eligible stock order line',
    array['analytics.order_lines','analytics.fulfilment_lines'],
    array['date','commercial_sku'],array['customer','store'],
    array[
      'PRODUCTION_FACT_REFRESH_NOT_ESTABLISHED',
      'FULFILMENT_CAPTURE_COVERAGE_NOT_ESTABLISHED',
      'CUSTOMER_STORE_DIMENSIONS_NOT_PROJECTED'
    ],0.0001,
    'Shadow only. Missing explicit fulfilment remains visible but cannot be promoted until capture coverage is independently established.'
  ),
  (
    'substitution_rate',1,'SHADOW','analytics.v_initial_kpi_line_projection_internal',
    'one current eligible stock order line with active fulfilment allocations',
    array['analytics.order_lines','analytics.fulfilment_lines'],
    array['date','commercial_sku','physical_sku'],
    array['customer','supplier','brand'],
    array[
      'PRODUCTION_FACT_REFRESH_NOT_ESTABLISHED',
      'FULFILMENT_CAPTURE_COVERAGE_NOT_ESTABLISHED',
      'CUSTOMER_SUPPLIER_BRAND_DIMENSIONS_NOT_PROJECTED'
    ],0.0001,
    'Shadow only. Zero fulfilled quantity is EMPTY, not zero percent.'
  ),
  (
    'revenue',1,'BLOCKED',null,'one accepted order line',
    array['analytics.order_lines'],array['date','commercial_sku'],
    array['customer','store','order_source'],
    array['ORDER_CURRENCY_NOT_CAPTURED','CUSTOMER_STORE_DIMENSIONS_NOT_PROJECTED'],
    0,'No governed currency code exists on fact_order_line.'
  ),
  (
    'gross_margin',1,'BLOCKED',null,'one fulfilled physical allocation',
    array['analytics.order_lines','analytics.fulfilment_lines'],
    array['date','commercial_sku','physical_sku'],
    array['customer','store','supplier','brand'],
    array['ORDER_CURRENCY_NOT_CAPTURED','ACTUAL_COST_COVERAGE_NOT_ESTABLISHED'],
    0,'Margin cannot be projected while sales currency and cost coverage are incomplete.'
  ),
  (
    'on_time_delivery_rate',1,'BLOCKED',null,'one eligible delivery stop',
    array['analytics.delivery_stops'],array['date','route','driver'],
    array['customer','store'],array['PROMISED_TIME_NOT_CAPTURED'],0,
    'Execution timestamps do not establish the promised-time denominator.'
  ),
  (
    'stockout_risk_count',1,'BLOCKED',null,'one commercial SKU snapshot',
    array['analytics.daily_inventory_snapshot'],array['date','commercial_sku'],
    array['supplier','brand','warehouse_location'],
    array['APPROVED_COVERAGE_THRESHOLD_NOT_GOVERNED'],0,
    'No approved commercial-to-physical coverage threshold is active.'
  ),
  (
    'dead_stock_value',1,'BLOCKED',null,'one physical SKU location snapshot',
    array['analytics.daily_inventory_snapshot','analytics.inventory_movements'],
    array['date','physical_sku','warehouse_location'],array['supplier','brand'],
    array['HISTORICAL_INVENTORY_COST_NOT_CAPTURED','DEAD_STOCK_WINDOW_NOT_GOVERNED'],
    0,'Quantity exists, but historical cost and the inactivity window are not governed.'
  ),
  (
    'lines_picked_per_hour',1,'BLOCKED',null,'one warehouse shift',
    array['analytics.inventory_movements'],array['date','warehouse_location'],
    array['driver'],array['PRODUCTIVE_LABOUR_TIME_NOT_CAPTURED'],0,
    'Movement timestamps are not a productive labour-hour denominator.'
  ),
  (
    'inventory_days_of_cover',1,'BLOCKED',null,'one commercial SKU snapshot',
    array['analytics.daily_inventory_snapshot','analytics.order_lines'],
    array['date','commercial_sku','physical_sku'],array['supplier','brand'],
    array['DEMAND_VELOCITY_POLICY_NOT_GOVERNED','COMMERCIAL_PHYSICAL_COVERAGE_INCOMPLETE'],
    0,'Demand velocity and approved physical coverage require a separate governed policy.'
  ),
  (
    'customer_concentration',1,'BLOCKED',null,'one customer period',
    array['analytics.order_lines'],array['date'],array['customer','store'],
    array['ORDER_CURRENCY_NOT_CAPTURED','CUSTOMER_DIMENSION_NOT_PROJECTED'],0,
    'Customer attribution and currency are absent from the current order fact.'
  )
on conflict(metric_key,metric_version) do nothing;

insert into analytics.metric_order_status_policy(
  metric_key,metric_version,source_system,source_status_key,eligibility,
  normalized_category,policy_reason
)
values
  (
    'fill_rate',1,'ORDERMENTUM','ACCEPTED','INCLUDE','ACCEPTED',
    'The source fact contract explicitly exercises Accepted orders. Unlisted statuses fail closed.'
  ),
  (
    'substitution_rate',1,'ORDERMENTUM','ACCEPTED','INCLUDE','ACCEPTED',
    'The source fact contract explicitly exercises Accepted orders. Unlisted statuses fail closed.'
  )
on conflict(metric_key,metric_version,source_system,source_status_key) do nothing;

update analytics.metric_definition
set formula_description=
      'At one current eligible stock order line, active fulfilled quantity divided by ordered quantity. Cross-unit aggregation is not permitted.',
    exclusions=array[
      'service_lines','unclassified_order_statuses','non_trusted_order_rows',
      'mixed_or_mismatched_units','overfulfilled_lines'
    ],
    source_objects=array[
      'analytics.fact_order_line','analytics.fact_fulfilment_line',
      'analytics.v_initial_kpi_line_projection_internal'
    ],
    updated_at=clock_timestamp()
where metric_key='fill_rate' and metric_version=1 and status='DRAFT';

update analytics.metric_definition
set formula_description=
      'At one current eligible stock order line, substituted active fulfilled quantity divided by total active fulfilled quantity. Zero fulfilled quantity is empty.',
    grain_key='order_line',
    exclusions=array[
      'service_lines','unclassified_order_statuses','non_trusted_order_rows',
      'zero_fulfilment_lines','mixed_or_mismatched_units','overfulfilled_lines'
    ],
    source_objects=array[
      'analytics.fact_order_line','analytics.fact_fulfilment_line',
      'analytics.v_initial_kpi_line_projection_internal'
    ],
    updated_at=clock_timestamp()
where metric_key='substitution_rate' and metric_version=1 and status='DRAFT';

create or replace view analytics.v_initial_kpi_line_projection_internal
with (security_barrier=true,security_invoker=true)
as
with source_health as (
  select
    coalesce((select status from analytics.refresh_status
      where dataset_key='analytics.order_lines'),'NEVER') as order_refresh_status,
    coalesce((select status from analytics.refresh_status
      where dataset_key='analytics.fulfilment_lines'),'NEVER') as fulfilment_refresh_status
),
fulfilment as (
  select
    f.source_system,
    f.source_order_line_key,
    coalesce(sum(f.fulfilled_quantity) filter(
      where f.allocation_status='ACTIVE'
    ),0)::numeric as active_fulfilled_quantity,
    coalesce(sum(f.fulfilled_quantity) filter(
      where f.allocation_status='ACTIVE' and f.substitution_flag
    ),0)::numeric as active_substituted_quantity,
    count(*) filter(where f.allocation_status='ACTIVE')::integer
      as active_allocation_count,
    count(distinct upper(btrim(f.fulfilled_unit))) filter(
      where f.allocation_status='ACTIVE'
    )::integer as active_unit_count,
    min(upper(btrim(f.fulfilled_unit))) filter(
      where f.allocation_status='ACTIVE'
    ) as active_unit_key,
    max(f.as_of_at) filter(where f.allocation_status='ACTIVE')
      as fulfilment_as_of_at
  from analytics.fact_fulfilment_line f
  group by f.source_system,f.source_order_line_key
),
expanded as (
  select
    m.metric_key,
    m.metric_version,
    o.source_system,
    o.source_order_key,
    o.source_order_line_key,
    o.requested_delivery_date as metric_date,
    o.commercial_sku_dimension_id,
    o.commercial_sku_code,
    upper(btrim(o.ordered_unit)) as unit_key,
    upper(btrim(coalesce(o.order_status,''))) as source_status_key,
    o.line_type,
    o.ordered_quantity,
    o.quality_status as order_quality_status,
    o.as_of_at as order_as_of_at,
    coalesce(f.active_fulfilled_quantity,0) as active_fulfilled_quantity,
    coalesce(f.active_substituted_quantity,0) as active_substituted_quantity,
    coalesce(f.active_allocation_count,0) as active_allocation_count,
    coalesce(f.active_unit_count,0) as active_unit_count,
    f.active_unit_key,
    f.fulfilment_as_of_at,
    p.eligibility as order_status_eligibility,
    h.order_refresh_status,
    h.fulfilment_refresh_status
  from analytics.fact_order_line o
  cross join (values ('fill_rate'::text,1),('substitution_rate'::text,1))
    as m(metric_key,metric_version)
  cross join source_health h
  left join fulfilment f
    on f.source_system=o.source_system
   and f.source_order_line_key=o.source_order_line_key
  left join analytics.metric_order_status_policy p
    on p.metric_key=m.metric_key
   and p.metric_version=m.metric_version
   and p.source_system=o.source_system
   and p.source_status_key=upper(btrim(coalesce(o.order_status,'')))
  where o.is_current
),
classified as (
  select
    e.*,
    case
      when e.line_type='SERVICE' then 'EXCLUDED'
      when e.order_status_eligibility='EXCLUDE' then 'EXCLUDED'
      when e.order_refresh_status<>'CURRENT'
        or e.fulfilment_refresh_status<>'CURRENT' then 'UNAVAILABLE'
      when e.order_status_eligibility is null then 'UNAVAILABLE'
      when e.order_quality_status<>'TRUSTED' then 'UNAVAILABLE'
      when e.metric_date is null then 'UNAVAILABLE'
      when e.active_unit_count>1 then 'UNAVAILABLE'
      when e.active_fulfilled_quantity>0
        and e.active_unit_key is distinct from e.unit_key then 'UNAVAILABLE'
      when e.active_fulfilled_quantity>e.ordered_quantity then 'UNAVAILABLE'
      when e.metric_key='substitution_rate'
        and e.active_fulfilled_quantity=0 then 'EMPTY'
      else 'SHADOW_READY'
    end as projection_state,
    case
      when e.line_type='SERVICE' then 'SERVICE_LINE_EXCLUDED'
      when e.order_status_eligibility='EXCLUDE' then 'ORDER_STATUS_EXCLUDED'
      when e.order_refresh_status<>'CURRENT'
        then 'ORDER_FACTS_'||e.order_refresh_status
      when e.fulfilment_refresh_status<>'CURRENT'
        then 'FULFILMENT_FACTS_'||e.fulfilment_refresh_status
      when e.order_status_eligibility is null then 'ORDER_STATUS_UNCLASSIFIED'
      when e.order_quality_status<>'TRUSTED'
        then 'ORDER_FACT_'||e.order_quality_status
      when e.metric_date is null then 'METRIC_DATE_MISSING'
      when e.active_unit_count>1 then 'MULTIPLE_FULFILMENT_UNITS'
      when e.active_fulfilled_quantity>0
        and e.active_unit_key is distinct from e.unit_key
        then 'FULFILMENT_UNIT_MISMATCH'
      when e.active_fulfilled_quantity>e.ordered_quantity
        then 'OVERFULFILLED_SOURCE_LINE'
      when e.metric_key='substitution_rate'
        and e.active_fulfilled_quantity=0
        then 'ZERO_FULFILLED_DENOMINATOR'
      else null
    end as blocker_code
  from expanded e
)
select
  c.metric_key,
  c.metric_version,
  'one current eligible stock order line'::text as projection_grain,
  c.source_system,
  c.source_order_key,
  c.source_order_line_key,
  c.metric_date,
  c.commercial_sku_dimension_id,
  c.commercial_sku_code,
  c.unit_key,
  case
    when c.metric_key='fill_rate' then c.active_fulfilled_quantity
    else c.active_substituted_quantity
  end::numeric as numerator_quantity,
  case
    when c.metric_key='fill_rate' then c.ordered_quantity
    else c.active_fulfilled_quantity
  end::numeric as denominator_quantity,
  case
    when c.projection_state='SHADOW_READY' then round(
      100 * (
        case when c.metric_key='fill_rate'
          then c.active_fulfilled_quantity
          else c.active_substituted_quantity
        end
      ) / nullif(
        case when c.metric_key='fill_rate'
          then c.ordered_quantity
          else c.active_fulfilled_quantity
        end,
        0
      ),
      4
    )
    else null
  end::numeric as metric_value_percent,
  c.projection_state,
  c.blocker_code,
  c.source_status_key,
  c.order_quality_status,
  c.active_allocation_count,
  c.order_as_of_at,
  c.fulfilment_as_of_at,
  c.order_refresh_status,
  c.fulfilment_refresh_status
from classified c;

revoke all on table analytics.v_initial_kpi_line_projection_internal
  from public,anon,authenticated;
grant select on table analytics.v_initial_kpi_line_projection_internal
  to service_role;

create or replace view analytics.v_initial_kpi_reconciliation_internal
with (security_barrier=true,security_invoker=true)
as
with direct_substitution as (
  select
    f.source_system,
    f.source_order_line_key,
    coalesce(sum(f.fulfilled_quantity) filter(
      where f.allocation_status='ACTIVE' and f.substitution_flag
    ),0)::numeric as direct_numerator,
    coalesce(sum(f.fulfilled_quantity) filter(
      where f.allocation_status='ACTIVE'
    ),0)::numeric as direct_denominator
  from analytics.fact_fulfilment_line f
  group by f.source_system,f.source_order_line_key
),
direct as (
  select
    'fill_rate'::text as metric_key,
    c.source_system,
    c.source_order_line_key,
    c.active_fulfilled_quantity::numeric as direct_numerator,
    c.ordered_quantity::numeric as direct_denominator
  from analytics.v_order_fulfilment_coverage c
  union all
  select
    'substitution_rate'::text,
    s.source_system,
    s.source_order_line_key,
    s.direct_numerator,
    s.direct_denominator
  from direct_substitution s
)
select
  p.metric_key,
  p.metric_version,
  p.source_system,
  p.source_order_key,
  p.source_order_line_key,
  p.metric_date,
  p.unit_key,
  p.projection_state,
  p.numerator_quantity as projected_numerator,
  p.denominator_quantity as projected_denominator,
  d.direct_numerator,
  d.direct_denominator,
  case
    when p.projection_state<>'SHADOW_READY' then 'NOT_COMPARABLE'
    when d.source_order_line_key is null then 'MISMATCH'
    when abs(p.numerator_quantity-d.direct_numerator)<=r.reconciliation_tolerance
     and abs(p.denominator_quantity-d.direct_denominator)<=r.reconciliation_tolerance
      then 'MATCHED'
    else 'MISMATCH'
  end as reconciliation_state,
  case
    when d.source_order_line_key is null then 'DIRECT_PATH_ROW_MISSING'
    when p.projection_state='SHADOW_READY'
     and (
       abs(p.numerator_quantity-d.direct_numerator)>r.reconciliation_tolerance
       or abs(p.denominator_quantity-d.direct_denominator)>r.reconciliation_tolerance
     ) then 'NUMERATOR_OR_DENOMINATOR_MISMATCH'
    else null
  end as reconciliation_detail,
  greatest(p.order_as_of_at,p.fulfilment_as_of_at) as as_of_at
from analytics.v_initial_kpi_line_projection_internal p
join analytics.metric_projection_readiness r
  on r.metric_key=p.metric_key and r.metric_version=p.metric_version
left join direct d
  on d.metric_key=p.metric_key
 and d.source_system=p.source_system
 and d.source_order_line_key=p.source_order_line_key;

revoke all on table analytics.v_initial_kpi_reconciliation_internal
  from public,anon,authenticated;
grant select on table analytics.v_initial_kpi_reconciliation_internal
  to service_role;

create or replace function analytics.get_initial_kpi_shadow_projection(
  p_metric_key text,
  p_date_from date,
  p_date_to date
)
returns table(
  metric_key text,
  metric_version integer,
  projection_grain text,
  source_order_key text,
  source_order_line_key text,
  metric_date date,
  commercial_sku_code text,
  unit_key text,
  numerator_quantity numeric,
  denominator_quantity numeric,
  metric_value_percent numeric,
  projection_state text,
  blocker_code text,
  source_status_key text,
  order_as_of_at timestamptz,
  fulfilment_as_of_at timestamptz,
  order_refresh_status text,
  fulfilment_refresh_status text
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_metric_key text := lower(btrim(coalesce(p_metric_key,'')));
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',
      message='INITIAL_KPI_OWNER_ROLE_REQUIRED';
  end if;
  if v_metric_key not in ('fill_rate','substitution_rate') then
    raise exception 'INITIAL_KPI_METRIC_NOT_AVAILABLE: %',v_metric_key;
  end if;
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then
    raise exception 'INITIAL_KPI_DATE_RANGE_INVALID';
  end if;
  if p_date_to-p_date_from>366 then
    raise exception 'INITIAL_KPI_DATE_RANGE_TOO_LARGE';
  end if;

  return query
  select
    p.metric_key,p.metric_version,p.projection_grain,p.source_order_key,
    p.source_order_line_key,p.metric_date,p.commercial_sku_code,p.unit_key,
    p.numerator_quantity,p.denominator_quantity,p.metric_value_percent,
    p.projection_state,p.blocker_code,p.source_status_key,p.order_as_of_at,
    p.fulfilment_as_of_at,p.order_refresh_status,p.fulfilment_refresh_status
  from analytics.v_initial_kpi_line_projection_internal p
  where p.metric_key=v_metric_key
    and p.metric_date between p_date_from and p_date_to
  order by p.metric_date,p.source_order_line_key;
end;
$$;

create or replace function analytics.get_initial_kpi_reconciliation(
  p_metric_key text,
  p_date_from date,
  p_date_to date
)
returns table(
  metric_key text,
  metric_version integer,
  source_order_key text,
  source_order_line_key text,
  metric_date date,
  unit_key text,
  projection_state text,
  projected_numerator numeric,
  projected_denominator numeric,
  direct_numerator numeric,
  direct_denominator numeric,
  reconciliation_state text,
  reconciliation_detail text,
  as_of_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_metric_key text := lower(btrim(coalesce(p_metric_key,'')));
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',
      message='INITIAL_KPI_OWNER_ROLE_REQUIRED';
  end if;
  if v_metric_key not in ('fill_rate','substitution_rate') then
    raise exception 'INITIAL_KPI_METRIC_NOT_AVAILABLE: %',v_metric_key;
  end if;
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then
    raise exception 'INITIAL_KPI_DATE_RANGE_INVALID';
  end if;
  if p_date_to-p_date_from>366 then
    raise exception 'INITIAL_KPI_DATE_RANGE_TOO_LARGE';
  end if;

  return query
  select
    r.metric_key,r.metric_version,r.source_order_key,r.source_order_line_key,
    r.metric_date,r.unit_key,r.projection_state,r.projected_numerator,
    r.projected_denominator,r.direct_numerator,r.direct_denominator,
    r.reconciliation_state,r.reconciliation_detail,r.as_of_at
  from analytics.v_initial_kpi_reconciliation_internal r
  where r.metric_key=v_metric_key
    and r.metric_date between p_date_from and p_date_to
  order by r.metric_date,r.source_order_line_key;
end;
$$;

revoke all on function analytics.get_initial_kpi_shadow_projection(text,date,date)
  from public,anon,authenticated,service_role;
revoke all on function analytics.get_initial_kpi_reconciliation(text,date,date)
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_initial_kpi_shadow_projection(text,date,date)
  to authenticated;
grant execute on function analytics.get_initial_kpi_reconciliation(text,date,date)
  to authenticated;

comment on table analytics.metric_projection_readiness is
  'Governed activation/readiness boundary. SHADOW permits Owner/Admin review only and never activates metric_definition.';
comment on table analytics.metric_order_status_policy is
  'Metric-versioned source-status policy. Unlisted statuses fail closed.';
comment on view analytics.v_initial_kpi_line_projection_internal is
  'Service-only line-grain shadow projection. It never silently aggregates unlike units.';
comment on function analytics.get_initial_kpi_shadow_projection(text,date,date) is
  'Owner/Admin bounded read-only RPC for DRAFT shadow projections.';

notify pgrst,'reload schema';

commit;
