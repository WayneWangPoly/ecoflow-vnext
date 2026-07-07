-- Package 3: Pick + Warehouse Location.
-- Deducts picked warehouse stock by SKU/unit level and records PICK movements.

create or replace function public.ecoflow_record_pick_movement(
  p_sku text,
  p_quantity numeric,
  p_unit_level text default 'carton',
  p_barcode text default null,
  p_note text default null
)
returns table(location_code text, sku text, picked_quantity numeric, remaining_quantity numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_needed numeric;
  v_take numeric;
  v_total_available numeric;
  v_row record;
  v_unit_level text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  if coalesce(trim(p_sku), '') = '' then
    raise exception 'SKU_REQUIRED';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'POSITIVE_QUANTITY_REQUIRED';
  end if;

  v_needed := p_quantity;
  v_unit_level := coalesce(nullif(trim(p_unit_level), ''), 'carton');

  select coalesce(sum(i.quantity), 0) into v_total_available
  from public.ecoflow_warehouse_location_items i
  join public.ecoflow_warehouse_locations l on l.id = i.location_id
  where upper(i.sku) = upper(trim(p_sku))
    and i.status = 'ACTIVE'
    and i.quantity > 0
    and (
      i.unit_level = v_unit_level
      or not exists (
        select 1
        from public.ecoflow_warehouse_location_items exact_i
        where upper(exact_i.sku) = upper(trim(p_sku))
          and exact_i.status = 'ACTIVE'
          and exact_i.quantity > 0
          and exact_i.unit_level = v_unit_level
      )
    );

  if v_total_available < p_quantity then
    raise exception 'STOCK_SHORTAGE: % % requested, % available', p_quantity, trim(p_sku), v_total_available;
  end if;

  for v_row in
    select i.id as item_id, i.location_id, i.sku, i.product_name, i.source_barcode, i.unit_level, i.quantity, l.location_code, l.sort_order
    from public.ecoflow_warehouse_location_items i
    join public.ecoflow_warehouse_locations l on l.id = i.location_id
    where upper(i.sku) = upper(trim(p_sku))
      and i.status = 'ACTIVE'
      and i.quantity > 0
      and (
        i.unit_level = v_unit_level
        or not exists (
          select 1
          from public.ecoflow_warehouse_location_items exact_i
          where upper(exact_i.sku) = upper(trim(p_sku))
            and exact_i.status = 'ACTIVE'
            and exact_i.quantity > 0
            and exact_i.unit_level = v_unit_level
        )
      )
    order by case when l.location_code = 'TEMP' then 1 else 0 end, l.sort_order, i.updated_at
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed, v_row.quantity);

    update public.ecoflow_warehouse_location_items
    set quantity = quantity - v_take,
        status = case when quantity - v_take <= 0 then 'ZEROED' else 'ACTIVE' end,
        last_movement_at = now(),
        last_note = coalesce(p_note, 'Picked to dock'),
        updated_at = now()
    where id = v_row.item_id;

    insert into public.ecoflow_warehouse_movements (movement_type, location_id, from_location_id, sku, product_name, barcode, unit_level, quantity, note, actor_user_id)
    values ('PICK', v_row.location_id, v_row.location_id, v_row.sku, v_row.product_name, coalesce(nullif(trim(p_barcode), ''), v_row.source_barcode), v_row.unit_level, -v_take, p_note, auth.uid());

    v_needed := v_needed - v_take;
    return query select v_row.location_code, v_row.sku, v_take, v_row.quantity - v_take;
  end loop;
end;
$$;

grant execute on function public.ecoflow_record_pick_movement(text, numeric, text, text, text) to authenticated;
