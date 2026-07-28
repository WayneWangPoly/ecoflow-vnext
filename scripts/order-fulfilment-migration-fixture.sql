-- Minimal Ordermentum/internal-order contract for INTEL-DATA-002 CI.
-- This fixture is loaded only in the isolated PostgreSQL workflow.

create table if not exists public.skus (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null unique,
  display_name text not null,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ordermentum_raw_orders (
  id uuid primary key default gen_random_uuid(),
  external_order_id text unique,
  external_order_number text,
  status text,
  payment_status text,
  delivery_date timestamptz,
  external_created_at timestamptz,
  external_updated_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.om_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  invoice_number text
);

create table if not exists public.om_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.om_orders(id) on delete cascade,
  product_id uuid,
  variant_id uuid,
  sku text,
  name text,
  quantity numeric,
  unit text,
  uom text,
  packing_unit text,
  price numeric,
  rate_price numeric,
  subtotal numeric,
  gst numeric,
  tax numeric,
  total numeric
);

create or replace view public.v_ecoflow_ordermentum_order_lines as
select
  o.id::text as external_order_id,
  o.order_number,
  o.invoice_number,
  li.id::text as line_id,
  li.product_id::text as product_id,
  li.variant_id::text as variant_id,
  coalesce(nullif(li.sku,''),'OM-LINE-' || left(li.id::text,8)) as sku,
  coalesce(nullif(li.name,''),'Ordermentum line item') as name,
  coalesce(li.quantity,0) as quantity,
  li.unit,
  li.uom,
  li.packing_unit,
  li.price,
  li.rate_price,
  li.subtotal,
  li.gst,
  li.tax,
  li.total
from public.om_order_items li
join public.om_orders o on o.id=li.order_id;

create table if not exists public.ecoflow_ordermentum_internal_orders (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null default 'ORDERMENTUM',
  raw_order_id uuid not null unique references public.ordermentum_raw_orders(id),
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

create table if not exists public.ecoflow_sku_barcode_confirmations (
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,external_sku_code)
);
