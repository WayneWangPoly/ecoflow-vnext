-- Test-only observability for the production-shaped legacy primitives.
-- These relations exist only in the CI fixture and are never created in product migrations.
grant select on public.ecoflow_test_notification_calls to authenticated;
grant select on public.ecoflow_test_exception_calls to authenticated;
grant select on public.ecoflow_test_location_calls to authenticated;
grant select on public.ecoflow_test_departure_calls to authenticated;
