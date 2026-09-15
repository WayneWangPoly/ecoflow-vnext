\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant usage on schema public to anon,authenticated,service_role;

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
grant usage on schema extensions to authenticated,service_role;
grant execute on function extensions.digest(text,text) to authenticated,service_role;

create table public.app_user_profiles(
  user_id uuid primary key,
  app_role text not null,
  team_status text not null default 'ACTIVE',
  is_active boolean not null default true
);

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select p.app_role
  from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active and p.team_status='ACTIVE'
$$;
grant execute on function public.ecoflow_active_app_role() to authenticated;

create table public.customers(
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  display_name text not null,
  invoice_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.addresses(
  id uuid primary key default gen_random_uuid(),
  line1 text not null,
  line2 text,
  suburb text not null,
  state text not null,
  postcode text not null,
  country text not null default 'AU',
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_sites(
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_code text not null unique,
  display_name text not null,
  address_id uuid references public.addresses(id),
  contact_name text,
  phone text,
  delivery_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.external_customer_mappings(
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider='ORDERMENTUM'),
  external_customer_id text not null,
  external_customer_name text,
  customer_id uuid not null references public.customers(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,external_customer_id)
);

create table public.ecoflow_unleashed_master_mappings(
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null unique default gen_random_uuid(),
  entity_type text not null,
  mapping_status text not null default 'UNMATCHED',
  source_external_guid text,
  source_external_code text,
  source_external_key text not null,
  source_payload_sha256 text not null,
  source_observed_at timestamptz not null default now(),
  canonical_object_type text,
  canonical_object_id uuid,
  canonical_code text,
  ordermentum_external_id text,
  match_method text,
  candidate_count integer not null default 0,
  source_duplicate_count integer not null default 1,
  candidate_set_sha256 text not null default repeat('0',64),
  decision_source text not null default 'AUTO',
  revision bigint not null default 0,
  last_planned_run_id uuid,
  last_planned_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.unleashed_raw_snapshots(
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  external_key text not null,
  external_guid text,
  external_code text,
  external_number text,
  display_name text,
  source_last_modified_at timestamptz,
  payload jsonb not null,
  payload_sha256 text not null,
  payload_object_keys text[] not null default '{}',
  first_seen_run_id uuid,
  last_seen_run_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  version_count integer not null default 1,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(resource,external_key)
);

create table public.ordermentum_raw_master_resources(
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  external_id text not null,
  supplier_id text,
  source_endpoint text not null default '/fixture',
  source_method text not null default 'GET',
  request_query jsonb not null default '{}',
  payload jsonb not null,
  payload_hash text not null,
  remote_created_at timestamptz,
  remote_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  is_deleted_or_missing boolean not null default false,
  sync_run_id uuid,
  previous_payload_hash text,
  invoice_projected_payload_hash text,
  invoice_projected_at timestamptz,
  unique(resource_type,external_id)
);

create table public.fixture_ordermentum_customer_master(
  external_purchaser_id text primary key,
  external_retailer_id text,
  customer_or_store_name text,
  email text,
  phone text,
  suburb text,
  postcode text
);

create or replace view public.v_ecoflow_ordermentum_customer_master_v1 as
select
  external_purchaser_id,
  external_retailer_id,
  customer_or_store_name,
  null::text as business_name,
  null::text as contact_name,
  email,
  phone,
  null::text as address_line_1,
  null::text as address_line_2,
  suburb,
  null::text as state,
  postcode,
  'AU'::text as country,
  null::numeric as latitude,
  null::numeric as longitude,
  null::text as external_price_group_id,
  null::text as price_group_name,
  null::text as delivery_instructions,
  'active'::text as customer_status,
  null::timestamptz as remote_created_at,
  null::timestamptz as remote_updated_at,
  now() as first_seen_at,
  now() as last_seen_at,
  now() as last_synced_at,
  '{}'::jsonb as raw_payload
from public.fixture_ordermentum_customer_master;

insert into public.app_user_profiles(user_id,app_role,team_status,is_active) values
('11111111-1111-4111-8111-111111111111','OWNER','ACTIVE',true),
('22222222-2222-4222-8222-222222222222','VIEWER','ACTIVE',true),
('33333333-3333-4333-8333-333333333333','ADMIN','INVITED',false);
