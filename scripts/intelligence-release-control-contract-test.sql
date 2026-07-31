\set ON_ERROR_STOP on

begin;
set timezone='UTC';

create or replace function public.ecoflow_release_expect_error(p_sql text,p_marker text)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_RELEASE_ERROR_NOT_RAISED: %',p_sql;
exception when others then
  if sqlerrm like 'EXPECTED_RELEASE_ERROR_NOT_RAISED:%' then raise; end if;
  if position(p_marker in sqlerrm)=0 then
    raise exception 'EXPECTED_RELEASE_ERROR_MARKER_MISSING: expected %, got %',p_marker,sqlerrm;
  end if;
end;
$$;

do $structure$
declare
  v_read_def text;
  v_flag_def text;
  v_evidence_def text;
begin
  if to_regclass('analytics.intelligence_release_flag') is null
     or to_regclass('analytics.intelligence_release_check_definition') is null
     or to_regclass('analytics.intelligence_release_verification') is null
     or to_regclass('analytics.intelligence_release_event') is null
     or to_regprocedure('analytics.get_intelligence_release_readiness(date)') is null
     or to_regprocedure('analytics.apply_intelligence_release_flag_command(uuid,text,date,bigint,text,text)') is null
     or to_regprocedure('analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone)') is null then
    raise exception 'Intelligence release control objects missing';
  end if;

  select pg_get_functiondef('analytics.get_intelligence_release_readiness(date)'::regprocedure) into v_read_def;
  select pg_get_functiondef('analytics.apply_intelligence_release_flag_command(uuid,text,date,bigint,text,text)'::regprocedure) into v_flag_def;
  select pg_get_functiondef('analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone)'::regprocedure) into v_evidence_def;

  if position('UNAVAILABLE' in v_read_def)=0
     or position('INTELLIGENCE_RELEASE_CUTOVER_EVIDENCE_INCOMPLETE' in v_flag_def)=0
     or position('INTELLIGENCE_RELEASE_FLAG_VERSION_CONFLICT' in v_flag_def)=0
     or position('INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT' in v_flag_def)=0
     or position('INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT' in v_evidence_def)=0 then
    raise exception 'Release read/revision/idempotency boundary incomplete';
  end if;

  if (select count(*) from analytics.intelligence_release_flag)<>5
     or (select count(*) from analytics.intelligence_release_check_definition)<>10 then
    raise exception 'Release flag/check registry cardinality incorrect';
  end if;

  if has_table_privilege('authenticated','analytics.intelligence_release_flag','SELECT')
     or has_table_privilege('authenticated','analytics.intelligence_release_flag','UPDATE')
     or has_table_privilege('authenticated','analytics.intelligence_release_verification','SELECT')
     or has_table_privilege('authenticated','analytics.intelligence_release_verification','INSERT')
     or has_table_privilege('authenticated','analytics.intelligence_release_event','SELECT') then
    raise exception 'Authenticated role must not access release control tables directly';
  end if;

  if not has_function_privilege('authenticated','analytics.get_intelligence_release_readiness(date)','EXECUTE')
     or not has_function_privilege('authenticated','analytics.apply_intelligence_release_flag_command(uuid,text,date,bigint,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','analytics.record_intelligence_release_verification(uuid,text,date,text,text,text,text,text,timestamp with time zone)','EXECUTE')
     or has_function_privilege('anon','analytics.get_intelligence_release_readiness(date)','EXECUTE') then
    raise exception 'Release control RPC ACL incorrect';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
 ('9a000000-0000-4000-8000-000000000001','release-owner@example.test'),
 ('9a000000-0000-4000-8000-000000000002','release-admin@example.test'),
 ('9a000000-0000-4000-8000-000000000003','release-account@example.test'),
 ('9a000000-0000-4000-8000-000000000004','release-viewer@example.test'),
 ('9a000000-0000-4000-8000-000000000005','release-warehouse@example.test'),
 ('9a000000-0000-4000-8000-000000000006','release-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
 ('9a000000-0000-4000-8000-000000000001','OWNER',true,'ACTIVE'),
 ('9a000000-0000-4000-8000-000000000002','ADMIN',true,'ACTIVE'),
 ('9a000000-0000-4000-8000-000000000003','ACCOUNT',true,'ACTIVE'),
 ('9a000000-0000-4000-8000-000000000004','VIEWER',true,'ACTIVE'),
 ('9a000000-0000-4000-8000-000000000005','WAREHOUSE',true,'ACTIVE'),
 ('9a000000-0000-4000-8000-000000000006','OWNER',false,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000001',false);

select (
  count(*)=50
  and count(distinct flag_key)=5
  and count(distinct check_key)=10
  and bool_and(rollout_state='SHADOW')
  and bool_and(check_status='UNAVAILABLE')
  and bool_and(check_version is null)
  and bool_and(can_manage)
) as owner_initial_read_ok
from analytics.get_intelligence_release_readiness(current_date)
\gset
\if :owner_initial_read_ok
\else
  \echo 'Owner initial release readiness envelope incorrect'
  \quit 1
\endif

select public.ecoflow_release_expect_error(
  $$select * from analytics.apply_intelligence_release_flag_command(
    '9b000000-0000-4000-8000-000000000001'::uuid,
    'control_room_v2',current_date,1,'ON','Attempt cutover before all evidence has passed.'
  )$$,
  'CUTOVER_EVIDENCE_INCOMPLETE'
);

select * from analytics.record_intelligence_release_verification(
  '9c000000-0000-4000-8000-000000000001'::uuid,
  'control_room_v2',current_date,'METRIC_DEFINITION_APPROVED','PASS',
  'Metric registry version 1 approved','Approved definition and grain',
  'Metric definition approval evidence recorded.',statement_timestamp()-interval '1 minute'
) \gset first_evidence_

select * from analytics.record_intelligence_release_verification(
  '9c000000-0000-4000-8000-000000000001'::uuid,
  'control_room_v2',current_date,'METRIC_DEFINITION_APPROVED','PASS',
  'Metric registry version 1 approved','Approved definition and grain',
  'Metric definition approval evidence recorded.',statement_timestamp()-interval '1 minute'
) \gset replay_evidence_

select (
  :'first_evidence_command_status'='APPLIED'
  and :'replay_evidence_command_status'='REPLAYED'
  and :'first_evidence_version'='1'
  and :'replay_evidence_version'='1'
) as evidence_replay_ok
\gset
\if :evidence_replay_ok
\else
  \echo 'Release verification idempotent replay incorrect'
  \quit 1
\endif

select public.ecoflow_release_expect_error(
  $$select * from analytics.record_intelligence_release_verification(
    '9c000000-0000-4000-8000-000000000001'::uuid,
    'control_room_v2',current_date,'METRIC_DEFINITION_APPROVED','PASS',
    'Different observed value','Approved definition and grain',
    'Metric definition approval evidence recorded.',statement_timestamp()-interval '1 minute'
  )$$,
  'COMMAND_REPLAY_CONFLICT'
);

select r.*
from (values
  ('9c000000-0000-4000-8000-000000000002'::uuid,'PARALLEL_READ_EXPLAINED'),
  ('9c000000-0000-4000-8000-000000000003'::uuid,'ROLE_ACCESS_VERIFIED'),
  ('9c000000-0000-4000-8000-000000000004'::uuid,'NO_DEMO_FALLBACK'),
  ('9c000000-0000-4000-8000-000000000005'::uuid,'NO_SILENT_ZERO'),
  ('9c000000-0000-4000-8000-000000000006'::uuid,'PERFORMANCE_BASELINE'),
  ('9c000000-0000-4000-8000-000000000007'::uuid,'OWNER_WORKFLOW_SMOKE'),
  ('9c000000-0000-4000-8000-000000000008'::uuid,'ROLLBACK_VERIFIED'),
  ('9c000000-0000-4000-8000-000000000009'::uuid,'MOBILE_VERIFIED'),
  ('9c000000-0000-4000-8000-000000000010'::uuid,'SOURCE_INTERRUPTION_VERIFIED')
) as evidence(command_id,check_key)
cross join lateral analytics.record_intelligence_release_verification(
  evidence.command_id,'control_room_v2',current_date,evidence.check_key,'PASS',
  'Observed result meets the approved release contract.',
  'Approved release contract expectation.',
  'Shadow verification evidence passed.',
  statement_timestamp()-interval '1 minute'
) r;

select (
  count(*)=10
  and bool_and(check_status='PASS')
  and bool_and(check_version=1)
) as control_room_evidence_complete
from analytics.get_intelligence_release_readiness(current_date)
where flag_key='control_room_v2'
\gset
\if :control_room_evidence_complete
\else
  \echo 'Control Room cutover evidence did not reach ten PASS checks'
  \quit 1
\endif

select * from analytics.apply_intelligence_release_flag_command(
  '9d000000-0000-4000-8000-000000000001'::uuid,
  'control_room_v2',current_date,1,'ON','All ten governed cutover checks passed for the selected business date.'
) \gset cutover_

select * from analytics.apply_intelligence_release_flag_command(
  '9d000000-0000-4000-8000-000000000001'::uuid,
  'control_room_v2',current_date,1,'ON','All ten governed cutover checks passed for the selected business date.'
) \gset cutover_replay_

select (
  :'cutover_command_status'='APPLIED'
  and :'cutover_rollout_state'='ON'
  and :'cutover_version'='2'
  and :'cutover_replay_command_status'='REPLAYED'
  and :'cutover_replay_version'='2'
) as cutover_replay_ok
\gset
\if :cutover_replay_ok
\else
  \echo 'Release cutover command or replay incorrect'
  \quit 1
\endif

select public.ecoflow_release_expect_error(
  $$select * from analytics.apply_intelligence_release_flag_command(
    '9d000000-0000-4000-8000-000000000002'::uuid,
    'control_room_v2',current_date,1,'OFF','Rollback with stale expected version must conflict.'
  )$$,
  'FLAG_VERSION_CONFLICT'
);

select * from analytics.apply_intelligence_release_flag_command(
  '9d000000-0000-4000-8000-000000000003'::uuid,
  'control_room_v2',current_date,2,'OFF','Verified rollback restores the legacy route and preserves analytics history.'
) \gset rollback_

select (
  :'rollback_rollout_state'='OFF'
  and :'rollback_version'='3'
  and :'rollback_command_status'='APPLIED'
) as rollback_ok
\gset
\if :rollback_ok
\else
  \echo 'Release rollback command incorrect'
  \quit 1
\endif

select public.ecoflow_release_expect_error(
  $$select * from analytics.apply_intelligence_release_flag_command(
    '9d000000-0000-4000-8000-000000000004'::uuid,
    'control_room_v2',current_date,3,'ON','Direct OFF to ON transition must be rejected.'
  )$$,
  'SHADOW_REQUIRED'
);

select * from analytics.apply_intelligence_release_flag_command(
  '9d000000-0000-4000-8000-000000000005'::uuid,
  'control_room_v2',current_date,3,'SHADOW','Resume parallel-read verification after the rollback exercise.'
) \gset shadow_resume_

select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000003',false);
select (
  count(*)=50
  and not bool_or(can_manage)
) as account_read_only_ok
from analytics.get_intelligence_release_readiness(current_date)
\gset
\if :account_read_only_ok
\else
  \echo 'Account release readiness access incorrect'
  \quit 1
\endif

select public.ecoflow_release_expect_error(
  $$select * from analytics.apply_intelligence_release_flag_command(
    '9d000000-0000-4000-8000-000000000006'::uuid,
    'analytics_inventory_v1',current_date,1,'OFF','Account must not manage rollout configuration.'
  )$$,
  'ADMIN_REQUIRED'
);

select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000004',false);
select (count(*)=50 and not bool_or(can_manage)) as viewer_read_only_ok
from analytics.get_intelligence_release_readiness(current_date)
\gset
\if :viewer_read_only_ok
\else
  \echo 'Viewer release readiness access incorrect'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000005',false);
select public.ecoflow_release_expect_error(
  $$select * from analytics.get_intelligence_release_readiness(current_date)$$,
  'DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000006',false);
select public.ecoflow_release_expect_error(
  $$select * from analytics.get_intelligence_release_readiness(current_date)$$,
  'DESKTOP_ROLE_REQUIRED'
);

reset role;

select public.ecoflow_release_expect_error(
  $$update analytics.intelligence_release_event set reason='Attempted rewrite' where true$$,
  'EVENT_IMMUTABLE'
);

rollback;
