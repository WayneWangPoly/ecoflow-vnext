\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

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

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('request.jwt.claim.app_role', true), '')
$$;

-- Isolated read-surface fixture matching the existing inventory SKU contract.
-- The candidate survey migration may read this surface but must never mutate it.
create table if not exists public._warehouse_survey_sku_fixture (
  sku text primary key,
  product_name text,
  category text,
  fixed_shelf text,
  primary_barcode text
);

insert into public._warehouse_survey_sku_fixture (sku, product_name, category, fixed_shelf, primary_barcode)
values
  ('CUP-12W', '12oz White Compostable Cup', 'Cups', 'A1', '0934567890001'),
  ('CUP-16W', '16oz White Compostable Cup', 'Cups', 'A2', '0934567890002'),
  ('CCSPW12-90', '12oz Compostable Sipper Lid', 'Lids', 'B1', null)
on conflict (sku) do update set
  product_name = excluded.product_name,
  category = excluded.category,
  fixed_shelf = excluded.fixed_shelf,
  primary_barcode = excluded.primary_barcode;

create or replace view public.v_ecoflow_inventory_sku_control as
select sku, product_name, category, fixed_shelf, primary_barcode
from public._warehouse_survey_sku_fixture;
