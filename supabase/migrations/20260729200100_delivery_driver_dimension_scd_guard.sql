-- INTEL-DATA-004 follow-up: preserve Driver SCD history when the delivery
-- refresh observes a later display-name change.
--
-- The main delivery refresh predates this guard and performs a normal UPDATE on
-- the current Driver dimension. This analytics-only AFTER UPDATE trigger turns a
-- later name change into SCD history: the original dimension ID is restored and
-- closed, then a new current dimension row is inserted. Facts already pointing
-- at the original ID therefore retain their historical interpretation.
--
-- The version boundary uses the Driver source timestamp rather than the generic
-- updated_at column, which may be replaced by database clock-time maintenance.
-- Same-effective-instant corrections remain in-place. No operational table,
-- Driver workflow or fact refresh is invoked by this migration.

begin;

do $preflight$
begin
  if to_regclass('analytics.dim_driver') is null
     or to_regclass('analytics.fact_delivery_route_observation') is null then
    raise exception 'DELIVERY_DRIVER_SCD_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

create or replace function analytics.ecoflow_version_driver_dimension_name_change()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,analytics
as $$
declare
  v_change_at timestamptz := coalesce(
    new.source_updated_at,
    new.updated_at,
    clock_timestamp()
  );
  v_new_display_name text := new.display_name;
  v_new_active boolean := new.active;
  v_new_source_updated_at timestamptz := new.source_updated_at;
begin
  if pg_trigger_depth()>1
     or not old.is_current
     or new.display_name is not distinct from old.display_name then
    return new;
  end if;

  -- A correction made at or before the current effective instant does not
  -- manufacture another history row.
  if v_change_at<=old.effective_from then
    return new;
  end if;

  -- Restore the historical row under its original dimension ID and close it.
  update analytics.dim_driver d
  set display_name=old.display_name,
      active=old.active,
      source_updated_at=old.source_updated_at,
      effective_from=old.effective_from,
      effective_to=v_change_at,
      is_current=false,
      recorded_by=old.recorded_by,
      updated_at=v_change_at
  where d.driver_dimension_id=new.driver_dimension_id;

  insert into analytics.dim_driver(
    source_system,source_driver_key,display_name,active,effective_from,effective_to,
    is_current,source_updated_at,recorded_by
  ) values(
    old.source_system,old.source_driver_key,v_new_display_name,v_new_active,
    v_change_at,null,true,v_new_source_updated_at,
    'analytics.ecoflow_version_driver_dimension_name_change'
  );

  return new;
end;
$$;

revoke all on function analytics.ecoflow_version_driver_dimension_name_change()
  from public,anon,authenticated,service_role;

drop trigger if exists version_driver_dimension_name_change
  on analytics.dim_driver;
create trigger version_driver_dimension_name_change
after update of display_name on analytics.dim_driver
for each row execute function analytics.ecoflow_version_driver_dimension_name_change();

comment on function analytics.ecoflow_version_driver_dimension_name_change() is
  'Analytics-only SCD guard. Later Driver display-name changes use source_updated_at to close the old dimension and create a new current version without rewriting historical fact meaning.';
comment on trigger version_driver_dimension_name_change on analytics.dim_driver is
  'Preserves Driver dimension history for delivery-route observations.';

notify pgrst,'reload schema';

commit;
