-- Recompile the legacy delivery-return implementations with a per-function
-- PL/pgSQL compiler directive before SEC-DB-002 renames and wraps them.
--
-- Supabase's managed migration role cannot set the superuser-only
-- plpgsql.variable_conflict server parameter through ALTER FUNCTION. The
-- #variable_conflict directive is part of each function body instead, so the
-- original use-column resolution is preserved without requiring elevated
-- database privileges.
--
-- pg_get_functiondef() preserves whether the stored function body starts with
-- a newline. Production contains compact bodies where code begins immediately
-- after the dollar-quote delimiter, while historical fixtures contain a leading
-- newline. Match the AS + dollar-quote marker without assuming either layout.

begin;

do $managed_plpgsql_compat$
declare
  v_signature text;
  v_oid oid;
  v_definition text;
  v_marker_match text[];
  v_body_marker text;
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

    select regexp_match(
      v_definition,
      E'(AS[[:space:]]+(\\$[A-Za-z0-9_]*\\$))'
    )
    into v_marker_match;

    v_body_marker := v_marker_match[1];
    if v_body_marker is null then
      raise exception 'RETURNS_MANAGED_POSTGRES_BODY_DELIMITER_NOT_FOUND: %', v_signature;
    end if;

    v_position := strpos(v_definition, v_body_marker);
    if v_position = 0 then
      raise exception 'RETURNS_MANAGED_POSTGRES_BODY_ANCHOR_NOT_FOUND: %', v_signature;
    end if;

    v_recompiled := overlay(
      v_definition
      placing v_body_marker || E'\n#variable_conflict use_column\n'
      from v_position
      for char_length(v_body_marker)
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
