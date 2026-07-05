-- EcoFlow Ordermentum Master Data + Integration Hub V2 SAFE OVERLAY
-- Additive only: does not touch App.tsx, supabaseOrdermentumViews.ts, ecoflow_store_sites, or v_ecoflow_app_sku_master.
-- EcoFlow Ordermentum Master Data + Integration Hub V1
-- Purpose:
-- 1) Mirror every readable Ordermentum master-data resource as raw JSONB.
-- 2) Build canonical workbench views for customers, SKUs, price tiers and sync health.
-- 3) Prepare controlled write-back/change queue without automatically mutating Ordermentum.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ordermentum_master_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null default 'MASTER_DATA_SYNC',
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCEEDED','FAILED','PARTIAL','DRY_RUN')),
  auth_mode text not null default 'legacy-bearer',
  supplier_id text,
  resources_requested text[] not null default array[]::text[],
  resources_succeeded text[] not null default array[]::text[],
  resources_failed text[] not null default array[]::text[],
  endpoints_attempted integer not null default 0,
  pages_seen integer not null default 0,
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  records_changed integer not null default 0,
  detail_attempted integer not null default 0,
  detail_succeeded integer not null default 0,
  detail_failed integer not null default 0,
  dry_run boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,
  notes jsonb not null default '{}'::jsonb
);

create table if not exists public.ordermentum_api_capabilities (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  endpoint text not null,
  method text not null default 'GET',
  supplier_id text not null default '',
  status text not null default 'UNKNOWN' check (status in ('UNKNOWN','OK','EMPTY','FAILED','UNSUPPORTED','AUTH_FAILED','PERMISSION_DENIED')),
  http_status integer,
  supports_pagination boolean,
  supports_supplier_filter boolean,
  supports_updated_at_filter boolean,
  sample_payload jsonb,
  last_checked_at timestamptz not null default now(),
  last_error text
);

-- Upsert target used by the discovery script. Empty supplier_id means a global capability check.
create unique index if not exists uq_ordermentum_api_capabilities_key
on public.ordermentum_api_capabilities(resource_type, endpoint, method, supplier_id);

create table if not exists public.ordermentum_raw_master_resources (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  external_id text not null,
  supplier_id text,
  source_endpoint text not null,
  source_method text not null default 'GET',
  request_query jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  payload_hash text not null,
  remote_created_at timestamptz,
  remote_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  is_deleted_or_missing boolean not null default false,
  sync_run_id uuid references public.ordermentum_master_sync_runs(id) on delete set null,
  previous_payload_hash text,
  unique(resource_type, external_id)
);

create index if not exists idx_om_raw_master_resource_type on public.ordermentum_raw_master_resources(resource_type);
create index if not exists idx_om_raw_master_external_id on public.ordermentum_raw_master_resources(external_id);
create index if not exists idx_om_raw_master_updated on public.ordermentum_raw_master_resources(remote_updated_at desc nulls last);
create index if not exists idx_om_raw_master_payload_gin on public.ordermentum_raw_master_resources using gin(payload jsonb_path_ops);

create table if not exists public.ordermentum_raw_master_resource_versions (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  external_id text not null,
  supplier_id text,
  source_endpoint text not null,
  payload jsonb not null,
  payload_hash text not null,
  changed_at timestamptz not null default now(),
  sync_run_id uuid references public.ordermentum_master_sync_runs(id) on delete set null
);

create index if not exists idx_om_raw_master_versions_key on public.ordermentum_raw_master_resource_versions(resource_type, external_id, changed_at desc);

-- Canonical layer override tables. These are EcoFlow-owned corrections, not blind copies of Ordermentum.
create table if not exists public.ecoflow_external_object_mappings (
  id uuid primary key default gen_random_uuid(),
  external_system text not null default 'ORDERMENTUM',
  external_resource_type text not null,
  external_id text not null,
  internal_object_type text not null,
  internal_object_id uuid,
  internal_code text,
  mapping_status text not null default 'ACTIVE' check (mapping_status in ('ACTIVE','PROPOSED','CONFLICT','INACTIVE')),
  confidence numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(external_system, external_resource_type, external_id, internal_object_type)
);

create table if not exists public.external_change_requests (
  id uuid primary key default gen_random_uuid(),
  external_system text not null default 'ORDERMENTUM',
  resource_type text not null,
  external_id text,
  change_type text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','PUSHING','PUSHED','FAILED','CONFLICT','CANCELLED')),
  requested_by uuid,
  approved_by uuid,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  pushed_at timestamptz,
  source_payload_before jsonb,
  proposed_payload_after jsonb not null default '{}'::jsonb,
  diff_summary jsonb not null default '{}'::jsonb,
  idempotency_key text,
  reason text,
  last_error text
);

