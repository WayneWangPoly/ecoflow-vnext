-- EcoFlow SKU Intelligence + Barcode Master Data
-- Purpose:
--   1. Summarise true Ordermentum SKU movement after historical backfill.
--   2. Separate external SKU, internal SKU, barcode, and packaging level.
--   3. Add warehouse-grade barcode confirmation without treating Ordermentum pseudo barcode as warehouse barcode.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Manual business override table. This lets EcoFlow classify service items, inactive SKUs,
-- and operational preferences without modifying raw Ordermentum data.
create table if not exists public.ecoflow_sku_master_overrides (
  external_sku_code text primary key,
  internal_sku_id uuid null,
  classification text not null default 'PRODUCT', -- PRODUCT / SERVICE_ITEM / INACTIVE / REVIEW
  is_service_item boolean not null default false,
  preferred_pick_level text null, -- CARTON / SLEEVE / EACH / PALLET
  status text not null default 'ACTIVE', -- ACTIVE / REVIEW / INACTIVE
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Packaging level hierarchy. One internal SKU can be picked/scanned/stocked at different levels.
create table if not exists public.sku_packaging_levels (
  id uuid primary key default extensions.gen_random_uuid(),
  sku_id uuid not null,
  level_code text not null, -- EACH / SLEEVE / CARTON / PALLET / INNER / CASE
  level_name text not null,
  quantity_in_base_units numeric(14,4) not null default 1,
  parent_level_id uuid null references public.sku_packaging_levels(id) on delete set null,
  is_orderable boolean not null default false,
  is_pickable boolean not null default true,
  is_stockable boolean not null default true,
  status text not null default 'ACTIVE', -- ACTIVE / REVIEW / INACTIVE
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sku_packaging_levels_qty_positive check (quantity_in_base_units > 0),
  constraint sku_packaging_levels_level_not_blank check (length(trim(level_code)) > 0),
  constraint sku_packaging_levels_unique unique (sku_id, level_code)
);

create index if not exists idx_sku_packaging_levels_sku_id
  on public.sku_packaging_levels(sku_id);

-- Barcode aliases. One SKU can have multiple barcodes across carton/sleeve/each.
create table if not exists public.sku_barcodes (
  id uuid primary key default extensions.gen_random_uuid(),
  sku_id uuid not null,
  packaging_level_id uuid null references public.sku_packaging_levels(id) on delete set null,
  barcode text not null,
  barcode_type text not null default 'UNKNOWN', -- GTIN_13 / GTIN_14 / EAN_13 / UPC / INTERNAL / ORDERMENTUM_PSEUDO / UNKNOWN
  source text not null default 'manual', -- warehouse_scan / supplier_packaging / ordermentum_candidate / manual
  status text not null default 'CONFIRMED', -- CONFIRMED / REVIEW / ORDERMENTUM_CODE_ONLY / INACTIVE
  is_primary boolean not null default false,
  confirmed_at timestamptz null,
  confirmed_by text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sku_barcodes_barcode_not_blank check (length(trim(barcode)) > 0),
  constraint sku_barcodes_unique_barcode unique (barcode)
);

create index if not exists idx_sku_barcodes_sku_id
  on public.sku_barcodes(sku_id);

create index if not exists idx_sku_barcodes_packaging_level_id
  on public.sku_barcodes(packaging_level_id);

create index if not exists idx_sku_barcodes_status
  on public.sku_barcodes(status);

-- Known freight/service lines should never block warehouse barcode work.
insert into public.ecoflow_sku_master_overrides (
  external_sku_code,
  internal_sku_id,
  classification,
  is_service_item,
  preferred_pick_level,
  status,
  notes
)
select
  m.external_product_code,
  m.internal_sku_id,
  'SERVICE_ITEM',
  true,
  null,
  'ACTIVE',
  'Auto-classified common freight/service line. Does not require warehouse barcode.'
from public.external_product_mappings m
where m.provider = 'ORDERMENTUM'
  and (
    upper(m.external_product_code) in ('FC-01', 'FREIGHT', 'DELIVERY')
    or m.external_product_code ilike '%freight%'
    or m.external_product_code ilike '%delivery%'
  )
on conflict (external_sku_code) do update set
  internal_sku_id = coalesce(excluded.internal_sku_id, public.ecoflow_sku_master_overrides.internal_sku_id),
  classification = 'SERVICE_ITEM',
  is_service_item = true,
  status = 'ACTIVE',
  updated_at = now();

-- Extract listed SKUs and Ordermentum pseudo barcode candidates from the variants table.
create or replace view public.v_ecoflow_ordermentum_listed_skus as
select
  v.sku::text as external_sku_code,
  max(v.name)::text as listed_product_name,
  max(v.id::text)::text as external_variant_id,
  max(v.raw_json->>'productId')::text as external_product_id,
  max(v.raw_json->>'unit')::text as listed_unit,
  max(v.raw_json->>'uom')::text as listed_uom,
  max(v.raw_json->>'barcode')::text as ordermentum_barcode_candidate,
  case
    when max(v.raw_json->>'barcode') ~ '^x[0-9a-fA-F]{8,}$' then 'ORDERMENTUM_CODE_ONLY'
    when max(v.raw_json->>'barcode') ~ '^[0-9]{14}$' then 'POSSIBLE_GTIN_14'
    when max(v.raw_json->>'barcode') ~ '^[0-9]{13}$' then 'POSSIBLE_EAN_13'
    when max(v.raw_json->>'barcode') ~ '^[0-9]{12}$' then 'POSSIBLE_UPC'
    when nullif(max(v.raw_json->>'barcode'), '') is not null then 'UNKNOWN_CANDIDATE'
    else 'MISSING'
  end as ordermentum_barcode_candidate_type,
  bool_or(coalesce((v.raw_json->>'visible')::boolean, true)) as is_visible_on_ordermentum,
  bool_or(coalesce((v.raw_json->>'outOfStock')::boolean, false)) as is_out_of_stock_on_ordermentum,
  min(nullif(v.raw_json->>'createdAt', '')::timestamptz) as listed_created_at,
  max(nullif(v.raw_json->>'updatedAt', '')::timestamptz) as listed_updated_at
from public.om_variants v
where nullif(v.sku, '') is not null
group by v.sku;

-- True movement from imported order history.
create or replace view public.v_ecoflow_sku_activity_summary as
with line_base as (
  select
    l.external_sku_code,
    l.external_product_name,
    l.order_number,
    l.invoice_number,
    coalesce(i.received_business_day, (coalesce(i.order_created_at, i.raw_created_at) at time zone 'Australia/Adelaide')::date) as business_day,
    coalesce(i.order_created_at, i.raw_created_at) as order_created_at,
    coalesce(i.order_updated_at, i.raw_updated_at) as order_updated_at,
    coalesce(l.quantity, 0)::numeric(14,4) as quantity,
    coalesce(l.total, 0)::numeric(14,4) as line_total,
    l.unit,
    l.uom
  from public.v_ecoflow_ordermentum_order_lines l
  left join public.v_ecoflow_ordermentum_inbox i
    on i.order_number = l.order_number
   and i.invoice_number = l.invoice_number
  where nullif(l.external_sku_code, '') is not null
),
activity as (
  select
    external_sku_code,
    max(external_product_name)::text as external_product_name,
    max(unit)::text as most_common_unit,
    max(uom)::text as most_common_uom,
    min(business_day) as first_ordered_day,
    max(business_day) as last_ordered_day,
    count(distinct order_number)::bigint as lifetime_order_count,
    count(*)::bigint as lifetime_line_count,
    coalesce(sum(quantity), 0)::numeric(14,4) as lifetime_quantity,
    coalesce(sum(line_total), 0)::numeric(14,4) as lifetime_sales_value,
    count(distinct order_number) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '30 days'))::bigint as orders_30d,
    count(distinct order_number) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '60 days'))::bigint as orders_60d,
    count(distinct order_number) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '90 days'))::bigint as orders_90d,
    coalesce(sum(quantity) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '30 days')), 0)::numeric(14,4) as quantity_30d,
    coalesce(sum(quantity) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '60 days')), 0)::numeric(14,4) as quantity_60d,
    coalesce(sum(quantity) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '90 days')), 0)::numeric(14,4) as quantity_90d,
    coalesce(sum(line_total) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '30 days')), 0)::numeric(14,4) as sales_value_30d,
    coalesce(sum(line_total) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '60 days')), 0)::numeric(14,4) as sales_value_60d,
    coalesce(sum(line_total) filter (where business_day >= ((now() at time zone 'Australia/Adelaide')::date - interval '90 days')), 0)::numeric(14,4) as sales_value_90d
  from line_base
  group by external_sku_code
),
mapping as (
  select
    external_product_code as external_sku_code,
    min(internal_sku_id::text)::uuid as internal_sku_id
  from public.external_product_mappings
  where provider = 'ORDERMENTUM'
  group by external_product_code
),
barcode_rollup as (
  select
    b.sku_id,
    count(*) filter (where b.status = 'CONFIRMED')::bigint as confirmed_barcode_count,
    count(*) filter (where b.status = 'CONFIRMED' and coalesce(pl.level_code, '') = 'CARTON')::bigint as confirmed_carton_barcode_count,
    count(*) filter (where b.status = 'CONFIRMED' and coalesce(pl.level_code, '') = 'SLEEVE')::bigint as confirmed_sleeve_barcode_count,
    count(*) filter (where b.status = 'CONFIRMED' and coalesce(pl.level_code, '') = 'EACH')::bigint as confirmed_each_barcode_count,
    max(b.barcode) filter (where b.status = 'CONFIRMED' and b.is_primary = true)::text as primary_barcode,
    max(b.updated_at) as last_barcode_update_at
  from public.sku_barcodes b
  left join public.sku_packaging_levels pl
    on pl.id = b.packaging_level_id
  group by b.sku_id
),
listed as (
  select * from public.v_ecoflow_ordermentum_listed_skus
),
overrides as (
  select * from public.ecoflow_sku_master_overrides
)
select
  coalesce(a.external_sku_code, listed.external_sku_code) as external_sku_code,
  coalesce(a.external_product_name, listed.listed_product_name) as external_product_name,
  mapping.internal_sku_id,
  coalesce(a.most_common_unit, listed.listed_unit) as sales_unit,
  coalesce(a.most_common_uom, listed.listed_uom) as sales_uom,
  listed.ordermentum_barcode_candidate,
  listed.ordermentum_barcode_candidate_type,
  coalesce(br.confirmed_barcode_count, 0)::bigint as confirmed_barcode_count,
  coalesce(br.confirmed_carton_barcode_count, 0)::bigint as confirmed_carton_barcode_count,
  coalesce(br.confirmed_sleeve_barcode_count, 0)::bigint as confirmed_sleeve_barcode_count,
  coalesce(br.confirmed_each_barcode_count, 0)::bigint as confirmed_each_barcode_count,
  br.primary_barcode,
  br.last_barcode_update_at,
  coalesce(overrides.classification,
    case
      when coalesce(a.external_sku_code, listed.external_sku_code) ilike '%freight%' then 'SERVICE_ITEM'
      when coalesce(a.external_product_name, listed.listed_product_name) ilike '%freight%' then 'SERVICE_ITEM'
      when coalesce(a.external_product_name, listed.listed_product_name) ilike '%delivery%' then 'SERVICE_ITEM'
      else 'PRODUCT'
    end
  ) as sku_classification,
  coalesce(overrides.is_service_item, false) as is_service_item_override,
  overrides.preferred_pick_level,
  overrides.status as override_status,
  a.first_ordered_day,
  a.last_ordered_day,
  coalesce(a.lifetime_order_count, 0)::bigint as lifetime_order_count,
  coalesce(a.lifetime_line_count, 0)::bigint as lifetime_line_count,
  coalesce(a.lifetime_quantity, 0)::numeric(14,4) as lifetime_quantity,
  coalesce(a.lifetime_sales_value, 0)::numeric(14,4) as lifetime_sales_value,
  coalesce(a.orders_30d, 0)::bigint as orders_30d,
  coalesce(a.orders_60d, 0)::bigint as orders_60d,
  coalesce(a.orders_90d, 0)::bigint as orders_90d,
  coalesce(a.quantity_30d, 0)::numeric(14,4) as quantity_30d,
  coalesce(a.quantity_60d, 0)::numeric(14,4) as quantity_60d,
  coalesce(a.quantity_90d, 0)::numeric(14,4) as quantity_90d,
  coalesce(a.sales_value_30d, 0)::numeric(14,4) as sales_value_30d,
  coalesce(a.sales_value_60d, 0)::numeric(14,4) as sales_value_60d,
  coalesce(a.sales_value_90d, 0)::numeric(14,4) as sales_value_90d,
  case
    when coalesce(a.lifetime_order_count, 0) = 0 then 'DORMANT'
    when coalesce(a.orders_90d, 0) >= 20 or coalesce(a.quantity_90d, 0) >= 100 then 'FAST'
    when coalesce(a.orders_90d, 0) >= 5 or coalesce(a.quantity_90d, 0) >= 20 then 'MEDIUM'
    else 'SLOW'
  end as movement_class,
  case
    when coalesce(overrides.is_service_item, false) = true then 'SERVICE_ITEM'
    when coalesce(br.confirmed_barcode_count, 0) > 0 then 'CONFIRMED'
    when listed.ordermentum_barcode_candidate_type = 'ORDERMENTUM_CODE_ONLY' then 'ORDERMENTUM_CODE_ONLY'
    when nullif(listed.ordermentum_barcode_candidate, '') is not null then 'REVIEW_CANDIDATE'
    else 'NEEDS_BARCODE'
  end as barcode_status,
  case
    when coalesce(overrides.is_service_item, false) = true then 'No warehouse barcode required.'
    when coalesce(br.confirmed_carton_barcode_count, 0) = 0 and coalesce(a.lifetime_order_count, 0) > 0 then 'Confirm carton barcode first.'
    when coalesce(br.confirmed_barcode_count, 0) = 0 then 'Barcode not yet confirmed.'
    when coalesce(br.confirmed_sleeve_barcode_count, 0) = 0 then 'Consider sleeve barcode if split picking is required.'
    else 'Barcode master data available.'
  end as required_action
