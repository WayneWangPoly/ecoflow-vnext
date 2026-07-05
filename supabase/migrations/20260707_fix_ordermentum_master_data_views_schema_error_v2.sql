-- Fix Ordermentum master-data workbench views that can fail with:
-- ERROR 2202E: multidimensional arrays must have array expressions with matching dimensions
--
-- Cause: previous view definitions used nested text-array path lists for jsonb extraction.
-- This migration recreates the app-facing master-data views using explicit JSON paths
-- and safe scalar parsing only. It does not touch raw data, seed data, store sites,
-- SKU overrides, or frontend files.

begin;

create or replace function public.ecoflow_safe_numeric(value text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when value is null then null
    when btrim(value) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(value)::numeric
    when regexp_replace(btrim(value), '[^0-9\.-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then regexp_replace(btrim(value), '[^0-9\.-]', '', 'g')::numeric
    else null
  end;
$$;

create or replace function public.ecoflow_jsonb_array(value jsonb)
returns jsonb
language sql
immutable
parallel safe
as $$
  select case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end;
$$;

grant execute on function public.ecoflow_safe_numeric(text) to anon, authenticated, service_role;
grant execute on function public.ecoflow_jsonb_array(jsonb) to anon, authenticated, service_role;

-- Recreate dependent views in a safe order.
drop view if exists public.v_ecoflow_ordermentum_customer_price_group_audit_v1;
drop view if exists public.v_ecoflow_ordermentum_price_tier_matrix_v1;
drop view if exists public.v_ecoflow_ordermentum_sku_master_v1;
drop view if exists public.v_ecoflow_ordermentum_customer_master_v1;
drop view if exists public.v_ecoflow_ordermentum_price_groups_v1;
drop view if exists public.v_ecoflow_ordermentum_master_data_sync_health;
drop view if exists public.v_ecoflow_external_change_queue;

create view public.v_ecoflow_ordermentum_master_data_sync_health as
select
  r.resource_type,
  count(*)::integer as raw_resource_count,
  count(*) filter (where coalesce(r.is_deleted_or_missing, false) = false)::integer as active_resource_count,
  min(r.first_seen_at) as first_seen_at,
  max(r.last_seen_at) as last_seen_at,
  max(r.last_synced_at) as last_synced_at,
  max(r.remote_updated_at) as latest_remote_updated_at,
  max(r.source_endpoint) as sample_source_endpoint
from public.ordermentum_raw_master_resources r
group by r.resource_type;

create view public.v_ecoflow_ordermentum_price_groups_v1 as
select
  r.external_id as external_price_group_id,
  coalesce(
    r.payload #>> '{name}',
    r.payload #>> '{priceGroupName}',
    r.payload #>> '{displayName}',
    r.payload #>> '{title}',
    r.external_id
  ) as price_group_name,
  coalesce(
    r.payload #>> '{status}',
    r.payload #>> '{state}',
    case when coalesce(r.is_deleted_or_missing, false) then 'missing' else 'active' end
  ) as price_group_status,
  coalesce(
    r.payload #>> '{type}',
    r.payload #>> '{priceGroupType}',
    r.payload #>> '{groupType}'
  ) as price_group_type,
  public.ecoflow_safe_numeric(coalesce(
    r.payload #>> '{customerCount}',
    r.payload #>> '{purchaserCount}',
    r.payload #>> '{retailerCount}'
  )) as customer_count,
  r.remote_created_at,
  r.remote_updated_at,
  r.first_seen_at,
  r.last_seen_at,
  r.last_synced_at,
  r.payload as raw_payload
from public.ordermentum_raw_master_resources r
where r.resource_type = 'price_groups'
  and coalesce(r.is_deleted_or_missing, false) = false;

create view public.v_ecoflow_ordermentum_customer_master_v1 as
select
  r.external_id as external_purchaser_id,
  coalesce(
    r.payload #>> '{retailer,id}',
    r.payload #>> '{retailerId}',
    r.payload #>> '{customer,id}',
    r.payload #>> '{customerId}'
  ) as external_retailer_id,
  coalesce(
    r.payload #>> '{retailer,name}',
    r.payload #>> '{retailer,businessName}',
    r.payload #>> '{customer,name}',
    r.payload #>> '{customer,businessName}',
    r.payload #>> '{businessName}',
    r.payload #>> '{name}',
    r.payload #>> '{displayName}',
    r.external_id
  ) as customer_or_store_name,
  coalesce(
    r.payload #>> '{retailer,businessName}',
    r.payload #>> '{customer,businessName}',
    r.payload #>> '{businessName}',
    r.payload #>> '{legalName}'
  ) as business_name,
  coalesce(
    r.payload #>> '{contact,name}',
    r.payload #>> '{contactName}',
    r.payload #>> '{primaryContact,name}',
    r.payload #>> '{retailer,contact,name}',
    r.payload #>> '{retailer,primaryContact,name}'
  ) as contact_name,
  coalesce(
    r.payload #>> '{contact,email}',
    r.payload #>> '{email}',
    r.payload #>> '{retailer,email}',
    r.payload #>> '{retailer,contact,email}',
    r.payload #>> '{retailer,primaryContact,email}',
    r.payload #>> '{contactInformation,email}'
  ) as email,
  coalesce(
    r.payload #>> '{contact,phone}',
    r.payload #>> '{phone}',
    r.payload #>> '{mobile}',
    r.payload #>> '{retailer,phone}',
    r.payload #>> '{retailer,contact,phone}',
    r.payload #>> '{retailer,primaryContact,phone}',
    r.payload #>> '{contactInformation,phone}',
    r.payload #>> '{contactInformation,mobile}'
  ) as phone,
  coalesce(
    r.payload #>> '{deliveryAddress,line1}',
    r.payload #>> '{deliveryAddress,address1}',
    r.payload #>> '{deliveryAddress,street1}',
    r.payload #>> '{address,line1}',
    r.payload #>> '{address,address1}',
    r.payload #>> '{retailer,address,line1}',
    r.payload #>> '{retailer,deliveryAddress,line1}'
  ) as address_line_1,
  coalesce(
    r.payload #>> '{deliveryAddress,line2}',
    r.payload #>> '{deliveryAddress,address2}',
    r.payload #>> '{deliveryAddress,street2}',
    r.payload #>> '{address,line2}',
    r.payload #>> '{address,address2}',
    r.payload #>> '{retailer,address,line2}',
    r.payload #>> '{retailer,deliveryAddress,line2}'
  ) as address_line_2,
  coalesce(
    r.payload #>> '{deliveryAddress,suburb}',
    r.payload #>> '{deliveryAddress,city}',
    r.payload #>> '{address,suburb}',
    r.payload #>> '{address,city}',
    r.payload #>> '{retailer,address,suburb}',
    r.payload #>> '{retailer,deliveryAddress,suburb}'
  ) as suburb,
  coalesce(
    r.payload #>> '{deliveryAddress,state}',
    r.payload #>> '{deliveryAddress,region}',
    r.payload #>> '{address,state}',
    r.payload #>> '{address,region}',
    r.payload #>> '{retailer,address,state}',
    r.payload #>> '{retailer,deliveryAddress,state}'
  ) as state,
  coalesce(
    r.payload #>> '{deliveryAddress,postcode}',
    r.payload #>> '{deliveryAddress,postalCode}',
    r.payload #>> '{address,postcode}',
    r.payload #>> '{address,postalCode}',
    r.payload #>> '{retailer,address,postcode}',
    r.payload #>> '{retailer,deliveryAddress,postcode}'
  ) as postcode,
  coalesce(
    r.payload #>> '{deliveryAddress,country}',
    r.payload #>> '{address,country}',
    r.payload #>> '{retailer,address,country}',
    'AU'
  ) as country,
  public.ecoflow_safe_numeric(coalesce(
    r.payload #>> '{deliveryAddress,latitude}',
    r.payload #>> '{deliveryAddress,lat}',
    r.payload #>> '{address,latitude}',
    r.payload #>> '{address,lat}',
    r.payload #>> '{retailer,address,latitude}',
    r.payload #>> '{geo,lat}',
    r.payload #>> '{latitude}',
    r.payload #>> '{lat}'
  )) as latitude,
  public.ecoflow_safe_numeric(coalesce(
    r.payload #>> '{deliveryAddress,longitude}',
    r.payload #>> '{deliveryAddress,lng}',
    r.payload #>> '{deliveryAddress,lon}',
    r.payload #>> '{address,longitude}',
    r.payload #>> '{address,lng}',
    r.payload #>> '{retailer,address,longitude}',
    r.payload #>> '{geo,lng}',
    r.payload #>> '{longitude}',
    r.payload #>> '{lng}',
    r.payload #>> '{lon}'
  )) as longitude,
  coalesce(
    r.payload #>> '{priceGroup,id}',
    r.payload #>> '{priceGroupId}',
    r.payload #>> '{price_group_id}',
    r.payload #>> '{linkedPriceGroup,id}',
    r.payload #>> '{pricing,priceGroupId}'
  ) as external_price_group_id,
  coalesce(
    r.payload #>> '{priceGroup,name}',
    r.payload #>> '{priceGroupName}',
    r.payload #>> '{price_group_name}',
    r.payload #>> '{linkedPriceGroup,name}',
    r.payload #>> '{pricing,priceGroupName}'
  ) as price_group_name,
  coalesce(
    r.payload #>> '{deliveryInstructions}',
    r.payload #>> '{delivery,instructions}',
    r.payload #>> '{purchasingPreferences,deliveryInstructions}',
    r.payload #>> '{preferences,deliveryInstructions}',
    r.payload #>> '{notes}',
    r.payload #>> '{deliveryNotes}'
  ) as delivery_instructions,
  coalesce(
    r.payload #>> '{status}',
    r.payload #>> '{state}',
    case when coalesce(r.is_deleted_or_missing, false) then 'missing' else 'active' end
  ) as customer_status,
  r.remote_created_at,
  r.remote_updated_at,
  r.first_seen_at,
  r.last_seen_at,
  r.last_synced_at,
  r.payload as raw_payload
from public.ordermentum_raw_master_resources r
where r.resource_type = 'purchasers'
  and coalesce(r.is_deleted_or_missing, false) = false;

create view public.v_ecoflow_ordermentum_sku_master_v1 as
with product_rows as (
  select
    'product'::text as source_type,
    r.external_id as external_product_id,
    null::text as external_variant_id,
    coalesce(
      r.payload #>> '{sku}',
      r.payload #>> '{code}',
      r.payload #>> '{productCode}',
      r.payload #>> '{externalCode}'
    ) as external_sku_code,
    coalesce(
      r.payload #>> '{name}',
      r.payload #>> '{productName}',
      r.payload #>> '{displayName}',
      r.external_id
    ) as external_product_name,
    null::text as external_variant_name,
    coalesce(
      r.payload #>> '{unitOfMeasure}',
      r.payload #>> '{unit}',
      r.payload #>> '{uom}',
      r.payload #>> '{sellUnit}',
      r.payload #>> '{defaultUnit}'
    ) as unit_of_measure,
    coalesce(
      r.payload #>> '{barcode}',
      r.payload #>> '{barCode}',
      r.payload #>> '{ean}',
      r.payload #>> '{gtin}',
      r.payload #>> '{upc}'
    ) as ordermentum_barcode_candidate,
    public.ecoflow_safe_numeric(coalesce(
      r.payload #>> '{price}',
      r.payload #>> '{basePrice}',
      r.payload #>> '{defaultPrice}',
      r.payload #>> '{unitPrice}'
    )) as base_price,
    coalesce(r.payload #>> '{status}', r.payload #>> '{state}', 'active') as source_status,
    r.remote_created_at,
    r.remote_updated_at,
    r.first_seen_at,
    r.last_seen_at,
    r.last_synced_at,
    r.payload as raw_payload
  from public.ordermentum_raw_master_resources r
  where r.resource_type = 'products'
    and coalesce(r.is_deleted_or_missing, false) = false
),
variant_rows as (
  select
    'variant'::text as source_type,
    coalesce(
      r.payload #>> '{product,id}',
      r.payload #>> '{productId}',
      r.payload #>> '{product_id}'
    ) as external_product_id,
    r.external_id as external_variant_id,
    coalesce(
      r.payload #>> '{sku}',
      r.payload #>> '{code}',
      r.payload #>> '{variantCode}',
      r.payload #>> '{productCode}',
      r.payload #>> '{externalCode}'
    ) as external_sku_code,
    coalesce(
      r.payload #>> '{product,name}',
      r.payload #>> '{productName}',
      r.payload #>> '{name}',
      r.payload #>> '{displayName}',
      r.external_id
    ) as external_product_name,
    coalesce(
      r.payload #>> '{variantName}',
      r.payload #>> '{name}',
      r.payload #>> '{displayName}',
      r.payload #>> '{description}'
    ) as external_variant_name,
    coalesce(
      r.payload #>> '{unitOfMeasure}',
      r.payload #>> '{unit}',
      r.payload #>> '{uom}',
      r.payload #>> '{sellUnit}',
      r.payload #>> '{defaultUnit}'
    ) as unit_of_measure,
    coalesce(
      r.payload #>> '{barcode}',
      r.payload #>> '{barCode}',
      r.payload #>> '{ean}',
      r.payload #>> '{gtin}',
      r.payload #>> '{upc}'
    ) as ordermentum_barcode_candidate,
    public.ecoflow_safe_numeric(coalesce(
      r.payload #>> '{price}',
      r.payload #>> '{basePrice}',
      r.payload #>> '{defaultPrice}',
      r.payload #>> '{unitPrice}'
    )) as base_price,
    coalesce(r.payload #>> '{status}', r.payload #>> '{state}', 'active') as source_status,
    r.remote_created_at,
    r.remote_updated_at,
    r.first_seen_at,
    r.last_seen_at,
    r.last_synced_at,
    r.payload as raw_payload
  from public.ordermentum_raw_master_resources r
  where r.resource_type = 'variants'
    and coalesce(r.is_deleted_or_missing, false) = false
),
combined as (
  select * from variant_rows
  union all
  select * from product_rows
)
select
  source_type,
  external_product_id,
  external_variant_id,
  external_sku_code,
  external_product_name,
  external_variant_name,
  unit_of_measure,
  case
    when lower(coalesce(unit_of_measure, external_variant_name, external_product_name, '')) ~ '(carton|ctn|box|case)' then 'CARTON'
    when lower(coalesce(unit_of_measure, external_variant_name, external_product_name, '')) ~ '(sleeve|slv|pack|packet)' then 'SLEEVE'
    when lower(coalesce(unit_of_measure, external_variant_name, external_product_name, '')) ~ '(each|ea|unit|piece|pc)' then 'EACH'
    else 'SLEEVE'
  end as inferred_default_unit_level,
  ordermentum_barcode_candidate,
  case
    when ordermentum_barcode_candidate is null or btrim(ordermentum_barcode_candidate) = '' then 'missing'
    when ordermentum_barcode_candidate ~ '^[0-9]{8,14}$' then 'gtin_like'
    else 'ordermentum_code_only'
  end as ordermentum_barcode_candidate_type,
  base_price,
  source_status,
  remote_created_at,
  remote_updated_at,
  first_seen_at,
  last_seen_at,
  last_synced_at,
  raw_payload
from combined;

create view public.v_ecoflow_ordermentum_price_tier_matrix_v1 as
with pg as (
  select * from public.ordermentum_raw_master_resources
  where resource_type = 'price_groups'
    and coalesce(is_deleted_or_missing, false) = false
),
product_price_items as (
  select
    pg.external_id as external_price_group_id,
    coalesce(pg.payload #>> '{name}', pg.payload #>> '{priceGroupName}', pg.external_id) as price_group_name,
    item.value as price_payload
  from pg
  cross join lateral jsonb_array_elements(
    public.ecoflow_jsonb_array(coalesce(
      pg.payload -> 'products',
      pg.payload -> 'productPrices',
      pg.payload -> 'prices',
      '[]'::jsonb
    ))
  ) as item(value)
),
variant_price_items as (
  select
    pg.external_id as external_price_group_id,
    coalesce(pg.payload #>> '{name}', pg.payload #>> '{priceGroupName}', pg.external_id) as price_group_name,
    item.value as price_payload
  from pg
  cross join lateral jsonb_array_elements(
    public.ecoflow_jsonb_array(coalesce(
      pg.payload -> 'variants',
      pg.payload -> 'variantPrices',
      '[]'::jsonb
    ))
  ) as item(value)
),
all_price_items as (
  select * from product_price_items
  union all
  select * from variant_price_items
)
select
  external_price_group_id,
  price_group_name,
  coalesce(
    price_payload #>> '{product,id}',
    price_payload #>> '{productId}',
    price_payload #>> '{product_id}'
  ) as external_product_id,
  coalesce(
    price_payload #>> '{variant,id}',
    price_payload #>> '{variantId}',
    price_payload #>> '{variant_id}'
  ) as external_variant_id,
  coalesce(
    price_payload #>> '{sku}',
    price_payload #>> '{code}',
    price_payload #>> '{productCode}',
    price_payload #>> '{variantCode}'
  ) as external_sku_code,
  coalesce(
    price_payload #>> '{productName}',
    price_payload #>> '{product,name}',
    price_payload #>> '{name}',
    price_payload #>> '{displayName}'
  ) as product_or_variant_name,
  public.ecoflow_safe_numeric(coalesce(
    price_payload #>> '{price}',
    price_payload #>> '{unitPrice}',
    price_payload #>> '{basePrice}',
    price_payload #>> '{amount}',
    price_payload #>> '{value}'
  )) as tier_price,
  coalesce(
    price_payload #>> '{currency}',
    price_payload #>> '{currencyCode}',
    'AUD'
  ) as currency,
  price_payload as raw_price_payload
from all_price_items;

create view public.v_ecoflow_ordermentum_customer_price_group_audit_v1 as
select
  c.external_purchaser_id,
  c.external_retailer_id,
  c.customer_or_store_name,
  c.email,
  c.phone,
  c.suburb,
  c.state,
  c.postcode,
  c.external_price_group_id,
  c.price_group_name as customer_price_group_name,
  pg.price_group_name as matched_price_group_name,
  case
    when c.external_price_group_id is null and c.price_group_name is null then 'NO_PRICE_GROUP_ON_CUSTOMER'
    when c.external_price_group_id is not null and pg.external_price_group_id is null then 'PRICE_GROUP_ID_NOT_IN_SYNCED_GROUPS'
    when c.external_price_group_id is null and c.price_group_name is not null then 'PRICE_GROUP_NAME_ONLY'
    else 'OK'
  end as audit_status,
  c.customer_status,
  c.remote_updated_at,
  c.last_synced_at,
  c.raw_payload
from public.v_ecoflow_ordermentum_customer_master_v1 c
left join public.v_ecoflow_ordermentum_price_groups_v1 pg
  on pg.external_price_group_id = c.external_price_group_id;

create view public.v_ecoflow_external_change_queue as
select
  r.id,
  r.external_system as source_system,
  r.external_system,
  r.resource_type,
  r.external_id,
  r.change_type,
  r.status,
  r.requested_by,
  r.approved_by,
  r.source_payload_before,
  r.proposed_payload_after,
  r.diff_summary,
  r.proposed_payload_after as request_payload,
  r.diff_summary as diff_payload,
  r.idempotency_key,
  r.reason,
  r.requested_at as created_at,
  coalesce(r.pushed_at, r.approved_at, r.requested_at) as updated_at,
  r.requested_at,
  r.approved_at,
  r.pushed_at,
  r.last_error
from public.external_change_requests r
order by r.requested_at desc;

grant select on public.v_ecoflow_ordermentum_master_data_sync_health to anon, authenticated, service_role;
grant select on public.v_ecoflow_ordermentum_customer_master_v1 to anon, authenticated, service_role;
grant select on public.v_ecoflow_ordermentum_sku_master_v1 to anon, authenticated, service_role;
grant select on public.v_ecoflow_ordermentum_price_groups_v1 to anon, authenticated, service_role;
grant select on public.v_ecoflow_ordermentum_price_tier_matrix_v1 to anon, authenticated, service_role;
grant select on public.v_ecoflow_ordermentum_customer_price_group_audit_v1 to anon, authenticated, service_role;
grant select on public.v_ecoflow_external_change_queue to anon, authenticated, service_role;

comment on view public.v_ecoflow_ordermentum_customer_master_v1 is
  'Safe Ordermentum purchaser/customer workbench view. Uses explicit JSON paths to avoid multidimensional array errors.';
comment on view public.v_ecoflow_ordermentum_sku_master_v1 is
  'Safe Ordermentum product/variant workbench view. Barcode candidates remain informational; scanning should use confirmed app SKU barcode views only.';
comment on view public.v_ecoflow_ordermentum_price_tier_matrix_v1 is
  'Safe price tier matrix view. Empty result is valid when price group detail payloads do not embed product or variant prices.';

commit;
