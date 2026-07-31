-- INTEL-REL-001/002/003/004: governed Intelligence rollout, shadow verification,
-- cutover readiness and rollback control.
--
-- This control plane stores release configuration and verification evidence only.
-- It does not mutate orders, inventory, customers, routes, returns or exceptions.

begin;

do $preflight$
begin
  if to_regclass('public.app_user_profiles') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('gen_random_uuid()') is null then
    raise exception 'INTELLIGENCE_RELEASE_CONTROL_PREREQUISITES_MISSING';
  end if;
  if not exists(select 1 from pg_namespace where nspname='analytics') then
    raise exception 'INTELLIGENCE_RELEASE_CONTROL_ANALYTICS_SCHEMA_MISSING';
  end if;
end;
$preflight$;

create table analytics.intelligence_release_flag (
  flag_key text primary key,
  rollout_state text not null default 'OFF',
  version bigint not null default 1,
  change_reason text,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint intelligence_release_flag_key check (flag_key in (
    'control_room_v2',
    'analytics_inventory_v1',
    'analytics_customer_v1',
    'analytics_delivery_v1',
    'overlay_navigation_v1'
  )),
  constraint intelligence_release_flag_state check (rollout_state in ('OFF','SHADOW','ON')),
  constraint intelligence_release_flag_version check (version>=1),
  constraint intelligence_release_flag_reason check (
    change_reason is null or length(btrim(change_reason)) between 10 and 500
  ),
  constraint intelligence_release_flag_time check (updated_at>=created_at)
);

create table analytics.intelligence_release_check_definition (
  check_key text primary key,
  sort_order integer not null unique,
  display_name text not null,
  requirement text not null,
  constraint intelligence_release_check_key check (check_key in (
    'METRIC_DEFINITION_APPROVED',
    'PARALLEL_READ_EXPLAINED',
    'ROLE_ACCESS_VERIFIED',
    'NO_DEMO_FALLBACK',
    'NO_SILENT_ZERO',
    'PERFORMANCE_BASELINE',
    'OWNER_WORKFLOW_SMOKE',
    'ROLLBACK_VERIFIED',
    'MOBILE_VERIFIED',
    'SOURCE_INTERRUPTION_VERIFIED'
  )),
  constraint intelligence_release_check_order check (sort_order between 1 and 10),
  constraint intelligence_release_check_name check (btrim(display_name)<>'' and length(display_name)<=120),
  constraint intelligence_release_check_requirement check (btrim(requirement)<>'' and length(requirement)<=500)
);

create table analytics.intelligence_release_verification (
  flag_key text not null references analytics.intelligence_release_flag(flag_key) on delete restrict,
  business_date date not null,
  check_key text not null references analytics.intelligence_release_check_definition(check_key) on delete restrict,
  check_status text not null,
  observed_value text,
  expected_value text,
  note text,
  source_as_of timestamptz,
  version bigint not null default 1,
  recorded_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(flag_key,business_date,check_key),
  constraint intelligence_release_verification_status check (
    check_status in ('PASS','FAIL','BLOCKED','UNAVAILABLE')
  ),
  constraint intelligence_release_verification_observed check (
    observed_value is null or length(observed_value)<=1000
  ),
  constraint intelligence_release_verification_expected check (
    expected_value is null or length(expected_value)<=1000
  ),
  constraint intelligence_release_verification_note check (
    note is null or length(note)<=2000
  ),
  constraint intelligence_release_verification_version check (version>=1),
  constraint intelligence_release_verification_time check (updated_at>=created_at)
);

create index intelligence_release_verification_date_idx
  on analytics.intelligence_release_verification(business_date desc,flag_key,check_key);
create index intelligence_release_verification_status_idx
  on analytics.intelligence_release_verification(check_status,business_date desc);

create table analytics.intelligence_release_event (
  event_id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  command_fingerprint text not null,
  action text not null,
  flag_key text not null references analytics.intelligence_release_flag(flag_key) on delete restrict,
  business_date date,
  check_key text,
  previous_state jsonb not null default '{}'::jsonb,
  next_state jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  actor_role text not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint intelligence_release_event_fingerprint check (command_fingerprint ~ '^[a-f0-9]{32}$'),
  constraint intelligence_release_event_action check (action in ('SET_FLAG_STATE','RECORD_VERIFICATION')),
  constraint intelligence_release_event_check check (
    (action='SET_FLAG_STATE' and check_key is null)
    or (action='RECORD_VERIFICATION' and check_key is not null and business_date is not null)
  ),
  constraint intelligence_release_event_actor_role check (actor_role in ('OWNER','ADMIN')),
  constraint intelligence_release_event_reason check (length(btrim(reason)) between 3 and 2000),
  constraint intelligence_release_event_payload check (
    jsonb_typeof(previous_state)='object' and jsonb_typeof(next_state)='object'
  )
);

