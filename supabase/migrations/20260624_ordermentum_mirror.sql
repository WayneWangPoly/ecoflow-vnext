create extension if not exists "pgcrypto";

create table if not exists public.om_sync_runs (
  id uuid primary key default gen_random_uuid(),
  sync_type text not null,
  status text not null check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_processed integer not null default 0,
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.om_raw_payloads (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  synced_at timestamptz not null default now(),
  unique(entity_type, entity_id)
);

create table if not exists public.om_price_groups (
  id uuid primary key,
  supplier_id uuid not null,
  name text not null,
  is_default boolean not null default false,
  retailers_total integer,
  products_total integer,
  external_id text,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.om_products (
  id uuid primary key,
  supplier_id uuid not null,
  name text not null,
  sku text,
  base_price numeric(12,4),
  price numeric(12,4),
  cost numeric(12,4),
  category_names text[],
  description text,
  image_url text,
  unit text,
  uom text,
  unit_size numeric,
  min_quantity numeric,
  max_quantity numeric,
  tax_type text,
  out_of_stock boolean,
  stock_tracking boolean,
  variant_id uuid,
  badge_label text,
  featured boolean,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.om_variants (
  id uuid primary key,
  product_id uuid,
  supplier_id uuid not null,
  sku text,
  name text not null,
  price numeric(12,4),
  base_price numeric(12,4),
  cost numeric(12,4),
  barcode text,
  unit text,
  uom text,
  unit_size numeric,
  packing_unit numeric,
  visible boolean,
  out_of_stock boolean,
  tracked boolean,
  available numeric,
  allow_oversell boolean,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.om_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.om_products(id) on delete cascade,
  price_group_id uuid not null references public.om_price_groups(id) on delete cascade,
  price numeric(12,4),
  config_type text,
  percent numeric(8,4),
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, price_group_id)
);

create table if not exists public.om_customers (
  purchaser_id uuid primary key,
  retailer_id uuid,
  supplier_id uuid not null,
  reference text,
  name text,
  retailer_name text,
  legal_name text,
  trading_name text,
  abn text,
  email text,
  billing_email text,
  phone text,
  price_group_id uuid references public.om_price_groups(id),
  freight_group_id uuid,
  visibility_group_id uuid,
  payment_delay integer,
  payment_schedule text,
  default_payment_method text,
  payment_method_display text,
  stop_credit boolean,
  minimum_order_value numeric(12,2),
  days_since_last_order integer,
  delivery_instructions text,
  notes text,
  delivery_address jsonb,
  billing_address jsonb,
  latitude numeric(12,8),
  longitude numeric(12,8),
  first_ordered_at timestamptz,
  ordered_at timestamptz,
  activated_at timestamptz,
  archived boolean,
  disabled boolean,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.om_orders (
  id uuid primary key,
  supplier_id uuid not null,
  purchaser_id uuid,
  retailer_id uuid,
  invoice_id uuid,
  order_number text,
  status text,
  order_status text,
  payment_status text,
  retailer_name text,
  delivery_date timestamptz,
  due_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  cancelled_at timestamptz,
  cancelled boolean not null default false,
  placed_by_retailer boolean,
  invoice_number text,
  subtotal numeric(12,4),
  total_gst numeric(12,4),
  total_freight numeric(12,4),
  surcharge numeric(12,4),
  total_discount numeric(12,4),
  total numeric(12,4),
  total_due numeric(12,4),
  total_quantity numeric(12,4),
  line_count integer,
  customer_reference text,
  raw_json jsonb not null
);

create table if not exists public.om_order_items (
  id uuid primary key,
  order_id uuid not null references public.om_orders(id) on delete cascade,
  product_id uuid,
  variant_id uuid,
  sku text,
  name text not null,
  quantity numeric(12,4),
  price numeric(12,4),
  rate_price numeric(12,4),
  subtotal numeric(12,4),
  gst numeric(12,4),
  tax numeric(12,4),
  total numeric(12,4),
  unit text,
  uom text,
  packing_unit numeric,
  batch_code text,
  description text,
  image_url text,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.om_invoices (
  id uuid primary key,
  supplier_id uuid not null,
  purchaser_id uuid,
  retailer_id uuid,
  number text,
  reference text,
  status text,
  payment_status text,
  invoice_status text,
  payment_method text,
  payment_transaction_id text,
  settlement_reference text,
  paid_at timestamptz,
  paid_supplier_at timestamptz,
  due_at timestamptz,
  charge_at timestamptz,
  date timestamptz,
  subtotal numeric(12,4),
  total_gst numeric(12,4),
  total_freight numeric(12,4),
  surcharge numeric(12,4),
  total_discount numeric(12,4),
  total numeric(12,4),
  total_due numeric(12,4),
  total_charge numeric(12,4),
  credit numeric(12,4),
  is_outstanding boolean,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.om_stock_locations (
  id uuid primary key,
  supplier_id uuid not null,
  name text not null,
  is_default boolean not null default false,
  external_id text,
  raw_json jsonb not null,
  created_at timestamptz,
  updated_at timestamptz
);

create index if not exists idx_om_orders_delivery_date on public.om_orders(delivery_date);
create index if not exists idx_om_orders_updated_at on public.om_orders(updated_at);
create index if not exists idx_om_orders_purchaser_id on public.om_orders(purchaser_id);
create index if not exists idx_om_order_items_sku on public.om_order_items(sku);
create index if not exists idx_om_customers_price_group_id on public.om_customers(price_group_id);
create index if not exists idx_om_products_sku on public.om_products(sku);
create index if not exists idx_om_variants_sku on public.om_variants(sku);

create or replace view public.v_om_price_matrix as
select
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.base_price,
  pg.id as price_group_id,
  pg.name as price_group_name,
  pp.price as tier_price,
  pp.config_type,
  pp.percent
from public.om_products p
cross join public.om_price_groups pg
left join public.om_product_prices pp
  on pp.product_id = p.id
 and pp.price_group_id = pg.id;

create or replace view public.v_om_pick_by_sku as
select
  oi.sku,
  oi.name,
  sum(coalesce(oi.quantity, 0)) as total_quantity,
  count(distinct oi.order_id) as order_count,
  min(o.delivery_date) as first_delivery_date,
  max(o.delivery_date) as last_delivery_date
from public.om_order_items oi
join public.om_orders o on o.id = oi.order_id
where coalesce(o.cancelled, false) = false
group by oi.sku, oi.name;

create or replace view public.v_om_customer_statement as
select
  c.purchaser_id,
  c.name as customer_name,
  c.price_group_id,
  i.id as invoice_id,
  i.number as invoice_number,
  i.reference,
  i.status,
  i.payment_status,
  i.invoice_status,
  i.date,
  i.due_at,
  i.paid_at,
  i.total,
  i.total_due,
  i.surcharge,
  i.payment_method
from public.om_invoices i
left join public.om_customers c on c.purchaser_id = i.purchaser_id;