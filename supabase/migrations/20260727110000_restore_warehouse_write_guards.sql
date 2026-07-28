-- Restore warehouse write guards that were replaced by the 20260725 barcode
-- ambiguity fix. This is forward-only: deployed migrations remain immutable.

begin;

-- Browser clients read these tables, but every write must pass through a
-- role-gated SECURITY DEFINER command.
revoke insert, update, delete on public.ecoflow_barcode_scan_sessions
  from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_sku_barcode_registry
  from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_barcode_scan_events
  from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_sku_package_policies
  from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_inventory_movements
  from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_inventory_sku_controls
  from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_inventory_sku_actions
  from public, anon, authenticated;

grant select on public.ecoflow_barcode_scan_sessions to authenticated;
grant select on public.ecoflow_sku_barcode_registry to authenticated;
grant select on public.ecoflow_barcode_scan_events to authenticated;
grant select on public.ecoflow_sku_package_policies to authenticated;
grant select on public.ecoflow_inventory_movements to authenticated;
grant select on public.ecoflow_inventory_sku_controls to authenticated;
grant select on public.ecoflow_inventory_sku_actions to authenticated;

create or replace function public.ecoflow_start_barcode_scan_session(
  p_session_name text default 'Barcode sprint',
  p_target_area text default null
)
returns table (
  session_id uuid,
  session_name text,
  target_area text,
  session_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' using errcode = '42501';
  end if;

  insert into public.ecoflow_barcode_scan_sessions(
    session_name,
    target_area,
    session_status,
    created_by,
    created_at
  ) values (
    coalesce(nullif(trim(p_session_name), ''), 'Barcode sprint'),
    nullif(trim(coalesce(p_target_area, '')), ''),
    'OPEN',
    auth.uid(),
    now()
  )
  returning id into v_id;

  return query
  select s.id, s.session_name, s.target_area, s.session_status, s.created_at
  from public.ecoflow_barcode_scan_sessions s
  where s.id = v_id;
end;
$$;

revoke all on function public.ecoflow_start_barcode_scan_session(text, text)
  from public, anon, authenticated;
grant execute on function public.ecoflow_start_barcode_scan_session(text, text)
  to authenticated;

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
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' using errcode = '42501';
  end if;
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;
  if v_mode not in (
    'CARTON_AND_SLEEVE',
    'CARTON_ONLY',
    'SLEEVE_ONLY',
    'EACH_ONLY',
    'INNER_ONLY',
    'UNKNOWN'
  ) then
    raise exception 'invalid package mode: %', p_package_mode;
  end if;

  select velocity.product_name
  into v_product_name
  from public.v_ecoflow_owner_sku_velocity as velocity
  where velocity.sku = v_sku
  limit 1;

  insert into public.ecoflow_sku_package_policies(
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

revoke all on function public.ecoflow_set_sku_package_policy(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ecoflow_set_sku_package_policy(text, text, text, text)
  to authenticated;

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
  v_units numeric := coalesce(p_units_per_barcode, 1);
  v_qty numeric := coalesce(p_qty_observed, 1);
  v_event_id uuid;
  v_product text;
  v_status text;
  v_existing public.ecoflow_sku_barcode_registry%rowtype;
  v_existing_found boolean := false;
  v_policy text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' using errcode = '42501';
  end if;
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;
  if v_barcode is null then
    raise exception 'barcode is required';
  end if;
  if v_package not in ('CARTON', 'SLEEVE', 'EACH', 'INNER') then
    raise exception 'valid package level is required';
  end if;
  if v_mode not in ('MAP_ONLY', 'MAP_AND_COUNT') then
    raise exception 'BARCODE_SETUP_CANNOT_RECEIVE_STOCK: use the controlled Receive batch';
  end if;
  if v_units <= 0 or v_units <> trunc(v_units) then
    raise exception 'units per barcode must be a positive whole number';
  end if;
  if v_qty <= 0 or v_qty <> trunc(v_qty) then
    raise exception 'observed package count must be a positive whole number';
  end if;

  select policy.package_mode
  into v_policy
  from public.ecoflow_sku_package_policies as policy
  where policy.sku = v_sku;

  if v_policy = 'CARTON_ONLY' and v_package <> 'CARTON' then
    raise exception 'package level conflicts with CARTON_ONLY policy';
  end if;
  if v_policy = 'SLEEVE_ONLY' and v_package <> 'SLEEVE' then
    raise exception 'package level conflicts with SLEEVE_ONLY policy';
  end if;
  if v_policy = 'EACH_ONLY' and v_package <> 'EACH' then
    raise exception 'package level conflicts with UNIT/BOTTLE policy';
  end if;
  if v_policy = 'INNER_ONLY' and v_package <> 'INNER' then
    raise exception 'package level conflicts with INNER_ONLY policy';
  end if;
  if v_policy = 'CARTON_AND_SLEEVE' and v_package not in ('CARTON', 'SLEEVE') then
    raise exception 'package level conflicts with CARTON_AND_SLEEVE policy';
  end if;

  select registry.*
  into v_existing
  from public.ecoflow_sku_barcode_registry as registry
  where registry.barcode = v_barcode
  for update;
  v_existing_found := found;

  if v_existing_found then
    if not v_existing.is_active then
      raise exception 'BARCODE_RETIRED: create or scan the new packaging code';
    end if;
    if upper(v_existing.sku) <> v_sku
       or upper(v_existing.package_level) <> v_package then
      raise exception 'BARCODE_CONFLICT: active code already belongs to % %',
        v_existing.sku,
        v_existing.package_level;
    end if;
  end if;

  select velocity.product_name
  into v_product
  from public.v_ecoflow_owner_sku_velocity as velocity
  where velocity.sku = v_sku
  limit 1;
  v_product := coalesce(
    nullif(trim(coalesce(p_product_name, '')), ''),
    v_product,
    'Unknown product'
  );

  if v_existing_found then
    update public.ecoflow_sku_barcode_registry as registry
    set units_per_barcode = v_units,
        product_name = coalesce(v_product, registry.product_name),
        fixed_shelf = coalesce(
          nullif(trim(coalesce(p_shelf, '')), ''),
          registry.fixed_shelf
        ),
        source_session_id = coalesce(p_session_id, registry.source_session_id),
        scan_count = registry.scan_count + 1,
        last_scanned_at = now(),
        note = coalesce(
          nullif(trim(coalesce(p_note, '')), ''),
          registry.note
        ),
        updated_at = now()
    where registry.id = v_existing.id;
  else
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
      note,
      is_active,
      valid_from,
      updated_at
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
      nullif(trim(coalesce(p_note, '')), ''),
      true,
      now(),
      now()
    );
  end if;

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
    fixed_shelf = coalesce(excluded.fixed_shelf, public.ecoflow_inventory_sku_controls.fixed_shelf),
    primary_barcode = coalesce(public.ecoflow_inventory_sku_controls.primary_barcode, excluded.primary_barcode),
    updated_by = auth.uid(),
    updated_at = now();

  v_status := case
    when v_mode = 'MAP_AND_COUNT' then 'MAPPED_AND_COUNTED'
    else 'MAPPED'
  end;

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
    null,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  )
  returning id into v_event_id;

  return query
  select
    event.id,
    event.sku,
    event.barcode,
    event.package_level,
    event.scan_status,
    event.movement_id,
    event.scanned_at
  from public.ecoflow_barcode_scan_events as event
  where event.id = v_event_id;
end;
$$;

revoke all on function public.ecoflow_record_barcode_scan(
  uuid, text, text, text, numeric, text, text, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.ecoflow_record_barcode_scan(
  uuid, text, text, text, numeric, text, text, numeric, text, text
) to authenticated;

create or replace function public.ecoflow_record_inventory_movement(
  p_sku text,
  p_movement_type text,
  p_quantity numeric,
  p_from_location text default null,
  p_to_location text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_store_id text default null,
  p_note text default null,
  p_source text default 'INVENTORY_CONTROL'
)
returns table (
  movement_id uuid,
  sku text,
  movement_type text,
  quantity numeric,
  from_location text,
  to_location text,
  moved_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict error
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_type text := upper(trim(coalesce(p_movement_type, '')));
  v_qty numeric := coalesce(p_quantity, 0);
  v_product_name text;
  v_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' using errcode = '42501';
  end if;
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;
  if v_type not in (
    'RECEIVE',
    'PUTAWAY',
    'DISPATCH',
    'ADJUST_IN',
    'ADJUST_OUT',
    'RETURN_IN'
  ) then
    raise exception 'unsupported inventory movement type: %', p_movement_type;
  end if;
  if v_qty <= 0 then
    raise exception 'movement quantity must be greater than zero';
  end if;
  if v_type in ('RECEIVE', 'ADJUST_IN', 'RETURN_IN')
     and nullif(trim(coalesce(p_to_location, '')), '') is null then
    raise exception '% requires to_location', v_type;
  end if;
  if v_type in ('DISPATCH', 'ADJUST_OUT')
     and nullif(trim(coalesce(p_from_location, '')), '') is null then
    raise exception '% requires from_location', v_type;
  end if;
  if v_type = 'PUTAWAY'
     and (
       nullif(trim(coalesce(p_from_location, '')), '') is null
       or nullif(trim(coalesce(p_to_location, '')), '') is null
     ) then
    raise exception 'PUTAWAY requires from_location and to_location';
  end if;

  select velocity.product_name
  into v_product_name
  from public.v_ecoflow_owner_sku_velocity as velocity
  where velocity.sku = v_sku
  limit 1;

  insert into public.ecoflow_inventory_movements(
    sku,
    product_name,
    movement_type,
    quantity,
    from_location,
    to_location,
    reference_type,
    reference_id,
    store_id,
    action_note,
    source,
    moved_by,
    moved_at
  ) values (
    v_sku,
    v_product_name,
    v_type,
    v_qty,
    nullif(trim(coalesce(p_from_location, '')), ''),
    nullif(trim(coalesce(p_to_location, '')), ''),
    nullif(trim(coalesce(p_reference_type, '')), ''),
    nullif(trim(coalesce(p_reference_id, '')), ''),
    nullif(trim(coalesce(p_store_id, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    'INVENTORY_CONTROL',
    auth.uid(),
    now()
  )
  returning id into v_id;

  insert into public.ecoflow_inventory_sku_controls(
    sku,
    product_name,
    updated_by,
    updated_at
  ) values (
    v_sku,
    v_product_name,
    auth.uid(),
    now()
  )
  on conflict on constraint ecoflow_inventory_sku_controls_pkey do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    updated_at = now(),
    updated_by = auth.uid();

  return query
  select
    movement.id,
    movement.sku,
    movement.movement_type,
    movement.quantity,
    movement.from_location,
    movement.to_location,
    movement.moved_at
  from public.ecoflow_inventory_movements as movement
  where movement.id = v_id;
end;
$$;

revoke all on function public.ecoflow_record_inventory_movement(
  text, text, numeric, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ecoflow_record_inventory_movement(
  text, text, numeric, text, text, text, text, text, text, text
) to authenticated;

-- Legacy master-data commands are used by service-role maintenance scripts.
-- They must not remain a second authenticated-browser write path.
do $legacy_master_data_acl$
begin
  if to_regprocedure(
    'public.ecoflow_confirm_sku_barcode(text,text,text,numeric,text,text,boolean,text,text)'
  ) is not null then
    execute 'revoke all on function public.ecoflow_confirm_sku_barcode(text,text,text,numeric,text,text,boolean,text,text) from public, anon, authenticated';
    execute 'grant execute on function public.ecoflow_confirm_sku_barcode(text,text,text,numeric,text,text,boolean,text,text) to service_role';
  end if;

  if to_regprocedure(
    'public.ecoflow_mark_ordermentum_sku_service_item(text,text)'
  ) is not null then
    execute 'revoke all on function public.ecoflow_mark_ordermentum_sku_service_item(text,text) from public, anon, authenticated';
    execute 'grant execute on function public.ecoflow_mark_ordermentum_sku_service_item(text,text) to service_role';
  end if;

  if to_regclass('public.ecoflow_sku_master_overrides') is not null then
    execute 'revoke insert, update, delete on public.ecoflow_sku_master_overrides from public, anon, authenticated';
  end if;
  if to_regclass('public.sku_packaging_levels') is not null then
    execute 'revoke insert, update, delete on public.sku_packaging_levels from public, anon, authenticated';
  end if;
  if to_regclass('public.sku_barcodes') is not null then
    execute 'revoke insert, update, delete on public.sku_barcodes from public, anon, authenticated';
  end if;
end;
$legacy_master_data_acl$;

notify pgrst, 'reload schema';

commit;
