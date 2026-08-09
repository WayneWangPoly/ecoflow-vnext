-- Production-shaped receiving confirmation/post primitives used by the
-- TRANSFORM-005 operational authority contract. The barcode staging function is
-- supplied by the canonical operational gate; these functions prove quantity is
-- still changed only by an explicit confirm + post action.

alter table public.ecoflow_warehouse_location_items
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists uq_inventory_receiving_line_reference_fixture
  on public.ecoflow_inventory_movements(reference_type,reference_id)
  where reference_type='WAREHOUSE_RECEIVING_LINE';

create unique index if not exists uq_warehouse_receiving_line_reference_fixture
  on public.ecoflow_warehouse_movements(reference_type,reference_id)
  where reference_type='WAREHOUSE_RECEIVING_LINE';

create or replace function public.ecoflow_confirm_warehouse_receiving_line(
  p_line_id uuid,
  p_confirmed boolean default true,
  p_note text default null
)
returns table(line_id uuid,batch_id uuid,confirmation_checked boolean,line_status text,updated_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
#variable_conflict error
declare
  v_batch_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;

  select l.batch_id into v_batch_id
  from public.ecoflow_warehouse_receiving_lines l
  join public.ecoflow_warehouse_receiving_batches b on b.id=l.batch_id
  where l.id=p_line_id and b.batch_status in ('SCANNING','READY_TO_POST')
  for update of l;
  if v_batch_id is null then raise exception 'open receiving line not found'; end if;

  update public.ecoflow_warehouse_receiving_lines as l
  set confirmation_checked=coalesce(p_confirmed,true),
      line_status=case when coalesce(p_confirmed,true) then 'CONFIRMED' else 'WAITING_CONFIRM' end,
      line_note=coalesce(nullif(trim(coalesce(p_note,'')),''),l.line_note),
      confirmed_by=case when coalesce(p_confirmed,true) then auth.uid() else null end,
      confirmed_at=case when coalesce(p_confirmed,true) then now() else null end,
      updated_at=now()
  where l.id=p_line_id and l.line_status in ('WAITING_CONFIRM','CONFIRMED');

  update public.ecoflow_warehouse_receiving_batches as b
  set batch_status=case
        when exists(select 1 from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status in ('WAITING_CONFIRM','CONFIRMED'))
         and not exists(select 1 from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status in ('WAITING_CONFIRM','CONFIRMED') and not l.confirmation_checked)
        then 'READY_TO_POST' else 'SCANNING' end,
      updated_at=now()
  where b.id=v_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values(v_batch_id,p_line_id,case when coalesce(p_confirmed,true) then 'LINE_CONFIRMED' else 'LINE_REOPENED' end,nullif(trim(coalesce(p_note,'')),''));

  return query
  select l.id,l.batch_id,l.confirmation_checked,l.line_status,l.updated_at
  from public.ecoflow_warehouse_receiving_lines l where l.id=p_line_id;
end;
$$;

create or replace function public.ecoflow_complete_warehouse_receiving_batch(
  p_batch_id uuid,
  p_note text default null
)
returns table(batch_id uuid,batch_no text,posted_lines numeric,posted_units numeric,batch_status text,completed_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
#variable_conflict error
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

  select b.* into v_batch
  from public.ecoflow_warehouse_receiving_batches b
  where b.id=p_batch_id
  for update;
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
  where l.batch_id=p_batch_id
    and l.line_status in ('WAITING_CONFIRM','CONFIRMED')
    and not l.confirmation_checked;
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
    if not found then raise exception 'active warehouse location not found: %',v_line.suggested_location; end if;

    select m.id into v_inventory_movement_id
    from public.ecoflow_inventory_movements m
    where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line.id::text
    limit 1;

    if v_inventory_movement_id is null then
      insert into public.ecoflow_inventory_movements(
        sku,product_name,movement_type,quantity,to_location,reference_type,reference_id,
        action_note,source,moved_by,moved_at
      ) values(
        v_line.sku,v_line.product_name,'RECEIVE',v_line.units_received,v_location.location_code,
        'WAREHOUSE_RECEIVING_LINE',v_line.id::text,
        coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),
        'WAREHOUSE_RECEIVING_BATCH',auth.uid(),now()
      ) returning id into v_inventory_movement_id;
    end if;

    v_unit_level:=case upper(coalesce(v_line.package_level,'UNKNOWN'))
      when 'CARTON' then 'carton'
      when 'SLEEVE' then 'sleeve'
      when 'EACH' then 'each'
      else 'unknown' end;

    insert into public.ecoflow_warehouse_location_items(
      location_id,sku,product_name,source_barcode,unit_level,quantity,status,
      last_movement_at,last_note,created_at,updated_at
    ) values(
      v_location.id,v_line.sku,v_line.product_name,v_line.barcode,v_unit_level,
      v_line.units_received,'ACTIVE',now(),
      coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),now(),now()
    )
    on conflict(location_id,sku,unit_level) do update set
      quantity=public.ecoflow_warehouse_location_items.quantity+excluded.quantity,
      product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),
      source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),
      status='ACTIVE',last_movement_at=now(),last_note=excluded.last_note,updated_at=now();

    select m.id into v_warehouse_movement_id
    from public.ecoflow_warehouse_movements m
    where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line.id::text
    limit 1;

    if v_warehouse_movement_id is null then
      insert into public.ecoflow_warehouse_movements(
        movement_type,location_id,to_location_id,sku,product_name,barcode,unit_level,
        quantity,note,actor_user_id,created_at,reference_type,reference_id
      ) values(
        'RECEIVE',v_location.id,v_location.id,v_line.sku,v_line.product_name,v_line.barcode,
        v_unit_level,v_line.units_received,
        coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),auth.uid(),now(),
        'WAREHOUSE_RECEIVING_LINE',v_line.id::text
      ) returning id into v_warehouse_movement_id;
    end if;

    update public.ecoflow_warehouse_receiving_lines as l
    set movement_id=v_inventory_movement_id,line_status='POSTED',updated_at=now()
    where l.id=v_line.id;
  end loop;

  update public.ecoflow_warehouse_receiving_batches as b
  set batch_status='POSTED',completed_by=auth.uid(),completed_at=now(),
      batch_note=coalesce(nullif(trim(coalesce(p_note,'')),''),b.batch_note),updated_at=now()
  where b.id=p_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values(p_batch_id,'BATCH_POSTED',nullif(trim(coalesce(p_note,'')),''));

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

revoke all on function public.ecoflow_confirm_warehouse_receiving_line(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.ecoflow_complete_warehouse_receiving_batch(uuid,text) from public,anon,authenticated;
grant execute on function public.ecoflow_confirm_warehouse_receiving_line(uuid,boolean,text) to authenticated;
grant execute on function public.ecoflow_complete_warehouse_receiving_batch(uuid,text) to authenticated;