from activity a
full outer join listed
  on listed.external_sku_code = a.external_sku_code
left join mapping
  on mapping.external_sku_code = coalesce(a.external_sku_code, listed.external_sku_code)
left join barcode_rollup br
  on br.sku_id = mapping.internal_sku_id
left join overrides
  on overrides.external_sku_code = coalesce(a.external_sku_code, listed.external_sku_code);

create or replace view public.v_ecoflow_sku_abc_analysis as
with base as (
  select
    s.*,
    sum(case when sku_classification = 'PRODUCT' then lifetime_sales_value else 0 end) over ()::numeric(14,4) as total_product_sales_value,
    sum(case when sku_classification = 'PRODUCT' then lifetime_quantity else 0 end) over ()::numeric(14,4) as total_product_quantity
  from public.v_ecoflow_sku_activity_summary s
),
ranked as (
  select
    base.*,
    row_number() over (order by lifetime_sales_value desc, lifetime_order_count desc, external_sku_code) as sales_rank,
    row_number() over (order by lifetime_quantity desc, lifetime_order_count desc, external_sku_code) as quantity_rank,
    sum(case when sku_classification = 'PRODUCT' then lifetime_sales_value else 0 end) over (
      order by lifetime_sales_value desc, lifetime_order_count desc, external_sku_code rows between unbounded preceding and current row
    )::numeric(14,4) as cumulative_sales_value,
    sum(case when sku_classification = 'PRODUCT' then lifetime_quantity else 0 end) over (
      order by lifetime_quantity desc, lifetime_order_count desc, external_sku_code rows between unbounded preceding and current row
    )::numeric(14,4) as cumulative_quantity
  from base
)
select
  *,
  case
    when sku_classification = 'SERVICE_ITEM' then 'SERVICE'
    when total_product_sales_value <= 0 then 'C'
    when cumulative_sales_value / nullif(total_product_sales_value, 0) <= 0.80 then 'A'
    when cumulative_sales_value / nullif(total_product_sales_value, 0) <= 0.95 then 'B'
    else 'C'
  end as abc_sales_class,
  case
    when sku_classification = 'SERVICE_ITEM' then 'SERVICE'
    when total_product_quantity <= 0 then 'C'
    when cumulative_quantity / nullif(total_product_quantity, 0) <= 0.80 then 'A'
    when cumulative_quantity / nullif(total_product_quantity, 0) <= 0.95 then 'B'
    else 'C'
  end as abc_quantity_class,
  case
    when sku_classification = 'SERVICE_ITEM' then 999999
    when total_product_sales_value <= 0 then 999998
    else sales_rank
  end as barcode_priority_rank
