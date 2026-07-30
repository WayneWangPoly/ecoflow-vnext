-- INTEL-DATA-004D: role-aware lifecycle access envelope.
--
-- The lifecycle row RPC cannot communicate capability when no ledger row exists.
-- This bounded one-row RPC exposes server-authoritative access metadata without
-- fabricating an exception record or reading/writing operational state.

begin;

do $preflight$
begin
  if to_regprocedure('analytics.ecoflow_can_read_actionable_exceptions()') is null
     or to_regprocedure('analytics.ecoflow_can_write_actionable_exception_lifecycle()') is null
     or to_regprocedure('analytics.get_actionable_exception_lifecycle(text[],integer)') is null
     or to_regprocedure(
       'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)'
     ) is null then
    raise exception 'ACTIONABLE_EXCEPTION_LIFECYCLE_ACCESS_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

create or replace function analytics.get_actionable_exception_lifecycle_access()
returns table(
  access_version integer,
  lifecycle_capability text,
  ownership_capability text,
  action_capability text,
  history_capability text,
  command_actions text[],
  command_id_required boolean,
  max_read_ids integer,
  max_read_rows integer,
  max_history_events integer,
  max_snooze_days integer,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_can_write boolean;
begin
  if not analytics.ecoflow_can_read_actionable_exceptions() then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED';
  end if;

  v_can_write := analytics.ecoflow_can_write_actionable_exception_lifecycle();

  return query select
    1::integer as access_version,
    'AVAILABLE'::text as lifecycle_capability,
    'AVAILABLE'::text as ownership_capability,
    case when v_can_write then 'AVAILABLE' else 'READ_ONLY' end::text
      as action_capability,
    'AVAILABLE'::text as history_capability,
    case
      when v_can_write then array[
        'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE',
        'RESOLVE','REOPEN','ADD_NOTE'
      ]::text[]
      else array[]::text[]
    end as command_actions,
    true::boolean as command_id_required,
    300::integer as max_read_ids,
    300::integer as max_read_rows,
    50::integer as max_history_events,
    30::integer as max_snooze_days,
    statement_timestamp() as read_at;
end;
$$;

revoke all on function analytics.get_actionable_exception_lifecycle_access()
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_actionable_exception_lifecycle_access()
  to authenticated;

comment on function analytics.get_actionable_exception_lifecycle_access() is
  'One-row server-authoritative lifecycle access envelope. Returns AVAILABLE actions for active Owner/Admin/Account and READ_ONLY with no command actions for active Viewer, including when no lifecycle rows exist.';

notify pgrst,'reload schema';

commit;
