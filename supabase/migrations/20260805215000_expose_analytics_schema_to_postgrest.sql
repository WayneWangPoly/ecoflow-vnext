-- Production hotfix: the browser already calls bounded RPCs in the governed
-- analytics schema, but PostgREST was configured to expose only its previous
-- schema list. That mismatch returns PGRST106 before function permissions or
-- role checks can run.
--
-- Preserve any explicitly configured schemas and append analytics. When no
-- database role override exists, retain the normal public API surface and
-- graphql_public when installed. Browser access remains controlled by the
-- existing schema/function grants and each RPC's application-role checks.

begin;

do $expose_analytics$
declare
  v_current text;
  v_next text;
  v_database_oid oid;
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

  select substring(setting from length('pgrst.db_schemas=') + 1)
    into v_current
  from pg_catalog.pg_db_role_setting role_setting
  join pg_catalog.pg_roles role_row
    on role_row.oid = role_setting.setrole
  cross join lateral unnest(role_setting.setconfig) as config(setting)
  where role_row.rolname = 'authenticator'
    and setting like 'pgrst.db_schemas=%'
  order by
    case when role_setting.setdatabase = v_database_oid then 0 else 1 end,
    role_setting.setdatabase desc
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

  execute format(
    'alter role authenticator set pgrst.db_schemas = %L',
    v_next
  );

  if not exists (
    select 1
    from pg_catalog.pg_db_role_setting role_setting
    join pg_catalog.pg_roles role_row
      on role_row.oid = role_setting.setrole
    cross join lateral unnest(role_setting.setconfig) as config(setting)
    where role_row.rolname = 'authenticator'
      and setting like 'pgrst.db_schemas=%'
      and 'analytics' = any (
        select lower(btrim(schema_name, ' "'))
        from unnest(
          regexp_split_to_array(
            substring(setting from length('pgrst.db_schemas=') + 1),
            '\s*,\s*'
          )
        ) schema_name
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