from ranked;

create or replace view public.v_ecoflow_sku_barcode_gap_report as
select
  barcode_priority_rank,
  external_sku_code,
  external_product_name,
  internal_sku_id,
  sku_classification,
  abc_sales_class,
  abc_quantity_class,
  movement_class,
  lifetime_order_count,
  lifetime_quantity,
  lifetime_sales_value,
  orders_30d,
  orders_60d,
  orders_90d,
  ordermentum_barcode_candidate,
  ordermentum_barcode_candidate_type,
  confirmed_barcode_count,
  confirmed_carton_barcode_count,
  confirmed_sleeve_barcode_count,
  confirmed_each_barcode_count,
  barcode_status,
  required_action
from public.v_ecoflow_sku_abc_analysis
where sku_classification <> 'SERVICE_ITEM'
  and (
    confirmed_carton_barcode_count = 0
    or barcode_status in ('NEEDS_BARCODE', 'ORDERMENTUM_CODE_ONLY', 'REVIEW_CANDIDATE')
  );

create or replace view public.v_ecoflow_top_skus_for_barcode_confirmation as
select *
from public.v_ecoflow_sku_barcode_gap_report
where lifetime_order_count > 0
order by
  case abc_sales_class when 'A' then 1 when 'B' then 2 else 3 end,
  case movement_class when 'FAST' then 1 when 'MEDIUM' then 2 when 'SLOW' then 3 else 4 end,
  lifetime_sales_value desc,
  lifetime_order_count desc,
  external_sku_code;

