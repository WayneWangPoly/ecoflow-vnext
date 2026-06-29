-- EcoFlow vNext role/workflow additions for the new Owner/Mobile/Warehouse/Driver/Account flow.
-- Run this only after the base vNext schema is in place. It is additive and avoids dropping data.

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role text not null check (role in ('owner','mobile','warehouse','driver','account')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid references public.user_profiles(id),
  role text not null check (role in ('owner','mobile','warehouse','driver','account')),
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(role, setting_key)
);

create table if not exists public.ordermentum_sku_candidates (
  id uuid primary key default gen_random_uuid(),
  external_sku_code text not null unique,
  external_product_name text not null,
  carton_barcode text,
  sleeve_barcode text,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','ignored')),
  approved_by uuid references public.user_profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_locks (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order','order_line','pick_wave','pick_task','delivery_run','delivery_stop','package')),
  entity_id uuid not null,
  locked_by_role text not null check (locked_by_role in ('warehouse','driver')),
  locked_by_user_id uuid references public.user_profiles(id),
  status text not null default 'active' check (status in ('active','released','expired')),
  note text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique(entity_type, entity_id, status)
);

create table if not exists public.driver_pretrip_checks (
  id uuid primary key default gen_random_uuid(),
  delivery_run_id uuid references public.delivery_runs(id),
  driver_user_id uuid references public.user_profiles(id),
  licence_phone_ok boolean not null default false,
  vehicle_ok boolean not null default false,
  load_secured boolean not null default false,
  status text not null default 'draft' check (status in ('draft','completed','failed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.package_labels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  delivery_stop_id uuid references public.delivery_stops(id),
  label_number integer not null,
  label_count integer not null,
  label_type text not null check (label_type in ('small_goods_carton','large_carton','mixed_carton')),
  barcode_value text not null unique,
  print_status text not null default 'pending' check (print_status in ('pending','printed','void')),
  printed_by uuid references public.user_profiles(id),
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  invoice_number text,
  customer_id uuid references public.customers(id),
  status text not null default 'open' check (status in ('open','matched','query','closed')),
  pod_required boolean not null default true,
  pod_received boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.delivery_stops add column if not exists latitude numeric;
alter table public.delivery_stops add column if not exists longitude numeric;
alter table public.delivery_stops add column if not exists route_sequence integer;
alter table public.delivery_stops add column if not exists route_locked boolean not null default false;

-- For current prototype only. Do not store plain role passcodes in production.
insert into public.user_settings (role, setting_key, setting_value)
values
  ('owner','login_hint','{"prototype_password":"0000"}'::jsonb),
  ('mobile','login_hint','{"prototype_password":"2222"}'::jsonb),
  ('warehouse','login_hint','{"prototype_password":"4444"}'::jsonb),
  ('driver','login_hint','{"prototype_password":"6666"}'::jsonb),
  ('account','login_hint','{"prototype_password":"0000","note":"temporary; set separate passcode before production"}'::jsonb)
on conflict (role, setting_key) do nothing;
