-- EcoFlow pick state sync
-- Shared picking progress (route lock, bulk tasks, allocations, staged stops)
-- so every device sees the same pick board in near-real-time.
-- One row per (business_day, scope); scopes are:
--   'meta'            -> { lockedAt, stopOrder, boxCodes } (lockedAt null = route unlocked)
--   'task:<sku>'      -> PickTaskState json
--   'alloc:<sku>|<orderId>' -> { done }
--   'stage:<orderId>' -> { stagedAt } (null = unstaged)

create table if not exists public.ecoflow_pick_state (
  business_day date not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (business_day, scope)
);

create or replace function public.ecoflow_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_pick_state_touch on public.ecoflow_pick_state;
create trigger trg_ecoflow_pick_state_touch
before insert or update on public.ecoflow_pick_state
for each row execute function public.ecoflow_touch_updated_at();

create index if not exists idx_ecoflow_pick_state_day_updated
  on public.ecoflow_pick_state (business_day, updated_at);

alter table public.ecoflow_pick_state enable row level security;

drop policy if exists ecoflow_pick_state_select on public.ecoflow_pick_state;
create policy ecoflow_pick_state_select
  on public.ecoflow_pick_state for select
  to anon, authenticated
  using (true);

drop policy if exists ecoflow_pick_state_insert on public.ecoflow_pick_state;
create policy ecoflow_pick_state_insert
  on public.ecoflow_pick_state for insert
  to anon, authenticated
  with check (true);

drop policy if exists ecoflow_pick_state_update on public.ecoflow_pick_state;
create policy ecoflow_pick_state_update
  on public.ecoflow_pick_state for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.ecoflow_pick_state to anon, authenticated;