create index if not exists idx_external_change_requests_status on public.external_change_requests(external_system, status, requested_at desc);

create table if not exists public.external_change_attempts (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.external_change_requests(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  method text,
  endpoint text,
  request_payload jsonb,
  response_status integer,
  response_payload jsonb,
  succeeded boolean not null default false,
  error text
);

create table if not exists public.external_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  external_system text not null default 'ORDERMENTUM',
  resource_type text not null,
  external_id text not null,
  conflict_type text not null,
  status text not null default 'OPEN' check (status in ('OPEN','ACKNOWLEDGED','RESOLVED','IGNORED')),
  local_payload jsonb,
  remote_payload jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

create or replace function public.ecoflow_text_to_numeric(value text)
returns numeric
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then null
    when value ~ '^-?\d+(\.\d+)?$' then value::numeric
    else null
  end;
$$;

create or replace function public.ecoflow_jsonb_first_text(payload jsonb, paths text[][])
returns text
language plpgsql
immutable
as $$
declare
  p text[];
  v text;
begin
  foreach p slice 1 in array paths loop
    v := payload #>> p;
    if v is not null and btrim(v) <> '' then
      return v;
    end if;
  end loop;
  return null;
end;
$$;

create or replace view public.v_ecoflow_ordermentum_master_data_sync_health as
with latest_resource as (
  select
    resource_type,
    count(*) as record_count,
    count(*) filter (where is_deleted_or_missing) as missing_count,
    max(last_synced_at) as latest_synced_at,
    max(remote_updated_at) as latest_remote_updated_at,
    count(*) filter (where last_synced_at >= now() - interval '24 hours') as synced_24h
  from public.ordermentum_raw_master_resources
  group by resource_type
), latest_run as (
  select *
  from public.ordermentum_master_sync_runs
  order by started_at desc
  limit 1
)
select
  lr.resource_type,
  lr.record_count,
  lr.missing_count,
  lr.latest_synced_at,
  lr.latest_remote_updated_at,
  lr.synced_24h,
  case
    when lr.latest_synced_at is null then 'NO_DATA'
    when lr.latest_synced_at < now() - interval '24 hours' then 'STALE'
    else 'OK'
  end as freshness_status,
  (select status from latest_run) as latest_run_status,
  (select started_at from latest_run) as latest_run_started_at,
  (select finished_at from latest_run) as latest_run_finished_at,
  (select last_error from latest_run) as latest_run_error
from latest_resource lr
order by lr.resource_type;

create or replace view public.v_ecoflow_ordermentum_customer_master_v1 as
select
  r.external_id as purchaser_id,
  r.payload_hash,
  r.last_synced_at,
  r.remote_updated_at,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['name'], array['retailer','name'], array['businessName'], array['companyName'], array['tradingName']
  ]) as customer_or_store_name,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['email'], array['contact','email'], array['retailer','email'], array['primaryContact','email']
  ]) as email,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['phone'], array['contact','phone'], array['retailer','phone'], array['primaryContact','phone']
  ]) as phone,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['priceGroupId'], array['priceGroup','id'], array['defaultPriceGroup','id'], array['linkedPriceGroup','id']
  ]) as price_group_id,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['priceGroupName'], array['priceGroup','name'], array['defaultPriceGroup','name'], array['linkedPriceGroup','name']
  ]) as price_group_name,
  coalesce(r.payload->'addresses', r.payload->'deliveryAddresses', r.payload->'retailer'->'addresses') as addresses,
  coalesce(r.payload->'visibilityTags', r.payload->'tags', r.payload->'metadata'->'visibilityTags') as visibility_tags,
  r.payload
from public.ordermentum_raw_master_resources r
where r.resource_type in ('purchasers','customers','purchaser_detail')
  and not r.is_deleted_or_missing;

create or replace view public.v_ecoflow_ordermentum_sku_master_v1 as
select
  r.resource_type,
  r.external_id,
  r.payload_hash,
  r.last_synced_at,
  r.remote_updated_at,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['sku'], array['code'], array['productSku'], array['variantSku'], array['product','sku'], array['variant','sku']
  ]) as external_sku_code,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['name'], array['title'], array['productName'], array['displayName'], array['product','name'], array['variant','name']
  ]) as external_product_name,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['productId'], array['product','id']
  ]) as product_id,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['variantId'], array['id'], array['variant','id']
  ]) as variant_id,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['unitOfMeasure'], array['unit'], array['uom'], array['variant','unitOfMeasure']
  ]) as unit_of_measure,
  public.ecoflow_text_to_numeric(public.ecoflow_jsonb_first_text(r.payload, array[
    array['price'], array['basePrice'], array['sellPrice'], array['variant','price']
  ])) as base_price,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['barcode'], array['gtin'], array['ean'], array['variant','barcode']
  ]) as barcode_candidate,
  public.ecoflow_jsonb_first_text(r.payload, array[
    array['category'], array['categoryName'], array['product','category']
  ]) as category_name,
  coalesce(r.payload->'prices', r.payload->'priceGroups', r.payload->'variantPrices') as price_payload,
  r.payload
