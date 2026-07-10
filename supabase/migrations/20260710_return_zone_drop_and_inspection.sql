-- Practical small-warehouse return flow.
-- A fixed physical return-zone barcode proves the driver has brought goods back.
-- The per-return RET code remains an item/audit identifier, not the warehouse arrival scan.
-- Warehouse staff inspect the return next shift and either restock scanned goods, hold for supplier claim, or dispose.

create extension if not exists pgcrypto;

create table if not exists public.ecoflow_warehouse_return_zones (
  id uuid primary key default gen_random_uuid(),
  zone_code text not null unique,
  zone_name text not null default 'Returns Area',
  warehouse_location text not null default 'RETURNS-HOLD',
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ecoflow_warehouse_return_zones(zone_code, zone_name, warehouse_location)
values ('ECOFLOW-RETURNS-ZONE-01', 'Returns Area', 'RETURNS-HOLD')
on conflict(zone_code) do nothing;

grant select, insert, update on public.ecoflow_warehouse_return_zones to anon, authenticated;

alter table public.ecoflow_delivery_exceptions add column if not exists driver_return_zone_code text;
alter table public.ecoflow_delivery_exceptions add column if not exists driver_returned_by text;
alter table public.ecoflow_delivery_exceptions add column if not exists driver_returned_at timestamptz;
alter table public.ecoflow_delivery_exceptions add column if not exists inspection_completed_by text;
alter table public.ecoflow_delivery_exceptions add column if not exists inspection_completed_at timestamptz;
alter table public.ecoflow_delivery_exceptions add column if not exists inspection_note text;

alter table public.ecoflow_delivery_exceptions drop constraint if exists ecoflow_delivery_exceptions_return_status_check;
alter table public.ecoflow_delivery_exceptions add constraint ecoflow_delivery_exceptions_return_status_check
check (return_status in (
  'NOT_REQUIRED','WITH_DRIVER','DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD',
  'RESTOCKED','SUPPLIER_CLAIM','DISPOSED','MIXED_RESOLUTION','CANCELLED'
));

alter table public.ecoflow_delivery_return_scans drop constraint if exists ecoflow_delivery_return_scans_scan_action_check;
alter table public.ecoflow_delivery_return_scans add constraint ecoflow_delivery_return_scans_scan_action_check
check (scan_action in ('DRIVER_ZONE_DROP','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD','RESTOCKED','SUPPLIER_CLAIM','DISPOSED','MIXED_RESOLUTION'));

create table if not exists public.ecoflow_delivery_return_inspection_lines (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id) on delete cascade,
  resolution text not null check (resolution in ('RESTOCK','SUPPLIER_CLAIM','DISPOSE')),
  barcode text,
  sku text,
  product_name text,
  package_level text,
  qty_packages numeric not null default 1,
  units_per_package numeric not null default 1,
  units_processed numeric not null default 0,
  target_location text,
  movement_id uuid,
  manual_item text,
  inspection_note text,
  inspected_by text,
  inspected_at timestamptz not null default now()
);

create index if not exists idx_return_inspection_exception on public.ecoflow_delivery_return_inspection_lines(exception_id, inspected_at desc);
create index if not exists idx_return_inspection_sku on public.ecoflow_delivery_return_inspection_lines(sku);
grant select, insert on public.ecoflow_delivery_return_inspection_lines to anon, authenticated;

