-- EcoFlow vNext trial data seed
-- Runs after supabase/schema.sql.
-- Current pilot baseline:
-- Ordermentum SKU = EcoFlow sku_code = warehouse SKU.
-- Test order OMO-TEST-001 needs 11 sleeves of JP-PBS-6X197-ARTBOX.
-- Scan carton barcode 19344062036170 (+10 sleeves) and sleeve barcode 9344062033639 (+1 sleeve).

insert into public.warehouses (warehouse_code, display_name)
values ('MAIN', 'EcoFlow Main Warehouse')
on conflict (warehouse_code) do update set display_name = excluded.display_name;

insert into public.skus (
  sku_code, display_name, category,
  can_sell_by_carton, can_sell_by_sleeve, sleeves_per_carton,
  default_storage_unit, default_pick_unit, can_mix_pack, setup_status
)
values
  ('JP-PBS-6X197-ARTBOX', 'BioPak 6x197mm Paper Straw Art Series', 'Straws', true, true, 10, 'carton', 'sleeve', true, 'trial_ready'),
  ('JP-JUMBO-10MM', 'BioPak 10x197mm Jumbo Paper Straw Art Series', 'Straws', true, true, 25, 'carton', 'sleeve', true, 'needs_location'),
  ('CCSPW16-90', 'ComPak PLA Compostable Single Wall Coffee Cup Plain White 16oz 90mm', 'Coffee Cup', true, true, 20, 'carton', 'sleeve', true, 'needs_location'),
  ('CCSPW8-90', 'ComPak PLA Compostable Single Wall Coffee Cup Plain White 8oz 90mm', 'Coffee Cup', true, true, 20, 'carton', 'sleeve', true, 'needs_location')
on conflict (sku_code) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  can_sell_by_carton = excluded.can_sell_by_carton,
  can_sell_by_sleeve = excluded.can_sell_by_sleeve,
  sleeves_per_carton = excluded.sleeves_per_carton,
  default_storage_unit = excluded.default_storage_unit,
  default_pick_unit = excluded.default_pick_unit,
  can_mix_pack = excluded.can_mix_pack,
  setup_status = excluded.setup_status,
  updated_at = now();

insert into public.sku_units (sku_id, unit_level, quantity_in_base_unit, is_default_receiving_unit, is_default_picking_unit)
select id, 'carton', sleeves_per_carton, true, false from public.skus
where sku_code in ('JP-PBS-6X197-ARTBOX','JP-JUMBO-10MM','CCSPW16-90','CCSPW8-90')
on conflict (sku_id, unit_level) do update set
  quantity_in_base_unit = excluded.quantity_in_base_unit,
  is_default_receiving_unit = excluded.is_default_receiving_unit,
  is_default_picking_unit = excluded.is_default_picking_unit;

insert into public.sku_units (sku_id, unit_level, quantity_in_base_unit, is_default_receiving_unit, is_default_picking_unit)
select id, 'sleeve', 1, false, true from public.skus
where sku_code in ('JP-PBS-6X197-ARTBOX','JP-JUMBO-10MM','CCSPW16-90','CCSPW8-90')
on conflict (sku_id, unit_level) do update set
  quantity_in_base_unit = excluded.quantity_in_base_unit,
  is_default_receiving_unit = excluded.is_default_receiving_unit,
  is_default_picking_unit = excluded.is_default_picking_unit;

