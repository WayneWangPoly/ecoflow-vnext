-- INTEL-DATA-004B: governed actionable-exception lifecycle ledger.
--
-- This migration adds a durable current-state ledger and append-only event ledger
-- for exceptions that have first been verified against the existing active
-- Ordermentum exception projection. It does not change operational order state,
-- infer severity/SLA/impact, or expose browser table writes.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_column text;
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions') is null then
    v_missing := array_append(v_missing,'public.v_ecoflow_ordermentum_ui_active_exceptions');
  else
    foreach v_column in array array[
      'raw_order_id','external_order_id','external_order_number',
      'external_invoice_number','order_number','invoice_number',
      'exception_type','message','status','detected_at'
    ] loop
      if not exists(
        select 1
        from pg_catalog.pg_attribute
        where attrelid='public.v_ecoflow_ordermentum_ui_active_exceptions'::regclass
          and attname=v_column
          and attnum>0
          and not attisdropped
      ) then
        v_missing := array_append(
          v_missing,
          'public.v_ecoflow_ordermentum_ui_active_exceptions.'||v_column
        );
      end if;
    end loop;
  end if;

  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;
  if to_regclass('auth.users') is null then
    v_missing := array_append(v_missing,'auth.users');
  end if;
  if to_regprocedure('analytics.ecoflow_can_read_actionable_exceptions()') is null then
    v_missing := array_append(v_missing,'analytics.ecoflow_can_read_actionable_exceptions()');
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    v_missing := array_append(v_missing,'gen_random_uuid()');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'ACTIONABLE_EXCEPTION_LIFECYCLE_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create table analytics.actionable_exception_lifecycle (
  exception_id text primary key,
  source_key text not null,
  source_kind text not null,
  source_status text,
  title text,
  detail text,
  detected_at timestamptz,
  handoff_workspace text,
  handoff_entity_kind text,
  handoff_entity_id text,
  lifecycle_status text not null default 'OPEN',
  owner_team text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  snoozed_until timestamptz,
  snooze_resume_status text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  version bigint not null default 0,
  first_recorded_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_event_at timestamptz not null default clock_timestamp(),
  constraint actionable_exception_id_format
    check (exception_id ~ '^ORDERMENTUM_ACTIVE:[a-f0-9]{32}$'),
  constraint actionable_exception_source_kind
    check (source_kind='order'),
  constraint actionable_exception_handoff_workspace
    check (handoff_workspace is null or handoff_workspace='orders'),
  constraint actionable_exception_handoff_entity
    check (
      (handoff_entity_kind is null and handoff_entity_id is null)
      or (handoff_entity_kind='order' and btrim(coalesce(handoff_entity_id,''))<>'')
    ),
  constraint actionable_exception_lifecycle_status
    check (lifecycle_status in ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')),
  constraint actionable_exception_owner_team
    check (owner_team is null or (btrim(owner_team)<>'' and length(owner_team)<=80)),
  constraint actionable_exception_snooze_state
    check (
      (
        lifecycle_status='SNOOZED'
        and snoozed_until is not null
        and snooze_resume_status in ('OPEN','ACKNOWLEDGED')
      )
      or (
        lifecycle_status<>'SNOOZED'
        and snoozed_until is null
        and snooze_resume_status is null
      )
    ),
  constraint actionable_exception_resolution_state
    check (
      (
        lifecycle_status='RESOLVED'
        and resolved_at is not null
        and resolved_by is not null
        and btrim(coalesce(resolution_note,''))<>''
      )
      or (
        lifecycle_status<>'RESOLVED'
        and resolved_at is null
        and resolved_by is null
        and resolution_note is null
      )
    ),
  constraint actionable_exception_version_nonnegative check (version>=0),
  constraint actionable_exception_time_order
    check (updated_at>=first_recorded_at and last_event_at>=first_recorded_at)
);

create index actionable_exception_lifecycle_status_idx
  on analytics.actionable_exception_lifecycle(lifecycle_status,last_event_at desc);
