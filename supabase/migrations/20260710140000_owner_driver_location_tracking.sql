-- Owner delivery tracking: periodic driver positions with an auditable timeline.
-- Tracking is active only while the driver route is active; Owner/Admin can read it.

begin;

create table if not exists public.ecoflow_driver_location_samples (
  id uuid primary key default gen_random_uuid(),
  business_day date not null,
  route_id text not null,
  driver_user_id uuid not null default auth.uid(),
  driver_label text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m numeric check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 20000)),
  speed_mps numeric check (speed_mps is null or speed_mps >= 0),
  heading_degrees numeric check (heading_degrees is null or (heading_degrees >= 0 and heading_degrees <= 360)),
  current_order_id text,
  sample_source text not null default 'AUTO_INTERVAL' check (sample_source in (
    'AUTO_INTERVAL','MANUAL','ROUTE_START','ROUTE_END','STOP_ARRIVAL','DELIVERY','FAILED_DELIVERY'
  )),
  client_sample_id uuid not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  device_timezone text,
  metadata jsonb not null default '{}'::jsonb,
  constraint uq_driver_location_client_sample unique (client_sample_id)
);

create index if not exists idx_driver_location_day_time
  on public.ecoflow_driver_location_samples(business_day, captured_at desc);
create index if not exists idx_driver_location_driver_time
  on public.ecoflow_driver_location_samples(driver_user_id, captured_at desc);
create index if not exists idx_driver_location_route_time
  on public.ecoflow_driver_location_samples(route_id, captured_at desc);

create or replace function public.ecoflow_can_record_driver_location()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('DRIVER','OWNER','ADMIN')
  );
$$;

create or replace function public.ecoflow_can_view_driver_location()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  );
$$;

grant execute on function public.ecoflow_can_record_driver_location() to authenticated;
grant execute on function public.ecoflow_can_view_driver_location() to authenticated;

alter table public.ecoflow_driver_location_samples enable row level security;

drop policy if exists ecoflow_driver_location_owner_read on public.ecoflow_driver_location_samples;
create policy ecoflow_driver_location_owner_read
on public.ecoflow_driver_location_samples
for select
using (public.ecoflow_can_view_driver_location());

revoke all on public.ecoflow_driver_location_samples from anon;
revoke insert, update, delete on public.ecoflow_driver_location_samples from authenticated;
grant select on public.ecoflow_driver_location_samples to authenticated;

