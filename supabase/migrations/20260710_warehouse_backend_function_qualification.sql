-- Final authoritative definitions with every table column explicitly qualified.
-- RETURNS TABLE output names are PL/pgSQL variables, so unqualified columns can
-- otherwise become ambiguous only when the function is first executed.

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
  on conflict (sku) do update set
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

create or replace function public.ecoflow_retire_barcode_mapping(
  p_barcode text, p_reason text, p_replacement_barcode text default null
)
returns table (
  barcode text, sku text, package_level text,
  retired_at timestamptz, replacement_barcode text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(trim(coalesce(p_barcode, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_replacement text := nullif(trim(coalesce(p_replacement_barcode, '')), '');
  v_current public.ecoflow_sku_barcode_registry%rowtype;
  v_next public.ecoflow_sku_barcode_registry%rowtype;
  v_replacement_id uuid := null;
begin
  if not public.ecoflow_can_edit_warehouse_layout() then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_code is null then raise exception 'barcode is required'; end if;
  if v_reason is null then raise exception 'retirement reason is required'; end if;

  select r.* into v_current
  from public.ecoflow_sku_barcode_registry r
  where r.barcode = v_code
  for update;
  if not found then raise exception 'barcode not found: %', v_code; end if;
  if not v_current.is_active then raise exception 'barcode is already retired'; end if;

  if v_replacement is not null then
    select r.* into v_next
    from public.ecoflow_sku_barcode_registry r
    where r.barcode = v_replacement and r.is_active
    limit 1;
    if not found then raise exception 'active replacement barcode not found: %', v_replacement; end if;
    if upper(v_next.sku) <> upper(v_current.sku) then raise exception 'replacement barcode must belong to the same SKU'; end if;
    v_replacement_id := v_next.id;
  end if;

  update public.ecoflow_sku_barcode_registry r
  set is_active = false, retired_at = now(), retired_by = auth.uid(),
      retirement_reason = v_reason, replaced_by_barcode_id = v_replacement_id, updated_at = now()
  where r.id = v_current.id;

  update public.ecoflow_inventory_sku_controls c
  set primary_barcode = case when v_replacement_id is not null then v_next.barcode else null end,
      updated_by = auth.uid(), updated_at = now()
  where c.sku = v_current.sku and c.primary_barcode = v_current.barcode;

  return query
  select v_current.barcode, v_current.sku, v_current.package_level, now(),
         case when v_replacement_id is not null then v_next.barcode else null end;
end;
$$;

create or replace function public.ecoflow_stage_receiving_scan_v2(
  p_batch_id uuid,
  p_barcode text,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_client_scanned_at timestamptz default null
)
returns table (
  line_id uuid,batch_id uuid,sku text,product_name text,barcode text,
  package_level text,qty_packages numeric,units_received numeric,
  suggested_location text,confirmation_checked boolean,line_status text,scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid := p_batch_id;
  v_barcode text := nullif(trim(coalesce(p_barcode,'')),'');
  v_packages numeric := coalesce(p_qty_packages,1);
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_units numeric;
  v_location text;
  v_location_row public.ecoflow_warehouse_locations%rowtype;
  v_id uuid;
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_key is null then raise exception 'idempotency key is required'; end if;
  if v_packages <= 0 or v_packages <> trunc(v_packages) then raise exception 'package quantity must be a positive whole number'; end if;

  if v_batch_id is null then
    select started.batch_id into v_batch_id
    from public.ecoflow_start_warehouse_receiving_batch(null,null,null,'Auto receiving batch') started
    limit 1;
  end if;

  select b.* into v_batch
  from public.ecoflow_warehouse_receiving_batches b
  where b.id = v_batch_id
  for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status not in ('SCANNING','READY_TO_POST') then raise exception 'receiving batch is not open: %', v_batch.batch_status; end if;

  select l.id into v_id
  from public.ecoflow_warehouse_receiving_lines l
  where l.batch_id = v_batch_id and l.idempotency_key = v_key
  limit 1;
  if v_id is not null then
    return query
    select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
           l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
    from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
    return;
  end if;

  select r.* into v_registry
  from public.ecoflow_sku_barcode_registry r
  where r.barcode = v_barcode and r.is_active
  limit 1;
  if not found then
    if exists(select 1 from public.ecoflow_sku_barcode_registry retired where retired.barcode=v_barcode and not retired.is_active) then
      raise exception 'BARCODE_RETIRED: scan the current packaging code';
    end if;
    raise exception 'barcode is not mapped yet: %', v_barcode;
  end if;

  v_units := v_packages * v_registry.units_per_barcode;
  v_location := coalesce(
    nullif(trim(coalesce(p_target_location,'')),''),
    nullif(trim(coalesce(v_registry.fixed_shelf,'')),''),
    (select nullif(trim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where c.sku=v_registry.sku limit 1),
    (select nullif(trim(coalesce(pol.default_shelf,'')),'') from public.ecoflow_sku_package_policies pol where pol.sku=v_registry.sku limit 1),
    'TEMP'
  );

  select wl.* into v_location_row
  from public.ecoflow_warehouse_locations wl
  where upper(wl.location_code)=upper(v_location) and wl.status='ACTIVE'
  limit 1;
  if not found then
    if nullif(trim(coalesce(p_target_location,'')),'') is not null then raise exception 'active warehouse location not found: %', p_target_location; end if;
    select wl.* into v_location_row
    from public.ecoflow_warehouse_locations wl
    where upper(wl.location_code)='TEMP' and wl.status='ACTIVE'
    limit 1;
    if not found then raise exception 'TEMP warehouse location is not configured'; end if;
  end if;
  v_location := v_location_row.location_code;

  begin
    insert into public.ecoflow_warehouse_receiving_lines(
      batch_id,sku,product_name,barcode,package_level,qty_packages,units_per_package,
      units_received,suggested_location,line_note,idempotency_key,client_scanned_at,
      scanned_by,scanned_at,updated_at
    ) values (
      v_batch_id,v_registry.sku,v_registry.product_name,v_barcode,v_registry.package_level,
      v_packages,v_registry.units_per_barcode,v_units,v_location,
      nullif(trim(coalesce(p_note,'')),''),v_key,p_client_scanned_at,auth.uid(),now(),now()
    ) returning id into v_id;
  exception when unique_violation then
    select l.id into v_id
    from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id=v_batch_id and l.idempotency_key=v_key
    limit 1;
  end;

  update public.ecoflow_warehouse_receiving_batches b
  set batch_status='SCANNING',updated_at=now()
  where b.id=v_batch_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values (v_batch_id,v_id,'LINE_SCANNED',v_registry.sku || ' · ' || v_location || ' · ' || v_packages::text || ' packages');

  return query
  select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
         l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
  from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
end;
$$;

create or replace function public.ecoflow_complete_warehouse_receiving_batch(
  p_batch_id uuid,p_note text default null
)
returns table (batch_id uuid,batch_no text,posted_lines numeric,posted_units numeric,batch_status text,completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unconfirmed integer;
  v_line record;
  v_inventory_movement_id uuid;
  v_warehouse_movement_id uuid;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_unit_level text;
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  select b.* into v_batch from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id for update;
  if not found then raise exception 'receiving batch not found'; end if;

  if v_batch.batch_status='POSTED' then
    return query
    select b.id,b.batch_no,
      coalesce(count(l.id) filter(where l.line_status='POSTED'),0)::numeric,
      coalesce(sum(l.units_received) filter(where l.line_status='POSTED'),0)::numeric,
      b.batch_status,b.completed_at
    from public.ecoflow_warehouse_receiving_batches b
    left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
    where b.id=p_batch_id
    group by b.id,b.batch_no,b.batch_status,b.completed_at;
    return;
  end if;
  if v_batch.batch_status='CANCELLED' then raise exception 'cancelled receiving batch cannot be posted'; end if;

  select count(*) into v_unconfirmed
  from public.ecoflow_warehouse_receiving_lines l
  where l.batch_id=p_batch_id and l.line_status in ('WAITING_CONFIRM','CONFIRMED') and not l.confirmation_checked;
  if v_unconfirmed>0 then raise exception 'all scanned receiving lines must be confirmed before completion'; end if;
  if not exists(
    select 1 from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id=p_batch_id and l.confirmation_checked and l.movement_id is null
  ) then raise exception 'no confirmed receiving lines to post'; end if;

  for v_line in
    select l.* from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id=p_batch_id and l.confirmation_checked and l.movement_id is null and l.line_status='CONFIRMED'
    order by l.scanned_at asc
  loop
    select wl.* into v_location
    from public.ecoflow_warehouse_locations wl
    where upper(wl.location_code)=upper(v_line.suggested_location) and wl.status='ACTIVE'
    limit 1;
    if not found then raise exception 'active warehouse location not found: %', v_line.suggested_location; end if;

    select m.id into v_inventory_movement_id
    from public.ecoflow_inventory_movements m
    where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line.id::text
    limit 1;
    if v_inventory_movement_id is null then
      insert into public.ecoflow_inventory_movements(
        sku,product_name,movement_type,quantity,to_location,reference_type,reference_id,
        action_note,source,moved_by,moved_at
      ) values (
        v_line.sku,v_line.product_name,'RECEIVE',v_line.units_received,v_location.location_code,
        'WAREHOUSE_RECEIVING_LINE',v_line.id::text,
        coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),
        'WAREHOUSE_RECEIVING_BATCH',auth.uid(),now()
      ) returning id into v_inventory_movement_id;
    end if;

    v_unit_level := case upper(coalesce(v_line.package_level,'UNKNOWN'))
      when 'CARTON' then 'carton' when 'SLEEVE' then 'sleeve'
      when 'EACH' then 'each' else 'unknown' end;

    insert into public.ecoflow_warehouse_location_items(
      location_id,sku,product_name,source_barcode,unit_level,quantity,status,last_movement_at,last_note,created_at,updated_at
    ) values (
      v_location.id,v_line.sku,v_line.product_name,v_line.barcode,v_unit_level,v_line.units_received,
      'ACTIVE',now(),coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),now(),now()
    )
    on conflict (location_id,sku,unit_level) do update set
      quantity=public.ecoflow_warehouse_location_items.quantity+excluded.quantity,
      product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),
      source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),
      status='ACTIVE',last_movement_at=now(),last_note=excluded.last_note,updated_at=now();

    select wm.id into v_warehouse_movement_id
    from public.ecoflow_warehouse_movements wm
    where wm.reference_type='WAREHOUSE_RECEIVING_LINE' and wm.reference_id=v_line.id::text
    limit 1;
    if v_warehouse_movement_id is null then
      insert into public.ecoflow_warehouse_movements(
        movement_type,location_id,to_location_id,sku,product_name,barcode,unit_level,
        quantity,note,actor_user_id,created_at,reference_type,reference_id
      ) values (
        'RECEIVE',v_location.id,v_location.id,v_line.sku,v_line.product_name,v_line.barcode,
        v_unit_level,v_line.units_received,coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),
        auth.uid(),now(),'WAREHOUSE_RECEIVING_LINE',v_line.id::text
      ) returning id into v_warehouse_movement_id;
    end if;

    update public.ecoflow_warehouse_receiving_lines l
    set movement_id=v_inventory_movement_id,line_status='POSTED',updated_at=now()
    where l.id=v_line.id;
  end loop;

  update public.ecoflow_warehouse_receiving_batches b
  set batch_status='POSTED',completed_by=auth.uid(),completed_at=now(),
      batch_note=coalesce(nullif(trim(coalesce(p_note,'')),''),b.batch_note),updated_at=now()
  where b.id=p_batch_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values (p_batch_id,'BATCH_POSTED',nullif(trim(coalesce(p_note,'')),''));

  return query
  select b.id,b.batch_no,
    coalesce(count(l.id) filter(where l.line_status='POSTED'),0)::numeric,
    coalesce(sum(l.units_received) filter(where l.line_status='POSTED'),0)::numeric,
    b.batch_status,b.completed_at
  from public.ecoflow_warehouse_receiving_batches b
  left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
  where b.id=p_batch_id
  group by b.id,b.batch_no,b.batch_status,b.completed_at;
end;
$$;

create or replace function public.ecoflow_cancel_warehouse_receiving_batch(
  p_batch_id uuid,p_reason text
)
returns table (batch_id uuid,batch_no text,batch_status text,cancelled_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if v_reason is null then raise exception 'cancellation reason is required'; end if;

  select b.* into v_batch
  from public.ecoflow_warehouse_receiving_batches b
  where b.id=p_batch_id
  for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status='POSTED' then raise exception 'posted receiving batch cannot be cancelled'; end if;
  if v_batch.batch_status='CANCELLED' then
    return query
    select b.id,b.batch_no,b.batch_status,b.cancelled_at
    from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id;
    return;
  end if;
  if exists(
    select 1 from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id=p_batch_id and l.movement_id is not null
  ) then raise exception 'batch with posted movement cannot be cancelled'; end if;

  update public.ecoflow_warehouse_receiving_lines l
  set line_status='CANCELLED',updated_at=now()
  where l.batch_id=p_batch_id and l.line_status in ('WAITING_CONFIRM','CONFIRMED');
  update public.ecoflow_warehouse_receiving_batches b
  set batch_status='CANCELLED',cancelled_by=auth.uid(),cancelled_at=now(),cancel_reason=v_reason,updated_at=now()
  where b.id=p_batch_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values (p_batch_id,'BATCH_CANCELLED',v_reason);

  return query
  select b.id,b.batch_no,b.batch_status,b.cancelled_at
  from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
