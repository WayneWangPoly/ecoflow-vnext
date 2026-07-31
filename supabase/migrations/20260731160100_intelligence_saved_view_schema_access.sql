-- INTEL-PER-001 follow-up: permit authenticated callers to resolve the
-- analytics Saved View RPCs without exposing any table privileges.

begin;

do $preflight$
begin
  if to_regnamespace('analytics') is null
     or to_regprocedure('analytics.get_intelligence_saved_views(text)') is null
     or to_regprocedure('analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text)') is null then
    raise exception 'INTELLIGENCE_SAVED_VIEW_SCHEMA_ACCESS_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

revoke all on schema analytics from public,anon;
grant usage on schema analytics to authenticated;

-- Table access remains explicitly unavailable; only the two security-definer
-- RPCs granted by the preceding migration are callable by authenticated users.
revoke all on analytics.intelligence_saved_view from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