create or replace function public.ecoflow_record_driver_location_sample(
  p_business_day date,
  p_route_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m numeric default null,
  p_speed_mps numeric default null,
  p_heading_degrees numeric default null,
  p_current_order_id text default null,
  p_sample_source text default 'AUTO_INTERVAL',
  p_client_sample_id uuid default gen_random_uuid(),
  p_captured_at timestamptz default now(),
  p_driver_label text default null,
  p_device_timezone text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  location_id uuid,
  business_day date,
  route_id text,
  driver_user_id uuid,
  driver_label text,
  latitude double precision,
  longitude double precision,
  accuracy_m numeric,
  sample_source text,
  current_order_id text,
  captured_at timestamptz,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := upper(trim(coalesce(p_sample_source, 'AUTO_INTERVAL')));
  v_route text := nullif(trim(coalesce(p_route_id, '')), '');
  v_label text := nullif(trim(coalesce(p_driver_label, '')), '');
  v_existing_id uuid;
begin
  if auth.uid() is null or not public.ecoflow_can_record_driver_location() then
    raise exception 'DRIVER_LOCATION_ROLE_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_route is null then raise exception 'ROUTE_ID_REQUIRED'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 then raise exception 'VALID_LATITUDE_REQUIRED'; end if;
  if p_longitude is null or p_longitude not between -180 and 180 then raise exception 'VALID_LONGITUDE_REQUIRED'; end if;
  if v_source not in ('AUTO_INTERVAL','MANUAL','ROUTE_START','ROUTE_END','STOP_ARRIVAL','DELIVERY','FAILED_DELIVERY') then
    raise exception 'INVALID_LOCATION_SAMPLE_SOURCE';
  end if;
  if p_captured_at > now() + interval '10 minutes' then raise exception 'LOCATION_SAMPLE_IN_FUTURE'; end if;
  if p_captured_at < now() - interval '7 days' then raise exception 'LOCATION_SAMPLE_TOO_OLD'; end if;

  -- Protect the database from noisy browser callbacks. Event/manual samples are never throttled.
  if v_source = 'AUTO_INTERVAL' then
    select s.id into v_existing_id
    from public.ecoflow_driver_location_samples s
    where s.driver_user_id = auth.uid()
      and s.business_day = p_business_day
      and s.route_id = v_route
      and s.sample_source = 'AUTO_INTERVAL'
      and s.captured_at >= p_captured_at - interval '60 seconds'
    order by s.captured_at desc
    limit 1;
  end if;

  if v_existing_id is null then
    insert into public.ecoflow_driver_location_samples(
      business_day, route_id, driver_user_id, driver_label,
      latitude, longitude, accuracy_m, speed_mps, heading_degrees,
      current_order_id, sample_source, client_sample_id, captured_at,
      device_timezone, metadata
    ) values (
      p_business_day, v_route, auth.uid(), v_label,
      p_latitude, p_longitude, p_accuracy_m, p_speed_mps, p_heading_degrees,
      nullif(trim(coalesce(p_current_order_id, '')), ''), v_source,
      coalesce(p_client_sample_id, gen_random_uuid()), p_captured_at,
      nullif(trim(coalesce(p_device_timezone, '')), ''), coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict on constraint uq_driver_location_client_sample do nothing
    returning ecoflow_driver_location_samples.id into v_existing_id;

    if v_existing_id is null then
      select s.id into v_existing_id
      from public.ecoflow_driver_location_samples s
      where s.client_sample_id = p_client_sample_id
      limit 1;
    end if;
  end if;

  return query
  select
    s.id, s.business_day, s.route_id, s.driver_user_id, s.driver_label,
    s.latitude, s.longitude, s.accuracy_m, s.sample_source,
    s.current_order_id, s.captured_at, s.received_at
  from public.ecoflow_driver_location_samples s
  where s.id = v_existing_id;
end;
$$;

grant execute on function public.ecoflow_record_driver_location_sample(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) to authenticated;
revoke execute on function public.ecoflow_record_driver_location_sample(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) from anon;

drop view if exists public.v_ecoflow_owner_driver_location_timeline cascade;
create view public.v_ecoflow_owner_driver_location_timeline
with (security_invoker = true)
as
select
  s.id,
  s.business_day,
  s.route_id,
  s.driver_user_id,
  coalesce(s.driver_label, 'Driver') as driver_label,
  s.latitude,
  s.longitude,
  s.accuracy_m,
  s.speed_mps,
  s.heading_degrees,
  s.current_order_id,
  s.sample_source,
  s.captured_at,
  s.received_at
from public.ecoflow_driver_location_samples s
where public.ecoflow_can_view_driver_location();

grant select on public.v_ecoflow_owner_driver_location_timeline to authenticated;

drop view if exists public.v_ecoflow_owner_driver_location_latest cascade;
create view public.v_ecoflow_owner_driver_location_latest
with (security_invoker = true)
as
select distinct on (s.business_day, s.driver_user_id)
  s.id,
  s.business_day,
  s.route_id,
  s.driver_user_id,
  coalesce(s.driver_label, 'Driver') as driver_label,
  s.latitude,
  s.longitude,
  s.accuracy_m,
  s.speed_mps,
  s.heading_degrees,
  s.current_order_id,
  s.sample_source,
  s.captured_at,
  s.received_at
from public.ecoflow_driver_location_samples s
where public.ecoflow_can_view_driver_location()
order by s.business_day, s.driver_user_id, s.captured_at desc;

grant select on public.v_ecoflow_owner_driver_location_latest to authenticated;

notify pgrst, 'reload schema';
commit;
