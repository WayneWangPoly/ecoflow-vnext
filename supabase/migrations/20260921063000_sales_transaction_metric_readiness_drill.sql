-- ECOFLOW-345-METRIC-DRILL-R1
-- Governed transaction-metric readiness and drill-authority extension.
--
-- Scope:
-- - add READY projection-readiness contracts for Revenue v2, Sales Orders v1,
--   and Average Revenue per Order v1;
-- - make readiness/drill RPCs choose one canonical lifecycle version per metric;
-- - extend the drill authority envelope to the two new transaction metrics
--   without adding them to the Operational Pulse KPI deck.
--
-- Explicit non-goals:
-- - no metric lifecycle mutation;
-- - no fact refresh/materialisation;
-- - no KPI value/breakdown/entity reads;
-- - no provider traffic;
-- - no browser grant on the internal transaction projection.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_target_count integer;
begin
  if to_regclass('analytics.metric_definition') is null then
    v_missing := array_append(v_missing,'analytics.metric_definition');
  end if;
  if to_regclass('analytics.metric_projection_readiness') is null then
    v_missing := array_append(v_missing,'analytics.metric_projection_readiness');
  end if;
  if to_regclass('analytics.v_sales_transaction_metric_input_internal') is null then
    v_missing := array_append(v_missing,'analytics.v_sales_transaction_metric_input_internal');
  end if;
  if to_regprocedure('analytics.reconcile_sales_transaction_metrics(date,date)') is null then
    v_missing := array_append(v_missing,'analytics.reconcile_sales_transaction_metrics(date,date)');
  end if;
  if to_regprocedure('analytics.get_metric_projection_readiness()') is null then
    v_missing := array_append(v_missing,'analytics.get_metric_projection_readiness()');
  end if;
  if to_regprocedure('analytics.get_metric_drill_access()') is null then
    v_missing := array_append(v_missing,'analytics.get_metric_drill_access()');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_active_app_role()');
  end if;
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'SALES_TRANSACTION_METRIC_DRILL_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;

  if exists(select 1 from analytics.metric_definition) then
    select count(*)
    into v_target_count
    from analytics.metric_definition
    where (metric_key='revenue' and metric_version=2)
       or (metric_key='sales_orders' and metric_version=1)
       or (metric_key='average_revenue_per_order' and metric_version=1);

    if v_target_count<>3 then
      raise exception 'SALES_TRANSACTION_METRIC_DRILL_TARGET_DEFINITIONS_MISSING: %',
        v_target_count;
    end if;
  end if;
end;
$preflight$;

insert into analytics.metric_projection_readiness(
  metric_key,metric_version,projection_status,projection_object,exact_grain,
  required_dataset_keys,supported_dimension_keys,blocked_dimension_keys,
  blocker_codes,reconciliation_tolerance,notes,updated_at
)
select
  v.metric_key,
  v.metric_version,
  'READY',
  'analytics.v_sales_transaction_metric_input_internal',
  v.exact_grain,
  array['analytics.sales_transaction_documents']::text[],
  array['date','customer','order_source']::text[],
  '{}'::text[],
  '{}'::text[],
  v.reconciliation_tolerance,
  v.notes,
  clock_timestamp()
from (
  values
    (
      'revenue'::text,
      2::integer,
      'one current eligible sales transaction document'::text,
      0::numeric,
      'Completed invoice/credit header BCSubTotal is the governed projection authority. Parked/invalid documents fail closed.'
    ),
    (
      'sales_orders'::text,
      1::integer,
      'one distinct completed-invoiced sales order within the selected transaction-date period'::text,
      0::numeric,
      'Distinct completed-invoiced source_order_number is projected from the governed transaction input. Credits never create denominator orders.'
    ),
    (
      'average_revenue_per_order'::text,
      1::integer,
      'one selected transaction-date period'::text,
      0.000001::numeric,
      'Derived ratio over the same governed Revenue v2 numerator and Sales Orders v1 denominator. Zero denominator remains NULL.'
    )
) as v(metric_key,metric_version,exact_grain,reconciliation_tolerance,notes)
join analytics.metric_definition d
  on d.metric_key=v.metric_key
 and d.metric_version=v.metric_version
