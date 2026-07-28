-- INTEL-DATA-003 follow-up: resolve warehouse location dimensions on the first
-- inventory movement fact refresh.
--
-- The preceding additive migration creates facts before it seeds location
-- dimensions. No refresh is invoked during deployment, but the controlled
-- refresh must still be complete on its first call. This analytics-only trigger
-- resolves or versions the authoritative warehouse location before each
-- movement fact row is written.

begin;

do $preflight$
begin
  if to_regclass('analytics.fact_inventory_movement') is null
     or to_regclass('analytics.dim_warehouse_location') is null
     or to_regclass('public.ecoflow_warehouse_locations') is null then
    raise exception 'INVENTORY_LOCATION_DIMENSION_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

create or replace function analytics.ecoflow_ensure_warehouse_location_dimension(
  p_source_location_key text,
  p_location_code text,
  p_as_of timestamptz
)
returns bigint
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of,clock_timestamp());
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_current analytics.dim_warehouse_location%rowtype;
  v_dimension_id bigint;
  v_location_type text;
  v_match_count integer;
begin
  select l.*
  into v_location
  from public.ecoflow_warehouse_locations l
  where (
      nullif(btrim(coalesce(p_source_location_key,'')),'') is not null
      and l.id::text=btrim(p_source_location_key)
    )
    or (
      nullif(btrim(coalesce(p_source_location_key,'')),'') is null
      and nullif(btrim(coalesce(p_location_code,'')),'') is not null
      and l.location_code=btrim(p_location_code)
    )
  order by case
    when l.id::text=btrim(coalesce(p_source_location_key,'')) then 0
    else 1
  end
  limit 1;

  if not found then
    select count(*)::integer,min(d.warehouse_location_dimension_id)
    into v_match_count,v_dimension_id
    from analytics.dim_warehouse_location d
    where d.source_system='ECOFLOW'
      and d.is_current
      and d.location_code=nullif(btrim(coalesce(p_location_code,'')),'');

    if v_match_count=1 then
      return v_dimension_id;
    end if;
    return null;
  end if;

  v_location_type := case
    when v_location.bin_code is not null then 'BIN'
    when v_location.rack_id is not null then 'SHELF'
    else 'AREA'
  end;

  select d.*
  into v_current
  from analytics.dim_warehouse_location d
  where d.source_system='ECOFLOW'
    and d.source_location_key=v_location.id::text
    and d.is_current
  for update;

  if found then
    if v_current.location_code is not distinct from v_location.location_code
       and v_current.zone_code is not distinct from v_location.location_category
       and v_current.rack_code is not distinct from v_location.rack_id
       and v_current.location_type is not distinct from v_location_type
       and v_current.active is not distinct from (v_location.status='ACTIVE') then
      update analytics.dim_warehouse_location
      set source_updated_at=v_location.updated_at,
          updated_at=v_as_of
      where warehouse_location_dimension_id=
        v_current.warehouse_location_dimension_id;
      return v_current.warehouse_location_dimension_id;
    end if;

    if v_as_of<=v_current.effective_from then
      update analytics.dim_warehouse_location
      set location_code=v_location.location_code,
          zone_code=v_location.location_category,
          rack_code=v_location.rack_id,
          location_type=v_location_type,
          active=(v_location.status='ACTIVE'),
          source_updated_at=v_location.updated_at,
          updated_at=v_as_of
      where warehouse_location_dimension_id=
        v_current.warehouse_location_dimension_id
      returning warehouse_location_dimension_id into v_dimension_id;
      return v_dimension_id;
    end if;

    update analytics.dim_warehouse_location
    set effective_to=v_as_of,
        is_current=false,
        updated_at=v_as_of
    where warehouse_location_dimension_id=
      v_current.warehouse_location_dimension_id;
  end if;

  insert into analytics.dim_warehouse_location(
    source_system,source_location_key,location_code,zone_code,rack_code,
    location_type,active,effective_from,is_current,source_updated_at,recorded_by
  )
  values(
    'ECOFLOW',v_location.id::text,v_location.location_code,
    v_location.location_category,v_location.rack_id,v_location_type,
    v_location.status='ACTIVE',v_as_of,true,v_location.updated_at,
    'analytics.ecoflow_ensure_warehouse_location_dimension'
  )
  returning warehouse_location_dimension_id into v_dimension_id;

  return v_dimension_id;
end;
$$;

revoke all on function analytics.ecoflow_ensure_warehouse_location_dimension(
  text,text,timestamptz
) from public,anon,authenticated,service_role;

create or replace function analytics.ecoflow_resolve_inventory_fact_locations()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
begin
  new.from_location_dimension_id :=
    analytics.ecoflow_ensure_warehouse_location_dimension(
      new.from_location_key,new.from_location_code,new.as_of_at
    );

  new.to_location_dimension_id :=
    analytics.ecoflow_ensure_warehouse_location_dimension(
      new.to_location_key,new.to_location_code,new.as_of_at
    );

  return new;
end;
$$;

revoke all on function analytics.ecoflow_resolve_inventory_fact_locations()
  from public,anon,authenticated,service_role;

drop trigger if exists resolve_inventory_fact_locations
  on analytics.fact_inventory_movement;
create trigger resolve_inventory_fact_locations
before insert or update of
  from_location_key,from_location_code,to_location_key,to_location_code,as_of_at
on analytics.fact_inventory_movement
for each row execute function analytics.ecoflow_resolve_inventory_fact_locations();

comment on function analytics.ecoflow_ensure_warehouse_location_dimension(
  text,text,timestamptz
) is
  'Analytics-only location SCD resolver used by inventory movement fact writes. It performs no operational warehouse mutation.';
comment on trigger resolve_inventory_fact_locations
  on analytics.fact_inventory_movement is
  'Ensures the first controlled inventory refresh resolves source location dimensions.';

notify pgrst,'reload schema';

commit;
