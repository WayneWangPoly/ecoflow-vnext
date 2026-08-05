-- Production hotfix: the browser already calls bounded RPCs in the governed
-- analytics schema, but PostgREST was configured to expose only its previous
-- schema list. That mismatch returns PGRST106 before function permissions or
-- role checks can run.
--
-- Preserve the effective schema list and append analytics at the same setting
-- scope. A database-specific authenticator setting overrides the cluster-wide
-- setting, so changing the wrong scope would appear successful while leaving
-- production broken.

begin;

do $expose_analytics$
declare
  v_current text;
  v_next text;
  v_database_oid oid;
  v_database_specific boolean := false;
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'authenticator'
  ) then
    raise exception 'POSTGREST_AUTHENTICATOR_ROLE_MISSING';
  end if;

  select oid
    into v_database_oid
  from pg_catalog.pg_database
  where datname = current_database();

  select
    substring(setting from length('pgrst.db_schemas=') + 1),
    role_setting.setdatabase = v_database_oid
    into v_current, v_database_specific
  from pg_catalog.pg_db_role_setting role_setting
  join pg_catalog.pg_roles role_row
    on role_row.oid = role_setting.setrole
  cross join lateral unnest(role_setting.setconfig) as config(setting)
  where role_row.rolname = 'authenticator'
    and role_setting.setdatabase in (0, v_database_oid)
    and setting like 'pgrst.db_schemas=%'
  order by
    case when role_setting.setdatabase = v_database_oid then 0 else 1 end
  limit 1;

  if nullif(btrim(v_current), '') is null then
    v_current := 'public';
    if to_regnamespace('graphql_public') is not null then
      v_current := v_current || ',graphql_public';
    end if;
  end if;

  if exists (
    select 1
    from unnest(regexp_split_to_array(v_current, '\s*,\s*')) schema_name
    where lower(btrim(schema_name, ' "')) = 'analytics'
  ) then
    v_next := v_current;
  else
    v_next := v_current || ',analytics';
  end if;

  if v_database_specific then
    execute format(
      'alter role authenticator in database %I set pgrst.db_schemas = %L',
      current_database(),
      v_next
    );
  else
    execute format(
      'alter role authenticator set pgrst.db_schemas = %L',
      v_next
    );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_db_role_setting role_setting
    join pg_catalog.pg_roles role_row
      on role_row.oid = role_setting.setrole
    cross join lateral unnest(role_setting.setconfig) as config(setting)
    where role_row.rolname = 'authenticator'
      and role_setting.setdatabase = case
        when v_database_specific then v_database_oid
        else 0
      end
      and setting like 'pgrst.db_schemas=%'
      and exists (
        select 1
        from unnest(
          regexp_split_to_array(
            substring(setting from length('pgrst.db_schemas=') + 1),
            '\s*,\s*'
          )
        ) schema_name
        where lower(btrim(schema_name, ' "')) = 'analytics'
      )
  ) then
    raise exception 'POSTGREST_ANALYTICS_SCHEMA_EXPOSURE_NOT_PERSISTED';
  end if;
end;
$expose_analytics$;

grant usage on schema analytics to authenticated, service_role;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
