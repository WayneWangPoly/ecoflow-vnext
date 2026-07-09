-- Warehouse receiving + putaway flow.
-- Field workflow: receive known barcode into RECEIVING, then put away the same barcode from RECEIVING to a fixed shelf.

create or replace function public.ecoflow_putaway_by_barcode(
  p_barcode text,
  p_qty_packages numeric default 1,
  p_from_location text default 'RECEIVING',
  p_to_location text default null,
  p_note text default null
)
returns table (
  movement_id uuid,
  sku text,
  barcode text,
  package_level text,
  packages numeric,
  units_putaway numeric,
  from_location text,
  to_location text,
  moved_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_packages numeric := greatest(coalesce(p_qty_packages, 1), 1);
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_units numeric;
  v_from text;
  v_to text;
  v_id uuid;
begin
  if v_barcode is null then raise exception 'barcode is required'; end if;

  select * into v_registry
  from public.ecoflow_sku_barcode_registry
  where barcode = v_barcode
  order by last_scanned_at desc
  limit 1;

  if v_registry.id is null then
    raise exception 'barcode is not mapped yet: %', v_barcode;
  end if;

  v_units := v_packages * greatest(coalesce(v_registry.units_per_barcode, 1), 1);
  v_from := coalesce(nullif(trim(coalesce(p_from_location, '')), ''), 'RECEIVING');
  v_to := coalesce(
    nullif(trim(coalesce(p_to_location, '')), ''),
    nullif(trim(coalesce(v_registry.fixed_shelf, '')), ''),
    (select nullif(trim(coalesce(c.fixed_shelf, '')), '') from public.ecoflow_inventory_sku_controls c where c.sku = v_registry.sku limit 1),
    (select nullif(trim(coalesce(p.default_shelf, '')), '') from public.ecoflow_sku_package_policies p where p.sku = v_registry.sku limit 1)
  );

  if v_to is null then
    raise exception 'putaway target location is required for SKU %', v_registry.sku;
  end if;

  insert into public.ecoflow_inventory_movements(
    sku,
    product_name,
    movement_type,
    quantity,
    from_location,
    to_location,
    reference_type,
    reference_id,
    action_note,
    source,
    moved_by,
    moved_at
  ) values (
    v_registry.sku,
    v_registry.product_name,
    'PUTAWAY',
    v_units,
    v_from,
    v_to,
    'BARCODE_PUTAWAY',
    v_barcode,
    nullif(trim(coalesce(p_note, '')), ''),
    'WAREHOUSE_PUTAWAY',
    auth.uid(),
    now()
  ) returning id into v_id;

  update public.ecoflow_sku_barcode_registry
  set scan_count = scan_count + 1,
      last_scanned_at = now(),
      fixed_shelf = coalesce(fixed_shelf, v_to)
  where id = v_registry.id;

  insert into public.ecoflow_barcode_scan_events(
    session_id,
    sku,
    barcode,
    package_level,
    units_per_barcode,
    product_name,
    shelf,
    qty_observed,
    action_mode,
    scan_status,
    movement_id,
    scan_note,
    scanned_by,
    scanned_at
  ) values (
    v_registry.source_session_id,
    v_registry.sku,
    v_barcode,
    v_registry.package_level,
    v_registry.units_per_barcode,
    v_registry.product_name,
    v_to,
    v_packages,
    'MAP_AND_COUNT',
    'PUTAWAY_BY_BARCODE',
    v_id,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  );

  return query
  select v_id, v_registry.sku, v_barcode, v_registry.package_level, v_packages, v_units, v_from, v_to, now();
end;
$$;

grant execute on function public.ecoflow_putaway_by_barcode(text, numeric, text, text, text) to authenticated;

drop view if exists public.v_ecoflow_warehouse_recent_receiving_movements cascade;
drop view if exists public.v_ecoflow_warehouse_receiving_queue cascade;

create view public.v_ecoflow_warehouse_receiving_queue as
select
  b.sku,
  coalesce(b.product_name, c.product_name, p.product_name, 'Unknown product') as product_name,
  b.on_hand_location as receiving_units,
  coalesce(c.fixed_shelf, p.default_shelf, r.fixed_shelf) as suggested_shelf,
  coalesce(p.package_mode, 'UNKNOWN') as package_mode,
  coalesce(r.primary_barcode, c.primary_barcode) as primary_barcode,
  b.latest_location_movement_at,
  case
    when coalesce(c.fixed_shelf, p.default_shelf, r.fixed_shelf) is null then 'NEEDS_SHELF'
    when b.on_hand_location < 0 then 'NEGATIVE_RECEIVING'
    else 'READY_TO_PUTAWAY'
  end as receiving_signal
from public.v_ecoflow_inventory_sku_location_balance b
left join public.ecoflow_inventory_sku_controls c on c.sku = b.sku
left join public.ecoflow_sku_package_policies p on p.sku = b.sku
left join lateral (
  select
    max(barcode) filter (where package_level = 'CARTON') as primary_barcode,
    max(fixed_shelf) as fixed_shelf
  from public.ecoflow_sku_barcode_registry r0
  where r0.sku = b.sku
) r on true
where upper(trim(b.location)) = 'RECEIVING'
order by
  case
    when coalesce(c.fixed_shelf, p.default_shelf, r.fixed_shelf) is null then 0
    when b.on_hand_location < 0 then 1
    else 2
  end,
  b.latest_location_movement_at desc nulls last;

grant select on public.v_ecoflow_warehouse_receiving_queue to authenticated;

create view public.v_ecoflow_warehouse_recent_receiving_movements as
select
  id,
  sku,
  product_name,
  movement_type,
  quantity,
  from_location,
  to_location,
  reference_type,
  reference_id,
  action_note,
  source,
  moved_at
from public.v_ecoflow_inventory_recent_movements
where source in ('BARCODE_RECEIVING','WAREHOUSE_PUTAWAY','INVENTORY_CONTROL','BARCODE_ONBOARDING')
   or upper(coalesce(from_location, '')) = 'RECEIVING'
   or upper(coalesce(to_location, '')) = 'RECEIVING'
order by moved_at desc
limit 120;

grant select on public.v_ecoflow_warehouse_recent_receiving_movements to authenticated;

notify pgrst, 'reload schema';
