-- EcoFlow master data pass 1: seed the SKU master and create the store-site (address) master.
-- Everything is idempotent; manual edits (source='manual' / existing override rows) are preserved.

-- ============================================================
-- 1) Store / delivery-site master, seeded from Ordermentum raw orders
--    (address, coordinates, phone, delivery instructions, price group).
-- ============================================================

create table if not exists public.ecoflow_store_sites (
  retailer_id uuid primary key,
  purchaser_id uuid null,
  store_name text not null,
  street1 text null,
  street2 text null,
  suburb text null,
  state text null,
  postcode text null,
  formatted_address text null,
  latitude double precision null,
  longitude double precision null,
  contact_phone text null,
  delivery_instructions text null,
  price_group_id uuid null,
  source text not null default 'ordermentum',
  verified boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ecoflow_store_sites_touch on public.ecoflow_store_sites;
create trigger trg_ecoflow_store_sites_touch
before insert or update on public.ecoflow_store_sites
for each row execute function public.ecoflow_touch_updated_at();

alter table public.ecoflow_store_sites enable row level security;

drop policy if exists ecoflow_store_sites_select on public.ecoflow_store_sites;
create policy ecoflow_store_sites_select
  on public.ecoflow_store_sites for select
  to anon, authenticated using (true);

drop policy if exists ecoflow_store_sites_write on public.ecoflow_store_sites;
create policy ecoflow_store_sites_write
  on public.ecoflow_store_sites for update
  to anon, authenticated using (true) with check (true);

grant select, update on public.ecoflow_store_sites to anon, authenticated;

-- Seed / refresh from the newest raw order per retailer that actually carries an
-- address (some orders omit it). Manual rows are never overwritten.
with source as (
  select
    (o.raw_json)::jsonb as rj,
    o.retailer_id,
    o.retailer_name,
    o.updated_at
  from public.om_orders o
  where o.retailer_id is not null
    and o.raw_json is not null
), ranked as (
  select
    s.*,
    row_number() over (
      partition by s.retailer_id
      order by (nullif(s.rj->'address'->>'street1', '') is not null) desc, s.updated_at desc nulls last
    ) as rn
  from source s
), extracted as (
  select
    retailer_id,
    nullif(rj->'purchaser'->>'id', '')::uuid as purchaser_id,
    coalesce(nullif(rj->>'retailerName', ''), retailer_name, 'Unknown store') as store_name,
    nullif(rj->'address'->>'street1', '') as street1,
    nullif(rj->'address'->>'street2', '') as street2,
    nullif(rj->'address'->>'suburb', '') as suburb,
    nullif(rj->'address'->>'state', '') as state,
    nullif(rj->'address'->>'postcode', '') as postcode,
    nullif(rj->'address'->>'formatted', '') as formatted_address,
    nullif(rj->'address'->>'latitude', '')::double precision as latitude,
    nullif(rj->'address'->>'longitude', '')::double precision as longitude,
    nullif(rj->'purchaser'->>'retailerPhone', '') as contact_phone,
    coalesce(nullif(rj->>'deliveryInstructions', ''), nullif(rj->'purchaser'->>'deliveryInstructions', '')) as delivery_instructions,
    nullif(rj->'purchaser'->>'priceGroupId', '')::uuid as price_group_id
  from ranked
  where rn = 1
)
insert into public.ecoflow_store_sites (
  retailer_id, purchaser_id, store_name, street1, street2, suburb, state, postcode,
  formatted_address, latitude, longitude, contact_phone, delivery_instructions, price_group_id,
  source, verified
)
select
  e.retailer_id, e.purchaser_id, e.store_name, e.street1, e.street2, e.suburb, e.state, e.postcode,
  e.formatted_address, e.latitude, e.longitude, e.contact_phone, e.delivery_instructions, e.price_group_id,
  'ordermentum', (e.street1 is not null and e.suburb is not null)
from extracted e
on conflict (retailer_id) do update set
  purchaser_id = excluded.purchaser_id,
  store_name = excluded.store_name,
  street1 = excluded.street1,
  street2 = excluded.street2,
  suburb = excluded.suburb,
  state = excluded.state,
  postcode = excluded.postcode,
  formatted_address = excluded.formatted_address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  contact_phone = excluded.contact_phone,
  delivery_instructions = excluded.delivery_instructions,
  price_group_id = excluded.price_group_id,
  verified = excluded.verified
where public.ecoflow_store_sites.source <> 'manual';

-- ============================================================
-- 2) SKU master seed: one override row per mapped Ordermentum SKU,
--    warehouse location column, packaging levels and barcode candidates.
-- ============================================================

alter table public.ecoflow_sku_master_overrides
  add column if not exists warehouse_location text;

-- 2a. Product rows for every active mapping.
-- NOTE: external_product_mappings.default_unit_level is an unreliable 'SLEEVE'
-- placeholder for every row, so the pick level is inferred from how the SKU
-- actually appears on real order lines (majority unit wins; default CARTON).
with line_units as (
  select
    l.external_sku_code,
    count(*) filter (where lower(coalesce(l.unit, '')) in ('carton', 'box')) as carton_ct,
    count(*) filter (
      where lower(coalesce(l.unit, '')) in ('unit', 'each', 'ea')
         or lower(coalesce(l.unit, '')) like '%sleeve%'
    ) as loose_ct
  from public.v_ecoflow_ordermentum_order_lines l
  where nullif(l.external_sku_code, '') is not null
  group by l.external_sku_code
)
insert into public.ecoflow_sku_master_overrides (
  external_sku_code, internal_sku_id, classification, is_service_item,
  preferred_pick_level, status, notes
)
select
  m.external_product_code,
  m.internal_sku_id,
  'PRODUCT',
  false,
  case when coalesce(lu.loose_ct, 0) > coalesce(lu.carton_ct, 0) then 'EACH' else 'CARTON' end,
  'ACTIVE',
  'Seeded from mapping; pick level inferred from order-line units'
