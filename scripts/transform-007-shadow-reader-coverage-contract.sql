\set ON_ERROR_STOP on

-- Reproduce the external dedicated-reader shape inside ephemeral CI. The role is
-- intentionally not created by the production migration itself.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='ecoflow_shadow_read') then
    create role ecoflow_shadow_read
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

create schema if not exists analytics;

drop table if exists public.ecoflow_account_hold_commands;
create table public.ecoflow_account_hold_commands(command_id uuid primary key);

-- Apply the actual forward migration under the same migration owner that creates
-- the probe tables in this PostgreSQL job.
\i supabase/migrations/20260813003000_transform_007_shadow_reader_coverage.sql

-- These objects are deliberately created after ALTER DEFAULT PRIVILEGES. They
-- prove future migration-created tables inherit schema-reader SELECT access.
drop table if exists public.transform_007_shadow_future_probe;
create table public.transform_007_shadow_future_probe(id bigint primary key);

drop table if exists analytics.transform_007_shadow_future_probe;
create table analytics.transform_007_shadow_future_probe(id bigint primary key);

do $$
declare
  rel text;
  write_priv text;
begin
  if not has_schema_privilege('ecoflow_shadow_read','public','USAGE') then
    raise exception 'shadow reader lost public schema USAGE';
  end if;
  if not has_schema_privilege('ecoflow_shadow_read','analytics','USAGE') then
    raise exception 'shadow reader lost analytics schema USAGE';
  end if;
  if has_schema_privilege('ecoflow_shadow_read','public','CREATE')
     or has_schema_privilege('ecoflow_shadow_read','analytics','CREATE') then
    raise exception 'shadow reader unexpectedly gained schema CREATE';
  end if;

  foreach rel in array array[
    'public.ecoflow_account_hold_commands',
    'public.transform_007_shadow_future_probe',
    'analytics.transform_007_shadow_future_probe'
  ] loop
    if not has_table_privilege('ecoflow_shadow_read',rel,'SELECT') then
      raise exception 'shadow reader lacks SELECT on %',rel;
    end if;

    foreach write_priv in array array[
      'INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER'
    ] loop
      if has_table_privilege('ecoflow_shadow_read',rel,write_priv) then
        raise exception 'shadow reader unexpectedly gained % on %',write_priv,rel;
      end if;
    end loop;
  end loop;
end
$$;
