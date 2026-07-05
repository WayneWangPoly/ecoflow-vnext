-- EcoFlow shared day state + POD storage + release RPC access
-- One row per (business_day, scope). Scopes:
--   'meta'                  -> { lockedAt, stopOrder, boxCodes }   route lock (lockedAt null = unlocked)
--   'task:<sku>'            -> PickTaskState json                   bulk pick progress
--   'alloc:<sku>|<orderId>' -> { done }                             sort allocations
--   'stage:<orderId>'       -> { stagedAt }                         stop staged (null = unstaged)
--   'release:<orderId>'     -> { releasedAt, by }                   order released into today's run
--   'stop:<orderId>'        -> StopProgress json (POD as storage paths, photos never inline)
--   'route'                 -> { startedAt, endedAt }
--   'shift'                 -> { events: ShiftEvent[] }
-- Every device (driver, warehouse, office) reads and writes the same facts.

create table if not exists public.ecoflow_day_state (
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

drop trigger if exists trg_ecoflow_day_state_touch on public.ecoflow_day_state;
create trigger trg_ecoflow_day_state_touch
before insert or update on public.ecoflow_day_state
for each row execute function public.ecoflow_touch_updated_at();

create index if not exists idx_ecoflow_day_state_day_updated
  on public.ecoflow_day_state (business_day, updated_at);

alter table public.ecoflow_day_state enable row level security;

drop policy if exists ecoflow_day_state_select on public.ecoflow_day_state;
create policy ecoflow_day_state_select
  on public.ecoflow_day_state for select
  to anon, authenticated
  using (true);

drop policy if exists ecoflow_day_state_insert on public.ecoflow_day_state;
create policy ecoflow_day_state_insert
  on public.ecoflow_day_state for insert
  to anon, authenticated
  with check (true);

drop policy if exists ecoflow_day_state_update on public.ecoflow_day_state;
create policy ecoflow_day_state_update
  on public.ecoflow_day_state for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.ecoflow_day_state to anon, authenticated;

-- POD photos and signatures live in Storage; only the path syncs through day state.
insert into storage.buckets (id, name, public)
values ('pod-photos', 'pod-photos', true)
on conflict (id) do nothing;

drop policy if exists ecoflow_pod_photos_insert on storage.objects;
create policy ecoflow_pod_photos_insert
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'pod-photos');

drop policy if exists ecoflow_pod_photos_select on storage.objects;
create policy ecoflow_pod_photos_select
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'pod-photos');

drop policy if exists ecoflow_pod_photos_update on storage.objects;
create policy ecoflow_pod_photos_update
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'pod-photos')
  with check (bucket_id = 'pod-photos');

-- Let the app call the formal internalisation RPC (was service_role only).
grant execute on function public.ecoflow_internalise_ordermentum_orders(integer, boolean, boolean) to authenticated, anon;
