-- Check SKU + barcode baseline.
select
  s.sku_code,
  s.display_name,
  s.category,
  b.barcode_value,
  b.barcode_type,
  b.unit_level,
  b.quantity_in_base_unit,
  b.is_primary
from public.skus s
left join public.barcodes b on b.sku_id = s.id
order by s.sku_code, b.unit_level;

-- Check warehouse location mapping.
select
  l.location_code,
  l.zone,
  l.bay,
  l.level,
  l.side,
  l.barcode_value as location_barcode,
  s.sku_code,
  s.display_name
from public.warehouse_locations l
left join public.skus s on s.id = l.assigned_sku_id
order by l.location_code;

-- Check the trial order pick task.
select
  o.order_number,
  o.status as order_status,
  s.sku_code,
  ol.requested_quantity,
  l.location_code,
  pt.status as pick_status
from public.orders o
join public.order_lines ol on ol.order_id = o.id
join public.skus s on s.id = ol.sku_id
left join public.pick_tasks pt on pt.order_line_id = ol.id
left join public.warehouse_locations l on l.id = pt.from_location_id
where o.order_number = 'OMO-TEST-001';