create index intelligence_release_event_flag_idx
  on analytics.intelligence_release_event(flag_key,created_at desc,event_id desc);

alter table analytics.intelligence_release_flag enable row level security;
alter table analytics.intelligence_release_check_definition enable row level security;
alter table analytics.intelligence_release_verification enable row level security;
alter table analytics.intelligence_release_event enable row level security;

revoke all on analytics.intelligence_release_flag from public,anon,authenticated,service_role;
revoke all on analytics.intelligence_release_check_definition from public,anon,authenticated,service_role;
revoke all on analytics.intelligence_release_verification from public,anon,authenticated,service_role;
revoke all on analytics.intelligence_release_event from public,anon,authenticated,service_role;

grant usage on schema analytics to authenticated;

insert into analytics.intelligence_release_flag(flag_key,rollout_state,change_reason)
values
  ('control_room_v2','SHADOW','Initial parallel-read verification; legacy Control Room remains authoritative.'),
  ('analytics_inventory_v1','SHADOW','Initial parallel-read verification; operational Inventory remains authoritative.'),
  ('analytics_customer_v1','SHADOW','Initial parallel-read verification; operational Customer workspace remains authoritative.'),
  ('analytics_delivery_v1','SHADOW','Initial parallel-read verification; operational Delivery workspace remains authoritative.'),
  ('overlay_navigation_v1','SHADOW','Initial navigation verification; legacy route recovery remains available.')
on conflict(flag_key) do nothing;

insert into analytics.intelligence_release_check_definition(
  check_key,sort_order,display_name,requirement
)
values
  ('METRIC_DEFINITION_APPROVED',1,'Metric definition approved','Metric definition, grain, date basis, exclusions and owner are approved.'),
  ('PARALLEL_READ_EXPLAINED',2,'Parallel-read differences explained','Differences between legacy and Intelligence results are measured and explained.'),
  ('ROLE_ACCESS_VERIFIED',3,'Role access verified','Owner, Admin, Account and Viewer boundaries pass; Warehouse, Driver and inactive access fail closed.'),
  ('NO_DEMO_FALLBACK',4,'No demo fallback','Unavailable production evidence remains unavailable and never falls back to demo data.'),
  ('NO_SILENT_ZERO',5,'No silent zero','Missing, invalid, stale and unavailable values remain distinct from confirmed numeric zero.'),
  ('PERFORMANCE_BASELINE',6,'Performance baseline met','Request, payload, query latency and rendering budgets meet the approved baseline.'),
  ('OWNER_WORKFLOW_SMOKE',7,'Owner workflow smoke passed','Owner can identify a problem, drill to an entity and reach the operational handoff.'),
  ('ROLLBACK_VERIFIED',8,'Rollback verified','Feature-flag rollback restores the legacy route without deleting analytics history.'),
  ('MOBILE_VERIFIED',9,'Mobile verified','Mobile layout, touch targets, overlays and navigation recovery are operational.'),
  ('SOURCE_INTERRUPTION_VERIFIED',10,'Source interruption verified','Stale or interrupted sources produce explicit degraded or unavailable states.')
on conflict(check_key) do update set
  sort_order=excluded.sort_order,
  display_name=excluded.display_name,
  requirement=excluded.requirement;

create or replace function analytics.prevent_intelligence_release_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,analytics
as $$
begin
  raise exception using errcode='55000',message='INTELLIGENCE_RELEASE_EVENT_IMMUTABLE';
end;
$$;

create trigger intelligence_release_event_immutable
before update or delete on analytics.intelligence_release_event
for each row execute function analytics.prevent_intelligence_release_event_mutation();

revoke all on function analytics.prevent_intelligence_release_event_mutation()
  from public,anon,authenticated,service_role;