create index actionable_exception_lifecycle_owner_idx
  on analytics.actionable_exception_lifecycle(owner_team,last_event_at desc)
  where owner_team is not null;

create table analytics.actionable_exception_lifecycle_event (
  event_id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  exception_id text not null
    references analytics.actionable_exception_lifecycle(exception_id) on delete restrict,
  action text not null,
  actor_user_id uuid not null,
  actor_role text not null,
  actor_label text not null,
  previous_status text not null,
  next_status text not null,
  owner_team text,
  snoozed_until timestamptz,
  resolution_note text,
  note text,
  request_fingerprint text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint actionable_exception_event_action
    check (action in (
      'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE',
      'RESOLVE','REOPEN','ADD_NOTE'
    )),
  constraint actionable_exception_event_actor_role
    check (actor_role in ('OWNER','ADMIN','ACCOUNT')),
  constraint actionable_exception_event_statuses
    check (
      previous_status in ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')
      and next_status in ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')
    ),
  constraint actionable_exception_event_owner
    check (owner_team is null or (btrim(owner_team)<>'' and length(owner_team)<=80)),
  constraint actionable_exception_event_fingerprint
    check (request_fingerprint ~ '^[a-f0-9]{32}$'),
  constraint actionable_exception_event_payload_object
    check (jsonb_typeof(event_payload)='object')
);

create index actionable_exception_event_exception_idx
  on analytics.actionable_exception_lifecycle_event(exception_id,created_at desc,event_id desc);
create index actionable_exception_event_actor_idx
  on analytics.actionable_exception_lifecycle_event(actor_user_id,created_at desc);

alter table analytics.actionable_exception_lifecycle enable row level security;
alter table analytics.actionable_exception_lifecycle_event enable row level security;

revoke all on analytics.actionable_exception_lifecycle from public,anon,authenticated;
revoke all on analytics.actionable_exception_lifecycle_event from public,anon,authenticated;

create or replace function analytics.prevent_actionable_exception_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,analytics
as $$
begin
  raise exception using errcode='55000',
    message='ACTIONABLE_EXCEPTION_EVENT_IMMUTABLE';
end;
$$;

create trigger actionable_exception_event_immutable
before update or delete on analytics.actionable_exception_lifecycle_event
for each row execute function analytics.prevent_actionable_exception_event_mutation();

revoke all on function analytics.prevent_actionable_exception_event_mutation()
  from public,anon,authenticated,service_role;

create or replace function analytics.ecoflow_can_write_actionable_exception_lifecycle()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select exists(
    select 1
    from public.app_user_profiles p
    where p.user_id=auth.uid()
      and p.is_active=true
      and p.team_status='ACTIVE'
      and p.app_role in ('OWNER','ADMIN','ACCOUNT')
  )
$$;

revoke all on function analytics.ecoflow_can_write_actionable_exception_lifecycle()
  from public,anon,authenticated,service_role;
grant execute on function analytics.ecoflow_can_write_actionable_exception_lifecycle()
  to authenticated;

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
  v_exception_id text := upper(btrim(coalesce(p_exception_id,'')));
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_owner_team text := nullif(btrim(coalesce(p_owner_team,'')),'');
  v_resolution_note text := nullif(btrim(coalesce(p_resolution_note,'')),'');
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_snoozed_until timestamptz := p_snoozed_until;
  v_user uuid := auth.uid();
  v_actor_role text;
  v_actor_label text;
  v_fingerprint text;
  v_existing analytics.actionable_exception_lifecycle%rowtype;
  v_replay analytics.actionable_exception_lifecycle_event%rowtype;
  v_source record;
  v_source_found boolean := false;
  v_previous_status text;
  v_next_status text;
  v_next_owner text;
  v_next_acknowledged_at timestamptz;
  v_next_acknowledged_by uuid;
  v_next_snoozed_until timestamptz;
  v_next_snooze_resume text;
  v_next_resolved_at timestamptz;
  v_next_resolved_by uuid;
  v_next_resolution_note text;
  v_event_id uuid := gen_random_uuid();
  v_event_at timestamptz := clock_timestamp();
