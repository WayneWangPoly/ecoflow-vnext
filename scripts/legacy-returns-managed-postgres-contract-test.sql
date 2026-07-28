\set ON_ERROR_STOP on

begin;

do $managed_postgres_contract$
declare
  v_signature text;
  v_oid oid;
  v_source text;
  v_config text[];
begin
  foreach v_signature in array array[
    'public.ecoflow_queue_delivery_notifications_acl_impl(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception_acl_impl(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return_acl_impl(text,text,text,text)',
    'public.ecoflow_driver_drop_return_acl_impl(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item_acl_impl(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection_acl_impl(uuid,text,text)'
  ]
  loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'managed PostgreSQL implementation is missing: %', v_signature;
    end if;

    select prosrc, proconfig
    into v_source, v_config
    from pg_proc
    where oid = v_oid;

    if left(ltrim(v_source), length('#variable_conflict use_column'))
       <> '#variable_conflict use_column' then
      raise exception 'implementation is missing the per-function compiler directive: %', v_signature;
    end if;

    if exists (
      select 1
      from unnest(coalesce(v_config, array[]::text[])) as setting
      where setting like 'plpgsql.variable_conflict=%'
    ) then
      raise exception 'implementation still requires a superuser-only function setting: %', v_signature;
    end if;
  end loop;
end;
$managed_postgres_contract$;

rollback;
