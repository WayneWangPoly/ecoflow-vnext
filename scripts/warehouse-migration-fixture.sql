-- Minimal representation of the production schema immediately before the
-- 20260710 warehouse hardening migrations. Used only by CI migration tests.

create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists extensions;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role()
returns text language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
create or replace function auth.jwt()
returns jsonb language sql stable
as $$ select '{}'::jsonb $$;

create table public.app_user_profiles (
  user_id uuid primary key references auth.users(id),
  app_role text not null,
  is_active boolean not null default true,
  team_status text not null default 'ACTIVE'
);

create or replace function public.ecoflow_can_manage_warehouse()
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.app_user_profiles p
    where p.user_id=auth.uid() and p.is_active and p.team_status='ACTIVE'
      and p.app_role in ('OWNER','ADMIN','WAREHOUSE')
  )
$$;

create or replace function public.ecoflow_can_read_warehouse()
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.app_user_profiles p
    where p.user_id=auth.uid() and p.is_active and p.team_status='ACTIVE'
  )
$$;

create table public.fixture_sku_velocity (
  sku text primary key,
  product_name text,
  units_30d numeric default 0
);
create view public.v_ecoflow_owner_sku_velocity as
select f.sku,f.product_name,f.units_30d from public.fixture_sku_velocity f;

create table public.ecoflow_barcode_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text,
  target_area text,
  session_status text default 'OPEN',
  created_by uuid,
  created_at timestamptz default now(),
  closed_at timestamptz
);

create table public.ecoflow_sku_barcode_registry (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  barcode text not null unique,
  package_level text not null default 'UNKNOWN',
  units_per_barcode numeric not null default 1,
  product_name text,
  fixed_shelf text,
  source_session_id uuid,
  scan_count integer not null default 1,
  first_scanned_at timestamptz default now(),
  last_scanned_at timestamptz default now(),
  verified boolean not null default false,
  note text
);

create table public.ecoflow_barcode_scan_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  sku text,
  barcode text,
  package_level text,
  units_per_barcode numeric,
  product_name text,
  shelf text,
  qty_observed numeric,
  action_mode text,
  scan_status text,
  movement_id uuid,
  scan_note text,
  scanned_by uuid,
  scanned_at timestamptz default now()
);

create table public.ecoflow_sku_package_policies (
  sku text primary key,
  product_name text,
  package_mode text not null default 'UNKNOWN',
  default_units_per_carton numeric,
  default_units_per_sleeve numeric,
  default_units_per_each numeric,
  default_shelf text,
  policy_note text,
  updated_by uuid,
  updated_at timestamptz default now()
);

create table public.ecoflow_inventory_sku_controls (
  sku text primary key,
  product_name text,
  category text,
  fixed_shelf text,
  primary_barcode text,
  reorder_target numeric,
  on_hand_estimate numeric,
  status text default 'ACTIVE',
  owner_note text,
  updated_by uuid,
  updated_at timestamptz default now()
);

create table public.ecoflow_inventory_sku_actions (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  action text not null,
  action_value text,
  action_note text,
  execution_status text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  error_message text,
  executed_by uuid,
  executed_at timestamptz default now()
);

create table public.ecoflow_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  product_name text,
  movement_type text not null,
  quantity numeric not null,
  from_location text,
  to_location text,
  reference_type text,
  reference_id text,
  store_id text,
  action_note text,
  source text,
  moved_by uuid,
  moved_at timestamptz default now()
);

-- Reproduce the legacy browser-write grants so the final-state hotfix contract
-- proves that it removes them.
grant select, insert, update on public.ecoflow_barcode_scan_sessions to authenticated;
grant select, insert, update on public.ecoflow_sku_barcode_registry to authenticated;
grant select, insert on public.ecoflow_barcode_scan_events to authenticated;
grant select, insert, update on public.ecoflow_sku_package_policies to authenticated;
grant select, insert, update on public.ecoflow_inventory_sku_controls to authenticated;
grant select, insert on public.ecoflow_inventory_sku_actions to authenticated;
grant select, insert on public.ecoflow_inventory_movements to authenticated;

create table public.ecoflow_warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  location_code text not null unique,
  rack_id text not null,
  rack_title text not null,
  side text not null default 'front',
  bin_code text,
  level_code text,
  half_code text,
  display_level text not null,
  location_category text,
  status text not null default 'ACTIVE',
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.ecoflow_warehouse_location_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.ecoflow_warehouse_locations(id),
  sku text not null,
  product_name text,
  source_barcode text,
  unit_level text not null default 'unknown',
  quantity numeric not null default 0,
  status text not null default 'ACTIVE',
  last_movement_at timestamptz,
  last_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(location_id,sku,unit_level)
);

create table public.ecoflow_warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null,
  location_id uuid references public.ecoflow_warehouse_locations(id),
  to_location_id uuid references public.ecoflow_warehouse_locations(id),
  sku text,
  product_name text,
  barcode text,
  unit_level text,
  quantity numeric,
  note text,
  actor_user_id uuid,
  created_at timestamptz default now()
);

create table public.ecoflow_warehouse_receiving_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique default ('RCV-' || upper(substr(gen_random_uuid()::text,1,8))),
  supplier_name text,
  supplier_order_ref text,
  invoice_ref text,
  batch_status text not null default 'SCANNING',
  batch_note text,
  created_by uuid,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.ecoflow_warehouse_receiving_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_warehouse_receiving_batches(id),
  sku text not null,
  product_name text,
  barcode text not null,
  package_level text not null,
  qty_packages numeric not null,
  units_per_package numeric not null,
  units_received numeric not null,
  suggested_location text,
  confirmation_checked boolean not null default false,
  line_status text not null default 'WAITING_CONFIRM',
  movement_id uuid,
  line_note text,
  scanned_by uuid,
  scanned_at timestamptz default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_at timestamptz default now()
);

create view public.v_ecoflow_warehouse_receiving_batches as
select b.*,
  (select count(*) from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id)::numeric as line_count,
  (select count(*) from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.confirmation_checked)::numeric as confirmed_count,
  (select count(*) from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status='POSTED')::numeric as posted_count,
  (select coalesce(sum(l.units_received),0) from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id)::numeric as total_units,
  'SCAN_FIRST_ITEM'::text as receive_signal
from public.ecoflow_warehouse_receiving_batches b;

create view public.v_ecoflow_warehouse_receiving_batch_lines as
select l.*,b.batch_no,b.batch_status
from public.ecoflow_warehouse_receiving_lines l
join public.ecoflow_warehouse_receiving_batches b on b.id=l.batch_id;
