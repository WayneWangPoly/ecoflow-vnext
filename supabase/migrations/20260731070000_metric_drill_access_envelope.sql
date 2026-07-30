-- INTEL-DATA-005A: governed Metric Drill Access Envelope.
--
-- This package exposes drill-authority metadata only. It does not read KPI values,
-- fact rows, projection rows, affected entities, or breakdown values. A metric is
-- drillable only when its registry status is ACTIVE, its projection is READY, and
-- at least one governed dimension has been declared.

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
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'METRIC_DRILL_ACCESS_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

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
  select
    r.metric_key,
    r.metric_version,
    d.display_name,
    d.status as metric_status,
    r.projection_status,
    case
      when d.status='ACTIVE'
       and r.projection_status='READY'
       and cardinality(r.supported_dimension_keys)>0
        then 'AVAILABLE'
      else 'UNAVAILABLE'
    end as drill_capability,
    case
      when d.status='ACTIVE'
       and r.projection_status='READY'
       and cardinality(r.supported_dimension_keys)>0
        then r.supported_dimension_keys
      else '{}'::text[]
    end as authorised_dimension_keys,
    r.supported_dimension_keys as declared_dimension_keys,
    r.blocker_codes,
    array_remove(array[
      case when d.status<>'ACTIVE' then 'METRIC_NOT_ACTIVE' end,
      case when r.projection_status<>'READY'
        then 'PROJECTION_'||r.projection_status end,
      case when cardinality(r.supported_dimension_keys)=0
        then 'NO_SUPPORTED_DIMENSIONS' end
    ]::text[],null) as drill_reason_codes,
    greatest(r.updated_at,d.updated_at) as readiness_updated_at,
    v_read_at as read_at
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

revoke all on function analytics.get_metric_drill_access()
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_metric_drill_access()
  to authenticated;

comment on function analytics.get_metric_drill_access() is
  'Active Owner/Admin bounded read-only drill-authority metadata for the ten initial Operational Pulse metrics. Returns no KPI values, facts, breakdowns, or affected entities.';

notify pgrst,'reload schema';

commit;
