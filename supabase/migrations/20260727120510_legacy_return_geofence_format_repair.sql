-- Repair the historical return-zone implementation without editing its deployed migration.
-- PostgreSQL format() supports %s, not printf-style %.1f.

begin;

do $repair_geofence_format$
declare
  v_signature regprocedure := to_regprocedure(
    'public.ecoflow_driver_drop_return_acl_impl(uuid,text,text,text,double precision,double precision,numeric)'
  );
  v_definition text;
  v_repaired text;
begin
  if v_signature is null then
    raise exception 'RETURN_GEOFENCE_IMPL_MISSING';
  end if;

  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  if position(
    'format(''GPS %.1fm from zone; accuracy %.1fm'',v_distance,p_accuracy_metres)'
    in v_definition
  ) = 0 then
    if position(
      'format(''GPS %s m from zone; accuracy %s m'',round(v_distance::numeric,1),round(p_accuracy_metres::numeric,1))'
      in v_definition
    ) > 0 then
      return;
    end if;

    raise exception 'RETURN_GEOFENCE_FORMAT_PATTERN_NOT_FOUND';
  end if;

  v_repaired := replace(
    v_definition,
    'format(''GPS %.1fm from zone; accuracy %.1fm'',v_distance,p_accuracy_metres)',
    'format(''GPS %s m from zone; accuracy %s m'',round(v_distance::numeric,1),round(p_accuracy_metres::numeric,1))'
  );

  execute v_repaired;
end;
$repair_geofence_format$;

alter function public.ecoflow_driver_drop_return_acl_impl(
  uuid,text,text,text,double precision,double precision,numeric
) set search_path = pg_catalog, public;
alter function public.ecoflow_driver_drop_return_acl_impl(
  uuid,text,text,text,double precision,double precision,numeric
) set plpgsql.variable_conflict = use_column;
revoke all on function public.ecoflow_driver_drop_return_acl_impl(
  uuid,text,text,text,double precision,double precision,numeric
) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
