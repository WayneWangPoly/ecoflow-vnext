\set ON_ERROR_STOP on

-- Read-only production diagnostic for the 007B source-authority release gate.
-- It enumerates every source-owned relation for which PostgreSQL reports any
-- INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER capability to the authenticated role.
-- The transaction is explicitly READ ONLY and always rolled back.

begin;
set transaction read only;
set local statement_timeout='8000ms';

\pset format unaligned
\pset fieldsep '|'
\pset tuples_only off

with source_dml_open as (
  select
    n.nspname as schema_name,
    c.relname as relation_name,
    c.relkind,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    has_table_privilege('authenticated',c.oid,'INSERT') as can_insert,
    has_table_privilege('authenticated',c.oid,'UPDATE') as can_update,
    has_table_privilege('authenticated',c.oid,'DELETE') as can_delete,
    has_table_privilege('authenticated',c.oid,'TRUNCATE') as can_truncate,
    has_table_privilege('authenticated',c.oid,'TRIGGER') as can_trigger,
    has_any_column_privilege('authenticated',c.oid,'INSERT') as can_insert_column,
    has_any_column_privilege('authenticated',c.oid,'UPDATE') as can_update_column,
    coalesce(c.relacl::text,'<default-owner-only>') as relation_acl,
    coalesce((
      select string_agg(
        concat_ws(':',
          p.polname,
          p.polcmd::text,
          case when p.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end
        ),
        ',' order by p.polname
      )
      from pg_catalog.pg_policy p
      where p.polrelid=c.oid
    ),'<none>') as rls_policies
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p','v','m','f')
    and (
      c.relname='ecoflow_store_sites'
      or c.relname like 'ordermentum\_%' escape '\'
      or c.relname like 'om\_%' escape '\'
      or c.relname like 'qbo\_%' escape '\'
      or c.relname like 'quickbooks\_%' escape '\'
    )
    and (
      has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')
      or has_table_privilege('authenticated',c.oid,'TRUNCATE')
      or has_table_privilege('authenticated',c.oid,'TRIGGER')
      or has_any_column_privilege('authenticated',c.oid,'INSERT')
      or has_any_column_privilege('authenticated',c.oid,'UPDATE')
    )
)
select
  schema_name,
  relation_name,
  relkind,
  rls_enabled,
  force_rls,
  can_insert,
  can_update,
  can_delete,
  can_truncate,
  can_trigger,
  can_insert_column,
  can_update_column,
  relation_acl,
  rls_policies
from source_dml_open
order by relation_name;

with source_dml_open as (
  select c.oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p','v','m','f')
    and (
      c.relname='ecoflow_store_sites'
      or c.relname like 'ordermentum\_%' escape '\'
      or c.relname like 'om\_%' escape '\'
      or c.relname like 'qbo\_%' escape '\'
      or c.relname like 'quickbooks\_%' escape '\'
    )
    and (
      has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')
      or has_table_privilege('authenticated',c.oid,'TRUNCATE')
      or has_table_privilege('authenticated',c.oid,'TRIGGER')
      or has_any_column_privilege('authenticated',c.oid,'INSERT')
      or has_any_column_privilege('authenticated',c.oid,'UPDATE')
    )
)
select count(*) as source_dml_open_count
from source_dml_open;

-- Keep the diagnostic fail-closed so a green run can never be mistaken for a
-- release waiver. The row listing above remains in the job log/artifact.
do $$
declare v_count bigint;
begin
  select count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p','v','m','f')
    and (
      c.relname='ecoflow_store_sites'
      or c.relname like 'ordermentum\_%' escape '\'
      or c.relname like 'om\_%' escape '\'
      or c.relname like 'qbo\_%' escape '\'
      or c.relname like 'quickbooks\_%' escape '\'
    )
    and (
      has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')
      or has_table_privilege('authenticated',c.oid,'TRUNCATE')
      or has_table_privilege('authenticated',c.oid,'TRIGGER')
      or has_any_column_privilege('authenticated',c.oid,'INSERT')
      or has_any_column_privilege('authenticated',c.oid,'UPDATE')
    );
  if v_count<>0 then
    raise exception 'TRANSFORM_007B_SOURCE_DML_DIAGNOSTIC_OPEN:%',v_count;
  end if;
end
$$;

rollback;
