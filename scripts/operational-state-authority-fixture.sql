\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;

create schema auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.app_user_profiles (
  user_id uuid primary key,
  app_role text not null,
  is_active boolean not null default true,
  team_status text not null default 'ACTIVE'
);

insert into public.app_user_profiles(user_id, app_role) values
  ('00000000-0000-0000-0000-000000000001', 'OWNER'),
  ('00000000-0000-0000-0000-000000000002', 'OWNER'),
  ('00000000-0000-0000-0000-000000000003', 'DRIVER'),
  ('00000000-0000-0000-0000-000000000004', 'VIEWER');

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.app_role
  from public.app_user_profiles p
  where p.user_id = auth.uid()
    and p.is_active = true
    and p.team_status = 'ACTIVE'
  limit 1
$$;

grant execute on function public.ecoflow_active_app_role() to authenticated;

create or replace function public.ecoflow_can_write_day_scope(p_scope text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_scope text := regexp_replace(coalesce(p_scope, ''), '^run:[A-Z]+:', '');
begin
  if v_role in ('OWNER','ADMIN') then return true; end if;
  if p_scope = 'run-control' or v_scope = 'meta' or v_scope like 'release:%' then
    return v_role = 'ACCOUNT';
  end if;
  if v_scope like 'task:%' or v_scope like 'alloc:%' or v_scope like 'stage:%' or v_scope like 'prep:%' then
    return v_role in ('WAREHOUSE','DRIVER');
  end if;
  if v_scope like 'stop:%' or v_scope = 'route' or p_scope = 'shift' then
    return v_role = 'DRIVER';
  end if;
  return false;
end;
$$;

grant execute on function public.ecoflow_can_write_day_scope(text) to authenticated;

create sequence public.ecoflow_day_state_change_seq;

create table public.ecoflow_day_state (
  business_day date not null,
  scope text not null,
  payload jsonb not null,
  updated_by text,
  updated_at timestamptz not null default clock_timestamp(),
  change_seq bigint not null default nextval('public.ecoflow_day_state_change_seq'::regclass),
  primary key (business_day, scope)
);

alter sequence public.ecoflow_day_state_change_seq owned by public.ecoflow_day_state.change_seq;

create or replace function public.ecoflow_touch_day_state_change_seq()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := clock_timestamp();
  new.change_seq := nextval('public.ecoflow_day_state_change_seq'::regclass);
  return new;
end;
$$;

create trigger trg_ecoflow_day_state_change_seq
before insert or update on public.ecoflow_day_state
for each row execute function public.ecoflow_touch_day_state_change_seq();

alter table public.ecoflow_day_state enable row level security;
grant select, insert, update on public.ecoflow_day_state to authenticated;
create policy ecoflow_day_state_active_read
on public.ecoflow_day_state for select to authenticated
using (public.ecoflow_active_app_role() is not null);
create policy ecoflow_day_state_scoped_insert
on public.ecoflow_day_state for insert to authenticated
with check (public.ecoflow_can_write_day_scope(scope));
create policy ecoflow_day_state_scoped_update
on public.ecoflow_day_state for update to authenticated
using (public.ecoflow_can_write_day_scope(scope))
with check (public.ecoflow_can_write_day_scope(scope));

\i supabase/migrations/20260801053000_operational_state_authority.sql
\i scripts/operational-state-authority-contract-test.sql