from public.external_product_mappings m
left join line_units lu on lu.external_sku_code = m.external_product_code
where m.provider = 'ORDERMENTUM' and m.is_active
on conflict (external_sku_code) do nothing;

-- 2b. Freight / service classification (same rule as the barcode-master patch).
update public.ecoflow_sku_master_overrides o
set classification = 'SERVICE_ITEM', is_service_item = true, preferred_pick_level = null
where upper(o.external_sku_code) in ('FC-01', 'FC', 'FREIGHT', 'DELIVERY')
   or o.external_sku_code ilike '%freight%'
   or o.external_sku_code ilike '%delivery fee%';

-- 2c. A CARTON packaging level for every mapped physical SKU.
insert into public.sku_packaging_levels (sku_id, level_code, level_name, quantity_in_base_units, is_orderable, is_pickable, is_stockable)
select distinct m.internal_sku_id, 'CARTON', 'Carton', 1, true, true, true
from public.external_product_mappings m
join public.ecoflow_sku_master_overrides o on o.external_sku_code = m.external_product_code
where m.provider = 'ORDERMENTUM' and m.is_active and m.internal_sku_id is not null
  and o.is_service_item = false
on conflict (sku_id, level_code) do nothing;

-- 2d. An EACH level where the SKU is sold loose (unit/each/sleeve).
insert into public.sku_packaging_levels (sku_id, level_code, level_name, quantity_in_base_units, is_orderable, is_pickable, is_stockable)
select distinct m.internal_sku_id, 'EACH', 'Each / sleeve', 1, true, true, false
from public.external_product_mappings m
join public.ecoflow_sku_master_overrides o on o.external_sku_code = m.external_product_code
where m.provider = 'ORDERMENTUM' and m.is_active and m.internal_sku_id is not null
  and o.is_service_item = false
  and o.preferred_pick_level in ('EACH', 'SLEEVE')
on conflict (sku_id, level_code) do nothing;

-- 2e. Barcode candidates straight from what is already listed on Ordermentum.
insert into public.sku_barcodes (sku_id, packaging_level_id, barcode, barcode_type, source, status, is_primary)
select
  m.internal_sku_id,
  pl.id,
  ls.ordermentum_barcode_candidate,
  case ls.ordermentum_barcode_candidate_type
    when 'POSSIBLE_EAN_13' then 'EAN_13'
    when 'POSSIBLE_GTIN_14' then 'GTIN_14'
    when 'POSSIBLE_UPC' then 'UPC'
    else 'ORDERMENTUM_PSEUDO'
  end,
  'ordermentum_candidate',
  case
    when ls.ordermentum_barcode_candidate_type in ('POSSIBLE_EAN_13', 'POSSIBLE_GTIN_14', 'POSSIBLE_UPC') then 'REVIEW'
    else 'ORDERMENTUM_CODE_ONLY'
  end,
  false
from public.v_ecoflow_ordermentum_listed_skus ls
join public.external_product_mappings m
  on m.provider = 'ORDERMENTUM' and m.external_product_code = ls.external_sku_code and m.is_active
join public.sku_packaging_levels pl
  on pl.sku_id = m.internal_sku_id and pl.level_code = 'CARTON'
where ls.ordermentum_barcode_candidate_type <> 'MISSING'
  and nullif(ls.ordermentum_barcode_candidate, '') is not null
  and m.internal_sku_id is not null
on conflict (barcode) do nothing;

-- ============================================================
-- 3) App-facing SKU master view (one row per external SKU).
-- ============================================================

create or replace view public.v_ecoflow_app_sku_master as
select
  o.external_sku_code,
  o.classification,
  o.is_service_item,
  coalesce(o.preferred_pick_level, 'CARTON') as pick_level,
  o.warehouse_location,
  o.status,
  m.internal_sku_id,
  cb.barcode as carton_barcode,
  cb.status as carton_barcode_status,
  eb.barcode as each_barcode,
  eb.status as each_barcode_status
from public.ecoflow_sku_master_overrides o
left join public.external_product_mappings m
  on m.provider = 'ORDERMENTUM' and m.external_product_code = o.external_sku_code and m.is_active
-- Only CONFIRMED barcodes reach the app: Ordermentum pseudo-codes and unreviewed
-- candidates stay in sku_barcodes for the confirmation workbench but never drive scans.
left join lateral (
  select b.barcode, b.status
  from public.sku_barcodes b
  join public.sku_packaging_levels pl on pl.id = b.packaging_level_id
  where pl.sku_id = m.internal_sku_id and pl.level_code = 'CARTON' and b.status = 'CONFIRMED'
  order by b.is_primary desc, b.updated_at desc
  limit 1
) cb on true
left join lateral (
  select b.barcode, b.status
  from public.sku_barcodes b
  join public.sku_packaging_levels pl on pl.id = b.packaging_level_id
  where pl.sku_id = m.internal_sku_id and pl.level_code in ('EACH', 'SLEEVE') and b.status = 'CONFIRMED'
  order by b.is_primary desc, b.updated_at desc
  limit 1
) eb on true;

grant select on public.v_ecoflow_app_sku_master to anon, authenticated;
grant select on public.v_ecoflow_ordermentum_listed_skus to anon, authenticated;
