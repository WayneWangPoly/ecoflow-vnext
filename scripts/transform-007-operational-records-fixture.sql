\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

create table public.app_user_profiles(
  user_id uuid primary key,
  app_role text not null,
  is_active boolean not null default true,
  team_status text not null default 'ACTIVE'
);

create or replace function public.ecoflow_active_app_role()
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select p.app_role from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active and p.team_status='ACTIVE'
$$;

create table public.v_ecoflow_inventory_kpis(
  sku_count numeric,
  below_target_skus numeric,
  negative_stock_skus numeric,
  live_on_hand_units numeric,
  latest_sku_activity_at timestamptz
);

create table public.v_ecoflow_inventory_sku_control(
  sku text primary key,
  product_name text,
  category text,
  reorder_target numeric,
  units_7d numeric,
  units_30d numeric,
  revenue_30d numeric,
  order_count_30d numeric,
  last_sold_at timestamptz,
  inventory_signal text,
  action_hint text,
  inventory_rank bigint,
  primary_barcode text,
  control_status text,
  latest_movement_at timestamptz,
  stock_source text,
  effective_on_hand numeric
);

create table public.ecoflow_warehouse_locations(
  id uuid primary key,
  location_code text not null,
  rack_id text,
  zone text,
  location_type text,
  status text,
  sort_order integer
);

create table public.ecoflow_warehouse_location_items(
  id uuid primary key,
  location_id uuid not null references public.ecoflow_warehouse_locations(id),
  sku text not null,
  product_name text,
  unit_level text,
  quantity numeric,
  source_barcode text,
  last_movement_at timestamptz,
  status text
);

create table public.ecoflow_warehouse_movements(
  id uuid primary key,
  movement_type text,
  location_id uuid,
  from_location_id uuid,
  to_location_id uuid,
  sku text,
  product_name text,
  barcode text,
  unit_level text,
  quantity numeric,
  transfer_reference text,
  note text,
  actor_user_id uuid,
  created_at timestamptz
);

create table public.ecoflow_inventory_movements(
  id uuid primary key,
  sku text,
  product_name text,
  movement_type text,
  quantity numeric,
  from_location text,
  to_location text,
  reference_type text,
  reference_id text,
  action_note text,
  moved_by uuid,
  moved_at timestamptz
);

create table public.ecoflow_stocktake_sessions(
  id uuid primary key,
  session_type text,
  session_status text,
  title text,
  rack_id text,
  blind_count boolean,
  revision bigint,
  created_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  updated_at timestamptz
);

create table public.ecoflow_stocktake_location_progress(
  session_id uuid,
  location_code text
);

create table public.ecoflow_stocktake_observations(
  id uuid primary key,
  session_id uuid,
  exception_codes text[],
  review_status text
);

create table public.v_ecoflow_customer_store_directory(
  store_id text primary key,
  purchaser_id text,
  store_name text,
  suburb text,
  state text,
  address text,
  contact_phone text,
  price_group_id text,
  verified boolean,
  store_signal text,
  orders_30d numeric,
  revenue_30d numeric,
  units_30d numeric,
  top_sku_30d text,
  top_product_30d text,
  last_order_at timestamptz,
  site_updated_at timestamptz
);

create table public.ecoflow_account_release_holds(
  store_id text primary key,
  active boolean,
  hold_reason text,
  source_action_id uuid,
  updated_by uuid,
  updated_at timestamptz
);

create table public.v_ecoflow_accounts_live_statement_customers(
  store_id text primary key,
  store_name text,
  invoice_count numeric,
  open_invoice_count numeric,
  overdue_invoice_count numeric,
  open_statement_value numeric,
  overdue_statement_value numeric,
  worst_overdue_days numeric,
  statement_signal text,
  accounts_priority text,
  billing_email text,
  billing_contact_name text,
  billing_enabled boolean
);

create table public.v_ecoflow_accounts_live_ar_kpis(
  open_ar_value numeric,
  overdue_ar_value numeric,
  open_customers numeric,
  overdue_customers numeric,
  open_invoices numeric,
  overdue_invoices numeric,
  held_customers numeric,
  latest_invoice_at timestamptz
);

