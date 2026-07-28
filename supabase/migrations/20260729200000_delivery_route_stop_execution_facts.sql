-- INTEL-DATA-004: governed delivery-route and delivery-stop observations.
--
-- Durable POD, delivery exception and departure records remain authoritative.
-- ecoflow_day_state route/stop scopes are current-state observations only: they
-- are overwritten and therefore are not represented as a complete event ledger.
-- Notifications are communication evidence and never prove delivery.
-- Driver-location coordinates are intentionally excluded from these facts.
--
-- This migration does not refresh or backfill production data and does not
-- install triggers on any operational table.

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
  if to_regclass('analytics.dim_route') is null then
    v_missing := array_append(v_missing,'analytics.dim_route');
  end if;
  if to_regclass('analytics.dim_driver') is null then
    v_missing := array_append(v_missing,'analytics.dim_driver');
  end if;
  if to_regclass('public.ecoflow_day_state') is null then
    v_missing := array_append(v_missing,'public.ecoflow_day_state');
  end if;
  if to_regclass('public.ecoflow_delivery_pod_proofs') is null then
    v_missing := array_append(v_missing,'public.ecoflow_delivery_pod_proofs');
  end if;
  if to_regclass('public.ecoflow_delivery_exceptions') is null then
    v_missing := array_append(v_missing,'public.ecoflow_delivery_exceptions');
  end if;
  if to_regclass('public.ecoflow_delivery_notifications') is null then
    v_missing := array_append(v_missing,'public.ecoflow_delivery_notifications');
  end if;
  if to_regclass('public.ecoflow_delivery_notification_log') is null then
    v_missing := array_append(v_missing,'public.ecoflow_delivery_notification_log');
  end if;
  if to_regclass('public.ecoflow_driver_departure_acknowledgements') is null then
    v_missing := array_append(v_missing,'public.ecoflow_driver_departure_acknowledgements');
  end if;
  if to_regclass('public.ecoflow_driver_location_samples') is null then
    v_missing := array_append(v_missing,'public.ecoflow_driver_location_samples');
  end if;
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    v_missing := array_append(v_missing,'gen_random_uuid()');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'DELIVERY_EXECUTION_FACT_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create or replace function analytics.ecoflow_try_date(p_value text)
returns date
language plpgsql
immutable
security invoker
set search_path=pg_catalog
as $$
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  return btrim(p_value)::date;
exception when others then
  return null;
end;
$$;

create or replace function analytics.ecoflow_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path=pg_catalog
as $$
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  return btrim(p_value)::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function analytics.ecoflow_delivery_run_code(p_route_id text)
returns text
language plpgsql
immutable
security invoker
set search_path=pg_catalog
as $$
declare
  v_match text[];
  v_route text := upper(btrim(coalesce(p_route_id,'')));
begin
  if v_route='' then return 'UNASSIGNED'; end if;
  v_match := regexp_match(v_route,'^RUN-[0-9]{8}-([A-Z]+)$');
  if v_match is not null then return v_match[1]; end if;
  return 'UNASSIGNED';
end;
$$;

revoke all on function analytics.ecoflow_try_date(text)
  from public,anon,authenticated,service_role;
revoke all on function analytics.ecoflow_try_timestamptz(text)
  from public,anon,authenticated,service_role;
revoke all on function analytics.ecoflow_delivery_run_code(text)
  from public,anon,authenticated,service_role;

create table analytics.fact_delivery_route_observation(
  delivery_route_fact_id bigint generated always as identity primary key,
  source_system text not null default 'ECOFLOW',
  business_day date not null,
  run_code text not null,
  source_route_key text not null,
  source_route_id text not null,
  route_dimension_id bigint references analytics.dim_route(route_dimension_id),
  route_status text not null,
  route_locked_at timestamptz,
  route_started_at timestamptz,
  route_ended_at timestamptz,
  planned_stop_count integer not null default 0,
  departure_ack_count integer not null default 0,
  observed_driver_count integer not null default 0,
  driver_dimension_id bigint references analytics.dim_driver(driver_dimension_id),
  driver_resolution_status text not null,
  first_departure_ack_at timestamptz,
  latest_departure_ack_at timestamptz,
  location_sample_count integer not null default 0,
  route_start_sample_count integer not null default 0,
  route_end_sample_count integer not null default 0,
  stop_arrival_sample_count integer not null default 0,
  delivery_sample_count integer not null default 0,
  failed_delivery_sample_count integer not null default 0,
  first_location_sample_at timestamptz,
  latest_location_sample_at timestamptz,
  route_notice_store_count integer not null default 0,
  route_notice_sent_count integer not null default 0,
  route_notice_failed_count integer not null default 0,
  route_notice_missing_contact_count integer not null default 0,
  evidence_status text not null,
  history_completeness text not null,
  quality_status text not null,
  quality_detail text,
  source_version_hash text not null,
  source_last_observed_at timestamptz,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint delivery_route_source_key_not_blank check(
    btrim(source_route_key)<>'' and btrim(source_route_id)<>'' and btrim(run_code)<>''
  ),
  constraint delivery_route_status check(route_status in(
    'NOT_STARTED','IN_PROGRESS','COMPLETED','UNKNOWN'
  )),
  constraint delivery_route_driver_resolution check(driver_resolution_status in(
    'NONE','SINGLE','MULTIPLE'
  )),
  constraint delivery_route_evidence check(evidence_status in(
    'DAY_STATE_ONLY','DURABLE_DEPARTURE','DURABLE_LOCATION_COVERAGE',
    'MIXED_OPERATIONAL_EVIDENCE','UNASSIGNED_SOURCE'
  )),
  constraint delivery_route_history check(history_completeness in(
    'OBSERVATION_VERSIONED_CURRENT_STATE','UNASSIGNED_OBSERVATION'
  )),
  constraint delivery_route_quality check(quality_status in(
    'TRUSTED','DEGRADED','INVALID'
  )),
  constraint delivery_route_counts_nonnegative check(
    planned_stop_count>=0 and departure_ack_count>=0 and
    observed_driver_count>=0 and location_sample_count>=0 and
    route_start_sample_count>=0 and route_end_sample_count>=0 and
    stop_arrival_sample_count>=0 and delivery_sample_count>=0 and
    failed_delivery_sample_count>=0 and route_notice_store_count>=0 and
    route_notice_sent_count>=0 and route_notice_failed_count>=0 and
    route_notice_missing_contact_count>=0
  ),
  constraint delivery_route_time_order check(
    route_ended_at is null or route_started_at is null or route_ended_at>=route_started_at
  ),
  constraint delivery_route_hash check(source_version_hash~'^[0-9a-f]{64}$'),
  constraint delivery_route_effective_state check(
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to>=effective_from)
  ),
  constraint delivery_route_observation_order check(last_observed_at>=first_observed_at)
);

create unique index delivery_route_one_current
  on analytics.fact_delivery_route_observation(source_system,source_route_key)
  where is_current;
create index delivery_route_day_status
  on analytics.fact_delivery_route_observation(business_day,route_status,is_current);