begin
  if not analytics.ecoflow_can_write_actionable_exception_lifecycle() then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED';
  end if;
  if v_user is null then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_AUTHENTICATED_USER_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_COMMAND_ID_REQUIRED';
  end if;
  if v_exception_id !~ '^ORDERMENTUM_ACTIVE:[A-F0-9]{32}$' then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_ID_INVALID';
  end if;
  v_exception_id := lower(v_exception_id);
  v_exception_id := 'ORDERMENTUM_ACTIVE:'||split_part(v_exception_id,':',2);

  if v_action not in (
    'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE',
    'RESOLVE','REOPEN','ADD_NOTE'
  ) then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_ACTION_INVALID';
  end if;
  if v_owner_team is not null and length(v_owner_team)>80 then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_OWNER_TEAM_TOO_LONG';
  end if;
  if v_resolution_note is not null and length(v_resolution_note)>2000 then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_RESOLUTION_NOTE_TOO_LONG';
  end if;
  if v_note is not null and length(v_note)>2000 then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_NOTE_TOO_LONG';
  end if;

  if v_action='ASSIGN' and v_owner_team is null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_OWNER_TEAM_REQUIRED';
  end if;
  if v_action<>'ASSIGN' and v_owner_team is not null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_OWNER_TEAM_NOT_ALLOWED';
  end if;
  if v_action='SNOOZE' then
    if v_snoozed_until is null
       or v_snoozed_until<=statement_timestamp()
       or v_snoozed_until>statement_timestamp()+interval '30 days' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_SNOOZE_WINDOW_INVALID';
    end if;
  elsif v_snoozed_until is not null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_SNOOZE_NOT_ALLOWED';
  end if;
  if v_action='RESOLVE' and v_resolution_note is null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_RESOLUTION_NOTE_REQUIRED';
  end if;
  if v_action<>'RESOLVE' and v_resolution_note is not null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_RESOLUTION_NOTE_NOT_ALLOWED';
  end if;
  if v_action='ADD_NOTE' and v_note is null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_NOTE_REQUIRED';
  end if;
  if v_action<>'ADD_NOTE' and v_note is not null then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_NOTE_NOT_ALLOWED';
  end if;

  select p.app_role,
         coalesce(nullif(btrim(u.email),''),p.app_role||' operator')
  into v_actor_role,v_actor_label
  from public.app_user_profiles p
  left join auth.users u on u.id=p.user_id
  where p.user_id=v_user
    and p.is_active=true
    and p.team_status='ACTIVE'
    and p.app_role in ('OWNER','ADMIN','ACCOUNT');

  if v_actor_role is null then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED';
  end if;

  v_fingerprint := md5(concat_ws('|',
    v_exception_id,
    v_action,
    coalesce(v_owner_team,''),
    coalesce(to_char(v_snoozed_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),''),
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

    return query
    select l.exception_id,l.lifecycle_status,l.owner_team,l.acknowledged_at,
           l.snoozed_until,l.resolved_at,l.version,
           v_replay.event_id,v_replay.command_id,'REPLAYED'::text,v_replay.created_at
    from analytics.actionable_exception_lifecycle l
    where l.exception_id=v_exception_id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_exception_id,0));

  with source_rows as (
    select
      e.raw_order_id::text as raw_order_id,
      e.external_order_id::text as external_order_id,
      e.external_order_number::text as external_order_number,
      e.external_invoice_number::text as external_invoice_number,
      e.order_number::text as order_number,
      e.invoice_number::text as invoice_number,
      nullif(btrim(e.exception_type::text),'') as exception_type,
      nullif(btrim(e.message::text),'') as message,
      nullif(btrim(e.status::text),'') as source_status,
      e.detected_at::timestamptz as detected_at,
      coalesce(
        nullif(btrim(e.raw_order_id::text),''),
        nullif(btrim(e.external_order_id::text),''),
        nullif(btrim(e.order_number::text),''),
        nullif(btrim(e.external_order_number::text),'')
      ) as handoff_order_id
    from public.v_ecoflow_ordermentum_ui_active_exceptions e
  ), identified as (
    select
      'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
        coalesce(s.raw_order_id,''),coalesce(s.external_order_id,''),
        coalesce(s.external_order_number,''),coalesce(s.external_invoice_number,''),
        coalesce(s.order_number,''),coalesce(s.invoice_number,''),
        coalesce(s.exception_type,''),coalesce(s.source_status,''),
        coalesce(s.detected_at::text,'')
      )) as exception_id,
      s.*
    from source_rows s
  )
  select i.* into v_source
  from identified i
  where i.exception_id=v_exception_id
  limit 1;
  v_source_found := found;

  select l.* into v_existing
  from analytics.actionable_exception_lifecycle l
  where l.exception_id=v_exception_id
  for update;

  if not found then
    if not v_source_found then
      raise exception using errcode='P0002',
        message='ACTIONABLE_EXCEPTION_SOURCE_NOT_ACTIVE';
    end if;

    insert into analytics.actionable_exception_lifecycle(
      exception_id,source_key,source_kind,source_status,title,detail,detected_at,
      handoff_workspace,handoff_entity_kind,handoff_entity_id,lifecycle_status,
      version,first_recorded_at,updated_at,last_event_at
    ) values (
      v_exception_id,v_exception_id,'order',v_source.source_status,
      v_source.exception_type,v_source.message,v_source.detected_at,
      'orders',case when v_source.handoff_order_id is null then null else 'order' end,
      v_source.handoff_order_id,'OPEN',0,v_event_at,v_event_at,v_event_at
    );

    select l.* into v_existing
    from analytics.actionable_exception_lifecycle l
    where l.exception_id=v_exception_id
    for update;
  end if;

  if v_action='REOPEN' and not v_source_found then
    raise exception using errcode='P0002',
      message='ACTIONABLE_EXCEPTION_REOPEN_SOURCE_NOT_ACTIVE';
  end if;

  v_previous_status := v_existing.lifecycle_status;
  v_next_status := v_existing.lifecycle_status;
  v_next_owner := v_existing.owner_team;
  v_next_acknowledged_at := v_existing.acknowledged_at;
  v_next_acknowledged_by := v_existing.acknowledged_by;
  v_next_snoozed_until := v_existing.snoozed_until;
  v_next_snooze_resume := v_existing.snooze_resume_status;
  v_next_resolved_at := v_existing.resolved_at;
  v_next_resolved_by := v_existing.resolved_by;
  v_next_resolution_note := v_existing.resolution_note;

  if v_action='ACKNOWLEDGE' then
    if v_previous_status='RESOLVED' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_acknowledged_at := coalesce(v_existing.acknowledged_at,v_event_at);
    v_next_acknowledged_by := coalesce(v_existing.acknowledged_by,v_user);
    if v_previous_status='SNOOZED' then
      v_next_snooze_resume := 'ACKNOWLEDGED';
    else
      v_next_status := 'ACKNOWLEDGED';
    end if;
  elsif v_action='ASSIGN' then
    if v_previous_status='RESOLVED' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_owner := v_owner_team;
  elsif v_action='UNASSIGN' then
    if v_previous_status='RESOLVED' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_owner := null;
  elsif v_action='SNOOZE' then
    if v_previous_status not in ('OPEN','ACKNOWLEDGED') then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_status := 'SNOOZED';
    v_next_snoozed_until := v_snoozed_until;
    v_next_snooze_resume := v_previous_status;
  elsif v_action='UNSNOOZE' then
    if v_previous_status<>'SNOOZED' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_status := coalesce(v_existing.snooze_resume_status,'OPEN');
    v_next_snoozed_until := null;
    v_next_snooze_resume := null;
  elsif v_action='RESOLVE' then
    if v_previous_status='RESOLVED' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_status := 'RESOLVED';
    v_next_snoozed_until := null;
    v_next_snooze_resume := null;
    v_next_resolved_at := v_event_at;
    v_next_resolved_by := v_user;
    v_next_resolution_note := v_resolution_note;
  elsif v_action='REOPEN' then
    if v_previous_status<>'RESOLVED' then
      raise exception using errcode='22023',
        message='ACTIONABLE_EXCEPTION_TRANSITION_INVALID';
    end if;
    v_next_status := 'OPEN';
    v_next_acknowledged_at := null;
    v_next_acknowledged_by := null;
    v_next_snoozed_until := null;
    v_next_snooze_resume := null;
    v_next_resolved_at := null;
    v_next_resolved_by := null;
    v_next_resolution_note := null;
  elsif v_action='ADD_NOTE' then
    null;
  end if;

  update analytics.actionable_exception_lifecycle l
  set source_status=case when v_source_found then v_source.source_status else l.source_status end,
      title=case when v_source_found then v_source.exception_type else l.title end,
      detail=case when v_source_found then v_source.message else l.detail end,
      detected_at=case when v_source_found then v_source.detected_at else l.detected_at end,
      handoff_workspace=case when v_source_found then 'orders' else l.handoff_workspace end,
      handoff_entity_kind=case
        when v_source_found and v_source.handoff_order_id is not null then 'order'
        when v_source_found then null
        else l.handoff_entity_kind
      end,
      handoff_entity_id=case
        when v_source_found then v_source.handoff_order_id
        else l.handoff_entity_id
      end,
      lifecycle_status=v_next_status,
      owner_team=v_next_owner,
      acknowledged_at=v_next_acknowledged_at,
      acknowledged_by=v_next_acknowledged_by,
      snoozed_until=v_next_snoozed_until,
      snooze_resume_status=v_next_snooze_resume,
      resolved_at=v_next_resolved_at,
      resolved_by=v_next_resolved_by,
      resolution_note=v_next_resolution_note,
      version=l.version+1,
      updated_at=v_event_at,
      last_event_at=v_event_at
  where l.exception_id=v_exception_id;

  insert into analytics.actionable_exception_lifecycle_event(
    event_id,command_id,exception_id,action,actor_user_id,actor_role,actor_label,
    previous_status,next_status,owner_team,snoozed_until,resolution_note,note,
    request_fingerprint,event_payload,created_at
  ) values (
    v_event_id,p_command_id,v_exception_id,v_action,v_user,v_actor_role,v_actor_label,
    v_previous_status,v_next_status,v_next_owner,v_next_snoozed_until,
    v_next_resolution_note,v_note,v_fingerprint,
    jsonb_strip_nulls(jsonb_build_object(
      'source_active',v_source_found,
      'owner_team',v_owner_team,
      'snoozed_until',v_snoozed_until,
      'resolution_note',v_resolution_note,
      'note',v_note
    )),
    v_event_at
  );

  return query
  select l.exception_id,l.lifecycle_status,l.owner_team,l.acknowledged_at,
         l.snoozed_until,l.resolved_at,l.version,
         v_event_id,p_command_id,'APPLIED'::text,v_event_at
  from analytics.actionable_exception_lifecycle l
  where l.exception_id=v_exception_id;
end;
$$;

revoke all on function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) from public,anon,authenticated,service_role;
grant execute on function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) to authenticated;

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
    'AVAILABLE'::text as action_capability,
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

comment on table analytics.actionable_exception_lifecycle is
  'Current governed lifecycle state for previously verified Ordermentum active exceptions. No operational order mutation and no severity/SLA/impact inference.';
comment on table analytics.actionable_exception_lifecycle_event is
  'Append-only idempotent lifecycle command history. Direct browser writes are prohibited and update/delete are trigger-blocked.';
comment on function analytics.apply_actionable_exception_lifecycle_command(
  uuid,text,text,text,timestamptz,text,text
) is
  'Idempotent Owner/Admin/Account lifecycle command boundary for acknowledge, ownership, snooze, resolution, reopen and notes. Does not mutate source operational orders.';
comment on function analytics.get_actionable_exception_lifecycle(text[],integer) is
  'Bounded read of governed lifecycle state and latest 50 immutable events for active desktop roles.';

notify pgrst,'reload schema';

commit;