create table public.ecoflow_delivery_exceptions(
  id uuid primary key,
  return_code text,
  business_day text,
  order_id text,
  order_number text,
  stop_number integer,
  store_name text,
  outcome text,
  return_cartons numeric,
  reason text,
  driver_note text,
  return_status text,
  warehouse_location text,
  recorded_at timestamptz,
  warehouse_received_at timestamptz,
  driver_returned_at timestamptz,
  inspection_completed_at timestamptz,
  updated_at timestamptz
);

create table public.ecoflow_delivery_return_inspection_lines(
  id uuid primary key,
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id),
  resolution text,
  barcode text,
  sku text,
  product_name text,
  package_level text,
  qty_packages numeric,
  units_processed numeric,
  target_location text,
  movement_id uuid,
  manual_item text,
  inspection_note text,
  inspected_by text,
  inspected_at timestamptz
);

create table public.ecoflow_delivery_return_scans(
  id uuid primary key,
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id),
  return_code text,
  scan_action text,
  warehouse_location text,
  scan_note text,
  scanned_by text,
  scanned_at timestamptz
);

create table public.skus(
  id uuid primary key,
  sku_code text,
  display_name text
);

create table public.external_product_mappings(
  id uuid primary key,
  provider text,
  external_product_code text,
  internal_sku_id uuid,
  is_active boolean
);

create table public.ecoflow_sku_families(
  id uuid primary key,
  family_code text,
  family_name text,
  identity_status text
);

create table public.ecoflow_physical_skus(
  id uuid primary key,
  physical_sku_code text,
  display_name text,
  brand text,
  supplier_name text,
  manufacturer_code text,
  family_id uuid,
  identity_status text,
  revision bigint
);

create table public.ecoflow_commercial_family_links(
  id uuid primary key,
  commercial_sku_id uuid,
  family_id uuid,
  preferred_physical_sku_id uuid,
  substitution_policy text,
  identity_status text
);

create table public.ecoflow_physical_sku_packages(
  id uuid primary key,
  physical_sku_id uuid,
  package_level text,
  units_in_base_unit numeric,
  identity_status text,
  revision bigint
);

create table public.ecoflow_physical_barcode_bindings(
  id uuid primary key,
  barcode text,
  physical_sku_id uuid,
  package_id uuid,
  identity_status text,
  source text,
  revision bigint,
  active_from timestamptz
);

create table public.ecoflow_product_identity_tasks(
  id uuid primary key,
  commercial_sku_id uuid,
  task_type text,
  task_status text,
  blocking boolean,
  barcode text,
  detail text,
  updated_at timestamptz
);

create table public.v_ecoflow_customer_store_order_history(
  store_id text,
  store_name text,
  internal_order_id text,
  external_order_id text,
  order_number text,
  invoice_number text,
  status text,
  order_value numeric,
  order_at timestamptz,
  delivery_date date,
  due_at timestamptz,
  last_synced_at timestamptz
);

create table public.ecoflow_customer_operational_events(
  id uuid primary key,
  store_key text,
  store_name text,
  event_type text,
  note_text text,
  contact_channel text,
  occurred_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz
);

create table public.ecoflow_accounts_statement_actions(
  id uuid primary key,
  store_id text,
  action text,
  action_note text,
  action_value text,
  action_status text,
  action_by uuid,
  action_at timestamptz
);

create table public.v_ecoflow_accounts_live_statement_lines(
  store_id text,
  store_name text,
  internal_order_id text,
  order_number text,
  invoice_number text,
  order_ts timestamptz,
  due_at timestamptz,
  invoice_value numeric,
  allocated_amount numeric,
  outstanding_amount numeric,
  overdue_days numeric,
  statement_status text,
  order_status text,
  account_release_status text,
  warehouse_gate_status text,
  accounts_signal text
);

create table public.v_ecoflow_statement_document_history(
  id uuid primary key,
  statement_number text,
  store_id text,
  store_name text,
  document_status text,
  closing_balance numeric,
  created_at timestamptz,
  line_count integer
);

grant usage on schema public,auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
