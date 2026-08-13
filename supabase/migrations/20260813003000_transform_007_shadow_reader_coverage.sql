-- TRANSFORM-007 release bootstrap: keep the dedicated production-schema reader
-- able to take schema-only snapshots after new application tables are deployed.
--
-- The trusted shadow gate already proves that ecoflow_shadow_read is a dedicated
-- default-read-only role with zero detected persistent mutation capability. 007B
-- introduced ecoflow_account_hold_commands after the reader was provisioned;
-- pg_dump --schema-only therefore failed before the 007B repair candidate could
-- be evaluated because the reader could not take ACCESS SHARE on that new table.
--
-- This migration restores the intended schema-reader coverage without granting
-- any INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/MAINTAIN/schema-CREATE capability.
-- It also applies the same SELECT coverage to future tables created by the
-- migration role, preventing 007C or later forward migrations from repeating the
-- same bootstrap failure. Environments without the external reader role no-op.

begin;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'ecoflow_shadow_read') then
    grant usage on schema public to ecoflow_shadow_read;
    grant select on all tables in schema public to ecoflow_shadow_read;
    alter default privileges in schema public
      grant select on tables to ecoflow_shadow_read;

    if exists (select 1 from pg_catalog.pg_namespace where nspname = 'analytics') then
      grant usage on schema analytics to ecoflow_shadow_read;
      grant select on all tables in schema analytics to ecoflow_shadow_read;
      alter default privileges in schema analytics
        grant select on tables to ecoflow_shadow_read;
    end if;
  end if;
end
$$;

commit;
