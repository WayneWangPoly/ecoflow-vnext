-- Production migration-history baseline.
--
-- The linked EcoFlow Supabase project already records migration version 20260624
-- in supabase_migrations.schema_migrations. The original SQL file pre-dates the
-- repository-normalised migration history and is no longer available locally.
--
-- This file is intentionally a no-op. Its filename preserves the remote version
-- so `supabase db push` can reconcile local and remote history without deleting,
-- reverting, or replaying an unknown production migration.
--
-- Do not remove or rename this file.

do $$
begin
  null;
end
$$;
