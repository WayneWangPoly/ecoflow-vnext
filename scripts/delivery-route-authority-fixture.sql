-- Minimal production-shaped auth/team/shared-state fixture for TRANSFORM-006 route authority tests.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('app.test_user_id',true),''),
    '11111111-1111-4111-8111-111111111111'
  )::uuid
$$;

create or replace function public.ecoflow_active_app_role() returns text
language sql stable
as $$ select coalesce(nullif(current_setting('app.test_role',true),''),'OWNER')::text $$;

create table public.ecoflow_test_team_members(
  user_id uuid primary key,
  email text not null,
  display_name text,
  app_role text not null,
  team_status text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.ecoflow_test_team_members(user_id,email,display_name,app_role,team_status,is_active) values
  ('11111111-1111-4111-8111-111111111111','driver-a@example.test','Driver A','DRIVER','ACTIVE',true),
  ('22222222-2222-4222-8222-222222222222','driver-b@example.test','Driver B','DRIVER','ACTIVE',true),
  ('33333333-3333-4333-8333-333333333333','accounts@example.test','Accounts User','ACCOUNT','ACTIVE',true),
  ('44444444-4444-4444-8444-444444444444','driver-disabled@example.test','Driver Disabled','DRIVER','SUSPENDED',false);

create or replace view public.v_ecoflow_team_members_secure as
select user_id,email,display_name,app_role,team_status,is_active,created_at
from public.ecoflow_test_team_members;

-- Pre-authority shared operational state. The production migration under test
-- removes direct browser writes and installs CAS/idempotent command authority.
create or replace function public.ecoflow_can_write_day_scope(p_scope text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_scope text:=regexp_replace(coalesce(p_scope,''),'^run:[A-Z]+:','');
begin
  if v_role in ('OWNER','ADMIN') then return true; end if;
  if p_scope='run-control' or v_scope='meta' or v_scope like 'release:%' then
    return v_role='ACCOUNT';
  end if;
  if v_scope like 'task:%' or v_scope like 'alloc:%' or v_scope like 'stage:%' or v_scope like 'prep:%' then
    return v_role in ('WAREHOUSE','DRIVER');
  end if;
  if v_scope like 'stop:%' or v_scope='route' or p_scope='shift' then
    return v_role='DRIVER';
  end if;
  return false;
end;
$$;

grant execute on function public.ecoflow_can_write_day_scope(text) to authenticated;

create sequence public.ecoflow_day_state_change_seq;

create table public.ecoflow_day_state(
  business_day date not null,
  scope text not null,
  payload jsonb not null,
  updated_by text,
  updated_at timestamptz not null default clock_timestamp(),
  change_seq bigint not null default nextval('public.ecoflow_day_state_change_seq'::regclass),
  primary key(business_day,scope)
);

alter sequence public.ecoflow_day_state_change_seq owned by public.ecoflow_day_state.change_seq;

create or replace function public.ecoflow_touch_day_state_change_seq()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  new.updated_at:=clock_timestamp();
  new.change_seq:=nextval('public.ecoflow_day_state_change_seq'::regclass);
  return new;
end;
$$;

create trigger trg_ecoflow_day_state_change_seq
before insert or update on public.ecoflow_day_state
for each row execute function public.ecoflow_touch_day_state_change_seq();

alter table public.ecoflow_day_state enable row level security;
grant select,insert,update on public.ecoflow_day_state to authenticated;
create policy ecoflow_day_state_active_read
on public.ecoflow_day_state for select to authenticated
using(public.ecoflow_active_app_role() is not null);
create policy ecoflow_day_state_scoped_insert
on public.ecoflow_day_state for insert to authenticated
with check(public.ecoflow_can_write_day_scope(scope));
create policy ecoflow_day_state_scoped_update
on public.ecoflow_day_state for update to authenticated
using(public.ecoflow_can_write_day_scope(scope))
with check(public.ecoflow_can_write_day_scope(scope));
