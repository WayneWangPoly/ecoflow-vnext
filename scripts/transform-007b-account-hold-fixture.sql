\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

create schema if not exists auth;

grant usage on schema public, auth to anon, authenticated;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to public, anon, authenticated;

create table public.user_profiles (
  user_id uuid primary key,
  role text not null,
  is_active boolean not null default true
);

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.role
  from public.user_profiles as p
  where p.user_id = auth.uid()
    and p.is_active is true
  limit 1
$$;

grant execute on function public.ecoflow_active_app_role() to public, anon, authenticated;

create table public.ordermentum_stores (
  store_id text primary key,
  store_name text not null
);

create table public.ecoflow_account_release_holds (
  store_id text primary key,
  active boolean not null default true,
  hold_reason text,
  source_action_id uuid,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.ecoflow_account_release_holds enable row level security;

create policy "account release holds authenticated read"
  on public.ecoflow_account_release_holds
  for select
  to authenticated
  using (true);

create policy "account release holds write insert"
  on public.ecoflow_account_release_holds
  for insert
  to authenticated
  with check (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT'));

create policy "account release holds write update"
  on public.ecoflow_account_release_holds
  for update
  to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT'))
  with check (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT'));

create policy "account release holds write delete"
  on public.ecoflow_account_release_holds
  for delete
  to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT'));

grant select, insert, update, delete on public.ecoflow_account_release_holds to authenticated;

create table public.ecoflow_account_statement_actions (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  action_kind text not null,
  action_metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.ecoflow_account_statement_actions enable row level security;

create policy "account statement actions authenticated read"
  on public.ecoflow_account_statement_actions
  for select
  to authenticated
  using (true);

create policy "account statement actions write insert"
  on public.ecoflow_account_statement_actions
  for insert
  to authenticated
  with check (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT'));

grant select, insert on public.ecoflow_account_statement_actions to authenticated;

insert into public.user_profiles (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'OWNER'),
  ('22222222-2222-2222-2222-222222222222', 'ADMIN'),
  ('33333333-3333-3333-3333-333333333333', 'ACCOUNT'),
  ('44444444-4444-4444-4444-444444444444', 'VIEWER'),
  ('55555555-5555-5555-5555-555555555555', 'WAREHOUSE'),
  ('66666666-6666-6666-6666-666666666666', 'DRIVER');

insert into public.ordermentum_stores (store_id, store_name) values
  ('STORE-1', 'Fixture Store One'),
  ('STORE-2', 'Fixture Store Two'),
  ('STORE-3', 'Fixture Store Three');
