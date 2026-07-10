-- Use the named primary-key constraint in the barcode-control upsert.
-- The RETURNS TABLE output variable named sku otherwise makes ON CONFLICT (sku)
-- ambiguous inside PL/pgSQL at runtime.

begin;

create or replace function public.ecoflow_record_barcode_scan(
  p_session_id uuid,
  p_sku text,
  p_barcode text,
  p_package_level text default 'UNKNOWN',
  p_units_per_barcode numeric default 1,
  p_product_name text default null,
  p_shelf text default null,
  p_qty_observed numeric default null,
  p_action_mode text default 'MAP_ONLY',
  p_note text default null
)
returns table (
  event_id uuid, sku text, barcode text, package_level text,
  scan_status text, movement_id uuid, scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_package text := upper(trim(coalesce(p_package_level, 'UNKNOWN')));
  v_mode text := upper(trim(coalesce(p_action_mode, 'MAP_ONLY')));
  v_units numeric := coalesce(p_units_per_barcode, 1);
  v_qty numeric := coalesce(p_qty_observed, 1);
  v_event_id uuid;
  v_product text;
  v_status text;
  v_existing public.ecoflow_sku_barcode_registry%rowtype;
  v_existing_found boolean := false;
  v_policy text;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if v_sku is null or v_sku = 'UNKNOWN' then raise exception 'valid SKU is required'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_package not in ('CARTON','SLEEVE','EACH','INNER') then raise exception 'valid package level is required'; end if;
  if v_mode not in ('MAP_ONLY','MAP_AND_COUNT') then raise exception 'BARCODE_SETUP_CANNOT_RECEIVE_STOCK: use the controlled Receive batch'; end if;
  if v_units <= 0 or v_units <> trunc(v_units) then raise exception 'units per barcode must be a positive whole number'; end if;
  if v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'observed package count must be a positive whole number'; end if;

  select pol.package_mode into v_policy
  from public.ecoflow_sku_package_policies pol
  where pol.sku = v_sku;

  if v_policy = 'CARTON_ONLY' and v_package <> 'CARTON' then raise exception 'package level conflicts with CARTON_ONLY policy'; end if;
  if v_policy = 'SLEEVE_ONLY' and v_package <> 'SLEEVE' then raise exception 'package level conflicts with SLEEVE_ONLY policy'; end if;
  if v_policy = 'EACH_ONLY' and v_package <> 'EACH' then raise exception 'package level conflicts with UNIT/BOTTLE policy'; end if;
  if v_policy = 'INNER_ONLY' and v_package <> 'INNER' then raise exception 'package level conflicts with INNER_ONLY policy'; end if;
  if v_policy = 'CARTON_AND_SLEEVE' and v_package not in ('CARTON','SLEEVE') then raise exception 'package level conflicts with CARTON_AND_SLEEVE policy'; end if;

  select r.* into v_existing
  from public.ecoflow_sku_barcode_registry r
  where r.barcode = v_barcode
  for update;
  v_existing_found := found;

  if v_existing_found then
    if not v_existing.is_active then raise exception 'BARCODE_RETIRED: create or scan the new packaging code'; end if;
    if upper(v_existing.sku) <> v_sku or upper(v_existing.package_level) <> v_package then
      raise exception 'BARCODE_CONFLICT: active code already belongs to % %', v_existing.sku, v_existing.package_level;
    end if;
  end if;

  select vel.product_name into v_product
  from public.v_ecoflow_owner_sku_velocity vel
  where vel.sku = v_sku
  limit 1;
  v_product := coalesce(nullif(trim(coalesce(p_product_name, '')), ''), v_product, 'Unknown product');

  if v_existing_found then
    update public.ecoflow_sku_barcode_registry r
    set units_per_barcode = v_units,
        product_name = coalesce(v_product, r.product_name),
        fixed_shelf = coalesce(nullif(trim(coalesce(p_shelf, '')), ''), r.fixed_shelf),
        source_session_id = coalesce(p_session_id, r.source_session_id),
        scan_count = r.scan_count + 1,
        last_scanned_at = now(),
        note = coalesce(nullif(trim(coalesce(p_note, '')), ''), r.note),
        updated_at = now()
    where r.id = v_existing.id;
  else
    insert into public.ecoflow_sku_barcode_registry(
      sku, barcode, package_level, units_per_barcode, product_name, fixed_shelf,
      source_session_id, scan_count, first_scanned_at, last_scanned_at,
      verified, note, is_active, valid_from, updated_at
    ) values (
      v_sku, v_barcode, v_package, v_units, v_product,
      nullif(trim(coalesce(p_shelf, '')), ''), p_session_id, 1, now(), now(),
      false, nullif(trim(coalesce(p_note, '')), ''), true, now(), now()
    );
  end if;

  insert into public.ecoflow_inventory_sku_controls(
    sku, product_name, fixed_shelf, primary_barcode, updated_by, updated_at
  ) values (
    v_sku, v_product, nullif(trim(coalesce(p_shelf, '')), ''), v_barcode, auth.uid(), now()
  )
  on conflict on constraint ecoflow_inventory_sku_controls_pkey do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    fixed_shelf = coalesce(excluded.fixed_shelf, public.ecoflow_inventory_sku_controls.fixed_shelf),
    primary_barcode = coalesce(public.ecoflow_inventory_sku_controls.primary_barcode, excluded.primary_barcode),
    updated_by = auth.uid(), updated_at = now();

  v_status := case when v_mode = 'MAP_AND_COUNT' then 'MAPPED_AND_COUNTED' else 'MAPPED' end;
  insert into public.ecoflow_barcode_scan_events(
    session_id, sku, barcode, package_level, units_per_barcode, product_name, shelf,
    qty_observed, action_mode, scan_status, movement_id, scan_note, scanned_by, scanned_at
  ) values (
    p_session_id, v_sku, v_barcode, v_package, v_units, v_product,
    nullif(trim(coalesce(p_shelf, '')), ''), v_qty, v_mode, v_status,
    null, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now()
  ) returning id into v_event_id;

  return query
  select e.id, e.sku, e.barcode, e.package_level, e.scan_status, e.movement_id, e.scanned_at
  from public.ecoflow_barcode_scan_events e where e.id = v_event_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
