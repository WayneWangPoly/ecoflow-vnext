-- Package 2: Receiving + Putaway barcode lookup.
-- Known product barcodes are resolved from the EcoFlow SKU master so receiving can suggest the fixed shelf.

create or replace view public.v_ecoflow_receiving_barcode_lookup as
with sku_barcodes as (
  select
    nullif(trim(carton_barcode), '') as barcode,
    external_sku_code as sku,
    coalesce(nullif(trim(classification), ''), external_sku_code) as product_name,
    'carton'::text as unit_level,
    nullif(trim(warehouse_location), '') as fixed_location,
    pick_level,
    classification,
    carton_barcode_status as barcode_status,
    status as sku_status
  from public.v_ecoflow_app_sku_master
  where nullif(trim(carton_barcode), '') is not null

  union all

  select
    nullif(trim(each_barcode), '') as barcode,
    external_sku_code as sku,
    coalesce(nullif(trim(classification), ''), external_sku_code) as product_name,
    case
      when upper(coalesce(pick_level, '')) = 'EACH' then 'each'
      else 'sleeve'
    end as unit_level,
    nullif(trim(warehouse_location), '') as fixed_location,
    pick_level,
    classification,
    each_barcode_status as barcode_status,
    status as sku_status
  from public.v_ecoflow_app_sku_master
  where nullif(trim(each_barcode), '') is not null
)
select distinct on (barcode)
  barcode,
  sku,
  product_name,
  unit_level,
  fixed_location,
  pick_level,
  classification,
  barcode_status,
  sku_status
from sku_barcodes
where barcode is not null
  and sku is not null
order by barcode,
  case when sku_status = 'ACTIVE' then 0 else 1 end,
  case when barcode_status = 'CONFIRMED' then 0 else 1 end,
  sku;

grant select on public.v_ecoflow_receiving_barcode_lookup to authenticated;