create or replace view public.v_ecoflow_sku_packaging_barcode_matrix as
select
  pl.sku_id,
  pl.level_code,
  pl.level_name,
  pl.quantity_in_base_units,
  pl.is_orderable,
  pl.is_pickable,
  pl.is_stockable,
  pl.status as packaging_level_status,
  b.barcode,
  b.barcode_type,
  b.source,
  b.status as barcode_status,
  b.is_primary,
  b.confirmed_at,
  b.confirmed_by,
  b.notes,
  b.updated_at
from public.sku_packaging_levels pl
left join public.sku_barcodes b
  on b.packaging_level_id = pl.id;

create or replace view public.v_ecoflow_ordermentum_sku_library_dashboard as
select
  count(*)::bigint as listed_sku_count,
  count(*) filter (where lifetime_order_count > 0)::bigint as ordered_sku_count,
  count(*) filter (where lifetime_order_count = 0)::bigint as dormant_or_unordered_sku_count,
  count(*) filter (where sku_classification = 'SERVICE_ITEM')::bigint as service_item_count,
  count(*) filter (where sku_classification <> 'SERVICE_ITEM' and abc_sales_class = 'A')::bigint as a_class_sku_count,
  count(*) filter (where sku_classification <> 'SERVICE_ITEM' and movement_class = 'FAST')::bigint as fast_moving_sku_count,
  count(*) filter (where sku_classification <> 'SERVICE_ITEM' and barcode_status = 'CONFIRMED')::bigint as barcode_confirmed_sku_count,
  count(*) filter (where sku_classification <> 'SERVICE_ITEM' and confirmed_carton_barcode_count > 0)::bigint as carton_barcode_confirmed_sku_count,
  count(*) filter (where sku_classification <> 'SERVICE_ITEM' and confirmed_sleeve_barcode_count > 0)::bigint as sleeve_barcode_confirmed_sku_count,
  count(*) filter (where sku_classification <> 'SERVICE_ITEM' and lifetime_order_count > 0 and confirmed_carton_barcode_count = 0)::bigint as ordered_skus_missing_carton_barcode,
  coalesce(sum(lifetime_sales_value), 0)::numeric(14,4) as total_lifetime_sales_value,
  coalesce(sum(lifetime_quantity), 0)::numeric(14,4) as total_lifetime_quantity,
  max(last_ordered_day) as latest_ordered_day
