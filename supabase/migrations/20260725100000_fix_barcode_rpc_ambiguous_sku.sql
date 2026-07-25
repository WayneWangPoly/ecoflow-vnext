-- Fix PL/pgSQL output-column collisions in the barcode mapping RPCs.
-- RETURNS TABLE exposes sku/barcode as variables, so all source columns and
-- upsert targets are resolved explicitly.

begin;

create or replace function public.ecoflow_set_sku_package_policy(
  p_sku text,
  p_package_mode text,
  p_default_shelf text default null,
  p_note text default null
)
returns table (
  sku text,
  package_mode text,
  default_shelf text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict error
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_mode text := upper(trim(coalesce(p_package_mode, 'UNKNOWN')));
  v_product_name text;
begin
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;

  if v_mode not in ('CARTON_AND_SLEEVE','CARTON_ONLY','SLEEVE_ONLY','EACH_ONLY','INNER_ONLY','UNKNOWN') then
    raise exception 'invalid package mode: %', p_package_mode;
  end if;

  select velocity.product_name
  into v_product_name
  from public.v_ecoflow_owner_sku_velocity as velocity
  where velocity.sku = v_sku
  limit 1;

  insert into public.ecoflow_sku_package_policies (
    sku,
    product_name,
    package_mode,
    default_shelf,
    policy_note,
    updated_by,
    updated_at
  ) values (
    v_sku,
    v_product_name,
    v_mode,
    nullif(trim(coalesce(p_default_shelf, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  )
  on conflict on constraint ecoflow_sku_package_policies_pkey do update set
    product_name = coalesce(public.ecoflow_sku_package_policies.product_name, excluded.product_name),
    package_mode = excluded.package_mode,
    default_shelf = coalesce(excluded.default_shelf, public.ecoflow_sku_package_policies.default_shelf),
    policy_note = coalesce(excluded.policy_note, public.ecoflow_sku_package_policies.policy_note),
    updated_by = auth.uid(),
    updated_at = now();

  return query
  select policy.sku, policy.package_mode, policy.default_shelf, policy.updated_at
  from public.ecoflow_sku_package_policies as policy
  where policy.sku = v_sku;
end;
$$;

grant execute on function public.ecoflow_set_sku_package_policy(text, text, text, text) to authenticated;
revoke execute on function public.ecoflow_set_sku_package_policy(text, text, text, text) from anon;

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
  event_id uuid,
  sku text,
  barcode text,
  package_level text,
  scan_status text,
  movement_id uuid,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict error
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_package text := upper(trim(coalesce(p_package_level, 'UNKNOWN')));
  v_mode text := upper(trim(coalesce(p_action_mode, 'MAP_ONLY')));
  v_units numeric := greatest(coalesce(p_units_per_barcode, 1), 1);
  v_qty numeric := coalesce(p_qty_observed, 1);
  v_event_id uuid;
  v_movement_id uuid;
  v_product text;
  v_status text := 'RECORDED';
begin
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;
  if v_barcode is null then
    raise exception 'barcode is required';
  end if;
  if v_package not in ('CARTON','SLEEVE','EACH','INNER','UNKNOWN') then
    raise exception 'invalid package level';
  end if;
  if v_mode not in ('MAP_ONLY','MAP_AND_COUNT','MAP_AND_RECEIVE') then
    raise exception 'invalid action mode';
  end if;

  select velocity.product_name
  into v_product
  from public.v_ecoflow_owner_sku_velocity as velocity
  where velocity.sku = v_sku
  limit 1;

  v_product := coalesce(nullif(trim(coalesce(p_product_name, '')), ''), v_product, 'Unknown product');

  insert into public.ecoflow_sku_barcode_registry(
    sku,
    barcode,
    package_level,
    units_per_barcode,
    product_name,
    fixed_shelf,
    source_session_id,
    scan_count,
    first_scanned_at,
    last_scanned_at,
    verified,
    note
  ) values (
    v_sku,
    v_barcode,
    v_package,
    v_units,
    v_product,
    nullif(trim(coalesce(p_shelf, '')), ''),
    p_session_id,
    1,
    now(),
    now(),
    false,
    nullif(trim(coalesce(p_note, '')), '')
  )
  on conflict on constraint ecoflow_sku_barcode_registry_barcode_key do update set
    sku = excluded.sku,
    package_level = excluded.package_level,
    units_per_barcode = excluded.units_per_barcode,
    product_name = coalesce(nullif(excluded.product_name, ''), public.ecoflow_sku_barcode_registry.product_name),
    fixed_shelf = coalesce(nullif(excluded.fixed_shelf, ''), public.ecoflow_sku_barcode_registry.fixed_shelf),
    source_session_id = coalesce(excluded.source_session_id, public.ecoflow_sku_barcode_registry.source_session_id),
    scan_count = public.ecoflow_sku_barcode_registry.scan_count + 1,
    last_scanned_at = now(),
    note = coalesce(excluded.note, public.ecoflow_sku_barcode_registry.note);

  insert into public.ecoflow_inventory_sku_controls(
    sku,
    product_name,
    fixed_shelf,
    primary_barcode,
    updated_by,
    updated_at
  ) values (
    v_sku,
    v_product,
    nullif(trim(coalesce(p_shelf, '')), ''),
    v_barcode,
    auth.uid(),
    now()
  )
  on conflict on constraint ecoflow_inventory_sku_controls_pkey do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    fixed_shelf = coalesce(public.ecoflow_inventory_sku_controls.fixed_shelf, excluded.fixed_shelf),
    primary_barcode = coalesce(public.ecoflow_inventory_sku_controls.primary_barcode, excluded.primary_barcode),
    updated_by = auth.uid(),
    updated_at = now();

  if v_mode = 'MAP_AND_RECEIVE' then
    insert into public.ecoflow_inventory_movements(
      sku,
      product_name,
      movement_type,
      quantity,
      to_location,
      reference_type,
      reference_id,
      action_note,
      source,
      moved_by,
      moved_at
    ) values (
      v_sku,
      v_product,
      'RECEIVE',
      v_qty * v_units,
      coalesce(nullif(trim(coalesce(p_shelf, '')), ''), 'RECEIVING'),
      'BARCODE_SCAN',
      v_barcode,
      nullif(trim(coalesce(p_note, '')), ''),
      'BARCODE_ONBOARDING',
      auth.uid(),
      now()
    ) returning id into v_movement_id;
    v_status := 'RECORDED_AND_RECEIVED';
  elsif v_mode = 'MAP_AND_COUNT' then
    v_status := 'RECORDED_AND_COUNTED';
  end if;

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
    p_session_id,
    v_sku,
    v_barcode,
    v_package,
    v_units,
    v_product,
    nullif(trim(coalesce(p_shelf, '')), ''),
    v_qty,
    v_mode,
    v_status,
    v_movement_id,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  ) returning id into v_event_id;

  return query
  select event.id, event.sku, event.barcode, event.package_level, event.scan_status, event.movement_id, event.scanned_at
  from public.ecoflow_barcode_scan_events as event
  where event.id = v_event_id;
end;
$$;

grant execute on function public.ecoflow_record_barcode_scan(uuid, text, text, text, numeric, text, text, numeric, text, text) to authenticated;
revoke execute on function public.ecoflow_record_barcode_scan(uuid, text, text, text, numeric, text, text, numeric, text, text) from anon;

notify pgrst, 'reload schema';

commit;
