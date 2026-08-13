-- TRANSFORM-007B production release repair: source-owned data is read-only to
-- browser roles at the PostgreSQL privilege layer, not merely by UI discipline
-- or row-level policies.
--
-- The protected production diagnostic found 25 matching base tables where anon
-- and/or authenticated retained mutation-capable grants. Some exposed full
-- INSERT/UPDATE/DELETE; the rest still exposed TRUNCATE/TRIGGER/MAINTAIN. RLS
-- cannot make TRUNCATE safe because TRUNCATE is not a row-level operation.
--
-- Preserve SELECT and service_role authority. Remove only browser mutation and
-- schema-maintenance privileges from the current source-owned relation set.
-- Future source-table migrations are required to satisfy the same contract.

begin;

do $harden$
declare
  r record;
begin
  for r in
    select n.nspname,c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and (
        c.relname='ecoflow_store_sites'
        or left(c.relname,length('ordermentum_'))='ordermentum_'
        or left(c.relname,length('om_'))='om_'
        or left(c.relname,length('qbo_'))='qbo_'
        or left(c.relname,length('quickbooks_'))='quickbooks_'
      )
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on table %I.%I from anon, authenticated',
      r.nspname,r.relname
    );
  end loop;
end;
$harden$;

-- Fail the migration itself if any browser mutation capability survives. Check
-- table and column grants separately because a column-level UPDATE/INSERT grant
-- can remain even after a historical table-level grant changed.
do $verify$
declare
  v_open bigint;
  v_role text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    select count(*) into v_open
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and (
        c.relname='ecoflow_store_sites'
        or left(c.relname,length('ordermentum_'))='ordermentum_'
        or left(c.relname,length('om_'))='om_'
        or left(c.relname,length('qbo_'))='qbo_'
        or left(c.relname,length('quickbooks_'))='quickbooks_'
      )
      and (
        has_table_privilege(v_role,c.oid,'INSERT')
        or has_table_privilege(v_role,c.oid,'UPDATE')
        or has_table_privilege(v_role,c.oid,'DELETE')
        or has_table_privilege(v_role,c.oid,'TRUNCATE')
        or has_table_privilege(v_role,c.oid,'REFERENCES')
        or has_table_privilege(v_role,c.oid,'TRIGGER')
        or has_table_privilege(v_role,c.oid,'MAINTAIN')
        or has_any_column_privilege(v_role,c.oid,'INSERT')
        or has_any_column_privilege(v_role,c.oid,'UPDATE')
        or has_any_column_privilege(v_role,c.oid,'REFERENCES')
      );

    if v_open<>0 then
      raise exception 'TRANSFORM_007B_SOURCE_AUTHORITY_HARDENING_INCOMPLETE:%:%',v_role,v_open;
    end if;
  end loop;
end;
$verify$;

commit;
