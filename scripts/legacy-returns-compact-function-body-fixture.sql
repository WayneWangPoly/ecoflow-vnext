\set ON_ERROR_STOP on

-- Production contains legacy function sources whose first body character
-- follows the dollar-quote delimiter directly. Historical fixtures begin with
-- a newline. Reproduce the compact form on the first function that failed in
-- the production-schema shadow so the compatibility migration covers both.

do $compact_body_fixture$
declare
  v_signature text :=
    'public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)';
  v_oid oid;
  v_definition text;
  v_compact_definition text;
begin
  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'compact-body fixture function is missing: %', v_signature;
  end if;

  select pg_get_functiondef(v_oid)
  into v_definition;

  v_compact_definition := regexp_replace(
    v_definition,
    E'(AS[[:space:]]+\\$[A-Za-z0-9_]*\\$)\\n',
    E'\\1'
  );

  if v_compact_definition = v_definition then
    raise exception 'compact-body fixture could not remove the leading body newline';
  end if;

  execute v_compact_definition;

  select pg_get_functiondef(v_oid)
  into v_definition;

  if regexp_match(
    v_definition,
    E'AS[[:space:]]+\\$[A-Za-z0-9_]*\\$[^\\n\\r]'
  ) is null then
    raise exception 'compact-body fixture did not reproduce production formatting';
  end if;
end;
$compact_body_fixture$;