create or replace function analytics.get_intelligence_release_readiness(
  p_business_date date default current_date
)
returns table(
  flag_key text,
  rollout_state text,
  flag_version bigint,
  flag_reason text,
  flag_updated_at timestamptz,
  check_key text,
  check_order integer,
  check_name text,
  requirement text,
  check_status text,
  observed_value text,
  expected_value text,
  note text,
  source_as_of timestamptz,
  check_version bigint,
  check_updated_at timestamptz,
  can_manage boolean,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_can_manage boolean;
  v_date date := coalesce(p_business_date,current_date);
  v_read_at timestamptz := statement_timestamp();
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_user
    and p.is_active=true
    and p.team_status='ACTIVE'
    and p.app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER');

  if v_role is null then
    raise exception using errcode='42501',message='INTELLIGENCE_RELEASE_DESKTOP_ROLE_REQUIRED';
  end if;
  if v_date < current_date-400 or v_date > current_date+1 then
    raise exception using errcode='22023',message='INTELLIGENCE_RELEASE_BUSINESS_DATE_INVALID';
  end if;

  v_can_manage := v_role in ('OWNER','ADMIN');

  return query
  select
    f.flag_key,
    f.rollout_state,
    f.version,
    f.change_reason,
    f.updated_at,
    d.check_key,
    d.sort_order,
    d.display_name,
    d.requirement,
    coalesce(v.check_status,'UNAVAILABLE'::text),
    v.observed_value,
    v.expected_value,
    v.note,
    v.source_as_of,
    v.version,
    v.updated_at,
    v_can_manage,
    v_read_at
  from analytics.intelligence_release_flag f
  cross join analytics.intelligence_release_check_definition d
  left join analytics.intelligence_release_verification v
    on v.flag_key=f.flag_key
   and v.business_date=v_date
   and v.check_key=d.check_key
  order by
    array_position(array[
      'control_room_v2','analytics_inventory_v1','analytics_customer_v1',
      'analytics_delivery_v1','overlay_navigation_v1'
    ]::text[],f.flag_key),
    d.sort_order;
end;
$$;

create or replace function analytics.apply_intelligence_release_flag_command(
  p_command_id uuid,
  p_flag_key text,
  p_business_date date,
  p_expected_version bigint,
  p_next_state text,
  p_reason text
)
returns table(
  flag_key text,
  rollout_state text,
  version bigint,
  command_id uuid,
  command_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_flag_key text := lower(btrim(coalesce(p_flag_key,'')));
  v_next_state text := upper(btrim(coalesce(p_next_state,'')));
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_business_date date := coalesce(p_business_date,current_date);
  v_fingerprint text;
  v_existing analytics.intelligence_release_event%rowtype;
  v_flag analytics.intelligence_release_flag%rowtype;
  v_previous_state jsonb;
  v_now timestamptz := clock_timestamp();
  v_passed integer;
  v_required integer;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_user
    and p.is_active=true
    and p.team_status='ACTIVE'
    and p.app_role in ('OWNER','ADMIN');

  if v_role is null then
    raise exception using errcode='42501',message='INTELLIGENCE_RELEASE_ADMIN_REQUIRED';
  end if;
  if p_command_id is null
     or v_flag_key not in (
       'control_room_v2','analytics_inventory_v1','analytics_customer_v1',
       'analytics_delivery_v1','overlay_navigation_v1'
     )
     or v_next_state not in ('OFF','SHADOW','ON')
     or p_expected_version is null or p_expected_version<1
     or v_reason is null or length(v_reason) not between 10 and 500
     or v_business_date < current_date-400 or v_business_date > current_date+1 then
    raise exception using errcode='22023',message='INTELLIGENCE_RELEASE_FLAG_COMMAND_INVALID';
  end if;

  v_fingerprint := md5(concat_ws('|',
    v_flag_key,v_business_date::text,p_expected_version::text,v_next_state,v_reason
  ));

  select * into v_existing
  from analytics.intelligence_release_event e
  where e.command_id=p_command_id;

  if found then
    if v_existing.command_fingerprint<>v_fingerprint
       or v_existing.action<>'SET_FLAG_STATE' then
      raise exception using errcode='40001',message='INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT';
    end if;
    return query select
      v_existing.flag_key,
      v_existing.next_state->>'rollout_state',
      (v_existing.next_state->>'version')::bigint,
      v_existing.command_id,
      'REPLAYED'::text,
      (v_existing.next_state->>'updated_at')::timestamptz;
    return;
  end if;

  select * into v_flag
  from analytics.intelligence_release_flag f
  where f.flag_key=v_flag_key
  for update;

  if not found then
    raise exception using errcode='22023',message='INTELLIGENCE_RELEASE_FLAG_UNKNOWN';
  end if;
  if v_flag.version<>p_expected_version then
    raise exception using errcode='40001',message='INTELLIGENCE_RELEASE_FLAG_VERSION_CONFLICT';
  end if;
  if v_flag.rollout_state=v_next_state then
    raise exception using errcode='22023',message='INTELLIGENCE_RELEASE_FLAG_NO_CHANGE';
  end if;
  if v_flag.rollout_state='OFF' and v_next_state='ON' then
    raise exception using errcode='22023',message='INTELLIGENCE_RELEASE_SHADOW_REQUIRED';
  end if;

  if v_next_state='ON' then
    select count(*) into v_required
    from analytics.intelligence_release_check_definition;
    select count(*) into v_passed
    from analytics.intelligence_release_verification v
    where v.flag_key=v_flag_key
      and v.business_date=v_business_date
      and v.check_status='PASS';
    if v_passed<>v_required then
      raise exception using errcode='55000',message='INTELLIGENCE_RELEASE_CUTOVER_EVIDENCE_INCOMPLETE';
    end if;
  end if;

  v_previous_state := jsonb_build_object(
    'rollout_state',v_flag.rollout_state,
    'version',v_flag.version,
    'updated_at',v_flag.updated_at
  );

  update analytics.intelligence_release_flag f
  set rollout_state=v_next_state,
      version=f.version+1,
      change_reason=v_reason,
      updated_by=v_user,
      updated_at=v_now
  where f.flag_key=v_flag_key and f.version=p_expected_version
  returning * into v_flag;

  if not found then
    raise exception using errcode='40001',message='INTELLIGENCE_RELEASE_FLAG_VERSION_CONFLICT';
  end if;

  insert into analytics.intelligence_release_event(
    command_id,command_fingerprint,action,flag_key,business_date,
    previous_state,next_state,actor_user_id,actor_role,reason
  ) values(
    p_command_id,v_fingerprint,'SET_FLAG_STATE',v_flag_key,v_business_date,
    v_previous_state,
    jsonb_build_object(
      'rollout_state',v_flag.rollout_state,
      'version',v_flag.version,
      'updated_at',v_flag.updated_at
    ),
    v_user,v_role,v_reason
  );

  return query select
    v_flag.flag_key,
    v_flag.rollout_state,
    v_flag.version,
    p_command_id,
    'APPLIED'::text,
    v_flag.updated_at;
end;
$$;

create or replace function analytics.record_intelligence_release_verification(
  p_command_id uuid,
  p_flag_key text,
  p_business_date date,
  p_check_key text,
  p_check_status text,
  p_observed_value text default null,
  p_expected_value text default null,
  p_note text default null,
  p_source_as_of timestamptz default null
)
returns table(
  flag_key text,
  business_date date,
  check_key text,
  check_status text,
  version bigint,
  command_id uuid,
  command_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_flag_key text := lower(btrim(coalesce(p_flag_key,'')));
  v_check_key text := upper(btrim(coalesce(p_check_key,'')));
  v_status text := upper(btrim(coalesce(p_check_status,'')));
  v_observed text := nullif(btrim(coalesce(p_observed_value,'')),'');
  v_expected text := nullif(btrim(coalesce(p_expected_value,'')),'');
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_date date := coalesce(p_business_date,current_date);
  v_fingerprint text;
  v_existing analytics.intelligence_release_event%rowtype;
  v_previous jsonb := '{}'::jsonb;
  v_verification analytics.intelligence_release_verification%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_user
    and p.is_active=true
    and p.team_status='ACTIVE'
    and p.app_role in ('OWNER','ADMIN');

  if v_role is null then
    raise exception using errcode='42501',message='INTELLIGENCE_RELEASE_ADMIN_REQUIRED';
  end if;
  if p_command_id is null
     or not exists(select 1 from analytics.intelligence_release_flag f where f.flag_key=v_flag_key)
     or not exists(select 1 from analytics.intelligence_release_check_definition d where d.check_key=v_check_key)
     or v_status not in ('PASS','FAIL','BLOCKED','UNAVAILABLE')
     or v_date < current_date-400 or v_date > current_date+1
     or (v_observed is not null and length(v_observed)>1000)
     or (v_expected is not null and length(v_expected)>1000)
     or (v_note is not null and length(v_note)>2000)
     or (p_source_as_of is not null and p_source_as_of>statement_timestamp()+interval '5 minutes')
     or (v_status<>'PASS' and v_note is null) then
    raise exception using errcode='22023',message='INTELLIGENCE_RELEASE_VERIFICATION_COMMAND_INVALID';
  end if;

  v_fingerprint := md5(concat_ws('|',
    v_flag_key,v_date::text,v_check_key,v_status,
    coalesce(v_observed,''),coalesce(v_expected,''),coalesce(v_note,''),
    coalesce(p_source_as_of::text,'')
  ));

  select * into v_existing
  from analytics.intelligence_release_event e
  where e.command_id=p_command_id;

  if found then
    if v_existing.command_fingerprint<>v_fingerprint
       or v_existing.action<>'RECORD_VERIFICATION' then
      raise exception using errcode='40001',message='INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT';
    end if;
    return query select
      v_existing.flag_key,
      v_existing.business_date,
      v_existing.check_key,
      v_existing.next_state->>'check_status',
      (v_existing.next_state->>'version')::bigint,
      v_existing.command_id,
      'REPLAYED'::text,
      (v_existing.next_state->>'updated_at')::timestamptz;
    return;
  end if;

  select * into v_verification
  from analytics.intelligence_release_verification v
  where v.flag_key=v_flag_key
    and v.business_date=v_date
    and v.check_key=v_check_key
  for update;

  if found then
    v_previous := jsonb_build_object(
      'check_status',v_verification.check_status,
      'version',v_verification.version,
      'updated_at',v_verification.updated_at
    );
  end if;

  insert into analytics.intelligence_release_verification(
    flag_key,business_date,check_key,check_status,
    observed_value,expected_value,note,source_as_of,recorded_by
  ) values(
    v_flag_key,v_date,v_check_key,v_status,
    v_observed,v_expected,v_note,p_source_as_of,v_user
  )
  on conflict(flag_key,business_date,check_key)
  do update set
    check_status=excluded.check_status,
    observed_value=excluded.observed_value,
    expected_value=excluded.expected_value,
    note=excluded.note,
    source_as_of=excluded.source_as_of,
    recorded_by=excluded.recorded_by,
    version=analytics.intelligence_release_verification.version+1,
    updated_at=v_now
  returning * into v_verification;

  insert into analytics.intelligence_release_event(
    command_id,command_fingerprint,action,flag_key,business_date,check_key,
    previous_state,next_state,actor_user_id,actor_role,reason
  ) values(
    p_command_id,v_fingerprint,'RECORD_VERIFICATION',v_flag_key,v_date,v_check_key,
    v_previous,
    jsonb_build_object(
      'check_status',v_verification.check_status,
      'version',v_verification.version,
      'updated_at',v_verification.updated_at
    ),
    v_user,v_role,coalesce(v_note,'Verification evidence recorded.')
  );

  return query select
    v_verification.flag_key,
    v_verification.business_date,
    v_verification.check_key,
    v_verification.check_status,
    v_verification.version,
    p_command_id,
    'APPLIED'::text,
    v_verification.updated_at;
end;
$$;

revoke all on function analytics.get_intelligence_release_readiness(date)
  from public,anon,authenticated,service_role;
revoke all on function analytics.apply_intelligence_release_flag_command(uuid,text,date,bigint,text,text)
  from public,anon,authenticated,service_role;
revoke all on function analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone)
  from public,anon,authenticated,service_role;

grant execute on function analytics.get_intelligence_release_readiness(date) to authenticated;
grant execute on function analytics.apply_intelligence_release_flag_command(uuid,text,date,bigint,text,text) to authenticated;
grant execute on function analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone) to authenticated;

comment on table analytics.intelligence_release_flag is
  'Server-authoritative Intelligence feature flags with OFF, SHADOW and ON rollout states.';
comment on table analytics.intelligence_release_verification is
  'Per-business-date cutover evidence. Missing evidence remains unavailable rather than becoming PASS or numeric zero.';
comment on table analytics.intelligence_release_event is
  'Append-only idempotent audit ledger for release flag and verification commands.';
comment on function analytics.get_intelligence_release_readiness(date) is
  'Returns five rollout flags crossed with ten required cutover checks and explicit unavailable evidence.';
comment on function analytics.apply_intelligence_release_flag_command(uuid,text,date,bigint,text,text) is
  'Owner/Admin revisioned, idempotent feature-flag command. ON requires all cutover checks PASS.';
comment on function analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone) is
  'Owner/Admin idempotent command for bounded shadow-verification evidence.';

notify pgrst,'reload schema';
commit;