create or replace function public.ecoflow_driver_drop_return(
  p_exception_id uuid,
  p_zone_code text,
  p_note text default null,
  p_driver text default null
)
returns table (
  exception_id uuid,
  return_code text,
  store_name text,
  order_number text,
  return_cartons numeric,
  return_status text,
  warehouse_location text,
  driver_returned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone public.ecoflow_warehouse_return_zones%rowtype;
  v_exception public.ecoflow_delivery_exceptions%rowtype;
begin
  select * into v_zone
  from public.ecoflow_warehouse_return_zones
  where upper(zone_code) = upper(trim(coalesce(p_zone_code,''))) and active
  limit 1;
  if v_zone.id is null then raise exception 'This is not an active EcoFlow returns-zone code'; end if;

  select * into v_exception from public.ecoflow_delivery_exceptions where id = p_exception_id for update;
  if v_exception.id is null then raise exception 'return item not found'; end if;
  if v_exception.return_status <> 'WITH_DRIVER' then raise exception 'return is not currently with driver'; end if;

  update public.ecoflow_delivery_exceptions
  set return_status = 'DROPPED_IN_RETURN_ZONE',
      warehouse_location = v_zone.warehouse_location,
      driver_return_zone_code = v_zone.zone_code,
      driver_returned_by = coalesce(nullif(trim(coalesce(p_driver,'')),''),'Driver'),
      driver_returned_at = now(),
      inspection_note = coalesce(nullif(trim(coalesce(p_note,'')),''), inspection_note)
  where id = p_exception_id;

  insert into public.ecoflow_delivery_return_scans(exception_id,return_code,scan_action,warehouse_location,scan_note,scanned_by,scanned_at)
  values (p_exception_id,coalesce(v_exception.return_code,'NO-RET-CODE'),'DRIVER_ZONE_DROP',v_zone.warehouse_location,nullif(trim(coalesce(p_note,'')),''),coalesce(nullif(trim(coalesce(p_driver,'')),''),'Driver'),now());

  return query
  select e.id,e.return_code,e.store_name,e.order_number,e.return_cartons,e.return_status,e.warehouse_location,e.driver_returned_at
  from public.ecoflow_delivery_exceptions e where e.id=p_exception_id;
end;
$$;

grant execute on function public.ecoflow_driver_drop_return(uuid,text,text,text) to anon, authenticated;

create or replace function public.ecoflow_record_return_inspection_item(
  p_exception_id uuid,
  p_resolution text,
  p_barcode text default null,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_manual_item text default null,
  p_note text default null,
  p_inspected_by text default null
)
returns table (
  inspection_line_id uuid,
  resolution text,
  sku text,
  units_processed numeric,
  target_location text,
  movement_id uuid,
  inspected_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := upper(trim(coalesce(p_resolution,'')));
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_packages numeric := greatest(coalesce(p_qty_packages,1),0);
  v_units numeric := 0;
  v_location text;
  v_movement uuid;
  v_line uuid;
begin
  if v_action not in ('RESTOCK','SUPPLIER_CLAIM','DISPOSE') then raise exception 'invalid return resolution'; end if;
  select * into v_exception from public.ecoflow_delivery_exceptions where id=p_exception_id for update;
  if v_exception.id is null then raise exception 'return item not found'; end if;
  if v_exception.return_status not in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD') then raise exception 'return must be physically in the returns area before inspection'; end if;
  if v_packages <= 0 then raise exception 'quantity must be greater than zero'; end if;

  if nullif(trim(coalesce(p_barcode,'')),'') is not null then
    select * into v_registry from public.ecoflow_sku_barcode_registry where barcode=trim(p_barcode) order by last_scanned_at desc limit 1;
  end if;

  if v_action='RESTOCK' and v_registry.id is null then raise exception 'scan a mapped product barcode before restocking'; end if;
  if v_registry.id is null and nullif(trim(coalesce(p_manual_item,'')),'') is null then raise exception 'scan a barcode or describe the returned item'; end if;

  if v_registry.id is not null then
    v_units := v_packages * greatest(coalesce(v_registry.units_per_barcode,1),1);
    v_location := coalesce(
      nullif(trim(coalesce(p_target_location,'')),''),
      nullif(trim(coalesce(v_registry.fixed_shelf,'')),''),
      (select nullif(trim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where c.sku=v_registry.sku limit 1),
      (select nullif(trim(coalesce(pp.default_shelf,'')),'') from public.ecoflow_sku_package_policies pp where pp.sku=v_registry.sku limit 1)
    );
  else
    v_units := v_packages;
    v_location := nullif(trim(coalesce(p_target_location,'')),'');
  end if;

  if v_action='RESTOCK' and v_location is null then raise exception 'restock location is required'; end if;

  if v_action='RESTOCK' then
    insert into public.ecoflow_inventory_movements(sku,product_name,movement_type,quantity,to_location,reference_type,reference_id,action_note,source,moved_by,moved_at)
    values(v_registry.sku,v_registry.product_name,'RETURN_IN',v_units,v_location,'DELIVERY_RETURN',p_exception_id::text,nullif(trim(coalesce(p_note,'')),''),'RETURN_INSPECTION',auth.uid(),now())
    returning id into v_movement;
  end if;

  insert into public.ecoflow_delivery_return_inspection_lines(exception_id,resolution,barcode,sku,product_name,package_level,qty_packages,units_per_package,units_processed,target_location,movement_id,manual_item,inspection_note,inspected_by)
  values(p_exception_id,v_action,nullif(trim(coalesce(p_barcode,'')),''),v_registry.sku,v_registry.product_name,v_registry.package_level,v_packages,greatest(coalesce(v_registry.units_per_barcode,1),1),v_units,v_location,v_movement,nullif(trim(coalesce(p_manual_item,'')),''),nullif(trim(coalesce(p_note,'')),''),coalesce(nullif(trim(coalesce(p_inspected_by,'')),''),'Warehouse'))
  returning id into v_line;

  update public.ecoflow_delivery_exceptions set return_status='INSPECTION_HOLD' where id=p_exception_id;

  return query select l.id,l.resolution,l.sku,l.units_processed,l.target_location,l.movement_id,l.inspected_at
  from public.ecoflow_delivery_return_inspection_lines l where l.id=v_line;
end;
$$;

grant execute on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text) to anon, authenticated;

create or replace function public.ecoflow_complete_return_inspection(
  p_exception_id uuid,
  p_note text default null,
  p_inspected_by text default null
)
returns table (exception_id uuid,return_code text,return_status text,inspection_lines numeric,completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_distinct integer;
  v_resolution text;
begin
  select count(*),count(distinct resolution) into v_count,v_distinct
  from public.ecoflow_delivery_return_inspection_lines where exception_id=p_exception_id;
  if v_count=0 then raise exception 'record at least one inspected item before completion'; end if;

  if v_distinct>1 then v_resolution:='MIXED_RESOLUTION';
  else
    select case resolution when 'RESTOCK' then 'RESTOCKED' when 'SUPPLIER_CLAIM' then 'SUPPLIER_CLAIM' else 'DISPOSED' end
    into v_resolution from public.ecoflow_delivery_return_inspection_lines where exception_id=p_exception_id limit 1;
  end if;

  update public.ecoflow_delivery_exceptions
  set return_status=v_resolution,
      inspection_note=coalesce(nullif(trim(coalesce(p_note,'')),''),inspection_note),
      inspection_completed_by=coalesce(nullif(trim(coalesce(p_inspected_by,'')),''),'Warehouse'),
      inspection_completed_at=now()
  where id=p_exception_id;

  insert into public.ecoflow_delivery_return_scans(exception_id,return_code,scan_action,warehouse_location,scan_note,scanned_by,scanned_at)
  select id,coalesce(return_code,'NO-RET-CODE'),v_resolution,warehouse_location,nullif(trim(coalesce(p_note,'')),''),coalesce(nullif(trim(coalesce(p_inspected_by,'')),''),'Warehouse'),now()
  from public.ecoflow_delivery_exceptions where id=p_exception_id;

  return query select e.id,e.return_code,e.return_status,v_count::numeric,e.inspection_completed_at
  from public.ecoflow_delivery_exceptions e where e.id=p_exception_id;
end;
$$;

grant execute on function public.ecoflow_complete_return_inspection(uuid,text,text) to anon, authenticated;

drop view if exists public.v_ecoflow_warehouse_return_zones cascade;
create view public.v_ecoflow_warehouse_return_zones as
select id,zone_code,zone_name,warehouse_location,active,created_at,updated_at
from public.ecoflow_warehouse_return_zones
where active
order by created_at;
grant select on public.v_ecoflow_warehouse_return_zones to anon, authenticated;

drop view if exists public.v_ecoflow_return_inspection_lines cascade;
create view public.v_ecoflow_return_inspection_lines as
select l.id,l.exception_id,e.return_code,e.store_name,e.order_number,l.resolution,l.barcode,l.sku,l.product_name,l.package_level,l.qty_packages,l.units_processed,l.target_location,l.movement_id,l.manual_item,l.inspection_note,l.inspected_by,l.inspected_at
from public.ecoflow_delivery_return_inspection_lines l
join public.ecoflow_delivery_exceptions e on e.id=l.exception_id
order by l.inspected_at desc;
grant select on public.v_ecoflow_return_inspection_lines to anon, authenticated;

drop view if exists public.v_ecoflow_open_delivery_returns cascade;
create view public.v_ecoflow_open_delivery_returns as
select
  id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,expected_cartons,delivered_cartons,return_cartons,reason,driver_note,return_code,return_status,warehouse_location,recorded_by,recorded_at,
  warehouse_received_by,warehouse_received_at,driver_return_zone_code,driver_returned_by,driver_returned_at,inspection_note,
  case
    when return_status='WITH_DRIVER' then 'DRIVER_SCAN_RETURN_ZONE'
    when return_status in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE') then 'INSPECT_NEXT_SHIFT'
    when return_status='INSPECTION_HOLD' then 'FINISH_INSPECTION'
    else return_status
  end as warehouse_action
from public.ecoflow_delivery_exceptions
where return_code is not null and return_status in ('WITH_DRIVER','DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD')
order by case when return_status='WITH_DRIVER' then 0 when return_status='DROPPED_IN_RETURN_ZONE' then 1 else 2 end,recorded_at desc;
grant select on public.v_ecoflow_open_delivery_returns to anon, authenticated;

notify pgrst, 'reload schema';
