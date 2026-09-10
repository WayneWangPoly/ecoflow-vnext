create extension if not exists pgcrypto;

-- Mirror the Supabase roles referenced by migration grants when this contract
-- runs against the workflow's plain PostgreSQL service container.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin;
  end if;
end
$$;

create table public.skus (
  id uuid primary key,
  sku_code text not null unique
);

create table public.external_product_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_product_code text not null,
  internal_sku_id uuid,
  is_active boolean not null default true,
  unique(provider,external_product_code)
);

create table public.ecoflow_sku_barcode_confirmations (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'ORDERMENTUM',
  external_sku_code text not null,
  sku_id uuid,
  ordermentum_barcode_candidate text,
  warehouse_barcode text,
  status text not null default 'NEEDS_BARCODE',
  notes text,
  confirmed_by text,
  confirmed_at timestamptz,
  unique(provider,external_sku_code)
);

create table public.om_variants (
  sku text,
  name text,
  raw_json jsonb not null default '{}'::jsonb
);

create table public.om_products (
  sku text,
  name text,
  raw_json jsonb not null default '{}'::jsonb
);

create table public.test_ordermentum_inbox (
  raw_order_id uuid primary key,
  external_order_id text,
  external_order_number text,
  order_number text not null,
  invoice_number text not null unique,
  payment_status text,
  invoice_payment_status text,
  invoice_total numeric(12,4),
  total_due numeric(12,4),
  line_count bigint not null default 1,
  total_units numeric(12,4) not null default 1,
  invoice_detail_missing boolean not null default false,
  line_items_missing boolean not null default false,
  updated_business_day date not null default current_date,
  last_synced_at timestamptz not null default now()
);

create table public.test_ordermentum_lines (
  source_line_id text primary key,
  order_number text not null,
  invoice_number text not null,
  external_sku_code text,
  external_product_name text,
  quantity numeric(12,4) not null default 1,
  unit text,
  uom text,
  price numeric(12,4) not null default 1,
  rate_price numeric(12,4) not null default 1,
  subtotal numeric(12,4) not null default 1,
  gst numeric(12,4) not null default 0,
  tax numeric(12,4) not null default 0,
  total numeric(12,4) not null default 1
);

create view public.v_ecoflow_ordermentum_inbox as
select * from public.test_ordermentum_inbox;

create view public.v_ecoflow_ordermentum_order_lines as
select * from public.test_ordermentum_lines;

create view public.v_ecoflow_ordermentum_release_gate_v3 as
select
  i.*,
  0::bigint as unmapped_line_count,
  0::bigint as barcode_blocked_line_count,
  0::bigint as barcode_confirmed_line_count,
  0::bigint as service_line_count,
  0::bigint as stock_shortage_count,
  'READY_TO_INTERNALISE'::text as internalisation_status,
  'READY_FOR_ACCOUNT_RELEASE'::text as account_release_status,
  'READY_FOR_WAREHOUSE_PRECHECK'::text as warehouse_gate_status
from public.v_ecoflow_ordermentum_inbox i;

create table public.ecoflow_ordermentum_internal_orders (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null default 'ORDERMENTUM',
  raw_order_id uuid not null unique,
  external_order_id text,
  external_order_number text,
  invoice_number text,
  order_number text,
  payment_status text,
  invoice_payment_status text,
  invoice_total numeric(12,4),
  total_due numeric(12,4),
  line_count bigint,
  status text not null default 'IMPORTED',
  account_release_status text not null default 'WAITING_ACCOUNT_RELEASE',
  warehouse_gate_status text not null default 'BLOCKED_BARCODE',
  imported_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ecoflow_ordermentum_internal_order_lines (
  id uuid primary key default gen_random_uuid(),
  internal_order_id uuid not null references public.ecoflow_ordermentum_internal_orders(id) on delete cascade,
  line_index integer not null,
  external_sku_code text,
  external_product_name text,
  internal_sku_id uuid,
  quantity numeric(12,4),
  unit text,
  uom text,
  price numeric(12,4),
  rate_price numeric(12,4),
  subtotal numeric(12,4),
  gst numeric(12,4),
  tax numeric(12,4),
  total numeric(12,4),
  barcode_status text,
  warehouse_barcode text,
  line_type text not null default 'STOCK',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(internal_order_id,line_index)
);

create view public.v_ecoflow_ordermentum_internal_order_drafts_v3 as
select
  g.*,
  io.id as internal_order_id,
  io.status as internal_order_status,
  case when io.id is not null then 'ALREADY_INTERNALISED' else 'READY_TO_CREATE' end::text as creation_status,
  'fixture'::text as required_action
from public.v_ecoflow_ordermentum_release_gate_v3 g
left join public.ecoflow_ordermentum_internal_orders io on io.raw_order_id=g.raw_order_id;
