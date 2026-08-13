\set ON_ERROR_STOP on

-- Production baseline from 20260727120500_legacy_returns_acl_hardening.sql:
-- PUBLIC/anon/authenticated were first revoked from the legacy inspection RPCs,
-- then authenticated alone received EXECUTE. Model that exact starting point
-- before applying the 007C migration so the test does not inherit PostgreSQL's
-- default PUBLIC EXECUTE from freshly-created fixture functions.
revoke all on function public.ecoflow_record_return_inspection_item(
  uuid,text,text,numeric,text,text,text,text
) from public,anon,authenticated;
revoke all on function public.ecoflow_complete_return_inspection(uuid,text,text)
  from public,anon,authenticated;

grant execute on function public.ecoflow_record_return_inspection_item(
  uuid,text,text,numeric,text,text,text,text
) to authenticated;
grant execute on function public.ecoflow_complete_return_inspection(uuid,text,text)
  to authenticated;
