-- Minimal production contracts required by 20260711190000_commercial_controls.sql.

alter table public.app_user_profiles add column if not exists email text;
alter table public.app_user_profiles add column if not exists display_name text;

create table if not exists public.fixture_commercial_skus(
  source_type text, external_sku_code text, external_product_name text, base_price numeric, last_synced_at timestamptz
);
create or replace view public.v_ecoflow_ordermentum_sku_master_v1 as
select source_type,gen_random_uuid()::text external_product_id,null::text external_variant_id,
  external_sku_code,external_product_name,null::text external_variant_name,null::text unit_of_measure,
  'SLEEVE'::text inferred_default_unit_level,null::text ordermentum_barcode_candidate,
  'missing'::text ordermentum_barcode_candidate_type,base_price,'active'::text source_status,
  null::timestamptz remote_created_at,null::timestamptz remote_updated_at,null::timestamptz first_seen_at,
  null::timestamptz last_seen_at,last_synced_at,'{}'::jsonb raw_payload
from public.fixture_commercial_skus;

create table if not exists public.fixture_commercial_price_groups(external_price_group_id text primary key,price_group_name text,description text);
create or replace view public.v_ecoflow_ordermentum_price_groups_v1 as
select external_price_group_id,price_group_name,description,now() last_synced_at from public.fixture_commercial_price_groups;

create table if not exists public.fixture_accounts_lines(
  store_id text,store_name text,internal_order_id uuid primary key,order_number text,invoice_number text,order_ts timestamptz,due_at timestamptz,
  invoice_value numeric,age_days numeric,overdue_days numeric,statement_status text,order_status text,account_release_status text,warehouse_gate_status text,accounts_signal text
);
create or replace view public.v_ecoflow_accounts_statement_lines as select * from public.fixture_accounts_lines;

create table if not exists public.fixture_store_performance(
  store_id text primary key,store_name text,suburb text,address text,contact_phone text,price_group_id text,orders_30d numeric,revenue_30d numeric,top_sku_30d text,top_product_30d text
);
create or replace view public.v_ecoflow_owner_store_performance as select * from public.fixture_store_performance;

create table if not exists public.ecoflow_accounts_statement_actions(
  id uuid primary key default gen_random_uuid(),store_id text not null,action text not null,action_note text,action_value text,
  action_status text not null default 'RECORDED',action_by uuid default auth.uid(),action_at timestamptz not null default now()
);
create or replace view public.v_ecoflow_accounts_statement_latest_actions as
select distinct on(store_id) store_id,action latest_action,action_status latest_action_status,action_note latest_action_note,action_value latest_action_value,action_at latest_action_at
from public.ecoflow_accounts_statement_actions order by store_id,action_at desc;

create table if not exists public.om_orders(
  id text primary key,order_number text,retailer_id text,retailer_name text,delivery_date date,due_at timestamptz,total_quantity numeric
);
