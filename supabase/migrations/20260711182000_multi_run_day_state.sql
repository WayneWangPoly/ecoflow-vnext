-- Current-run projections for sequential Run A / Run B / Run C delivery days.
-- Historic run scopes remain in ecoflow_day_state and are not overwritten.

create or replace view public.v_ecoflow_active_run
with (security_invoker=true)
as
select distinct on (d.business_day)
  d.business_day,
  coalesce(nullif(d.payload->>'activeRunCode',''),'A') as run_code,
  d.updated_by,
  d.updated_at
from public.ecoflow_day_state d
where d.scope='run-control'
order by d.business_day,d.updated_at desc;

grant select on public.v_ecoflow_active_run to authenticated;
revoke all on public.v_ecoflow_active_run from anon;

create or replace view public.v_ecoflow_pick_handoff_meta
with (security_invoker=true)
as
with active as (
  select days.business_day,coalesce(r.run_code,'A') as run_code
  from (select distinct business_day from public.ecoflow_day_state) days
  left join public.v_ecoflow_active_run r using(business_day)
), chosen as (
  select a.business_day,a.run_code,d.payload,d.updated_by,d.updated_at
  from active a
  join public.ecoflow_day_state d on d.business_day=a.business_day
   and d.scope in ('run:' || a.run_code || ':meta',case when a.run_code='A' then 'meta' else '__none__' end)
  order by a.business_day,case when d.scope like 'run:%' then 0 else 1 end,d.updated_at desc
)
select distinct on (business_day)
  business_day,
  nullif(payload->>'lockedAt','') as locked_at,
  payload->'stopOrder' as stop_order,
  payload->'boxCodes' as box_codes,
  updated_by as locked_by,
  updated_at as route_lock_synced_at,
  case when nullif(payload->>'lockedAt','') is not null then 'ROUTE_LOCKED' else 'WAITING_ROUTE_LOCK' end as handoff_status,
  run_code
from chosen
order by business_day,updated_at desc;

grant select on public.v_ecoflow_pick_handoff_meta to authenticated;
revoke all on public.v_ecoflow_pick_handoff_meta from anon;

create or replace view public.v_ecoflow_pick_task_progress
with (security_invoker=true)
as
with active as (
  select days.business_day,coalesce(r.run_code,'A') as run_code
  from (select distinct business_day from public.ecoflow_day_state) days
  left join public.v_ecoflow_active_run r using(business_day)
)
select d.business_day,
  regexp_replace(d.scope,'^(run:[A-Z]+:)?task:','') as sku,
  coalesce(d.payload->>'status','PENDING') as pick_status,
  nullif(d.payload->>'scannedValue','') as scanned_value,
  coalesce((d.payload->>'shortCartons')::numeric,0)::numeric as short_cartons,
  coalesce((d.payload->>'shortSleeves')::numeric,0)::numeric as short_sleeves,
  d.updated_by,d.updated_at,a.run_code
from active a join public.ecoflow_day_state d on d.business_day=a.business_day
where d.scope like 'run:' || a.run_code || ':task:%'
   or (a.run_code='A' and d.scope like 'task:%');

grant select on public.v_ecoflow_pick_task_progress to authenticated;
revoke all on public.v_ecoflow_pick_task_progress from anon;

create or replace view public.v_ecoflow_pick_allocation_progress
with (security_invoker=true)
as
with active as (
  select days.business_day,coalesce(r.run_code,'A') as run_code
  from (select distinct business_day from public.ecoflow_day_state) days
  left join public.v_ecoflow_active_run r using(business_day)
), rows as (
  select d.*,a.run_code,regexp_replace(d.scope,'^(run:[A-Z]+:)?alloc:','') as alloc_key
  from active a join public.ecoflow_day_state d on d.business_day=a.business_day
  where d.scope like 'run:' || a.run_code || ':alloc:%' or (a.run_code='A' and d.scope like 'alloc:%')
)
select business_day,split_part(alloc_key,'|',1) as sku,split_part(alloc_key,'|',2) as order_id,
  coalesce((payload->>'done')::boolean,false) as allocation_done,updated_by,updated_at,run_code
from rows;

grant select on public.v_ecoflow_pick_allocation_progress to authenticated;
revoke all on public.v_ecoflow_pick_allocation_progress from anon;

create or replace view public.v_ecoflow_pick_stop_staging
with (security_invoker=true)
as
with active as (
  select days.business_day,coalesce(r.run_code,'A') as run_code
  from (select distinct business_day from public.ecoflow_day_state) days
  left join public.v_ecoflow_active_run r using(business_day)
)
select d.business_day,regexp_replace(d.scope,'^(run:[A-Z]+:)?stage:','') as order_id,
  nullif(d.payload->>'stagedAt','') as staged_at,d.updated_by,d.updated_at,a.run_code
from active a join public.ecoflow_day_state d on d.business_day=a.business_day
where d.scope like 'run:' || a.run_code || ':stage:%' or (a.run_code='A' and d.scope like 'stage:%');

grant select on public.v_ecoflow_pick_stop_staging to authenticated;
revoke all on public.v_ecoflow_pick_stop_staging from anon;
