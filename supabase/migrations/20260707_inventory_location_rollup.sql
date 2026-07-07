-- Package 1: Inventory <-> Warehouse Map linkage.
-- Gives Inventory a SKU-level warehouse-location summary without fabricating stock.

create or replace view public.v_ecoflow_inventory_locations as
select
  i.sku,
  max(i.product_name) filter (where i.product_name is not null and i.product_name <> '') as product_name,
  coalesce(sum(i.quantity) filter (where i.status <> 'ZEROED'), 0) as total_quantity,
  count(distinct l.location_code) filter (where i.status <> 'ZEROED' and i.quantity <> 0) as location_count,
  min(l.location_code) filter (where i.status <> 'ZEROED' and i.quantity <> 0) as primary_location,
  min(l.location_code) filter (where i.status <> 'ZEROED' and i.quantity <> 0) as fixed_shelf,
  string_agg(distinct l.location_code, ', ' order by l.location_code) filter (where i.status <> 'ZEROED' and i.quantity <> 0) as current_locations,
  string_agg(distinct nullif(i.source_barcode, ''), ', ' order by nullif(i.source_barcode, '')) filter (where i.source_barcode is not null and i.source_barcode <> '') as barcodes,
  max(i.last_movement_at) as last_movement_at,
  max(i.updated_at) as updated_at
from public.ecoflow_warehouse_location_items i
join public.ecoflow_warehouse_locations l on l.id = i.location_id
where i.status <> 'ZEROED'
group by i.sku;

grant select on public.v_ecoflow_inventory_locations to authenticated;
