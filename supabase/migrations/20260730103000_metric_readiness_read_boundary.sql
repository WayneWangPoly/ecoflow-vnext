-- INTEL-DATA-003A: bounded metric readiness read model.
--
-- This package exposes governance metadata only. It does not activate metrics,
-- read fact rows, emit KPI values, refresh datasets, or change blocker policy.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('analytics.metric_definition') is null then
    v_missing := array_append(v_missing,'analytics.metric_definition');
  end if;
  if to_regclass('analytics.metric_projection_readiness') is null then
    v_missing := array_append(v_missing,'analytics.metric_projection_readiness');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_active_app_role()');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'METRIC_READINESS_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

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
    greatest(r.updated_at,d.updated_at) as readiness_updated_at
  from analytics.metric_projection_readiness r
  join analytics.metric_definition d
    on d.metric_key=r.metric_key
   and d.metric_version=r.metric_version
  where r.metric_key in (
    'revenue',
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
  order by case r.metric_key
    when 'revenue' then 1
    when 'gross_margin' then 2
    when 'fill_rate' then 3
    when 'on_time_delivery_rate' then 4
    when 'stockout_risk_count' then 5
    when 'dead_stock_value' then 6
    when 'substitution_rate' then 7
    when 'lines_picked_per_hour' then 8
    when 'inventory_days_of_cover' then 9
    when 'customer_concentration' then 10
    else 99
  end;
end;
$$;

revoke all on function analytics.get_metric_projection_readiness()
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_metric_projection_readiness()
  to authenticated;

comment on function analytics.get_metric_projection_readiness() is
  'Owner/Admin bounded read-only governance metadata for the ten initial Operational Pulse metrics. Returns no KPI values or fact rows.';

notify pgrst,'reload schema';

commit;
