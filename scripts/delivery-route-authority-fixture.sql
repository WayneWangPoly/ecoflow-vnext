-- Minimal production-shaped auth/team fixture for TRANSFORM-006 route authority tests.
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