from public.ordermentum_raw_master_resources r
where r.resource_type in ('products','product_detail','variants','variant_detail')
  and not r.is_deleted_or_missing;

create or replace view public.v_ecoflow_ordermentum_price_groups_v1 as
select
  r.external_id as price_group_id,
  public.ecoflow_jsonb_first_text(r.payload, array[array['name'], array['title'], array['priceGroupName']]) as price_group_name,
  public.ecoflow_jsonb_first_text(r.payload, array[array['description']]) as description,
  r.last_synced_at,
  r.remote_updated_at,
  r.payload
from public.ordermentum_raw_master_resources r
where r.resource_type in ('price_groups','price_group_detail')
  and not r.is_deleted_or_missing;

-- Generic price-tier matrix. This intentionally preserves raw nested price payloads until the actual tenant response shape is confirmed.
create or replace view public.v_ecoflow_ordermentum_price_tier_matrix_v1 as
select
  s.resource_type,
  s.external_id,
  s.external_sku_code,
  s.external_product_name,
  s.product_id,
  s.variant_id,
  s.base_price,
  pg.price_group_id,
  pg.price_group_name,
  s.price_payload,
  s.last_synced_at
from public.v_ecoflow_ordermentum_sku_master_v1 s
left join public.v_ecoflow_ordermentum_price_groups_v1 pg
  on (s.price_payload::text ilike '%' || pg.price_group_id || '%' or s.price_payload::text ilike '%' || coalesce(pg.price_group_name,'') || '%')
where s.resource_type in ('products','product_detail','variants','variant_detail');

create or replace view public.v_ecoflow_ordermentum_customer_price_group_audit_v1 as
select
  c.purchaser_id,
  c.customer_or_store_name,
  c.email,
  c.phone,
  c.price_group_id,
  c.price_group_name,
  case
    when c.price_group_id is null and c.price_group_name is null then 'MISSING_PRICE_GROUP'
    when pg.price_group_id is null and c.price_group_id is not null then 'PRICE_GROUP_NOT_MIRRORED'
    else 'OK'
  end as audit_status,
  c.visibility_tags,
  c.addresses,
  c.last_synced_at
from public.v_ecoflow_ordermentum_customer_master_v1 c
left join public.v_ecoflow_ordermentum_price_groups_v1 pg
  on pg.price_group_id = c.price_group_id
  or lower(pg.price_group_name) = lower(c.price_group_name);

create or replace view public.v_ecoflow_external_change_queue as
select
  id,
  external_system,
  resource_type,
  external_id,
  change_type,
  status,
  requested_by,
  approved_by,
  requested_at,
  approved_at,
  pushed_at,
  diff_summary,
  reason,
  last_error
from public.external_change_requests
order by requested_at desc;

-- RLS: service_role still bypasses RLS. Frontend should use secure views/RPC, not raw tables.
alter table public.ordermentum_master_sync_runs enable row level security;
alter table public.ordermentum_api_capabilities enable row level security;
alter table public.ordermentum_raw_master_resources enable row level security;
alter table public.ordermentum_raw_master_resource_versions enable row level security;
alter table public.ecoflow_external_object_mappings enable row level security;
alter table public.external_change_requests enable row level security;
alter table public.external_change_attempts enable row level security;
alter table public.external_sync_conflicts enable row level security;

revoke all on table public.ordermentum_master_sync_runs from anon, authenticated;
revoke all on table public.ordermentum_api_capabilities from anon, authenticated;
revoke all on table public.ordermentum_raw_master_resources from anon, authenticated;
revoke all on table public.ordermentum_raw_master_resource_versions from anon, authenticated;
revoke all on table public.ecoflow_external_object_mappings from anon, authenticated;
revoke all on table public.external_change_requests from anon, authenticated;
revoke all on table public.external_change_attempts from anon, authenticated;
revoke all on table public.external_sync_conflicts from anon, authenticated;

grant select on public.v_ecoflow_ordermentum_master_data_sync_health to authenticated;
grant select on public.v_ecoflow_ordermentum_customer_master_v1 to authenticated;
grant select on public.v_ecoflow_ordermentum_sku_master_v1 to authenticated;
grant select on public.v_ecoflow_ordermentum_price_groups_v1 to authenticated;
grant select on public.v_ecoflow_ordermentum_price_tier_matrix_v1 to authenticated;
grant select on public.v_ecoflow_ordermentum_customer_price_group_audit_v1 to authenticated;
grant select on public.v_ecoflow_external_change_queue to authenticated;