from public.v_ecoflow_sku_abc_analysis;

-- Confirm a real warehouse barcode for a given Ordermentum SKU and packaging level.
create or replace function public.ecoflow_confirm_sku_barcode(
  p_external_sku_code text,
  p_barcode text,
  p_level_code text default 'CARTON',
  p_quantity_in_base_units numeric default 1,
  p_barcode_type text default 'UNKNOWN',
  p_source text default 'warehouse_scan',
  p_is_primary boolean default true,
  p_confirmed_by text default null,
  p_notes text default null
)
returns table(
  external_sku_code text,
  internal_sku_id uuid,
  packaging_level_id uuid,
  barcode_id uuid,
  barcode text,
  level_code text,
  status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_external_sku_code text := nullif(trim(p_external_sku_code), '');
  v_barcode text := nullif(trim(p_barcode), '');
  v_level_code text := upper(coalesce(nullif(trim(p_level_code), ''), 'CARTON'));
  v_sku_id uuid;
  v_packaging_level_id uuid;
  v_barcode_id uuid;
begin
  if v_external_sku_code is null then
    raise exception 'external_sku_code is required';
  end if;

  if v_barcode is null then
    raise exception 'barcode is required';
  end if;

  if coalesce(p_quantity_in_base_units, 0) <= 0 then
    raise exception 'quantity_in_base_units must be positive';
  end if;

  select m.internal_sku_id
    into v_sku_id
  from public.external_product_mappings m
  where m.provider = 'ORDERMENTUM'
    and m.external_product_code = v_external_sku_code
  limit 1;

  if v_sku_id is null then
    raise exception 'No internal SKU mapping found for Ordermentum SKU %', v_external_sku_code;
  end if;

  insert into public.sku_packaging_levels (
    sku_id,
    level_code,
    level_name,
    quantity_in_base_units,
    is_orderable,
    is_pickable,
    is_stockable,
    status,
    notes
  ) values (
    v_sku_id,
    v_level_code,
    initcap(lower(v_level_code)),
    p_quantity_in_base_units,
    v_level_code in ('CARTON', 'CASE', 'EACH'),
    true,
    true,
    'ACTIVE',
    p_notes
  )
  on conflict (sku_id, level_code) do update set
    quantity_in_base_units = excluded.quantity_in_base_units,
    is_pickable = true,
    is_stockable = true,
    status = 'ACTIVE',
    notes = coalesce(excluded.notes, public.sku_packaging_levels.notes),
    updated_at = now()
  returning id into v_packaging_level_id;

  if p_is_primary then
    update public.sku_barcodes
      set is_primary = false,
          updated_at = now()
    where sku_id = v_sku_id
      and coalesce(packaging_level_id, v_packaging_level_id) = v_packaging_level_id;
  end if;

  insert into public.sku_barcodes (
    sku_id,
    packaging_level_id,
    barcode,
    barcode_type,
    source,
    status,
    is_primary,
    confirmed_at,
    confirmed_by,
    notes
  ) values (
    v_sku_id,
    v_packaging_level_id,
    v_barcode,
    coalesce(nullif(trim(p_barcode_type), ''), 'UNKNOWN'),
    coalesce(nullif(trim(p_source), ''), 'warehouse_scan'),
    'CONFIRMED',
    p_is_primary,
    now(),
    p_confirmed_by,
    p_notes
  )
  on conflict (barcode) do update set
    sku_id = excluded.sku_id,
    packaging_level_id = excluded.packaging_level_id,
    barcode_type = excluded.barcode_type,
    source = excluded.source,
    status = 'CONFIRMED',
    is_primary = excluded.is_primary,
    confirmed_at = coalesce(public.sku_barcodes.confirmed_at, now()),
    confirmed_by = coalesce(excluded.confirmed_by, public.sku_barcodes.confirmed_by),
    notes = coalesce(excluded.notes, public.sku_barcodes.notes),
    updated_at = now()
  returning id into v_barcode_id;

  insert into public.ecoflow_sku_master_overrides (
    external_sku_code,
    internal_sku_id,
    classification,
    is_service_item,
    preferred_pick_level,
    status,
    notes
  ) values (
    v_external_sku_code,
    v_sku_id,
    'PRODUCT',
    false,
    v_level_code,
    'ACTIVE',
    p_notes
  )
  on conflict (external_sku_code) do update set
    internal_sku_id = excluded.internal_sku_id,
    classification = case when public.ecoflow_sku_master_overrides.classification = 'SERVICE_ITEM' then 'SERVICE_ITEM' else 'PRODUCT' end,
    is_service_item = case when public.ecoflow_sku_master_overrides.classification = 'SERVICE_ITEM' then true else false end,
    preferred_pick_level = excluded.preferred_pick_level,
    status = 'ACTIVE',
    notes = coalesce(excluded.notes, public.ecoflow_sku_master_overrides.notes),
    updated_at = now();

  return query select
    v_external_sku_code,
    v_sku_id,
    v_packaging_level_id,
    v_barcode_id,
    v_barcode,
    v_level_code,
    'CONFIRMED'::text;
end;
$$;

-- Mark an Ordermentum SKU as service/non-warehouse item.
create or replace function public.ecoflow_mark_ordermentum_sku_service_item(
  p_external_sku_code text,
  p_notes text default null
)
returns table(
  external_sku_code text,
  internal_sku_id uuid,
  classification text,
  is_service_item boolean,
  status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_external_sku_code text := nullif(trim(p_external_sku_code), '');
  v_sku_id uuid;
begin
  if v_external_sku_code is null then
    raise exception 'external_sku_code is required';
  end if;

  select m.internal_sku_id
    into v_sku_id
  from public.external_product_mappings m
  where m.provider = 'ORDERMENTUM'
    and m.external_product_code = v_external_sku_code
  limit 1;

  insert into public.ecoflow_sku_master_overrides (
    external_sku_code,
    internal_sku_id,
    classification,
    is_service_item,
    preferred_pick_level,
    status,
    notes
  ) values (
    v_external_sku_code,
    v_sku_id,
    'SERVICE_ITEM',
    true,
    null,
    'ACTIVE',
    p_notes
  )
  on conflict (external_sku_code) do update set
    internal_sku_id = coalesce(excluded.internal_sku_id, public.ecoflow_sku_master_overrides.internal_sku_id),
    classification = 'SERVICE_ITEM',
    is_service_item = true,
    preferred_pick_level = null,
    status = 'ACTIVE',
    notes = coalesce(excluded.notes, public.ecoflow_sku_master_overrides.notes),
    updated_at = now();

  return query select
    v_external_sku_code,
    v_sku_id,
    'SERVICE_ITEM'::text,
    true,
    'ACTIVE'::text;
end;
$$;

grant select on public.v_ecoflow_ordermentum_listed_skus to anon, authenticated, service_role;
grant select on public.v_ecoflow_sku_activity_summary to anon, authenticated, service_role;
grant select on public.v_ecoflow_sku_abc_analysis to anon, authenticated, service_role;
grant select on public.v_ecoflow_sku_barcode_gap_report to anon, authenticated, service_role;
grant select on public.v_ecoflow_top_skus_for_barcode_confirmation to anon, authenticated, service_role;
grant select on public.v_ecoflow_sku_packaging_barcode_matrix to anon, authenticated, service_role;
grant select on public.v_ecoflow_ordermentum_sku_library_dashboard to anon, authenticated, service_role;

grant select, insert, update on public.ecoflow_sku_master_overrides to authenticated, service_role;
grant select, insert, update on public.sku_packaging_levels to authenticated, service_role;
grant select, insert, update on public.sku_barcodes to authenticated, service_role;

grant execute on function public.ecoflow_confirm_sku_barcode(text, text, text, numeric, text, text, boolean, text, text) to authenticated, service_role;
grant execute on function public.ecoflow_mark_ordermentum_sku_service_item(text, text) to authenticated, service_role;
