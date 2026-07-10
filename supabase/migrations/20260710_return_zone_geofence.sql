-- Enforce physical warehouse proximity for the fixed Returns Area scan.
-- QR/barcode proves the driver scanned the physical sign; GPS proves the phone is within 500 metres.

alter table public.ecoflow_warehouse_return_zones add column if not exists latitude double precision;
alter table public.ecoflow_warehouse_return_zones add column if not exists longitude double precision;
alter table public.ecoflow_warehouse_return_zones add column if not exists radius_metres numeric not null default 500;

update public.ecoflow_warehouse_return_zones
set latitude = -34.8746,
    longitude = 138.5626,
    radius_metres = 500,
    updated_at = now()
where zone_code = 'ECOFLOW-RETURNS-ZONE-01';

alter table public.ecoflow_delivery_exceptions add column if not exists driver_return_latitude double precision;
alter table public.ecoflow_delivery_exceptions add column if not exists driver_return_longitude double precision;
alter table public.ecoflow_delivery_exceptions add column if not exists driver_return_accuracy_metres numeric;
alter table public.ecoflow_delivery_exceptions add column if not exists driver_return_distance_metres numeric;

drop function if exists public.ecoflow_driver_drop_return(uuid,text,text,text);

create or replace function public.ecoflow_driver_drop_return(
  p_exception_id uuid,
  p_zone_code text,
  p_note text default null,
  p_driver text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_metres numeric default null
)
returns table (
  exception_id uuid,
  return_code text,
  store_name text,
  order_number text,
  return_cartons numeric,
  return_status text,
  warehouse_location text,
  driver_returned_at timestamptz,
  distance_metres numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone public.ecoflow_warehouse_return_zones%rowtype;
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_distance double precision;
begin
  select * into v_zone
  from public.ecoflow_warehouse_return_zones
  where upper(zone_code) = upper(trim(coalesce(p_zone_code,''))) and active
  limit 1;

  if v_zone.id is null then
    raise exception 'This is not an active EcoFlow returns-zone code';
  end if;

  if v_zone.latitude is null or v_zone.longitude is null then
    raise exception 'Returns-zone coordinates are not configured';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'Phone location is required to confirm warehouse return';
  end if;

  if p_accuracy_metres is null or p_accuracy_metres > 200 then
    raise exception 'Location signal is too weak. Move outside or near the warehouse entrance and try again';
  end if;

  v_distance := 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_latitude - v_zone.latitude) / 2), 2) +
    cos(radians(v_zone.latitude)) * cos(radians(p_latitude)) *
    power(sin(radians(p_longitude - v_zone.longitude) / 2), 2)
  ));

  if v_distance > coalesce(v_zone.radius_metres, 500) then
    raise exception 'Return scan rejected: phone is % metres from the warehouse return zone; maximum is % metres', round(v_distance::numeric), round(coalesce(v_zone.radius_metres,500));
  end if;

  select * into v_exception
  from public.ecoflow_delivery_exceptions
  where id = p_exception_id
  for update;

  if v_exception.id is null then raise exception 'return item not found'; end if;
  if v_exception.return_status <> 'WITH_DRIVER' then raise exception 'return is not currently with driver'; end if;

  update public.ecoflow_delivery_exceptions
  set return_status = 'DROPPED_IN_RETURN_ZONE',
      warehouse_location = v_zone.warehouse_location,
      driver_return_zone_code = v_zone.zone_code,
      driver_returned_by = coalesce(nullif(trim(coalesce(p_driver,'')),''),'Driver'),
      driver_returned_at = now(),
      driver_return_latitude = p_latitude,
      driver_return_longitude = p_longitude,
      driver_return_accuracy_metres = p_accuracy_metres,
      driver_return_distance_metres = round(v_distance::numeric, 1),
      inspection_note = coalesce(nullif(trim(coalesce(p_note,'')),''), inspection_note)
  where id = p_exception_id;

  insert into public.ecoflow_delivery_return_scans(exception_id,return_code,scan_action,warehouse_location,scan_note,scanned_by,scanned_at)
  values (
    p_exception_id,
    coalesce(v_exception.return_code,'NO-RET-CODE'),
    'DRIVER_ZONE_DROP',
    v_zone.warehouse_location,
    concat_ws(' · ', nullif(trim(coalesce(p_note,'')),''), format('GPS %.1fm from zone; accuracy %.1fm',v_distance,p_accuracy_metres)),
    coalesce(nullif(trim(coalesce(p_driver,'')),''),'Driver'),
    now()
  );

  return query
  select e.id,e.return_code,e.store_name,e.order_number,e.return_cartons,e.return_status,e.warehouse_location,e.driver_returned_at,e.driver_return_distance_metres
  from public.ecoflow_delivery_exceptions e
  where e.id = p_exception_id;
end;
$$;

grant execute on function public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric) to anon, authenticated;

drop view if exists public.v_ecoflow_warehouse_return_zones cascade;
create view public.v_ecoflow_warehouse_return_zones as
select id,zone_code,zone_name,warehouse_location,latitude,longitude,radius_metres,active,created_at,updated_at
from public.ecoflow_warehouse_return_zones
where active
order by created_at;

grant select on public.v_ecoflow_warehouse_return_zones to anon, authenticated;

notify pgrst, 'reload schema';