insert into public.barcodes (sku_id, barcode_value, barcode_type, unit_level, quantity_in_base_unit, is_primary)
values
  ((select id from public.skus where sku_code = 'JP-PBS-6X197-ARTBOX'), '19344062036170', 'carton', 'carton', 10, true),
  ((select id from public.skus where sku_code = 'JP-PBS-6X197-ARTBOX'), '9344062033639', 'sleeve', 'sleeve', 1, false),
  ((select id from public.skus where sku_code = 'JP-JUMBO-10MM'), '19344062037160', 'carton', 'carton', 25, true),
  ((select id from public.skus where sku_code = 'JP-JUMBO-10MM'), '9344062034629', 'sleeve', 'sleeve', 1, false),
  ((select id from public.skus where sku_code = 'CCSPW16-90'), '07579531135548', 'carton', 'carton', 20, true),
  ((select id from public.skus where sku_code = 'CCSPW16-90'), '07579531136521', 'sleeve', 'sleeve', 1, false),
  ((select id from public.skus where sku_code = 'CCSPW8-90'), '07579531135517', 'carton', 'carton', 20, true),
  ((select id from public.skus where sku_code = 'CCSPW8-90'), '07579531136507', 'sleeve', 'sleeve', 1, false)
on conflict (barcode_value) do update set
  sku_id = excluded.sku_id,
  barcode_type = excluded.barcode_type,
  unit_level = excluded.unit_level,
  quantity_in_base_unit = excluded.quantity_in_base_unit,
  is_primary = excluded.is_primary;

insert into public.warehouse_locations (
  warehouse_id, location_code, zone, bay, level, side, barcode_value,
  location_type, sort_order, is_pickable, is_staging, is_active, assigned_sku_id
)
values
  ((select id from public.warehouses where warehouse_code = 'MAIN'), 'STAGING', 'INBOUND', null, null, null, 'LOC-STAGING', 'staging', 10, false, true, true, null),
  ((select id from public.warehouses where warehouse_code = 'MAIN'), 'A1-01-02A', 'A1', '01', '02', 'A', 'LOC-A1-01-02A', 'rack', 10102, true, false, true, (select id from public.skus where sku_code = 'JP-PBS-6X197-ARTBOX')),
  ((select id from public.warehouses where warehouse_code = 'MAIN'), 'DISPATCH', 'DISPATCH', null, null, null, 'LOC-DISPATCH', 'dispatch', 90000, false, false, true, null)
on conflict (location_code) do update set
  zone = excluded.zone,
  bay = excluded.bay,
  level = excluded.level,
  side = excluded.side,
  barcode_value = excluded.barcode_value,
  location_type = excluded.location_type,
  sort_order = excluded.sort_order,
  is_pickable = excluded.is_pickable,
  is_staging = excluded.is_staging,
  is_active = excluded.is_active,
  assigned_sku_id = excluded.assigned_sku_id,
  updated_at = now();

insert into public.addresses (line1, suburb, state, postcode, country)
select 'Ordermentum test delivery address', 'Adelaide', 'SA', '5000', 'AU'
where not exists (select 1 from public.customers where customer_code = 'ORDERMENTUM-TEST-CUSTOMER');

insert into public.customers (customer_code, display_name, invoice_name)
values ('ORDERMENTUM-TEST-CUSTOMER', 'Ordermentum Test Customer', 'Ordermentum Test Customer')
on conflict (customer_code) do update set display_name = excluded.display_name, invoice_name = excluded.invoice_name;

insert into public.customer_sites (customer_id, site_code, display_name, address_id, contact_name, phone, delivery_note)
values (
  (select id from public.customers where customer_code = 'ORDERMENTUM-TEST-CUSTOMER'),
  'ORDERMENTUM-TEST-SITE',
  'Ordermentum Test Site',
  (select id from public.addresses order by created_at desc limit 1),
  'Manager',
  '',
  'Trial stop. Replace after real customer/site import rules are confirmed.'
)
on conflict (site_code) do update set
  display_name = excluded.display_name,
  delivery_note = excluded.delivery_note;

insert into public.external_customer_mappings (provider, external_customer_id, external_customer_name, customer_id)
values ('ORDERMENTUM', 'OM-CUST-TEST', 'Ordermentum Test Customer', (select id from public.customers where customer_code = 'ORDERMENTUM-TEST-CUSTOMER'))
on conflict (provider, external_customer_id) do update set customer_id = excluded.customer_id, external_customer_name = excluded.external_customer_name;

