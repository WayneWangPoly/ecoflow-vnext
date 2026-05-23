-- EcoFlow vNext clean Supabase schema
-- WARNING: this is a rebuild script. It drops EcoFlow trial tables and recreates them.
-- Use only when you are comfortable resetting the current pilot schema.
-- It uses the current field names from the real trial baseline:
--   skus.sku_code
--   skus.display_name
--   barcodes.barcode_value as text
--   barcodes.barcode_type + barcodes.unit_level
--   warehouse_locations.location_code + warehouse_locations.barcode_value

create extension if not exists "pgcrypto";

-- Drop child tables first.
drop table if exists public.audit_events cascade;
drop table if exists public.pod_photos cascade;
drop table if exists public.delivery_events cascade;
drop table if exists public.delivery_stops cascade;
drop table if exists public.delivery_runs cascade;
drop table if exists public.pack_items cascade;
drop table if exists public.pack_jobs cascade;
drop table if exists public.pick_tasks cascade;
drop table if exists public.pick_waves cascade;
drop table if exists public.receiving_lines cascade;
drop table if exists public.receiving_batches cascade;
drop table if exists public.stock_movements cascade;
drop table if exists public.inventory_balances cascade;
drop table if exists public.order_notes cascade;
drop table if exists public.order_status_history cascade;
drop table if exists public.order_lines cascade;
drop table if exists public.order_external_refs cascade;
drop table if exists public.orders cascade;
drop table if exists public.import_exceptions cascade;
drop table if exists public.external_order_lines cascade;
drop table if exists public.external_orders cascade;
drop table if exists public.order_import_batches cascade;
drop table if exists public.external_site_mappings cascade;
drop table if exists public.external_customer_mappings cascade;
drop table if exists public.external_product_mappings cascade;
drop table if exists public.warehouse_locations cascade;
drop table if exists public.barcodes cascade;
drop table if exists public.sku_units cascade;
drop table if exists public.skus cascade;
drop table if exists public.customer_sites cascade;
drop table if exists public.customers cascade;
drop table if exists public.addresses cascade;
drop table if exists public.warehouses cascade;
drop table if exists public.user_roles cascade;
drop table if exists public.users cascade;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner','warehouse','picker','driver')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, role)
);

create table public.addresses (
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

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  display_name text not null,
  invoice_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_sites (
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

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null unique,
  display_name text not null,
  category text,
  can_sell_by_carton boolean not null default true,
  can_sell_by_sleeve boolean not null default true,
  sleeves_per_carton integer,
  pieces_per_sleeve integer,
  default_storage_unit text not null default 'carton',
  default_pick_unit text not null default 'sleeve',
  package_weight numeric,
  can_mix_pack boolean not null default true,
  setup_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sku_units (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus(id) on delete cascade,
  unit_level text not null check (unit_level in ('carton','sleeve','inner','piece','box','pack')),
  quantity_in_base_unit numeric not null check (quantity_in_base_unit > 0),
  is_default_receiving_unit boolean not null default false,
  is_default_picking_unit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sku_id, unit_level)
);

create table public.barcodes (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus(id) on delete cascade,
  barcode_value text not null,
  barcode_type text not null check (barcode_type in ('carton','sleeve','inner','piece','location','package','supplier','unknown')),
  unit_level text not null check (unit_level in ('carton','sleeve','inner','piece','location','package','unknown')),
  quantity_in_base_unit numeric not null check (quantity_in_base_unit > 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique(barcode_value)
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null unique,
  display_name text not null,
  address_id uuid references public.addresses(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references public.warehouses(id) on delete cascade,
  location_code text not null unique,
  zone text not null,
  bay text,
  level text,
  side text,
  barcode_value text not null unique,
  location_type text not null default 'rack' check (location_type in ('rack','shelf','floor','staging','receiving','dispatch','damaged','return','quarantine')),
  sort_order integer not null default 0,
  is_pickable boolean not null default true,
  is_staging boolean not null default false,
  is_active boolean not null default true,
  assigned_sku_id uuid references public.skus(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.external_product_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('ORDERMENTUM')),
  external_product_code text not null,
  internal_sku_id uuid not null references public.skus(id),
  default_unit_level text not null default 'sleeve',
  confidence text not null default 'EXACT',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_product_code)
);

create table public.external_customer_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('ORDERMENTUM')),
  external_customer_id text not null,
  external_customer_name text,
  customer_id uuid not null references public.customers(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_customer_id)
);

create table public.external_site_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('ORDERMENTUM')),
  external_site_id text not null,
  external_site_name text,
  customer_site_id uuid not null references public.customer_sites(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_site_id)
);

