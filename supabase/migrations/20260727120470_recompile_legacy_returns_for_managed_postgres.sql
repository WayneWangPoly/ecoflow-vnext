-- Recompile the legacy delivery-return implementations with a per-function
-- PL/pgSQL compiler directive before SEC-DB-002 renames and wraps them.
--
-- Supabase's managed migration role cannot set the superuser-only
-- plpgsql.variable_conflict server parameter through ALTER FUNCTION. The
-- #variable_conflict directive is part of each function body instead, so the
-- original use-column resolution is preserved without requiring elevated
-- database privileges.

begin;

do $managed_plpgsql_compat$
declare
  v_signature text;
  v_oid oid;
  v_definition text;
  v_delimiter text;
  v_anchor text;
  v_position integer;
  v_recompiled text;
begin
  foreach v_signature in array array[
    'public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return(text,text,text,text)',
    'public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection(uuid,text,text)'
  ]
  loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'RETURNS_MANAGED_POSTGRES_FUNCTION_MISSING: %', v_signature;
    end if;

    select pg_get_functiondef(v_oid)
    into v_definition;

    if position('#variable_conflict use_column' in v_definition) > 0 then
      continue;
    end if;

    select (regexp_match(
      v_definition,
      E'AS (\\$[A-Za-z0-9_]*\\$)\\n'
    ))[1]
    into v_delimiter;

    if v_delimiter is null then
      raise exception 'RETURNS_MANAGED_POSTGRES_BODY_DELIMITER_NOT_FOUND: %', v_signature;
    end if;

    v_anchor := 'AS ' || v_delimiter || E'\n';
    v_position := strpos(v_definition, v_anchor);
    if v_position = 0 then
      raise exception 'RETURNS_MANAGED_POSTGRES_BODY_ANCHOR_NOT_FOUND: %', v_signature;
    end if;

    v_recompiled := overlay(
      v_definition
      placing v_anchor || '#variable_conflict use_column' || E'\n'
      from v_position
      for char_length(v_anchor)
    );

    execute v_recompiled;

    select pg_get_functiondef(v_oid)
    into v_definition;
    if position('#variable_conflict use_column' in v_definition) = 0 then
      raise exception 'RETURNS_MANAGED_POSTGRES_RECOMPILE_FAILED: %', v_signature;
    end if;
  end loop;
end;
$managed_plpgsql_compat$;

notify pgrst, 'reload schema';

commit;
