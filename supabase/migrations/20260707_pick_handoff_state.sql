-- Pick handoff state.
-- Shared state table used by driver route lock, warehouse pick progress, staging, loading and POD sync.
-- This is intentionally small: the mobile apps write per-scope rows and all roles read the same facts.

create table if not exists public.ecoflow_day_state (
  business_day text not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (business_day, scope)
);

create index if not exists idx_ecoflow_day_state_business_updated on public.ecoflow_day_state(business_day, updated_at desc);
create index if not exists idx_ecoflow_day_state_scope on public.ecoflow_day_state(scope);

grant select, insert, update on public.ecoflow_day_state to anon, authenticated;

-- Keep updated_at correct for REST upserts from the mobile clients.
create or replace function public.ecoflow_touch_day_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_day_state_touch on public.ecoflow_day_state;
create trigger trg_ecoflow_day_state_touch
before update on public.ecoflow_day_state
for each row execute function public.ecoflow_touch_day_state_updated_at();

-- Compact route lock fact: this is what warehouse waits for before picking.
drop view if exists public.v_ecoflow_pick_handoff_meta cascade;
create view public.v_ecoflow_pick_handoff_meta as
select
  business_day,
  nullif(payload->>'lockedAt', '') as locked_at,
  payload->'stopOrder' as stop_order,
  payload->'boxCodes' as box_codes,
  updated_by as locked_by,
  updated_at as route_lock_synced_at,
  case
    when nullif(payload->>'lockedAt', '') is not null then 'ROUTE_LOCKED'
    else 'WAITING_ROUTE_LOCK'
  end as handoff_status
from public.ecoflow_day_state
where scope = 'meta';

grant select on public.v_ecoflow_pick_handoff_meta to anon, authenticated;

-- Pick task progress per SKU.
drop view if exists public.v_ecoflow_pick_task_progress cascade;
create view public.v_ecoflow_pick_task_progress as
select
  business_day,
  replace(scope, 'task:', '') as sku,
  coalesce(payload->>'status', 'PENDING') as pick_status,
  nullif(payload->>'scannedValue', '') as scanned_value,
  coalesce((payload->>'shortCartons')::numeric, 0)::numeric as short_cartons,
  coalesce((payload->>'shortSleeves')::numeric, 0)::numeric as short_sleeves,
  updated_by,
  updated_at
from public.ecoflow_day_state
where scope like 'task:%';

grant select on public.v_ecoflow_pick_task_progress to anon, authenticated;

-- Allocation progress per SKU/order. This is the sort-into-box layer.
drop view if exists public.v_ecoflow_pick_allocation_progress cascade;
create view public.v_ecoflow_pick_allocation_progress as
select
  business_day,
  split_part(replace(scope, 'alloc:', ''), '|', 1) as sku,
  split_part(replace(scope, 'alloc:', ''), '|', 2) as order_id,
  coalesce((payload->>'done')::boolean, false) as allocation_done,
  updated_by,
  updated_at
from public.ecoflow_day_state
where scope like 'alloc:%';

grant select on public.v_ecoflow_pick_allocation_progress to anon, authenticated;

-- Stop staging progress. This is when warehouse has sealed/labeled/staged a stop.
drop view if exists public.v_ecoflow_pick_stop_staging cascade;
create view public.v_ecoflow_pick_stop_staging as
select
  business_day,
  replace(scope, 'stage:', '') as order_id,
  nullif(payload->>'stagedAt', '') as staged_at,
  updated_by,
  updated_at
from public.ecoflow_day_state
where scope like 'stage:%';

grant select on public.v_ecoflow_pick_stop_staging to anon, authenticated;

-- One-row progress dashboard per day. It is deliberately source-agnostic: the app computes task and stop details,
-- this view proves the shared handoff is moving.
drop view if exists public.v_ecoflow_pick_handoff_progress cascade;
create view public.v_ecoflow_pick_handoff_progress as
with days as (
  select distinct business_day from public.ecoflow_day_state
), meta as (
  select business_day, locked_at, locked_by, handoff_status, route_lock_synced_at
  from public.v_ecoflow_pick_handoff_meta
), task_counts as (
  select
    business_day,
    count(*)::numeric as task_count,
    count(*) filter (where pick_status = 'PICKED')::numeric as picked_task_count,
    count(*) filter (where pick_status <> 'PICKED')::numeric as open_task_count,
    coalesce(sum(short_cartons + short_sleeves), 0)::numeric as short_units
  from public.v_ecoflow_pick_task_progress
  group by business_day
), alloc_counts as (
  select
    business_day,
    count(*)::numeric as allocation_count,
    count(*) filter (where allocation_done)::numeric as done_allocation_count
  from public.v_ecoflow_pick_allocation_progress
  group by business_day
), stage_counts as (
  select
    business_day,
    count(*)::numeric as staged_stop_count
  from public.v_ecoflow_pick_stop_staging
  where staged_at is not null
  group by business_day
)
select
  d.business_day,
  coalesce(m.handoff_status, 'WAITING_ROUTE_LOCK') as handoff_status,
  m.locked_at,
  m.locked_by,
  m.route_lock_synced_at,
  coalesce(t.task_count, 0)::numeric as task_count,
  coalesce(t.picked_task_count, 0)::numeric as picked_task_count,
  coalesce(t.open_task_count, 0)::numeric as open_task_count,
  coalesce(t.short_units, 0)::numeric as short_units,
  coalesce(a.allocation_count, 0)::numeric as allocation_count,
  coalesce(a.done_allocation_count, 0)::numeric as done_allocation_count,
  coalesce(s.staged_stop_count, 0)::numeric as staged_stop_count,
  case
    when m.locked_at is null then 'WAITING_DRIVER_ROUTE'
    when coalesce(t.task_count, 0) = 0 then 'PICK_READY'
    when coalesce(t.open_task_count, 0) > 0 then 'PICKING'
    when coalesce(a.allocation_count, 0) = 0 or coalesce(a.done_allocation_count, 0) < coalesce(a.allocation_count, 0) then 'SORTING'
    else 'STAGING_OR_READY_TO_LOAD'
  end as warehouse_phase
from days d
left join meta m on m.business_day = d.business_day
left join task_counts t on t.business_day = d.business_day
left join alloc_counts a on a.business_day = d.business_day
left join stage_counts s on s.business_day = d.business_day;

grant select on public.v_ecoflow_pick_handoff_progress to anon, authenticated;

notify pgrst, 'reload schema';
