-- INTEL-DATA-004C: distinguish lifecycle read access from command authority.
--
-- Owner/Admin/Account can read and command lifecycle state. Viewer can read the
-- same governed state but must receive READ_ONLY rather than AVAILABLE action
-- capability. Warehouse, Driver, inactive and anonymous callers remain rejected.

begin;

do $preflight$
begin
  if to_regprocedure('analytics.get_actionable_exception_lifecycle(text[],integer)') is null
     or to_regprocedure('analytics.ecoflow_can_read_actionable_exceptions()') is null
     or to_regprocedure('analytics.ecoflow_can_write_actionable_exception_lifecycle()') is null
     or to_regclass('analytics.actionable_exception_lifecycle') is null
     or to_regclass('analytics.actionable_exception_lifecycle_event') is null then
    raise exception 'ACTIONABLE_EXCEPTION_ROLE_CAPABILITY_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

create or replace function analytics.get_actionable_exception_lifecycle(
  p_exception_ids text[] default null,
  p_limit integer default 100
)
returns table(
  exception_id text,
  source_key text,
  source_kind text,
  source_status text,
  title text,
  detail text,
  detected_at timestamptz,
  handoff_workspace text,
  handoff_entity_kind text,
  handoff_entity_id text,
  lifecycle_status text,
  effective_status text,
  owner_team text,
  acknowledged_at timestamptz,
  acknowledged_by text,
  snoozed_until timestamptz,
  snooze_expired boolean,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  version bigint,
  first_recorded_at timestamptz,
  updated_at timestamptz,
  last_event_at timestamptz,
  audit_history jsonb,
  lifecycle_capability text,
  ownership_capability text,
  action_capability text,
  history_capability text,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_limit integer := coalesce(p_limit,100);
  v_id_count integer := coalesce(cardinality(p_exception_ids),0);
  v_action_capability text;
begin
  if not analytics.ecoflow_can_read_actionable_exceptions() then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED';
  end if;
  if v_limit<1 or v_limit>300 then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_LIMIT_INVALID';
  end if;
  if v_id_count>300 then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_ID_LIST_TOO_LARGE';
  end if;

  v_action_capability := case
    when analytics.ecoflow_can_write_actionable_exception_lifecycle()
      then 'AVAILABLE'
    else 'READ_ONLY'
  end;

  return query
  select
    l.exception_id,l.source_key,l.source_kind,l.source_status,l.title,l.detail,
    l.detected_at,l.handoff_workspace,l.handoff_entity_kind,l.handoff_entity_id,
    l.lifecycle_status,
    case
      when l.lifecycle_status='SNOOZED'
       and l.snoozed_until<=statement_timestamp()
      then coalesce(l.snooze_resume_status,'OPEN')
      else l.lifecycle_status
    end as effective_status,
    l.owner_team,l.acknowledged_at,
    acknowledged.email::text as acknowledged_by,
    l.snoozed_until,
    (l.lifecycle_status='SNOOZED' and l.snoozed_until<=statement_timestamp())
      as snooze_expired,
    l.resolved_at,resolved.email::text as resolved_by,l.resolution_note,
    l.version,l.first_recorded_at,l.updated_at,l.last_event_at,
    coalesce(history.audit_history,'[]'::jsonb) as audit_history,
    'AVAILABLE'::text as lifecycle_capability,
    'AVAILABLE'::text as ownership_capability,
    v_action_capability as action_capability,
    'AVAILABLE'::text as history_capability,
    statement_timestamp() as read_at
  from analytics.actionable_exception_lifecycle l
  left join auth.users acknowledged on acknowledged.id=l.acknowledged_by
  left join auth.users resolved on resolved.id=l.resolved_by
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'event_id',events.event_id,
        'command_id',events.command_id,
        'action',events.action,
        'actor_user_id',events.actor_user_id,
        'actor_role',events.actor_role,
        'actor_label',events.actor_label,
        'previous_status',events.previous_status,
        'next_status',events.next_status,
        'owner_team',events.owner_team,
        'snoozed_until',events.snoozed_until,
        'resolution_note',events.resolution_note,
        'note',events.note,
        'created_at',events.created_at
      ) order by events.created_at desc,events.event_id desc
    ) as audit_history
    from (
      select e.*
      from analytics.actionable_exception_lifecycle_event e
      where e.exception_id=l.exception_id
      order by e.created_at desc,e.event_id desc
      limit 50
    ) events
  ) history on true
  where p_exception_ids is null or l.exception_id=any(p_exception_ids)
  order by l.last_event_at desc,l.exception_id
  limit v_limit;
end;
$$;

revoke all on function analytics.get_actionable_exception_lifecycle(text[],integer)
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_actionable_exception_lifecycle(text[],integer)
  to authenticated;

comment on function analytics.get_actionable_exception_lifecycle(text[],integer) is
  'Bounded lifecycle read for desktop roles. Action capability is AVAILABLE for active Owner/Admin/Account and READ_ONLY for active Viewer; unsupported roles remain rejected.';

notify pgrst,'reload schema';

commit;
