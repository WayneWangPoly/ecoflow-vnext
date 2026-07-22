-- Keep the warehouse location balance in the same unit named by unit_level.
--
-- Receiving lines intentionally retain both:
--   qty_packages       = count of the scanned package level (cartons/sleeves/each)
--   units_received     = base operational units after barcode conversion
--
-- The public completion function is already the unresolved-unknown-barcode gate.
-- This migration replaces only its protected unchecked implementation, preserving
-- that gate while correcting the quantities written after it passes.

begin;

create or replace function public.ecoflow_complete_warehouse_receiving_batch_unchecked_20260711(
  p_batch_id uuid,
  p_note text default null
)
returns table (
  batch_id uuid,
  batch_no text,
  posted_lines numeric,
  posted_units numeric,
  batch_status text,
  completed_at timestamptz
)
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
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  select b.* into v_batch
  from public.ecoflow_warehouse_receiving_batches b
  where b.id = p_batch_id
  for update;

  if not found then raise exception 'receiving batch not found'; end if;

  if v_batch.batch_status = 'POSTED' then
    return query
    select b.id,b.batch_no,
      coalesce(count(l.id) filter(where l.line_status = 'POSTED'),0)::numeric,
      coalesce(sum(l.units_received) filter(where l.line_status = 'POSTED'),0)::numeric,
      b.batch_status,b.completed_at
    from public.ecoflow_warehouse_receiving_batches b
    left join public.ecoflow_warehouse_receiving_lines l on l.batch_id = b.id
    where b.id = p_batch_id
    group by b.id,b.batch_no,b.batch_status,b.completed_at;
    return;
  end if;

  if v_batch.batch_status = 'CANCELLED' then
    raise exception 'cancelled receiving batch cannot be posted';
  end if;

  select count(*) into v_unconfirmed
  from public.ecoflow_warehouse_receiving_lines l
  where l.batch_id = p_batch_id
    and l.line_status in ('WAITING_CONFIRM','CONFIRMED')
    and not l.confirmation_checked;

  if v_unconfirmed > 0 then
    raise exception 'all scanned receiving lines must be confirmed before completion';
  end if;

  if not exists (
    select 1
    from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id = p_batch_id
      and l.confirmation_checked
      and l.movement_id is null
  ) then
    raise exception 'no confirmed receiving lines to post';
  end if;

  for v_line in
    select l.*
    from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id = p_batch_id
      and l.confirmation_checked
      and l.movement_id is null
      and l.line_status = 'CONFIRMED'
    order by l.scanned_at asc
  loop
    if v_line.qty_packages <= 0 or v_line.qty_packages <> trunc(v_line.qty_packages) then
      raise exception 'receiving line % has an invalid package quantity', v_line.id;
    end if;
    if v_line.units_received <= 0 or v_line.units_received <> trunc(v_line.units_received) then
      raise exception 'receiving line % has an invalid converted unit quantity', v_line.id;
    end if;

    select wl.* into v_location
    from public.ecoflow_warehouse_locations wl
    where upper(wl.location_code) = upper(v_line.suggested_location)
      and wl.status = 'ACTIVE'
    limit 1;

    if not found then
      raise exception 'active warehouse location not found: %', v_line.suggested_location;
    end if;

    select m.id into v_inventory_movement_id
    from public.ecoflow_inventory_movements m
    where m.reference_type = 'WAREHOUSE_RECEIVING_LINE'
      and m.reference_id = v_line.id::text
    limit 1;

    -- Global inventory analysis remains in converted/base operational units.
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
      when 'CARTON' then 'carton'
      when 'SLEEVE' then 'sleeve'
      when 'EACH' then 'each'
      else 'unknown'
    end;

    -- A location row labelled carton/sleeve/each stores the physical count of
    -- that same package level. Conversion belongs only in the base-unit ledger.
    insert into public.ecoflow_warehouse_location_items(
      location_id,sku,product_name,source_barcode,unit_level,quantity,status,
      last_movement_at,last_note,created_at,updated_at
    ) values (
      v_location.id,v_line.sku,v_line.product_name,v_line.barcode,v_unit_level,
      v_line.qty_packages,'ACTIVE',now(),
      coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),now(),now()
    )
    on conflict (location_id,sku,unit_level) do update set
      quantity = public.ecoflow_warehouse_location_items.quantity + excluded.quantity,
      product_name = coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),
      source_barcode = coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),
      status = 'ACTIVE',
      last_movement_at = now(),
      last_note = excluded.last_note,
      updated_at = now();

    select m.id into v_warehouse_movement_id
    from public.ecoflow_warehouse_movements m
    where m.reference_type = 'WAREHOUSE_RECEIVING_LINE'
      and m.reference_id = v_line.id::text
    limit 1;

    if v_warehouse_movement_id is null then
      insert into public.ecoflow_warehouse_movements(
        movement_type,location_id,to_location_id,sku,product_name,barcode,unit_level,
        quantity,note,actor_user_id,created_at,reference_type,reference_id
      ) values (
        'RECEIVE',v_location.id,v_location.id,v_line.sku,v_line.product_name,v_line.barcode,
        v_unit_level,v_line.qty_packages,
        coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),
        auth.uid(),now(),'WAREHOUSE_RECEIVING_LINE',v_line.id::text
      ) returning id into v_warehouse_movement_id;
    end if;

    update public.ecoflow_warehouse_receiving_lines l
    set movement_id = v_inventory_movement_id,
        line_status = 'POSTED',
        updated_at = now()
    where l.id = v_line.id;
  end loop;

  update public.ecoflow_warehouse_receiving_batches b
  set batch_status = 'POSTED',
      completed_by = auth.uid(),
      completed_at = now(),
      batch_note = coalesce(nullif(trim(coalesce(p_note,'')),''),b.batch_note),
      updated_at = now()
  where b.id = p_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values (p_batch_id,'BATCH_POSTED',nullif(trim(coalesce(p_note,'')),''));

  return query
  select b.id,b.batch_no,
    coalesce(count(l.id) filter(where l.line_status = 'POSTED'),0)::numeric,
    coalesce(sum(l.units_received) filter(where l.line_status = 'POSTED'),0)::numeric,
    b.batch_status,b.completed_at
  from public.ecoflow_warehouse_receiving_batches b
  left join public.ecoflow_warehouse_receiving_lines l on l.batch_id = b.id
  where b.id = p_batch_id
  group by b.id,b.batch_no,b.batch_status,b.completed_at;
