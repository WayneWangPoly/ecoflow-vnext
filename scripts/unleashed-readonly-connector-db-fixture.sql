\set ON_ERROR_STOP on

-- Minimal EcoFlow dependency shell for UNLEASHED-MIGRATION-002 SQL contract
-- checks. This mirrors dependency names used by production without importing
-- business data.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.active_app_role', true), ''), 'OWNER')
$$;

create table if not exists public.app_user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  app_role text,
  team_status text,
  is_active boolean default true
);

create table if not exists public.app_security_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action text,
  target_type text,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);
