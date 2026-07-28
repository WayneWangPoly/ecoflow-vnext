-- Normalise the legacy return-zone read view before SEC-DB-002 hardens it.
--
-- Production may still expose the seven-column pre-geofence view. PostgreSQL
-- cannot use CREATE OR REPLACE VIEW to insert latitude/longitude/radius before
-- the existing `active` column, because that is interpreted as a column rename.
-- Rebuild the view atomically with the final column order so SEC-DB-002 can
-- safely apply its security options and grants.

begin;

do $preflight$
begin
  if to_regclass('public.ecoflow_warehouse_return_zones') is null then
    raise exception 'RETURN_ZONE_VIEW_PREREQUISITE_TABLE_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecoflow_warehouse_return_zones'
      and column_name = 'latitude'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecoflow_warehouse_return_zones'
      and column_name = 'longitude'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecoflow_warehouse_return_zones'
      and column_name = 'radius_metres'
  ) then
    raise exception 'RETURN_ZONE_VIEW_GEOFENCE_COLUMNS_MISSING';
  end if;
end;
$preflight$;

-- Do not use CASCADE: an unexpected dependency must block deployment rather
-- than silently remove another read model.
drop view if exists public.v_ecoflow_warehouse_return_zones;

create view public.v_ecoflow_warehouse_return_zones
with (security_barrier = true, security_invoker = true)
as
select
  id,
  zone_code,
  zone_name,
  warehouse_location,
  latitude,
  longitude,
  radius_metres,
  active,
  created_at,
  updated_at
from public.ecoflow_warehouse_return_zones
where active
order by created_at;

revoke all on table public.v_ecoflow_warehouse_return_zones
  from public, anon, authenticated;
grant select on table public.v_ecoflow_warehouse_return_zones to authenticated;

comment on view public.v_ecoflow_warehouse_return_zones is
  'Geofenced return-zone read model normalised before SEC-DB-002 role hardening.';

notify pgrst, 'reload schema';

commit;