end;
$$;

revoke execute on function public.ecoflow_complete_warehouse_receiving_batch_unchecked_20260711(uuid,text)
  from public,anon,authenticated;

-- Read-only audit: old posted movements with converted units recorded as package
-- quantities are surfaced for manual review. No historic balance is rewritten
-- automatically because later picks or adjustments may already be mixed in.
create or replace view public.v_ecoflow_stocktake_uom_integrity
with (security_invoker = true)
as
select
  l.id as receiving_line_id,
  l.batch_id,
  b.batch_no,
  l.sku,
  l.barcode,
  lower(coalesce(l.package_level,'unknown')) as unit_level,
  l.qty_packages as expected_package_quantity,
  l.units_received as expected_base_units,
  wm.quantity as warehouse_movement_quantity,
  im.quantity as inventory_ledger_quantity,
  case
    when wm.id is null or im.id is null then 'MISSING_MOVEMENT'
    when wm.quantity <> l.qty_packages then 'PACKAGE_QUANTITY_MISMATCH'
    when im.quantity <> l.units_received then 'BASE_UNIT_LEDGER_MISMATCH'
    else 'MATCHED'
  end as integrity_status,
  l.scanned_at,
  b.completed_at
from public.ecoflow_warehouse_receiving_lines l
join public.ecoflow_warehouse_receiving_batches b on b.id = l.batch_id
left join public.ecoflow_warehouse_movements wm
  on wm.reference_type = 'WAREHOUSE_RECEIVING_LINE'
 and wm.reference_id = l.id::text
left join public.ecoflow_inventory_movements im
  on im.reference_type = 'WAREHOUSE_RECEIVING_LINE'
 and im.reference_id = l.id::text
where l.line_status = 'POSTED';

grant select on public.v_ecoflow_stocktake_uom_integrity to authenticated;

comment on view public.v_ecoflow_stocktake_uom_integrity is
  'Receiving UOM integrity: warehouse movement uses package count; inventory ledger uses converted base units.';

commit;