insert into public.external_site_mappings (provider, external_site_id, external_site_name, customer_site_id)
values ('ORDERMENTUM', 'OM-SITE-TEST', 'Ordermentum Test Site', (select id from public.customer_sites where site_code = 'ORDERMENTUM-TEST-SITE'))
on conflict (provider, external_site_id) do update set customer_site_id = excluded.customer_site_id, external_site_name = excluded.external_site_name;

insert into public.external_product_mappings (provider, external_product_code, internal_sku_id, default_unit_level, confidence)
select 'ORDERMENTUM', sku_code, id, 'sleeve', 'EXACT' from public.skus
where sku_code in ('JP-PBS-6X197-ARTBOX','JP-JUMBO-10MM','CCSPW16-90','CCSPW8-90')
on conflict (provider, external_product_code) do update set
  internal_sku_id = excluded.internal_sku_id,
  default_unit_level = excluded.default_unit_level,
  confidence = excluded.confidence;

insert into public.order_import_batches (provider, started_at, finished_at, status, total_orders, imported_orders, failed_orders)
select 'ORDERMENTUM', now(), now(), 'COMPLETED', 1, 1, 0
where not exists (select 1 from public.external_orders where provider = 'ORDERMENTUM' and external_order_id = 'OMO-TEST-001');

insert into public.external_orders (
  provider, external_order_id, external_order_number,
  external_customer_id, external_customer_name, external_site_id, external_site_name,
  external_invoice_id, external_invoice_number, raw_payload, import_batch_id, import_status
)
values (
  'ORDERMENTUM', 'OMO-TEST-001', 'OMO-TEST-001',
  'OM-CUST-TEST', 'Ordermentum Test Customer', 'OM-SITE-TEST', 'Ordermentum Test Site',
  'OMO-INV-TEST-001', 'OMO-INV-TEST-001',
  '{"source":"ordermentum-trial-baseline"}'::jsonb,
  (select id from public.order_import_batches order by created_at desc limit 1),
  'IMPORTED'
)
on conflict (provider, external_order_id) do update set
  external_order_number = excluded.external_order_number,
  raw_payload = excluded.raw_payload,
  import_status = excluded.import_status;

insert into public.external_order_lines (
  external_order_id, external_line_id, external_sku_code, external_product_name, external_barcode,
  quantity, unit, raw_payload, import_status
)
values (
  (select id from public.external_orders where provider = 'ORDERMENTUM' and external_order_id = 'OMO-TEST-001'),
  'OMO-TEST-001-L1', 'JP-PBS-6X197-ARTBOX', 'BioPak 6x197mm Paper Straw Art Series', '9344062033639',
  11, 'sleeve', '{"sku_code":"JP-PBS-6X197-ARTBOX","quantity":11,"unit":"sleeve"}'::jsonb, 'IMPORTED'
)
on conflict (external_order_id, external_line_id) do update set
  external_sku_code = excluded.external_sku_code,
  quantity = excluded.quantity,
  unit = excluded.unit,
  raw_payload = excluded.raw_payload,
  import_status = excluded.import_status;

insert into public.orders (order_number, customer_id, customer_site_id, status, delivery_date, delivery_zone, owner_note)
values (
  'OMO-TEST-001',
  (select id from public.customers where customer_code = 'ORDERMENTUM-TEST-CUSTOMER'),
  (select id from public.customer_sites where site_code = 'ORDERMENTUM-TEST-SITE'),
  'STOCK_RESERVED',
  current_date + 1,
  'CBD',
  'Trial order: scan one carton barcode plus one sleeve barcode to complete 11 sleeves.'
)
on conflict (order_number) do update set
  status = excluded.status,
  delivery_date = excluded.delivery_date,
  owner_note = excluded.owner_note;

