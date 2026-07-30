-- INTEL-DATA-005B: bounded Shadow-only drill evidence for the initial KPI pair.
--
-- This read model is deliberately separate from production drill authority. It exposes
-- governed evidence counts, blocker codes and bounded Order entities for Owner/Admin
-- verification while Fill Rate and Substitution Rate remain DRAFT + SHADOW. It never
-- returns KPI percentages, arithmetic quantities or operational write capabilities.

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
  if to_regclass('analytics.v_initial_kpi_line_projection_internal') is null then
    v_missing := array_append(v_missing,'analytics.v_initial_kpi_line_projection_internal');
  end if;
  if to_regclass('analytics.fact_order_line') is null then
    v_missing := array_append(v_missing,'analytics.fact_order_line');
  end if;
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create or replace function analytics.get_initial_kpi_shadow_drill_evidence(
  p_metric_key text,
  p_dimension_key text,
  p_date_from date,
  p_date_to date,
  p_breakdown_limit integer default 25,
  p_entity_limit integer default 25
)
returns table(
  metric_key text,
  metric_version integer,
  metric_status text,
  projection_status text,
  evidence_capability text,
  dimension_key text,
  dimension_value_key text,
  dimension_value_label text,
  evidence_state text,
  affected_count integer,
  line_count integer,
  shadow_ready_line_count integer,
  unavailable_line_count integer,
  empty_line_count integer,
  excluded_line_count integer,
  blocker_codes text[],
  entities jsonb,
  entities_truncated boolean,
  as_of_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_metric_key text := lower(btrim(coalesce(p_metric_key,'')));
  v_dimension_key text := lower(btrim(coalesce(p_dimension_key,'')));
  v_metric_status text;
  v_projection_status text;
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
      message='INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED';
  end if;

  if v_metric_key not in ('fill_rate','substitution_rate') then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_METRIC_NOT_AVAILABLE: %',v_metric_key;
  end if;

  if v_dimension_key not in ('date','commercial_sku') then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_DIMENSION_NOT_AVAILABLE: %',v_dimension_key;
  end if;

  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_DATE_RANGE_INVALID';
  end if;
  if p_date_to-p_date_from>366 then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_DATE_RANGE_TOO_LARGE';
  end if;
  if p_breakdown_limit is null or p_breakdown_limit<1 or p_breakdown_limit>50 then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_BREAKDOWN_LIMIT_INVALID';
  end if;
  if p_entity_limit is null or p_entity_limit<1 or p_entity_limit>100 then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_ENTITY_LIMIT_INVALID';
  end if;

  select d.status,r.projection_status
  into v_metric_status,v_projection_status
  from analytics.metric_definition d
  join analytics.metric_projection_readiness r
    on r.metric_key=d.metric_key
   and r.metric_version=d.metric_version
  where d.metric_key=v_metric_key
    and d.metric_version=1;

  if v_metric_status is distinct from 'DRAFT'
     or v_projection_status is distinct from 'SHADOW' then
    raise exception 'INITIAL_KPI_SHADOW_DRILL_GOVERNANCE_STATE_REQUIRED: metric %, projection %',
      coalesce(v_metric_status,'MISSING'),coalesce(v_projection_status,'MISSING');
  end if;

  return query
  with source_rows as (
    select
      p.metric_key,
      p.metric_version,
      p.source_order_key,
      p.source_order_line_key,
      p.metric_date,
      p.commercial_sku_code,
      o.commercial_product_name,
      o.internal_order_id,
      o.external_order_number,
      o.invoice_number,
      p.projection_state,
      p.blocker_code,
      greatest(p.order_as_of_at,p.fulfilment_as_of_at) as row_as_of_at,
      case
        when v_dimension_key='date' then coalesce(p.metric_date::text,'__missing__')
        else p.commercial_sku_code
      end as value_key,
      case
        when v_dimension_key='date' then coalesce(p.metric_date::text,'Missing date')
        else o.commercial_product_name
      end as value_label
    from analytics.v_initial_kpi_line_projection_internal p
    join analytics.fact_order_line o
      on o.source_system=p.source_system
     and o.source_order_line_key=p.source_order_line_key
     and o.is_current
    where p.metric_key=v_metric_key
      and (
        p.metric_date between p_date_from and p_date_to
        or (p.metric_date is null and p_date_from<=p_date_to)
      )
  ),
  grouped as (
    select
      s.value_key,
      min(s.value_label) as value_label,
      count(distinct s.source_order_key)::integer as affected_count,
      count(*)::integer as line_count,
      count(*) filter(where s.projection_state='SHADOW_READY')::integer
        as shadow_ready_line_count,
      count(*) filter(where s.projection_state='UNAVAILABLE')::integer
        as unavailable_line_count,
      count(*) filter(where s.projection_state='EMPTY')::integer
        as empty_line_count,
      count(*) filter(where s.projection_state='EXCLUDED')::integer
        as excluded_line_count,
      coalesce(
        array_agg(distinct s.blocker_code order by s.blocker_code)
          filter(where s.blocker_code is not null),
        '{}'::text[]
      ) as blocker_codes,
      max(s.row_as_of_at) as as_of_at
    from source_rows s
    group by s.value_key
    order by count(distinct s.source_order_key) desc,s.value_key
    limit p_breakdown_limit
  ),
  entity_candidates as (
    select distinct
      s.value_key,
      s.internal_order_id::text as entity_id,
      coalesce(nullif(btrim(s.external_order_number),''),s.source_order_key)
        as entity_label,
      nullif(btrim(coalesce(s.invoice_number,'')),'') as entity_subtitle
    from source_rows s
    join grouped g on g.value_key=s.value_key
    where s.internal_order_id is not null
  ),
  ranked_entities as (
    select
      e.*,
      row_number() over(
        partition by e.value_key
        order by e.entity_label,e.entity_id
      ) as entity_rank,
      count(*) over(partition by e.value_key)::integer as routeable_entity_count
    from entity_candidates e
  ),
  entity_payload as (
    select
      e.value_key,
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'kind','order',
          'id',e.entity_id,
          'label',e.entity_label,
          'subtitle',e.entity_subtitle
        )) order by e.entity_rank
      ) filter(where e.entity_rank<=p_entity_limit) as entities,
      max(e.routeable_entity_count)::integer as routeable_entity_count
    from ranked_entities e
    group by e.value_key
  )
  select
    v_metric_key,
    1,
    v_metric_status,
    v_projection_status,
    'SHADOW_ONLY'::text,
    v_dimension_key,
    g.value_key,
    g.value_label,
    case
      when g.unavailable_line_count>0
       and (g.shadow_ready_line_count>0 or g.empty_line_count>0) then 'PARTIAL'
      when g.unavailable_line_count>0 then 'UNAVAILABLE'
      when g.shadow_ready_line_count>0 and g.empty_line_count>0 then 'PARTIAL'
      when g.shadow_ready_line_count>0 then 'SHADOW_READY'
      when g.empty_line_count>0 then 'EMPTY'
      else 'EXCLUDED'
    end,
    g.affected_count,
    g.line_count,
    g.shadow_ready_line_count,
    g.unavailable_line_count,
    g.empty_line_count,
    g.excluded_line_count,
    g.blocker_codes,
    coalesce(e.entities,'[]'::jsonb),
    g.affected_count>coalesce(jsonb_array_length(e.entities),0),
    g.as_of_at,
    v_read_at
  from grouped g
  left join entity_payload e on e.value_key=g.value_key
  order by g.affected_count desc,g.value_key;
end;
$$;

revoke all on function analytics.get_initial_kpi_shadow_drill_evidence(
  text,text,date,date,integer,integer
) from public,anon,authenticated,service_role;
grant execute on function analytics.get_initial_kpi_shadow_drill_evidence(
  text,text,date,date,integer,integer
) to authenticated;

comment on function analytics.get_initial_kpi_shadow_drill_evidence(
  text,text,date,date,integer,integer
) is
  'Active Owner/Admin bounded Shadow-only evidence counts and Order entities for Fill Rate and Substitution Rate. It returns no KPI arithmetic and grants no production drill authority.';

notify pgrst,'reload schema';

commit;