create table public.order_import_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('ORDERMENTUM')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('STARTED','COMPLETED','FAILED','PARTIAL')),
  total_orders integer not null default 0,
  imported_orders integer not null default 0,
  failed_orders integer not null default 0,
  created_by_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.external_orders (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('ORDERMENTUM')),
  external_order_id text not null,
  external_order_number text not null,
  external_customer_id text,
  external_customer_name text,
  external_site_id text,
  external_site_name text,
  external_invoice_id text,
  external_invoice_number text,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  import_batch_id uuid references public.order_import_batches(id),
  import_status text not null check (import_status in ('IMPORTED','EXCEPTION','DUPLICATE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_order_id)
);

create table public.external_order_lines (
  id uuid primary key default gen_random_uuid(),
  external_order_id uuid not null references public.external_orders(id) on delete cascade,
  external_line_id text not null,
  external_sku_code text,
  external_product_name text not null,
  external_barcode text,
  quantity numeric not null,
  unit text,
  raw_payload jsonb not null default '{}'::jsonb,
  import_status text not null check (import_status in ('IMPORTED','EXCEPTION')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(external_order_id, external_line_id)
);

create table public.import_exceptions (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.order_import_batches(id),
  external_order_id uuid references public.external_orders(id),
  external_order_line_id uuid references public.external_order_lines(id),
  exception_type text not null,
  message text not null,
  raw_payload jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','IGNORED')),
  resolved_by_user_id uuid references public.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id),
  customer_site_id uuid not null references public.customer_sites(id),
  status text not null check (status in ('IMPORTED','IMPORT_EXCEPTION','REVIEW_READY','APPROVED','STOCK_RESERVED','PICKING','PACKED','ASSIGNED_TO_RUN','OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCELLED','ON_HOLD','EXCEPTION')),
  delivery_date date,
  delivery_zone text,
  owner_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_external_refs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null check (provider in ('ORDERMENTUM')),
  external_order_id text not null,
  external_order_number text not null,
  external_invoice_id text,
  external_invoice_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_order_id)
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  status text not null check (status in ('REQUESTED','RESERVED','PICKED','SHORT','SUBSTITUTED','CANCELLED')),
  requested_quantity numeric not null,
  reserved_quantity numeric not null default 0,
  picked_quantity numeric not null default 0,
  packed_quantity numeric not null default 0,
  display_name_snapshot text not null,
  external_line_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  location_id uuid not null references public.warehouse_locations(id),
  sku_id uuid not null references public.skus(id),
  quantity_on_hand numeric not null default 0,
  quantity_reserved numeric not null default 0,
  quantity_available numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(warehouse_id, location_id, sku_id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (movement_type in ('RECEIVE','PUTAWAY','RESERVE','PICK','PACK','DISPATCH','ADJUST','RETURN','DAMAGED','TRANSFER')),
  warehouse_id uuid not null references public.warehouses(id),
  from_location_id uuid references public.warehouse_locations(id),
  to_location_id uuid references public.warehouse_locations(id),
  sku_id uuid not null references public.skus(id),
  quantity numeric not null,
  reference_type text,
  reference_id uuid,
  created_by_user_id uuid references public.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.receiving_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  warehouse_id uuid not null references public.warehouses(id),
  status text not null,
  sku_line_count integer not null default 0,
  carton_count integer not null default 0,
  staged_location_id uuid not null references public.warehouse_locations(id),
  received_by_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.receiving_lines (
  id uuid primary key default gen_random_uuid(),
  receiving_batch_id uuid not null references public.receiving_batches(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  barcode_id uuid references public.barcodes(id),
  quantity numeric not null,
  unit_level text not null,
  quantity_in_base_unit numeric not null,
  to_location_id uuid not null references public.warehouse_locations(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pick_waves (
  id uuid primary key default gen_random_uuid(),
  wave_number text not null unique,
  warehouse_id uuid not null references public.warehouses(id),
  delivery_zone text,
  status text not null check (status in ('OPEN','IN_PROGRESS','PICKED','PACKED','CANCELLED')),
  order_count integer not null default 0,
  task_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pick_tasks (
  id uuid primary key default gen_random_uuid(),
  pick_wave_id uuid not null references public.pick_waves(id),
  order_id uuid not null references public.orders(id),
  order_line_id uuid not null references public.order_lines(id),
  sku_id uuid not null references public.skus(id),
  from_location_id uuid not null references public.warehouse_locations(id),
  requested_quantity numeric not null,
  picked_quantity numeric not null default 0,
  status text not null check (status in ('OPEN','IN_PROGRESS','PICKED','SHORT','CANCELLED')),
  assigned_to_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pack_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  status text not null,
  packed_by_user_id uuid references public.users(id),
  packed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pack_items (
  id uuid primary key default gen_random_uuid(),
  pack_job_id uuid not null references public.pack_jobs(id) on delete cascade,
  order_line_id uuid not null references public.order_lines(id),
  sku_id uuid not null references public.skus(id),
  quantity numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.delivery_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique,
  warehouse_id uuid not null references public.warehouses(id),
  status text not null check (status in ('PLANNED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  assigned_driver_user_id uuid references public.users(id),
  planned_date date not null,
  stop_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.delivery_stops (
  id uuid primary key default gen_random_uuid(),
  delivery_run_id uuid not null references public.delivery_runs(id) on delete cascade,
  stop_sequence integer not null,
  order_id uuid not null references public.orders(id),
  customer_site_id uuid not null references public.customer_sites(id),
  status text not null check (status in ('PENDING','ARRIVED','DELIVERED','FAILED','SKIPPED')),
  eta timestamptz,
  arrived_at timestamptz,
  delivered_at timestamptz,
  driver_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(delivery_run_id, stop_sequence)
);

create table public.pod_photos (
  id uuid primary key default gen_random_uuid(),
  delivery_stop_id uuid not null references public.delivery_stops(id),
  order_id uuid not null references public.orders(id),
  image_url text not null,
  taken_by_user_id uuid references public.users(id),
  taken_at timestamptz not null default now(),
  latitude numeric,
  longitude numeric,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_run_id uuid not null references public.delivery_runs(id),
  delivery_stop_id uuid references public.delivery_stops(id),
  event_type text not null,
  created_by_user_id uuid references public.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid references public.users(id),
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_barcodes_value on public.barcodes(barcode_value);
create index idx_warehouse_locations_barcode on public.warehouse_locations(barcode_value);
create index idx_orders_status on public.orders(status);
create index idx_pick_tasks_status on public.pick_tasks(status);
create index idx_delivery_stops_status on public.delivery_stops(status);

-- POD Storage bucket to create later in Supabase dashboard/API:
-- bucket name: pod-photos
-- recommended production privacy: private
