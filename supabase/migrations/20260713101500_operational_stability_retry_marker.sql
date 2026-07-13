-- Retry marker for the operational stability migration release.
-- The production gate applies all still-pending migrations in order; this file
-- exists so the exact failure collector is installed before the next attempt.

begin;
notify pgrst, 'reload schema';
commit;