create table analytics.fact_delivery_stop_observation(
  delivery_stop_fact_id bigint generated always as identity primary key,
  source_system text not null default 'ECOFLOW',
  business_day date not null,
  run_code text not null,
  source_route_key text not null,
  route_dimension_id bigint references analytics.dim_route(route_dimension_id),
  source_stop_key text not null,
  source_order_id text not null,
  order_number_observed text,
  store_name_observed text,
  route_assignment_status text not null,
  planned_stop_number integer,
  box_code text,
  recorded_stop_status text not null,
  arrived_at timestamptz,
  completed_at timestamptz,
  pod1_present boolean not null default false,
  pod2_present boolean not null default false,
  pod_proof_count integer not null default 0,
  first_pod_captured_at timestamptz,
  latest_pod_captured_at timestamptz,
  durable_exception_count integer not null default 0,
  latest_exception_outcome text,
  latest_exception_recorded_at timestamptz,
  expected_cartons numeric,
  delivered_cartons numeric,
  return_cartons numeric,
  location_event_sample_count integer not null default 0,
  stop_arrival_sample_count integer not null default 0,
  delivery_sample_count integer not null default 0,
  failed_delivery_sample_count integer not null default 0,
  notification_count integer not null default 0,
  notification_sent_count integer not null default 0,
  notification_failed_count integer not null default 0,
  notification_waiting_count integer not null default 0,
  delivery_outcome text not null,
  outcome_authority text not null,
  proof_completeness text not null,
  history_completeness text not null,
  quality_status text not null,
  quality_detail text,
  source_version_hash text not null,
  source_last_observed_at timestamptz,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint delivery_stop_keys_not_blank check(
    btrim(source_route_key)<>'' and btrim(source_stop_key)<>'' and
    btrim(source_order_id)<>'' and btrim(run_code)<>''
  ),
  constraint delivery_stop_assignment check(route_assignment_status in(
    'UNIQUE','AMBIGUOUS','UNASSIGNED'
  )),
  constraint delivery_stop_status check(recorded_stop_status in(
    'PENDING','ARRIVED','DELIVERED','FAILED','SKIPPED','UNKNOWN'
  )),
  constraint delivery_stop_outcome check(delivery_outcome in(
    'PENDING','ARRIVED','DELIVERED','DELIVERED_UNVERIFIED','PARTIAL',
    'MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED',
    'FAILED_UNVERIFIED','SKIPPED','UNKNOWN'
  )),
  constraint delivery_stop_authority check(outcome_authority in(
    'DURABLE_EXCEPTION','DAY_STATE_AND_TYPED_POD','TRANSITIONAL_DAY_STATE','NONE'
  )),
  constraint delivery_stop_proof check(proof_completeness in(
    'COMPLETE','ONLY_POD1','ONLY_POD2','MISSING'
  )),
  constraint delivery_stop_history check(history_completeness in(
    'DURABLE_TERMINAL_EVIDENCE','CURRENT_STATE_ONLY','AMBIGUOUS_ROUTE_EVIDENCE'
  )),
  constraint delivery_stop_quality check(quality_status in(
    'TRUSTED','DEGRADED','INVALID'
  )),
  constraint delivery_stop_counts_nonnegative check(
    pod_proof_count>=0 and durable_exception_count>=0 and
    location_event_sample_count>=0 and stop_arrival_sample_count>=0 and
    delivery_sample_count>=0 and failed_delivery_sample_count>=0 and
    notification_count>=0 and notification_sent_count>=0 and
    notification_failed_count>=0 and notification_waiting_count>=0
  ),
  constraint delivery_stop_cartons_nonnegative check(
    (expected_cartons is null or expected_cartons>=0) and
    (delivered_cartons is null or delivered_cartons>=0) and
    (return_cartons is null or return_cartons>=0)
  ),
  constraint delivery_stop_time_order check(
    completed_at is null or arrived_at is null or completed_at>=arrived_at
  ),
  constraint delivery_stop_hash check(source_version_hash~'^[0-9a-f]{64}$'),
  constraint delivery_stop_effective_state check(
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to>=effective_from)
  ),
  constraint delivery_stop_observation_order check(last_observed_at>=first_observed_at)
);

create unique index delivery_stop_one_current
  on analytics.fact_delivery_stop_observation(source_system,source_stop_key)
  where is_current;
create index delivery_stop_day_outcome
  on analytics.fact_delivery_stop_observation(business_day,delivery_outcome,is_current);
create index delivery_stop_order
  on analytics.fact_delivery_stop_observation(source_order_id,business_day,is_current);

alter table analytics.fact_delivery_route_observation enable row level security;
alter table analytics.fact_delivery_stop_observation enable row level security;
revoke all on table analytics.fact_delivery_route_observation
  from public,anon,authenticated,service_role;
revoke all on table analytics.fact_delivery_stop_observation
  from public,anon,authenticated,service_role;
grant select on table analytics.fact_delivery_route_observation to service_role;
grant select on table analytics.fact_delivery_stop_observation to service_role;

create or replace view analytics.v_delivery_route_observation_quality
with(security_barrier=true,security_invoker=true)
as
select
  business_day,route_status,evidence_status,history_completeness,quality_status,
  count(*)::bigint as route_version_count,
  count(*) filter(where is_current)::bigint as current_route_count,
  sum(planned_stop_count) filter(where is_current)::bigint as current_planned_stop_count,
  sum(location_sample_count) filter(where is_current)::bigint as current_location_sample_count,
  max(as_of_at) as as_of_at
from analytics.fact_delivery_route_observation
group by business_day,route_status,evidence_status,history_completeness,quality_status;

create or replace view analytics.v_delivery_stop_observation_quality
with(security_barrier=true,security_invoker=true)
as
select
  business_day,delivery_outcome,outcome_authority,proof_completeness,
  history_completeness,route_assignment_status,quality_status,
  count(*)::bigint as stop_version_count,
  count(*) filter(where is_current)::bigint as current_stop_count,
  count(*) filter(where is_current and notification_failed_count>0)::bigint
    as current_stops_with_notification_failure,
  max(as_of_at) as as_of_at
from analytics.fact_delivery_stop_observation
group by business_day,delivery_outcome,outcome_authority,proof_completeness,
  history_completeness,route_assignment_status,quality_status;

revoke all on table analytics.v_delivery_route_observation_quality
  from public,anon,authenticated;
revoke all on table analytics.v_delivery_stop_observation_quality
  from public,anon,authenticated;
grant select on table analytics.v_delivery_route_observation_quality to service_role;
grant select on table analytics.v_delivery_stop_observation_quality to service_role;

create or replace function analytics.refresh_delivery_route_stop_facts(
  p_as_of timestamptz default clock_timestamp()
)
returns table(
  refreshed_dataset_key text,
  refreshed_row_count bigint,
  refresh_state text
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of,clock_timestamp());
  v_route_count bigint := 0;
  v_stop_count bigint := 0;
  v_error text;