insert into public.order_external_refs (order_id, provider, external_order_id, external_order_number, external_invoice_id, external_invoice_number)
values (
  (select id from public.orders where order_number = 'OMO-TEST-001'),
  'ORDERMENTUM', 'OMO-TEST-001', 'OMO-TEST-001', 'OMO-INV-TEST-001', 'OMO-INV-TEST-001'
)
on conflict (provider, external_order_id) do update set
  order_id = excluded.order_id,
  external_order_number = excluded.external_order_number,
  external_invoice_id = excluded.external_invoice_id,
  external_invoice_number = excluded.external_invoice_number;

insert into public.order_lines (order_id, sku_id, status, requested_quantity, reserved_quantity, picked_quantity, packed_quantity, display_name_snapshot, external_line_id)
select
  (select id from public.orders where order_number = 'OMO-TEST-001'),
  id,
  'RESERVED',
  11,
  11,
  0,
  0,
  display_name,
  'OMO-TEST-001-L1'
from public.skus
where sku_code = 'JP-PBS-6X197-ARTBOX'
and not exists (
  select 1 from public.order_lines ol
  join public.orders o on o.id = ol.order_id
  where o.order_number = 'OMO-TEST-001' and ol.external_line_id = 'OMO-TEST-001-L1'
);

insert into public.inventory_balances (warehouse_id, location_id, sku_id, quantity_on_hand, quantity_reserved, quantity_available)
values (
  (select id from public.warehouses where warehouse_code = 'MAIN'),
  (select id from public.warehouse_locations where location_code = 'A1-01-02A'),
  (select id from public.skus where sku_code = 'JP-PBS-6X197-ARTBOX'),
  11,
  11,
  0
)
on conflict (warehouse_id, location_id, sku_id) do update set
  quantity_on_hand = excluded.quantity_on_hand,
  quantity_reserved = excluded.quantity_reserved,
  quantity_available = excluded.quantity_available;

insert into public.pick_waves (wave_number, warehouse_id, delivery_zone, status, order_count, task_count)
values ('W-OMO-TEST-001', (select id from public.warehouses where warehouse_code = 'MAIN'), 'CBD', 'OPEN', 1, 1)
on conflict (wave_number) do update set status = excluded.status, order_count = excluded.order_count, task_count = excluded.task_count;

insert into public.pick_tasks (pick_wave_id, order_id, order_line_id, sku_id, from_location_id, requested_quantity, picked_quantity, status)
select
  (select id from public.pick_waves where wave_number = 'W-OMO-TEST-001'),
  (select id from public.orders where order_number = 'OMO-TEST-001'),
  ol.id,
  (select id from public.skus where sku_code = 'JP-PBS-6X197-ARTBOX'),
  (select id from public.warehouse_locations where location_code = 'A1-01-02A'),
  11,
  0,
  'OPEN'
from public.order_lines ol
join public.orders o on o.id = ol.order_id
where o.order_number = 'OMO-TEST-001'
and not exists (
  select 1 from public.pick_tasks pt
  join public.orders po on po.id = pt.order_id
  where po.order_number = 'OMO-TEST-001'
);

insert into public.delivery_runs (run_number, warehouse_id, status, planned_date, stop_count)
values ('RUN-OMO-TEST-001', (select id from public.warehouses where warehouse_code = 'MAIN'), 'PLANNED', current_date + 1, 1)
on conflict (run_number) do update set status = excluded.status, planned_date = excluded.planned_date, stop_count = excluded.stop_count;

insert into public.delivery_stops (delivery_run_id, stop_sequence, order_id, customer_site_id, status, eta, driver_note)
values (
  (select id from public.delivery_runs where run_number = 'RUN-OMO-TEST-001'),
  1,
  (select id from public.orders where order_number = 'OMO-TEST-001'),
  (select id from public.customer_sites where site_code = 'ORDERMENTUM-TEST-SITE'),
  'PENDING',
  (current_date + 1 + time '10:30')::timestamptz,
  'Trial stop. Capture POD photo after delivery.'
)
on conflict (delivery_run_id, stop_sequence) do update set
  order_id = excluded.order_id,
  status = excluded.status,
  eta = excluded.eta,
  driver_note = excluded.driver_note;
