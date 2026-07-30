-- INTEL-DATA-004B follow-up: preserve the exact result of every idempotent
-- lifecycle command so a later replay cannot leak a newer lifecycle state.

begin;

do $preflight$
begin
  if to_regclass('analytics.actionable_exception_lifecycle') is null
     or to_regclass('analytics.actionable_exception_lifecycle_event') is null
     or to_regprocedure(
       'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)'
     ) is null then
    raise exception 'ACTIONABLE_EXCEPTION_REPLAY_SNAPSHOT_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

alter table analytics.actionable_exception_lifecycle_event
  add column resulting_version bigint,
  add column resulting_acknowledged_at timestamptz,
  add column resulting_resolved_at timestamptz;

-- A normal release applies this follow-up immediately after the ledger migration,
-- before commands can exist. The bounded backfill keeps interrupted deployments
-- repairable without deleting audit events.
alter table analytics.actionable_exception_lifecycle_event
  disable trigger actionable_exception_event_immutable;

update analytics.actionable_exception_lifecycle_event e
set resulting_version=l.version,
    resulting_acknowledged_at=l.acknowledged_at,
    resulting_resolved_at=l.resolved_at
from analytics.actionable_exception_lifecycle l
where l.exception_id=e.exception_id
  and e.resulting_version is null;

alter table analytics.actionable_exception_lifecycle_event
  enable trigger actionable_exception_event_immutable;

alter table analytics.actionable_exception_lifecycle_event
  alter column resulting_version set not null,
  add constraint actionable_exception_event_resulting_version_positive
    check (resulting_version>0);

create or replace function analytics.capture_actionable_exception_event_result()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,analytics
as $$
begin
  select l.version,l.acknowledged_at,l.resolved_at
  into new.resulting_version,new.resulting_acknowledged_at,new.resulting_resolved_at
  from analytics.actionable_exception_lifecycle l
  where l.exception_id=new.exception_id;

  if new.resulting_version is null then
    raise exception using errcode='55000',
      message='ACTIONABLE_EXCEPTION_EVENT_RESULT_MISSING';
  end if;
  return new;
end;
$$;

create trigger actionable_exception_event_capture_result
before insert on analytics.actionable_exception_lifecycle_event
for each row execute function analytics.capture_actionable_exception_event_result();

revoke all on function analytics.capture_actionable_exception_event_result()
  from public,anon,authenticated,service_role;

alter function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) rename to apply_actionable_exception_lifecycle_command_unsnapshotted_20260730;

revoke all on function analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(
  uuid,text,text,text,timestamptz,text,text
) from public,anon,authenticated,service_role;

create or replace function analytics.apply_actionable_exception_lifecycle_command(
  p_command_id uuid,
  p_exception_id text,
  p_action text,
  p_owner_team text default null,
  p_snoozed_until timestamptz default null,
  p_resolution_note text default null,
  p_note text default null
)
returns table(
  exception_id text,
  lifecycle_status text,
  owner_team text,
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  version bigint,
  event_id uuid,
  command_id uuid,
  command_status text,
  event_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_raw_exception_id text := btrim(coalesce(p_exception_id,''));
  v_exception_id text;
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_owner_team text := nullif(btrim(coalesce(p_owner_team,'')),'');
  v_resolution_note text := nullif(btrim(coalesce(p_resolution_note,'')),'');
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_fingerprint text;
  v_replay analytics.actionable_exception_lifecycle_event%rowtype;
begin
  if not analytics.ecoflow_can_write_actionable_exception_lifecycle() then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED';
  end if;
  if auth.uid() is null then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_AUTHENTICATED_USER_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_COMMAND_ID_REQUIRED';
  end if;

  if upper(v_raw_exception_id) ~ '^ORDERMENTUM_ACTIVE:[A-F0-9]{32}$' then
    v_exception_id := 'ORDERMENTUM_ACTIVE:'||lower(split_part(v_raw_exception_id,':',2));
  else
    v_exception_id := v_raw_exception_id;
  end if;

  v_fingerprint := md5(concat_ws('|',
    v_exception_id,
    v_action,
    coalesce(v_owner_team,''),
    coalesce(to_char(p_snoozed_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),''),
    coalesce(v_resolution_note,''),
    coalesce(v_note,'')
  ));

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));

  select e.* into v_replay
  from analytics.actionable_exception_lifecycle_event e
  where e.command_id=p_command_id;

  if found then
    if v_replay.exception_id<>v_exception_id
       or v_replay.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',
        message='ACTIONABLE_EXCEPTION_COMMAND_ID_CONFLICT';
    end if;

    return query select
      v_replay.exception_id,
      v_replay.next_status,
      v_replay.owner_team,
      v_replay.resulting_acknowledged_at,
      v_replay.snoozed_until,
      v_replay.resulting_resolved_at,
      v_replay.resulting_version,
      v_replay.event_id,
      v_replay.command_id,
      'REPLAYED'::text,
      v_replay.created_at;
    return;
  end if;

  return query
  select r.exception_id,r.lifecycle_status,r.owner_team,r.acknowledged_at,
         r.snoozed_until,r.resolved_at,r.version,r.event_id,r.command_id,
         r.command_status,r.event_at
  from analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(
    p_command_id,p_exception_id,p_action,p_owner_team,p_snoozed_until,
    p_resolution_note,p_note
  ) r;
end;
$$;

revoke all on function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) from public,anon,authenticated,service_role;
grant execute on function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) to authenticated;

comment on function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) is
  'Idempotent lifecycle command boundary. Replays return the immutable original command result snapshot even after later lifecycle changes.';

notify pgrst,'reload schema';

commit;
