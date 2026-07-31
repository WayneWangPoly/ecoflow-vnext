-- Forward fix for managed PostgreSQL PL/pgSQL output-variable ambiguity in the
-- release verification UPSERT. The command contract is unchanged.

begin;

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
    coalesce(date_trunc('second',p_source_as_of)::text,'')
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
  on conflict on constraint intelligence_release_verification_pkey
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

revoke all on function analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone)
  from public,anon,authenticated,service_role;
grant execute on function analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone)
  to authenticated;

comment on function analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone) is
  'Owner/Admin idempotent command for bounded shadow-verification evidence; conflict target is constraint-qualified for PL/pgSQL compatibility.';

notify pgrst,'reload schema';
commit;