on conflict(metric_key,metric_version) do update
set projection_status=excluded.projection_status,
    projection_object=excluded.projection_object,
    exact_grain=excluded.exact_grain,
    required_dataset_keys=excluded.required_dataset_keys,
    supported_dimension_keys=excluded.supported_dimension_keys,
    blocked_dimension_keys=excluded.blocked_dimension_keys,
    blocker_codes=excluded.blocker_codes,
    reconciliation_tolerance=excluded.reconciliation_tolerance,
    notes=excluded.notes,
    updated_at=excluded.updated_at;

create or replace function analytics.get_metric_projection_readiness()
returns table(
  metric_key text,
  metric_version integer,
  display_name text,
  unit_kind text,
  metric_status text,
  projection_status text,
  exact_grain text,
  required_dataset_keys text[],
  supported_dimension_keys text[],
  blocked_dimension_keys text[],
  blocker_codes text[],
  reconciliation_tolerance numeric,
  data_owner text,
  quality_policy text,
  readiness_updated_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',
      message='METRIC_READINESS_OWNER_ROLE_REQUIRED';
  end if;

  return query
  with ranked as (
    select
      r.metric_key,
      r.metric_version,
      d.display_name,
      d.unit_kind,
      d.status as metric_status,
      r.projection_status,
      r.exact_grain,
      r.required_dataset_keys,
      r.supported_dimension_keys,
      r.blocked_dimension_keys,
      r.blocker_codes,
      r.reconciliation_tolerance,
      d.data_owner,
      d.quality_policy,
      greatest(r.updated_at,d.updated_at) as readiness_updated_at,
      row_number() over(
        partition by r.metric_key
        order by
          case d.status
            when 'ACTIVE' then 1
            when 'DRAFT' then 2
            when 'DEPRECATED' then 3
            else 9
          end,
          r.metric_version desc
      ) as lifecycle_rank
    from analytics.metric_projection_readiness r
    join analytics.metric_definition d
      on d.metric_key=r.metric_key
     and d.metric_version=r.metric_version
    where r.metric_key in (
      'revenue',
      'sales_orders',
      'average_revenue_per_order',
      'gross_margin',
      'fill_rate',
      'on_time_delivery_rate',
      'stockout_risk_count',
      'dead_stock_value',
      'substitution_rate',
      'lines_picked_per_hour',
      'inventory_days_of_cover',
      'customer_concentration'
    )
  )
  select
    x.metric_key,
    x.metric_version,
    x.display_name,
    x.unit_kind,
    x.metric_status,
    x.projection_status,
    x.exact_grain,
    x.required_dataset_keys,
    x.supported_dimension_keys,
    x.blocked_dimension_keys,
    x.blocker_codes,
    x.reconciliation_tolerance,
    x.data_owner,
    x.quality_policy,
    x.readiness_updated_at
  from ranked x
  where x.lifecycle_rank=1
  order by case x.metric_key
    when 'revenue' then 1
    when 'sales_orders' then 2
    when 'average_revenue_per_order' then 3
    when 'gross_margin' then 4
    when 'fill_rate' then 5
    when 'on_time_delivery_rate' then 6
    when 'stockout_risk_count' then 7
    when 'dead_stock_value' then 8
    when 'substitution_rate' then 9
    when 'lines_picked_per_hour' then 10
    when 'inventory_days_of_cover' then 11
    when 'customer_concentration' then 12
    else 99
  end;
end;
$$;

revoke all on function analytics.get_metric_projection_readiness()
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_metric_projection_readiness()
  to authenticated;

comment on function analytics.get_metric_projection_readiness() is
  'Owner/Admin bounded current-version governance metadata for twelve drill-governed metric identities. Canonical lifecycle selection prefers ACTIVE, then DRAFT, then DEPRECATED and never returns KPI values or fact rows.';

create or replace function analytics.get_metric_drill_access()
returns table(
  metric_key text,
  metric_version integer,
  display_name text,
  metric_status text,
  projection_status text,
  drill_capability text,
  authorised_dimension_keys text[],
  declared_dimension_keys text[],
  blocker_codes text[],
  drill_reason_codes text[],
  readiness_updated_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_read_at timestamptz := statement_timestamp();
begin
  if v_user is not null then
    select p.app_role
    into v_role
    from public.app_user_profiles p
    where p.user_id=v_user
      and p.is_active=true
      and p.team_status='ACTIVE';
  end if;

  if v_user is null or v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',
      message='METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED';
  end if;

  return query
  with ranked as (
    select
      r.metric_key,
      r.metric_version,
      d.display_name,
      d.status as metric_status,
      r.projection_status,
      r.supported_dimension_keys,
      r.blocker_codes,
      greatest(r.updated_at,d.updated_at) as readiness_updated_at,
      row_number() over(
        partition by r.metric_key
        order by
          case d.status
            when 'ACTIVE' then 1
            when 'DRAFT' then 2
            when 'DEPRECATED' then 3
            else 9
          end,
          r.metric_version desc
      ) as lifecycle_rank
    from analytics.metric_projection_readiness r
    join analytics.metric_definition d
      on d.metric_key=r.metric_key
     and d.metric_version=r.metric_version
    where r.metric_key in (
      'revenue',
      'sales_orders',
      'average_revenue_per_order',
      'gross_margin',
      'fill_rate',
      'on_time_delivery_rate',
      'stockout_risk_count',
      'dead_stock_value',
      'substitution_rate',
      'lines_picked_per_hour',
      'inventory_days_of_cover',
      'customer_concentration'
    )
  )
  select
    x.metric_key,
    x.metric_version,
    x.display_name,
    x.metric_status,
    x.projection_status,
    case
      when x.metric_status='ACTIVE'
       and x.projection_status='READY'
       and cardinality(x.supported_dimension_keys)>0
        then 'AVAILABLE'
      else 'UNAVAILABLE'
    end as drill_capability,
    case
      when x.metric_status='ACTIVE'
       and x.projection_status='READY'
       and cardinality(x.supported_dimension_keys)>0
        then x.supported_dimension_keys
      else '{}'::text[]
    end as authorised_dimension_keys,
    x.supported_dimension_keys as declared_dimension_keys,
    x.blocker_codes,
    array_remove(array[
      case when x.metric_status<>'ACTIVE' then 'METRIC_NOT_ACTIVE' end,
      case when x.projection_status<>'READY'
        then 'PROJECTION_'||x.projection_status end,
      case when cardinality(x.supported_dimension_keys)=0
        then 'NO_SUPPORTED_DIMENSIONS' end
    ]::text[],null) as drill_reason_codes,
    x.readiness_updated_at,
    v_read_at as read_at
  from ranked x
  where x.lifecycle_rank=1
  order by case x.metric_key
    when 'revenue' then 1
    when 'sales_orders' then 2
    when 'average_revenue_per_order' then 3
    when 'gross_margin' then 4
    when 'fill_rate' then 5
    when 'on_time_delivery_rate' then 6
    when 'stockout_risk_count' then 7
    when 'dead_stock_value' then 8
    when 'substitution_rate' then 9
    when 'lines_picked_per_hour' then 10
    when 'inventory_days_of_cover' then 11
    when 'customer_concentration' then 12
    else 99
  end;
end;
$$;

revoke all on function analytics.get_metric_drill_access()
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_metric_drill_access()
  to authenticated;

comment on function analytics.get_metric_drill_access() is
  'Owner/Admin bounded drill-authority metadata for twelve governed metric identities. ACTIVE + READY + declared dimensions is required for AVAILABLE. Returns no KPI values, facts, breakdowns, or affected entities.';

notify pgrst,'reload schema';

commit;
