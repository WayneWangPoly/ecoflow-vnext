\set ON_ERROR_STOP on

-- PostgreSQL identifiers are limited to NAMEDATALEN-1 bytes (normally 63). The
-- intentionally descriptive preserved primitive names exceed that limit and are
-- truncated by PostgreSQL during ALTER FUNCTION ... RENAME. Treat the actual
-- catalog objects, signatures and ACLs as the authority rather than the source
-- spelling or NOTICE text.

do $verify$
declare
  v_oid oid;
  v_count integer;
  v_seen oid[] := '{}'::oid[];
  v_public_oid oid;
begin
  -- Notification private primitive.
  select count(*),min(p.oid) into v_count,v_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname like 'ecoflow_queue_delivery_notifications_pre_resource_%'
    and pg_catalog.oidvectortypes(p.proargtypes)=
      'text, text, text, text, integer, text, text, text, text, text, text, text, text, text';
  if v_count<>1 or v_oid is null then
    raise exception 'notification private primitive catalog identity is ambiguous/missing: count=%',v_count;
  end if;
  if has_function_privilege('authenticated',v_oid,'EXECUTE') or has_function_privilege('anon',v_oid,'EXECUTE') then
    raise exception 'notification private primitive is executable by browser roles';
  end if;
  v_seen:=array_append(v_seen,v_oid);

  -- Exception private primitive.
  select count(*),min(p.oid) into v_count,v_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname like 'ecoflow_record_delivery_exception_pre_resource_%'
    and pg_catalog.oidvectortypes(p.proargtypes)=
      'text, text, text, integer, text, text, text, numeric, numeric, numeric, text, text, text, text, text, text';
  if v_count<>1 or v_oid is null then
    raise exception 'exception private primitive catalog identity is ambiguous/missing: count=%',v_count;
  end if;
  if has_function_privilege('authenticated',v_oid,'EXECUTE') or has_function_privilege('anon',v_oid,'EXECUTE') then
    raise exception 'exception private primitive is executable by browser roles';
  end if;
  v_seen:=array_append(v_seen,v_oid);

  -- Location private primitive.
  select count(*),min(p.oid) into v_count,v_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname like 'ecoflow_record_driver_location_sample_pre_resource_%'
    and pg_catalog.oidvectortypes(p.proargtypes)=
      'date, text, double precision, double precision, numeric, numeric, numeric, text, text, uuid, timestamp with time zone, text, text, jsonb';
  if v_count<>1 or v_oid is null then
    raise exception 'location private primitive catalog identity is ambiguous/missing: count=%',v_count;
  end if;
  if has_function_privilege('authenticated',v_oid,'EXECUTE') or has_function_privilege('anon',v_oid,'EXECUTE') then
    raise exception 'location private primitive is executable by browser roles';
  end if;
  v_seen:=array_append(v_seen,v_oid);

  -- Departure private primitive.
  select count(*),min(p.oid) into v_count,v_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname like 'ecoflow_record_driver_departure_acknowledgement_pre_%'
    and pg_catalog.oidvectortypes(p.proargtypes)=
      'date, text, text, text, jsonb, boolean, text, text, text, jsonb';
  if v_count<>1 or v_oid is null then
    raise exception 'departure private primitive catalog identity is ambiguous/missing: count=%',v_count;
  end if;
  if has_function_privilege('authenticated',v_oid,'EXECUTE') or has_function_privilege('anon',v_oid,'EXECUTE') then
    raise exception 'departure private primitive is executable by browser roles';
  end if;
  v_seen:=array_append(v_seen,v_oid);

  if cardinality(v_seen)<>cardinality(array(select distinct unnest(v_seen))) then
    raise exception 'two preserved private primitive checks resolved to the same catalog object';
  end if;

  -- Public wrappers remain the only browser-facing mutation entry points.
  v_public_oid:=to_regprocedure('public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)');
  if v_public_oid is null or not has_function_privilege('authenticated',v_public_oid,'EXECUTE')
     or has_function_privilege('anon',v_public_oid,'EXECUTE') then
    raise exception 'notification public wrapper ACL is incorrect';
  end if;

  v_public_oid:=to_regprocedure('public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)');
  if v_public_oid is null or not has_function_privilege('authenticated',v_public_oid,'EXECUTE')
     or has_function_privilege('anon',v_public_oid,'EXECUTE') then
    raise exception 'exception public wrapper ACL is incorrect';
  end if;

  v_public_oid:=to_regprocedure('public.ecoflow_record_driver_location_sample(date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamp with time zone,text,text,jsonb)');
  if v_public_oid is null or not has_function_privilege('authenticated',v_public_oid,'EXECUTE')
     or has_function_privilege('anon',v_public_oid,'EXECUTE') then
    raise exception 'location public wrapper ACL is incorrect';
  end if;

  v_public_oid:=to_regprocedure('public.ecoflow_record_driver_departure_acknowledgement(date,text,text,text,jsonb,boolean,text,text,text,jsonb)');
  if v_public_oid is null or not has_function_privilege('authenticated',v_public_oid,'EXECUTE')
     or has_function_privilege('anon',v_public_oid,'EXECUTE') then
    raise exception 'departure public wrapper ACL is incorrect';
  end if;
end;
$verify$;
