\set ON_ERROR_STOP on

-- Reproduce the production state observed by the 2026-07-28 shadow gate:
-- return tables and inspection functions exist, but the geofence archive was
-- never part of the timestamped deployment history, leaving the four-argument
-- driver drop function active.

drop function if exists public.ecoflow_driver_drop_return(
  uuid,text,text,text,double precision,double precision,numeric
);

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
  select *
  into v_zone
  from public.ecoflow_warehouse_return_zones
  where upper(zone_code) = upper(btrim(coalesce(p_zone_code, '')))
    and active
  limit 1;

  if v_zone.id is null then
    raise exception 'This is not an active EcoFlow returns-zone code';
  end if;

  select *
  into v_exception
  from public.ecoflow_delivery_exceptions
  where id = p_exception_id
  for update;

  if v_exception.id is null then
    raise exception 'return item not found';
  end if;

  if v_exception.return_status <> 'WITH_DRIVER' then
    raise exception 'return is not currently with driver';
  end if;

  update public.ecoflow_delivery_exceptions
  set return_status = 'DROPPED_IN_RETURN_ZONE',
      warehouse_location = v_zone.warehouse_location,
      driver_return_zone_code = v_zone.zone_code,
      driver_returned_by = coalesce(
        nullif(btrim(coalesce(p_driver, '')), ''),
        'Driver'
      ),
      driver_returned_at = clock_timestamp(),
      inspection_note = coalesce(
        nullif(btrim(coalesce(p_note, '')), ''),
        inspection_note
      )
  where id = p_exception_id;

  return query
  select
    e.id,
    e.return_code,
    e.store_name,
    e.order_number,
    e.return_cartons,
    e.return_status,
    e.warehouse_location,
    e.driver_returned_at
  from public.ecoflow_delivery_exceptions e
  where e.id = p_exception_id;
end;
$$;

grant execute on function public.ecoflow_driver_drop_return(
  uuid,text,text,text
) to anon, authenticated;

do $assert_drift$
begin
  if to_regprocedure(
    'public.ecoflow_driver_drop_return(uuid,text,text,text)'
  ) is null then
    raise exception 'four-argument production drift fixture was not created';
  end if;

  if to_regprocedure(
    'public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)'
  ) is not null then
    raise exception 'seven-argument geofence function still exists in drift fixture';
  end if;
end;
$assert_drift$;
