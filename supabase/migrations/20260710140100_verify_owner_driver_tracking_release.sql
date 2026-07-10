-- Release verification marker for the Owner driver tracking rollout.
-- This migration intentionally fails if the preceding tracking migration was not
-- applied to the linked production project, preventing a false-success deployment.

begin;

do $$
begin
  if to_regclass('public.ecoflow_driver_location_samples') is null then
    raise exception 'OWNER_DRIVER_TRACKING_TABLE_MISSING';
  end if;
  if to_regprocedure('public.ecoflow_record_driver_location_sample(date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamp with time zone,text,text,jsonb)') is null then
    raise exception 'OWNER_DRIVER_TRACKING_RPC_MISSING';
  end if;
  if to_regclass('public.v_ecoflow_owner_driver_location_timeline') is null then
    raise exception 'OWNER_DRIVER_TRACKING_TIMELINE_VIEW_MISSING';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