begin
  perform pg_advisory_xact_lock(hashtext('analytics.refresh_delivery_route_stop_facts'));

  insert into analytics.refresh_status(
    dataset_key,source_system,source_object,status,last_started_at,freshness_sla,
    visible_to_roles,updated_at
  ) values
    ('analytics.delivery_routes','ECOFLOW',
     'analytics.fact_delivery_route_observation','REFRESHING',v_as_of,
     interval '5 minutes',array['OWNER','ADMIN','ACCOUNT','VIEWER']::text[],v_as_of),
    ('analytics.delivery_stops','ECOFLOW',
     'analytics.fact_delivery_stop_observation','REFRESHING',v_as_of,
     interval '5 minutes',array['OWNER','ADMIN','ACCOUNT','VIEWER']::text[],v_as_of)
  on conflict on constraint refresh_status_pkey do update
  set status='REFRESHING',last_started_at=excluded.last_started_at,
      error_code=null,error_message=null,updated_at=excluded.updated_at;

  begin
    create temporary table if not exists pg_temp.delivery_route_candidates(
      business_day date,
      run_code text,
      source_route_key text,
      source_route_id text,
      primary key(source_route_key)
    ) on commit drop;
    truncate table pg_temp.delivery_route_candidates;

    insert into pg_temp.delivery_route_candidates
    with candidates as(
      select d.business_day,
        case when d.scope in('meta','route') then 'A'
             else coalesce(substring(d.scope from '^run:([A-Z]+):'),'UNASSIGNED') end as run_code,
        null::text as observed_route_id
      from public.ecoflow_day_state d
      where d.scope in('meta','route')
         or d.scope~'^run:[A-Z]+:(meta|route)$'
      union all
      select a.business_day,analytics.ecoflow_delivery_run_code(a.route_id),a.route_id
      from public.ecoflow_driver_departure_acknowledgements a
      union all
      select s.business_day,analytics.ecoflow_delivery_run_code(s.route_id),s.route_id
      from public.ecoflow_driver_location_samples s
      union all
      select n.business_day,analytics.ecoflow_delivery_run_code(n.route_id),n.route_id
      from public.ecoflow_delivery_notification_log n
    ), normalised as(
      select distinct business_day,upper(coalesce(nullif(run_code,''),'UNASSIGNED')) as run_code,
        case
          when run_code<>'UNASSIGNED' then
            'RUN-'||to_char(business_day,'YYYYMMDD')||'-'||upper(run_code)
          else coalesce(nullif(btrim(observed_route_id),''),'UNASSIGNED')
        end as route_id
      from candidates
      where business_day is not null
    )
    select business_day,run_code,
      case when run_code<>'UNASSIGNED'
           then to_char(business_day,'YYYY-MM-DD')||':RUN:'||run_code
           else to_char(business_day,'YYYY-MM-DD')||':ROUTE:'||route_id end,
      route_id
    from normalised
    on conflict(source_route_key) do nothing;

    create temporary table if not exists pg_temp.delivery_driver_source(
      source_driver_key text primary key,
      display_name text,
      source_updated_at timestamptz
    ) on commit drop;
    truncate table pg_temp.delivery_driver_source;

    insert into pg_temp.delivery_driver_source
    with observed as(
      select a.driver_user_id,
        max(nullif(btrim(coalesce(a.driver_label,'')),'')) as observed_label,
        max(a.accepted_at) as observed_at
      from public.ecoflow_driver_departure_acknowledgements a
      group by a.driver_user_id
      union all
      select s.driver_user_id,
        max(nullif(btrim(coalesce(s.driver_label,'')),'')),max(s.captured_at)
      from public.ecoflow_driver_location_samples s
      group by s.driver_user_id
    ), rolled as(
      select driver_user_id,max(observed_label) as observed_label,max(observed_at) as observed_at
      from observed where driver_user_id is not null group by driver_user_id
    )
    select r.driver_user_id::text,
      coalesce(nullif(to_jsonb(p)->>'display_name',''),
               nullif(to_jsonb(p)->>'email',''),r.observed_label,r.driver_user_id::text),
      greatest(r.observed_at,analytics.ecoflow_try_timestamptz(to_jsonb(p)->>'updated_at'))
    from rolled r
    left join public.app_user_profiles p on p.user_id=r.driver_user_id;

    insert into analytics.dim_driver(
      source_system,source_driver_key,display_name,active,effective_from,is_current,
      source_updated_at,recorded_by
    )
    select 'ECOFLOW',s.source_driver_key,s.display_name,true,v_as_of,true,
      s.source_updated_at,'analytics.refresh_delivery_route_stop_facts'
    from pg_temp.delivery_driver_source s
    where not exists(
      select 1 from analytics.dim_driver d
      where d.source_system='ECOFLOW'
        and d.source_driver_key=s.source_driver_key and d.is_current
    );

    update analytics.dim_driver d
    set display_name=s.display_name,source_updated_at=s.source_updated_at,updated_at=v_as_of
    from pg_temp.delivery_driver_source s
    where d.source_system='ECOFLOW' and d.source_driver_key=s.source_driver_key
      and d.is_current and d.display_name is distinct from s.display_name;

    insert into analytics.dim_route(
      source_system,source_route_key,route_code,route_name,active,effective_from,
      is_current,source_updated_at,recorded_by
    )
    select 'ECOFLOW',r.source_route_key,r.source_route_id,
      case when r.run_code='UNASSIGNED' then 'Unassigned delivery route'
           else 'Run '||r.run_code||' · '||to_char(r.business_day,'YYYY-MM-DD') end,
      true,v_as_of,true,v_as_of,'analytics.refresh_delivery_route_stop_facts'
    from pg_temp.delivery_route_candidates r
    where not exists(
      select 1 from analytics.dim_route d
      where d.source_system='ECOFLOW'
        and d.source_route_key=r.source_route_key and d.is_current
    );

    create temporary table if not exists pg_temp.delivery_route_source(
      source_system text,business_day date,run_code text,source_route_key text,
      source_route_id text,route_dimension_id bigint,route_status text,
      route_locked_at timestamptz,route_started_at timestamptz,route_ended_at timestamptz,
      planned_stop_count integer,departure_ack_count integer,
      observed_driver_count integer,driver_dimension_id bigint,
      driver_resolution_status text,first_departure_ack_at timestamptz,
      latest_departure_ack_at timestamptz,location_sample_count integer,
      route_start_sample_count integer,route_end_sample_count integer,
      stop_arrival_sample_count integer,delivery_sample_count integer,
      failed_delivery_sample_count integer,first_location_sample_at timestamptz,
      latest_location_sample_at timestamptz,route_notice_store_count integer,
      route_notice_sent_count integer,route_notice_failed_count integer,
      route_notice_missing_contact_count integer,evidence_status text,
      history_completeness text,quality_status text,quality_detail text,
      source_version_hash text,source_last_observed_at timestamptz
    ) on commit drop;
    truncate table pg_temp.delivery_route_source;

    insert into pg_temp.delivery_route_source
    with meta as(
      select distinct on(r.source_route_key)
        r.source_route_key,d.payload,d.updated_at
      from pg_temp.delivery_route_candidates r
      join public.ecoflow_day_state d on d.business_day=r.business_day
       and (d.scope='run:'||r.run_code||':meta' or (r.run_code='A' and d.scope='meta'))
      order by r.source_route_key,
        case when d.scope like 'run:%' then 0 else 1 end,d.updated_at desc
    ), route_state as(
      select distinct on(r.source_route_key)
        r.source_route_key,d.payload,d.updated_at
      from pg_temp.delivery_route_candidates r
      join public.ecoflow_day_state d on d.business_day=r.business_day
       and (d.scope='run:'||r.run_code||':route' or (r.run_code='A' and d.scope='route'))
      order by r.source_route_key,
        case when d.scope like 'run:%' then 0 else 1 end,d.updated_at desc
    ), ack as(
      select r.source_route_key,count(a.id)::integer as ack_count,
        count(distinct a.driver_user_id)::integer as driver_count,
        min(a.accepted_at) as first_at,max(a.accepted_at) as latest_at,
        case when count(distinct a.driver_user_id)=1 then min(a.driver_user_id::text) end
          as driver_key
      from pg_temp.delivery_route_candidates r
      left join public.ecoflow_driver_departure_acknowledgements a
        on a.business_day=r.business_day and a.route_id=r.source_route_id
      group by r.source_route_key
    ), loc as(
      select r.source_route_key,count(s.id)::integer as sample_count,
        count(s.id) filter(where s.sample_source='ROUTE_START')::integer as route_start_count,
        count(s.id) filter(where s.sample_source='ROUTE_END')::integer as route_end_count,
        count(s.id) filter(where s.sample_source='STOP_ARRIVAL')::integer as arrival_count,
        count(s.id) filter(where s.sample_source='DELIVERY')::integer as delivery_count,
        count(s.id) filter(where s.sample_source='FAILED_DELIVERY')::integer as failed_count,
        min(s.captured_at) as first_at,max(s.captured_at) as latest_at,
        count(distinct s.driver_user_id)::integer as driver_count,
        case when count(distinct s.driver_user_id)=1 then min(s.driver_user_id::text) end
          as driver_key
      from pg_temp.delivery_route_candidates r
      left join public.ecoflow_driver_location_samples s
        on s.business_day=r.business_day and s.route_id=r.source_route_id
      group by r.source_route_key
    ), notices as(
      select r.source_route_key,
        count(distinct n.store_key)::integer as store_count,
        count(*) filter(where n.status='SENT')::integer as sent_count,
        count(*) filter(where n.status='FAILED')::integer as failed_count,
        count(*) filter(where n.status='MISSING_CONTACT')::integer as missing_count,
        max(n.requested_at) as latest_at
      from pg_temp.delivery_route_candidates r
      left join public.ecoflow_delivery_notification_log n
        on n.business_day=r.business_day and n.route_id=r.source_route_id
      group by r.source_route_key
    ), prepared as(
      select r.*,dr.route_dimension_id,
        analytics.ecoflow_try_timestamptz(m.payload->>'lockedAt') as locked_at,
        analytics.ecoflow_try_timestamptz(rs.payload->>'startedAt') as started_at,
        analytics.ecoflow_try_timestamptz(rs.payload->>'endedAt') as ended_at,
        case when jsonb_typeof(m.payload->'stopOrder')='array'
             then jsonb_array_length(m.payload->'stopOrder') else 0 end as stop_count,
        coalesce(a.ack_count,0) as ack_count,
        (
  select count(distinct u.driver_user_id)::integer
  from (
    select da.driver_user_id
    from public.ecoflow_driver_departure_acknowledgements da
    where da.business_day=r.business_day and da.route_id=r.source_route_id
    union all
    select dl.driver_user_id
    from public.ecoflow_driver_location_samples dl
    where dl.business_day=r.business_day and dl.route_id=r.source_route_id
  ) u
) as driver_count,
(
  select case when count(distinct u.driver_user_id)=1
              then min(u.driver_user_id::text) end
  from (
    select da.driver_user_id
    from public.ecoflow_driver_departure_acknowledgements da
    where da.business_day=r.business_day and da.route_id=r.source_route_id
    union all
    select dl.driver_user_id
    from public.ecoflow_driver_location_samples dl
    where dl.business_day=r.business_day and dl.route_id=r.source_route_id
  ) u
) as driver_key,
        a.first_at as ack_first,a.latest_at as ack_latest,
        coalesce(l.sample_count,0) as sample_count,
        coalesce(l.route_start_count,0) as route_start_count,
        coalesce(l.route_end_count,0) as route_end_count,
        coalesce(l.arrival_count,0) as arrival_count,
        coalesce(l.delivery_count,0) as delivery_count,
        coalesce(l.failed_count,0) as failed_count,
        l.first_at as location_first,l.latest_at as location_latest,
        coalesce(n.store_count,0) as notice_store_count,
        coalesce(n.sent_count,0) as notice_sent_count,
        coalesce(n.failed_count,0) as notice_failed_count,
        coalesce(n.missing_count,0) as notice_missing_count,
        greatest(m.updated_at,rs.updated_at,a.latest_at,l.latest_at,n.latest_at) as source_updated_at
      from pg_temp.delivery_route_candidates r
      left join meta m using(source_route_key)
      left join route_state rs using(source_route_key)
      left join ack a using(source_route_key)
      left join loc l using(source_route_key)
      left join notices n using(source_route_key)
      left join analytics.dim_route dr
        on dr.source_system='ECOFLOW' and dr.source_route_key=r.source_route_key
       and dr.is_current
    )
    select 'ECOFLOW',p.business_day,p.run_code,p.source_route_key,p.source_route_id,
      p.route_dimension_id,
      case when p.ended_at is not null then 'COMPLETED'
           when p.started_at is not null then 'IN_PROGRESS'
           when p.locked_at is not null or p.stop_count>0 then 'NOT_STARTED'
           else 'UNKNOWN' end,
      p.locked_at,p.started_at,p.ended_at,p.stop_count,p.ack_count,p.driver_count,
      dd.driver_dimension_id,
      case when p.driver_count=0 then 'NONE' when p.driver_count=1 then 'SINGLE'
           else 'MULTIPLE' end,
      p.ack_first,p.ack_latest,p.sample_count,p.route_start_count,p.route_end_count,
      p.arrival_count,p.delivery_count,p.failed_count,p.location_first,p.location_latest,
      p.notice_store_count,p.notice_sent_count,p.notice_failed_count,
      p.notice_missing_count,
      case when p.run_code='UNASSIGNED' then 'UNASSIGNED_SOURCE'
           when p.ack_count>0 and p.sample_count>0 then 'MIXED_OPERATIONAL_EVIDENCE'
           when p.ack_count>0 then 'DURABLE_DEPARTURE'
           when p.sample_count>0 then 'DURABLE_LOCATION_COVERAGE'
           else 'DAY_STATE_ONLY' end,
      case when p.run_code='UNASSIGNED' then 'UNASSIGNED_OBSERVATION'
           else 'OBSERVATION_VERSIONED_CURRENT_STATE' end,
      case when p.run_code='UNASSIGNED' or p.driver_count>1
                  or (p.ended_at is not null and p.started_at is null)
                  or p.notice_failed_count>0 then 'DEGRADED'
           when p.business_day is null then 'INVALID' else 'TRUSTED' end,
      case when p.run_code='UNASSIGNED' then 'ROUTE_ID_NOT_STANDARD'
           when p.driver_count>1 then 'MULTIPLE_DRIVERS_OBSERVED'
           when p.ended_at is not null and p.started_at is null then 'ROUTE_END_WITHOUT_START'
           when p.notice_failed_count>0 then 'ROUTE_NOTICE_FAILURE'
           else null end,
      encode(digest(jsonb_build_array(
        p.business_day,p.run_code,p.source_route_id,p.locked_at,p.started_at,p.ended_at,
        p.stop_count,p.ack_count,p.driver_count,p.driver_key,p.ack_first,p.ack_latest,
        p.sample_count,p.route_start_count,p.route_end_count,p.arrival_count,
        p.delivery_count,p.failed_count,p.location_first,p.location_latest,
        p.notice_store_count,p.notice_sent_count,p.notice_failed_count,
        p.notice_missing_count
      )::text,'sha256'),'hex'),p.source_updated_at
    from prepared p
    left join analytics.dim_driver dd
      on dd.source_system='ECOFLOW' and dd.source_driver_key=p.driver_key and dd.is_current;

    update analytics.fact_delivery_route_observation f
    set effective_to=v_as_of,is_current=false,last_observed_at=v_as_of,as_of_at=v_as_of
    from pg_temp.delivery_route_source s
    where f.source_system=s.source_system and f.source_route_key=s.source_route_key
      and f.is_current and f.source_version_hash<>s.source_version_hash;

    update analytics.fact_delivery_route_observation f
    set last_observed_at=v_as_of,as_of_at=v_as_of,
        source_last_observed_at=s.source_last_observed_at,
        quality_status=s.quality_status,quality_detail=s.quality_detail
    from pg_temp.delivery_route_source s
    where f.source_system=s.source_system and f.source_route_key=s.source_route_key
      and f.is_current and f.source_version_hash=s.source_version_hash;

    insert into analytics.fact_delivery_route_observation(
      source_system,business_day,run_code,source_route_key,source_route_id,
      route_dimension_id,route_status,route_locked_at,route_started_at,route_ended_at,
      planned_stop_count,departure_ack_count,observed_driver_count,
      driver_dimension_id,driver_resolution_status,first_departure_ack_at,
      latest_departure_ack_at,location_sample_count,route_start_sample_count,
      route_end_sample_count,stop_arrival_sample_count,delivery_sample_count,
      failed_delivery_sample_count,first_location_sample_at,latest_location_sample_at,
      route_notice_store_count,route_notice_sent_count,route_notice_failed_count,
      route_notice_missing_contact_count,evidence_status,history_completeness,
      quality_status,quality_detail,source_version_hash,source_last_observed_at,
      effective_from,effective_to,is_current,first_observed_at,last_observed_at,as_of_at
    )
    select s.source_system,s.business_day,s.run_code,s.source_route_key,s.source_route_id,
      s.route_dimension_id,s.route_status,s.route_locked_at,s.route_started_at,
      s.route_ended_at,s.planned_stop_count,s.departure_ack_count,
      s.observed_driver_count,s.driver_dimension_id,s.driver_resolution_status,
      s.first_departure_ack_at,s.latest_departure_ack_at,s.location_sample_count,
      s.route_start_sample_count,s.route_end_sample_count,s.stop_arrival_sample_count,
      s.delivery_sample_count,s.failed_delivery_sample_count,s.first_location_sample_at,
      s.latest_location_sample_at,s.route_notice_store_count,s.route_notice_sent_count,
      s.route_notice_failed_count,s.route_notice_missing_contact_count,s.evidence_status,
      s.history_completeness,s.quality_status,s.quality_detail,s.source_version_hash,
      s.source_last_observed_at,v_as_of,null,true,v_as_of,v_as_of,v_as_of
    from pg_temp.delivery_route_source s
    where not exists(
      select 1 from analytics.fact_delivery_route_observation f
      where f.source_system=s.source_system and f.source_route_key=s.source_route_key
        and f.is_current and f.source_version_hash=s.source_version_hash
    );

    create temporary table if not exists pg_temp.delivery_stop_plan(
      business_day date,run_code text,source_route_key text,source_order_id text,
      planned_stop_number integer,box_code text,source_updated_at timestamptz,
      primary key(business_day,run_code,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_stop_plan;

    insert into pg_temp.delivery_stop_plan
    with meta as(
      select d.business_day,
        case when d.scope='meta' then 'A'
             else substring(d.scope from '^run:([A-Z]+):') end as run_code,
        d.payload,d.updated_at,
        case when d.scope like 'run:%' then 0 else 1 end as precedence
      from public.ecoflow_day_state d
      where d.scope='meta' or d.scope~'^run:[A-Z]+:meta$'
    ), expanded as(
      select m.business_day,upper(coalesce(m.run_code,'A')) as run_code,
        e.value as order_id,e.ordinality::integer as stop_number,
        m.payload->'boxCodes'->>e.value as box_code,m.updated_at,m.precedence
      from meta m
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(m.payload->'stopOrder')='array'
             then m.payload->'stopOrder' else '[]'::jsonb end
      ) with ordinality e(value,ordinality)
    )
    select distinct on(business_day,run_code,order_id)
      business_day,run_code,to_char(business_day,'YYYY-MM-DD')||':RUN:'||run_code,
      order_id,stop_number,box_code,updated_at
    from expanded
    where nullif(btrim(order_id),'') is not null
    order by business_day,run_code,order_id,precedence,updated_at desc;

    create temporary table if not exists pg_temp.delivery_stop_state(
      business_day date,run_code text,source_route_key text,source_order_id text,
      payload jsonb,source_updated_at timestamptz,
      primary key(business_day,run_code,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_stop_state;

    insert into pg_temp.delivery_stop_state
    with states as(
      select d.business_day,
        case when d.scope like 'stop:%' then 'A'
             else substring(d.scope from '^run:([A-Z]+):') end as run_code,
        regexp_replace(d.scope,'^(run:[A-Z]+:)?stop:','') as order_id,
        d.payload,d.updated_at,
        case when d.scope like 'run:%' then 0 else 1 end as precedence
      from public.ecoflow_day_state d
      where d.scope like 'stop:%' or d.scope~'^run:[A-Z]+:stop:.+$'
    )
    select distinct on(business_day,run_code,order_id)
      business_day,run_code,to_char(business_day,'YYYY-MM-DD')||':RUN:'||run_code,
      order_id,payload,updated_at
    from states
    where nullif(btrim(order_id),'') is not null
    order by business_day,run_code,order_id,precedence,updated_at desc;

    create temporary table if not exists pg_temp.delivery_order_route_assignment(
      business_day date,source_order_id text,route_count integer,
      unique_source_route_key text,unique_run_code text,
      primary key(business_day,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_order_route_assignment;

    insert into pg_temp.delivery_order_route_assignment
    with links as(
      select business_day,source_order_id,source_route_key,run_code
      from pg_temp.delivery_stop_plan
      union
      select business_day,source_order_id,source_route_key,run_code
      from pg_temp.delivery_stop_state
    )
    select business_day,source_order_id,count(distinct source_route_key)::integer,
      case when count(distinct source_route_key)=1 then min(source_route_key) end,
      case when count(distinct source_route_key)=1 then min(run_code) end
    from links group by business_day,source_order_id;

    create temporary table if not exists pg_temp.delivery_pod_agg(
      business_day date,source_order_id text,pod1_present boolean,pod2_present boolean,
      proof_count integer,first_at timestamptz,latest_at timestamptz,
      order_number text,store_name text,stop_number integer,box_code text,
      primary key(business_day,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_pod_agg;

    insert into pg_temp.delivery_pod_agg
    with valid as(
      select analytics.ecoflow_try_date(p.business_day) as parsed_business_day,p.*
      from public.ecoflow_delivery_pod_proofs p
      where analytics.ecoflow_try_date(p.business_day) is not null
        and nullif(btrim(p.order_id),'') is not null
    ), latest as(
      select distinct on(parsed_business_day,order_id)
        parsed_business_day as business_day,order_id,order_number,store_name,
        stop_number,box_code
      from valid
      order by parsed_business_day,order_id,captured_at desc,created_at desc
    )
    select v.parsed_business_day,v.order_id,
      bool_or(v.proof_type='POD1_DROP_POINT'),
      bool_or(v.proof_type='POD2_GOODS_PLACED'),count(distinct v.proof_type)::integer,
      min(v.captured_at),max(v.captured_at),l.order_number,l.store_name,
      l.stop_number,l.box_code
    from valid v
    join latest l
      on l.business_day=v.parsed_business_day and l.order_id=v.order_id
    group by v.parsed_business_day,v.order_id,l.order_number,l.store_name,
      l.stop_number,l.box_code;

    create temporary table if not exists pg_temp.delivery_exception_agg(
      business_day date,source_order_id text,exception_count integer,
      outcome text,recorded_at timestamptz,expected_cartons numeric,
      delivered_cartons numeric,return_cartons numeric,order_number text,
      store_name text,stop_number integer,box_code text,
      primary key(business_day,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_exception_agg;

    insert into pg_temp.delivery_exception_agg
    with valid as(
      select analytics.ecoflow_try_date(e.business_day) as parsed_business_day,e.*
      from public.ecoflow_delivery_exceptions e
      where analytics.ecoflow_try_date(e.business_day) is not null
        and nullif(btrim(e.order_id),'') is not null
    ), latest as(
      select distinct on(parsed_business_day,order_id)
        parsed_business_day as business_day,order_id,outcome,recorded_at,
        expected_cartons,delivered_cartons,return_cartons,order_number,
        store_name,stop_number,box_code
      from valid
      order by parsed_business_day,order_id,recorded_at desc,id desc
    ), counts as(
      select parsed_business_day as business_day,order_id,
        count(*)::integer as exception_count
      from valid group by parsed_business_day,order_id
    )
    select l.business_day,l.order_id,c.exception_count,upper(l.outcome),l.recorded_at,
      l.expected_cartons,l.delivered_cartons,l.return_cartons,l.order_number,
      l.store_name,l.stop_number,l.box_code
    from latest l join counts c using(business_day,order_id);

    create temporary table if not exists pg_temp.delivery_notification_agg(
      business_day date,source_order_id text,notification_count integer,
      sent_count integer,failed_count integer,waiting_count integer,
      latest_at timestamptz,order_number text,store_name text,stop_number integer,
      box_code text,primary key(business_day,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_notification_agg;

    insert into pg_temp.delivery_notification_agg
    with valid as(
      select analytics.ecoflow_try_date(n.business_day) as parsed_business_day,n.*
      from public.ecoflow_delivery_notifications n
      where analytics.ecoflow_try_date(n.business_day) is not null
        and nullif(btrim(n.order_id),'') is not null
    ), latest as(
      select distinct on(parsed_business_day,order_id)
        parsed_business_day as business_day,order_id,order_number,store_name,
        stop_number,box_code
      from valid
      order by parsed_business_day,order_id,updated_at desc,id desc
    )
    select v.parsed_business_day,v.order_id,count(*)::integer,
      count(*) filter(where v.notification_status='SENT')::integer,
      count(*) filter(where v.notification_status='FAILED')::integer,
      count(*) filter(where v.notification_status in(
        'PENDING','WAITING_CONTACT','WAITING_CONFIG','SENDING'
      ))::integer,max(greatest(v.queued_at,v.updated_at,v.sent_at)),
      l.order_number,l.store_name,l.stop_number,l.box_code
    from valid v
    join latest l
      on l.business_day=v.parsed_business_day and l.order_id=v.order_id
    group by v.parsed_business_day,v.order_id,l.order_number,l.store_name,
      l.stop_number,l.box_code;

    create temporary table if not exists pg_temp.delivery_stop_location_agg(
      business_day date,source_order_id text,event_count integer,
      arrival_count integer,delivery_count integer,failed_count integer,
      latest_at timestamptz,primary key(business_day,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_stop_location_agg;

    insert into pg_temp.delivery_stop_location_agg
    select s.business_day,s.current_order_id,count(*)::integer,
      count(s.id) filter(where s.sample_source='STOP_ARRIVAL')::integer,
      count(s.id) filter(where s.sample_source='DELIVERY')::integer,
      count(s.id) filter(where s.sample_source='FAILED_DELIVERY')::integer,
      max(s.captured_at)
    from public.ecoflow_driver_location_samples s
    where nullif(btrim(coalesce(s.current_order_id,'')),'') is not null
      and s.sample_source in('STOP_ARRIVAL','DELIVERY','FAILED_DELIVERY')
    group by s.business_day,s.current_order_id;

    create temporary table if not exists pg_temp.delivery_stop_candidates(
      business_day date,run_code text,source_route_key text,source_order_id text,
      route_assignment_status text,planned_stop_number integer,box_code text,
      primary key(source_route_key,source_order_id)
    ) on commit drop;
    truncate table pg_temp.delivery_stop_candidates;

    insert into pg_temp.delivery_stop_candidates
    with routed as(
      select p.business_day,p.run_code,p.source_route_key,p.source_order_id,
        p.planned_stop_number,p.box_code from pg_temp.delivery_stop_plan p
      union
      select s.business_day,s.run_code,s.source_route_key,s.source_order_id,
        null::integer,null::text from pg_temp.delivery_stop_state s
    )
    select r.business_day,r.run_code,r.source_route_key,r.source_order_id,
      case when a.route_count>1 then 'AMBIGUOUS' else 'UNIQUE' end,
      max(r.planned_stop_number),max(r.box_code)
    from routed r left join pg_temp.delivery_order_route_assignment a
      using(business_day,source_order_id)
    group by r.business_day,r.run_code,r.source_route_key,r.source_order_id,a.route_count;

    insert into pg_temp.delivery_stop_candidates
    with evidence as(
      select business_day,source_order_id from pg_temp.delivery_pod_agg
      union select business_day,source_order_id from pg_temp.delivery_exception_agg
      union select business_day,source_order_id from pg_temp.delivery_notification_agg
      union select business_day,source_order_id from pg_temp.delivery_stop_location_agg
    )
    select e.business_day,'UNASSIGNED',to_char(e.business_day,'YYYY-MM-DD')||':UNASSIGNED',
      e.source_order_id,'UNASSIGNED',null,null
    from evidence e
    left join pg_temp.delivery_order_route_assignment a
      using(business_day,source_order_id)
    where coalesce(a.route_count,0)=0
    on conflict(source_route_key,source_order_id) do nothing;

    create temporary table if not exists pg_temp.delivery_stop_source(
      source_system text,business_day date,run_code text,source_route_key text,
      route_dimension_id bigint,source_stop_key text,source_order_id text,
      order_number_observed text,store_name_observed text,
      route_assignment_status text,planned_stop_number integer,box_code text,
      recorded_stop_status text,arrived_at timestamptz,completed_at timestamptz,
      pod1_present boolean,pod2_present boolean,pod_proof_count integer,
      first_pod_captured_at timestamptz,latest_pod_captured_at timestamptz,
      durable_exception_count integer,latest_exception_outcome text,
      latest_exception_recorded_at timestamptz,expected_cartons numeric,
      delivered_cartons numeric,return_cartons numeric,
      location_event_sample_count integer,stop_arrival_sample_count integer,
      delivery_sample_count integer,failed_delivery_sample_count integer,
      notification_count integer,notification_sent_count integer,
      notification_failed_count integer,notification_waiting_count integer,
      delivery_outcome text,outcome_authority text,proof_completeness text,
      history_completeness text,quality_status text,quality_detail text,
      source_version_hash text,source_last_observed_at timestamptz
    ) on commit drop;
    truncate table pg_temp.delivery_stop_source;

    insert into pg_temp.delivery_stop_source
    with prepared as(
      select c.*,dr.route_dimension_id,s.payload,s.source_updated_at as state_updated_at,
        coalesce(p.pod1_present,false) as pod1_present,
        coalesce(p.pod2_present,false) as pod2_present,
        coalesce(p.proof_count,0) as proof_count,p.first_at as pod_first,
        p.latest_at as pod_latest,coalesce(e.exception_count,0) as exception_count,
        e.outcome as exception_outcome,e.recorded_at as exception_at,
        e.expected_cartons,e.delivered_cartons,e.return_cartons,
        coalesce(l.event_count,0) as event_count,coalesce(l.arrival_count,0) as arrival_count,
        coalesce(l.delivery_count,0) as delivery_count,
        coalesce(l.failed_count,0) as failed_count,
        coalesce(n.notification_count,0) as notification_count,
        coalesce(n.sent_count,0) as notification_sent_count,
        coalesce(n.failed_count,0) as notification_failed_count,
        coalesce(n.waiting_count,0) as notification_waiting_count,
        coalesce(e.order_number,p.order_number,n.order_number) as order_number,
        coalesce(e.store_name,p.store_name,n.store_name) as store_name,
        coalesce(c.planned_stop_number,e.stop_number,p.stop_number,n.stop_number) as stop_number,
        coalesce(c.box_code,e.box_code,p.box_code,n.box_code) as resolved_box_code,
        greatest(s.source_updated_at,p.latest_at,e.recorded_at,l.latest_at,n.latest_at)
          as source_updated_at
      from pg_temp.delivery_stop_candidates c
      left join pg_temp.delivery_stop_state s
        on s.business_day=c.business_day and s.run_code=c.run_code
       and s.source_order_id=c.source_order_id
      left join pg_temp.delivery_order_route_assignment a
        using(business_day,source_order_id)
      left join pg_temp.delivery_pod_agg p
        on p.business_day=c.business_day and p.source_order_id=c.source_order_id
       and (c.route_assignment_status='UNASSIGNED' or a.route_count=1)
      left join pg_temp.delivery_exception_agg e
        on e.business_day=c.business_day and e.source_order_id=c.source_order_id
       and (c.route_assignment_status='UNASSIGNED' or a.route_count=1)
      left join pg_temp.delivery_notification_agg n
        on n.business_day=c.business_day and n.source_order_id=c.source_order_id
       and (c.route_assignment_status='UNASSIGNED' or a.route_count=1)
      left join pg_temp.delivery_stop_location_agg l
        on l.business_day=c.business_day and l.source_order_id=c.source_order_id
       and (c.route_assignment_status='UNASSIGNED' or a.route_count=1)
      left join analytics.dim_route dr
        on dr.source_system='ECOFLOW' and dr.source_route_key=c.source_route_key
       and dr.is_current
    ), classified as(
      select p.*,
        case upper(btrim(coalesce(p.payload->>'status','PENDING')))
          when 'PENDING' then 'PENDING' when 'ARRIVED' then 'ARRIVED'
          when 'DELIVERED' then 'DELIVERED' when 'FAILED' then 'FAILED'
          when 'SKIPPED' then 'SKIPPED' else 'UNKNOWN' end as stop_status,
        analytics.ecoflow_try_timestamptz(p.payload->>'arrivedAt') as arrived_at,
        analytics.ecoflow_try_timestamptz(p.payload->>'completedAt') as completed_at
      from prepared p
    )
    select 'ECOFLOW',p.business_day,p.run_code,p.source_route_key,
      p.route_dimension_id,p.source_route_key||':STOP:'||p.source_order_id,
      p.source_order_id,p.order_number,p.store_name,p.route_assignment_status,
      p.stop_number,p.resolved_box_code,p.stop_status,p.arrived_at,p.completed_at,
      p.pod1_present,p.pod2_present,p.proof_count,p.pod_first,p.pod_latest,
      p.exception_count,p.exception_outcome,p.exception_at,p.expected_cartons,
      p.delivered_cartons,p.return_cartons,p.event_count,p.arrival_count,
      p.delivery_count,p.failed_count,p.notification_count,p.notification_sent_count,
      p.notification_failed_count,p.notification_waiting_count,
      case
        when p.exception_count>0 then p.exception_outcome
        when p.stop_status='DELIVERED' and p.pod1_present and p.pod2_present then 'DELIVERED'
        when p.stop_status='DELIVERED' then 'DELIVERED_UNVERIFIED'
        when p.stop_status='FAILED' then 'FAILED_UNVERIFIED'
        else p.stop_status
      end,
      case when p.exception_count>0 then 'DURABLE_EXCEPTION'
           when p.stop_status='DELIVERED' and p.pod1_present and p.pod2_present
             then 'DAY_STATE_AND_TYPED_POD'
           when p.stop_status in('ARRIVED','DELIVERED','FAILED','SKIPPED')
             then 'TRANSITIONAL_DAY_STATE'
           else 'NONE' end,
      case when p.pod1_present and p.pod2_present then 'COMPLETE'
           when p.pod1_present then 'ONLY_POD1'
           when p.pod2_present then 'ONLY_POD2' else 'MISSING' end,
      case when p.route_assignment_status='AMBIGUOUS' then 'AMBIGUOUS_ROUTE_EVIDENCE'
           when p.exception_count>0 or
                (p.stop_status='DELIVERED' and p.pod1_present and p.pod2_present)
             then 'DURABLE_TERMINAL_EVIDENCE'
           else 'CURRENT_STATE_ONLY' end,
      case when p.business_day is null or nullif(btrim(p.source_order_id),'') is null
             then 'INVALID'
           when p.route_assignment_status<>'UNIQUE'
             or (p.stop_status='DELIVERED' and not(p.pod1_present and p.pod2_present))
             or (p.pod1_present and p.pod2_present and p.stop_status<>'DELIVERED')
             or (p.exception_count>0 and p.stop_status='DELIVERED')
             or p.notification_failed_count>0 then 'DEGRADED'
           else 'TRUSTED' end,
      case when p.route_assignment_status='AMBIGUOUS' then 'ORDER_ASSIGNED_TO_MULTIPLE_RUNS'
           when p.route_assignment_status='UNASSIGNED' then 'DURABLE_EVIDENCE_WITHOUT_RUN_ASSIGNMENT'
           when p.stop_status='DELIVERED' and not(p.pod1_present and p.pod2_present)
             then 'DELIVERED_STATE_WITHOUT_TWO_TYPED_PODS'
           when p.pod1_present and p.pod2_present and p.stop_status<>'DELIVERED'
             then 'TYPED_PODS_WITHOUT_DELIVERED_STATE'
           when p.exception_count>0 and p.stop_status='DELIVERED'
             then 'DURABLE_EXCEPTION_CONFLICTS_WITH_DELIVERED_STATE'
           when p.notification_failed_count>0 then 'DELIVERY_NOTIFICATION_FAILURE'
           else null end,
      encode(digest(jsonb_build_array(
        p.business_day,p.run_code,p.source_order_id,p.order_number,p.store_name,
        p.route_assignment_status,p.stop_number,p.resolved_box_code,p.stop_status,
        p.arrived_at,p.completed_at,p.pod1_present,p.pod2_present,p.proof_count,
        p.pod_first,p.pod_latest,p.exception_count,p.exception_outcome,p.exception_at,
        p.expected_cartons,p.delivered_cartons,p.return_cartons,p.event_count,
        p.arrival_count,p.delivery_count,p.failed_count,p.notification_count,
        p.notification_sent_count,p.notification_failed_count,p.notification_waiting_count
      )::text,'sha256'),'hex'),p.source_updated_at
    from classified p;

    update analytics.fact_delivery_stop_observation f
    set effective_to=v_as_of,is_current=false,last_observed_at=v_as_of,as_of_at=v_as_of
    from pg_temp.delivery_stop_source s
    where f.source_system=s.source_system and f.source_stop_key=s.source_stop_key
      and f.is_current and f.source_version_hash<>s.source_version_hash;

    update analytics.fact_delivery_stop_observation f
    set last_observed_at=v_as_of,as_of_at=v_as_of,
        source_last_observed_at=s.source_last_observed_at,
        quality_status=s.quality_status,quality_detail=s.quality_detail
    from pg_temp.delivery_stop_source s
    where f.source_system=s.source_system and f.source_stop_key=s.source_stop_key
      and f.is_current and f.source_version_hash=s.source_version_hash;

    insert into analytics.fact_delivery_stop_observation(
      source_system,business_day,run_code,source_route_key,route_dimension_id,
      source_stop_key,source_order_id,order_number_observed,store_name_observed,
      route_assignment_status,planned_stop_number,box_code,recorded_stop_status,
      arrived_at,completed_at,pod1_present,pod2_present,pod_proof_count,
      first_pod_captured_at,latest_pod_captured_at,durable_exception_count,
      latest_exception_outcome,latest_exception_recorded_at,expected_cartons,
      delivered_cartons,return_cartons,location_event_sample_count,
      stop_arrival_sample_count,delivery_sample_count,failed_delivery_sample_count,
      notification_count,notification_sent_count,notification_failed_count,
      notification_waiting_count,delivery_outcome,outcome_authority,
      proof_completeness,history_completeness,quality_status,quality_detail,
      source_version_hash,source_last_observed_at,effective_from,effective_to,
      is_current,first_observed_at,last_observed_at,as_of_at
    )
    select s.source_system,s.business_day,s.run_code,s.source_route_key,
      s.route_dimension_id,s.source_stop_key,s.source_order_id,s.order_number_observed,
      s.store_name_observed,s.route_assignment_status,s.planned_stop_number,
      s.box_code,s.recorded_stop_status,s.arrived_at,s.completed_at,s.pod1_present,
      s.pod2_present,s.pod_proof_count,s.first_pod_captured_at,
      s.latest_pod_captured_at,s.durable_exception_count,s.latest_exception_outcome,
      s.latest_exception_recorded_at,s.expected_cartons,s.delivered_cartons,
      s.return_cartons,s.location_event_sample_count,s.stop_arrival_sample_count,
      s.delivery_sample_count,s.failed_delivery_sample_count,s.notification_count,
      s.notification_sent_count,s.notification_failed_count,
      s.notification_waiting_count,s.delivery_outcome,s.outcome_authority,
      s.proof_completeness,s.history_completeness,s.quality_status,s.quality_detail,
      s.source_version_hash,s.source_last_observed_at,v_as_of,null,true,
      v_as_of,v_as_of,v_as_of
    from pg_temp.delivery_stop_source s
    where not exists(
      select 1 from analytics.fact_delivery_stop_observation f
      where f.source_system=s.source_system and f.source_stop_key=s.source_stop_key
        and f.is_current and f.source_version_hash=s.source_version_hash
    );

    select count(*) into v_route_count
    from analytics.fact_delivery_route_observation where is_current;
    select count(*) into v_stop_count
    from analytics.fact_delivery_stop_observation where is_current;

    update analytics.refresh_status rs
    set status='CURRENT',as_of_at=v_as_of,last_succeeded_at=v_as_of,
        row_count=v_route_count,error_code=null,error_message=null,updated_at=v_as_of
    where rs.dataset_key='analytics.delivery_routes';
    update analytics.refresh_status rs
    set status='CURRENT',as_of_at=v_as_of,last_succeeded_at=v_as_of,
        row_count=v_stop_count,error_code=null,error_message=null,updated_at=v_as_of
    where rs.dataset_key='analytics.delivery_stops';

    return query values
      ('analytics.delivery_routes'::text,v_route_count,'CURRENT'::text),
      ('analytics.delivery_stops'::text,v_stop_count,'CURRENT'::text);
  exception when others then
    v_error:=sqlerrm;
    update analytics.refresh_status rs
    set status='FAILED',last_failed_at=clock_timestamp(),error_code=sqlstate,
        error_message=left(v_error,2000),updated_at=clock_timestamp()
    where rs.dataset_key in('analytics.delivery_routes','analytics.delivery_stops');
    return query values
      ('analytics.delivery_routes'::text,0::bigint,'FAILED'::text),
      ('analytics.delivery_stops'::text,0::bigint,'FAILED'::text);
  end;
end;
$$;

revoke all on function analytics.refresh_delivery_route_stop_facts(timestamptz)
  from public,anon,authenticated;
grant execute on function analytics.refresh_delivery_route_stop_facts(timestamptz)
  to service_role;

insert into analytics.refresh_status(
  dataset_key,source_system,source_object,status,freshness_sla,visible_to_roles
) values
  ('analytics.delivery_routes','ECOFLOW',
   'analytics.fact_delivery_route_observation','NEVER',interval '5 minutes',
   array['OWNER','ADMIN','ACCOUNT','VIEWER']::text[]),
  ('analytics.delivery_stops','ECOFLOW',
   'analytics.fact_delivery_stop_observation','NEVER',interval '5 minutes',
   array['OWNER','ADMIN','ACCOUNT','VIEWER']::text[])
on conflict(dataset_key) do nothing;

comment on table analytics.fact_delivery_route_observation is
  'Versioned observations at one business day and route instance. GPS coordinates are excluded; day-state timing is current-state evidence, not a complete event ledger.';
comment on table analytics.fact_delivery_stop_observation is
  'Versioned observations at one business day, route and order stop. Typed POD and durable exceptions are distinguished from overwritable day-state and notification evidence.';
comment on function analytics.refresh_delivery_route_stop_facts(timestamptz) is
  'Service-only controlled refresh. Not invoked automatically by migration or browser clients.';

notify pgrst,'reload schema';

commit;
