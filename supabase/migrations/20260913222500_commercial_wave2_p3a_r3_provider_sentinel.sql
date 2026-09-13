-- ECOFLOW-R3-P3A-R3: repair the P3 provider sentinel without widening authority.
--
-- R2 incorrectly froze one dynamic operational run UUID. This wrapper keeps the
-- frozen P2B evidence reader intact, then reclassifies provider-side observations
-- by a fail-closed incumbent legacy operational class. No business DML, provider
-- request, P2B replay, P4 capability, caller switch, retirement, or cutover is
-- introduced here.

begin;

do $dependencies$
begin
  if to_regprocedure('public.ecoflow_read_commercial_wave2_p3_verification()') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.ordermentum_sync_runs_v2') is null
     or to_regclass('public.ordermentum_raw_api_events_v2') is null
     or to_regclass('public.ordermentum_api_sync_state') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'COMMERCIAL_WAVE2_P3A_R3_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

create or replace function public.ecoflow_read_commercial_wave2_p3_verification_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_report jsonb;
  v_failures jsonb;
  v_provider jsonb;
  v_provider_status text;
  v_provider_runs bigint;
  v_invalid_provider_runs bigint;
  v_provider_events bigint;
  v_invalid_provider_events bigint;
  v_sync_state_rows bigint;
  v_invalid_sync_state_rows bigint;
  v_current_api_runs bigint;
  v_master_sync_runs bigint;
  v_current_api_shadow boolean;
  v_legacy_retired boolean;
  v_p4_locked boolean;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P3_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role
    into v_actor_role
  from public.app_user_profiles p
  where p.user_id = v_actor
    and p.is_active
    and p.team_status = 'ACTIVE';

  if v_actor_role is null
     or v_actor_role not in ('OWNER', 'ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_actor_role then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P3_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  -- Consume the already-reviewed frozen P2B/P3 evidence reader. R3 changes only
  -- provider attribution; every other R2 evidence mismatch remains authoritative.
  v_report := public.ecoflow_read_commercial_wave2_p3_verification();

  select coalesce(pg_catalog.jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
    into v_failures
  from pg_catalog.jsonb_array_elements(coalesce(v_report -> 'failedChecks', '[]'::jsonb))
       with ordinality as e(value, ordinality)
  where e.value <> pg_catalog.to_jsonb('provider.unattributedActivity'::text);

  select
    count(*),
    count(*) filter (
      where not (
        r.run_type = 'BACKFILL'
        and r.status = 'SUCCEEDED'
        and r.auth_mode = 'legacy-bearer'
        and r.api_base_url = 'https://app.ordermentum.com'
        and coalesce(r.rate_limited, 0) = 0
        and coalesce(r.error_count, 0) = 0
        and coalesce(r.detail_fetch_failed, 0) = 0
        and coalesce(r.detail_fetch_succeeded, 0) = coalesce(r.detail_fetch_attempted, 0)
        and r.finished_at is not null
      )
    ),
    count(*) filter (
      where r.auth_mode is distinct from 'legacy-bearer'
         or r.api_base_url is distinct from 'https://app.ordermentum.com'
    )
  into v_provider_runs, v_invalid_provider_runs, v_current_api_runs
  from public.ordermentum_sync_runs_v2 r
  where r.created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz
     or r.updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  select
    count(*),
    count(*) filter (
      where not exists (
        select 1
        from public.ordermentum_sync_runs_v2 r
        where r.id = e.run_id
          and (r.created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz
               or r.updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz)
          and r.run_type = 'BACKFILL'
          and r.status = 'SUCCEEDED'
          and r.auth_mode = 'legacy-bearer'
          and r.api_base_url = 'https://app.ordermentum.com'
          and coalesce(r.rate_limited, 0) = 0
          and coalesce(r.error_count, 0) = 0
          and coalesce(r.detail_fetch_failed, 0) = 0
          and coalesce(r.detail_fetch_succeeded, 0) = coalesce(r.detail_fetch_attempted, 0)
          and r.finished_at is not null
      )
    )
  into v_provider_events, v_invalid_provider_events
  from public.ordermentum_raw_api_events_v2 e
  where e.created_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  select
    count(*),
    count(*) filter (
      where not (
        s.id = 'ORDERMENTUM'
        and s.enabled
        and s.sync_mode = 'LEGACY_INCREMENTAL'
        and coalesce(s.consecutive_failures, 0) = 0
        and s.last_error is null
      )
    )
  into v_sync_state_rows, v_invalid_sync_state_rows
  from public.ordermentum_api_sync_state s
  where s.updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  v_master_sync_runs := coalesce((v_report -> 'sentinels' -> 'sinceP2B' ->> 'ordermentumMasterSyncRuns')::bigint, 0);
  v_current_api_shadow := v_current_api_runs <> 0 or v_master_sync_runs <> 0;
  v_legacy_retired := coalesce((v_report -> 'providerSentinel' ->> 'legacyRetired')::boolean, false);

  v_provider_status := case
    when v_provider_runs = 0 and v_provider_events = 0 and v_sync_state_rows = 0
      then 'NO_PROVIDER_ACTIVITY'
    when v_invalid_provider_runs = 0
      and v_invalid_provider_events = 0
      and v_invalid_sync_state_rows = 0
      and not v_current_api_shadow
      and not v_legacy_retired
      then 'ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY'
    else 'UNATTRIBUTED_PROVIDER_ACTIVITY'
  end;

  if v_provider_status = 'UNATTRIBUTED_PROVIDER_ACTIVITY' then
    v_failures := v_failures || pg_catalog.jsonb_build_array('provider.unattributedActivity');
  end if;

  v_provider := pg_catalog.jsonb_build_object(
    'status', v_provider_status,
    'contractVersion', 'P3A_R3_INCUMBENT_LEGACY_CLASS',
    'p3aEmittedProviderTraffic', 0,
    'allowedClass', 'SUCCEEDED_BACKFILL_LEGACY_BEARER',
    'legacyOrigin', 'https://app.ordermentum.com',
    'authMode', 'legacy-bearer',
    'syncRuns', v_provider_runs,
    'rawApiEvents', v_provider_events,
    'syncStateRows', v_sync_state_rows,
    'unattributedSyncRuns', v_invalid_provider_runs,
    'unattributedRawApiEvents', v_invalid_provider_events,
    'unattributedSyncStateRows', v_invalid_sync_state_rows,
    'currentApiShadowExecuted', v_current_api_shadow,
    'legacyRetired', v_legacy_retired
  );

  v_p4_locked := coalesce((v_report ->> 'p4Locked')::boolean, false);
  v_report := pg_catalog.jsonb_set(v_report, '{providerSentinel}', v_provider, true);
  v_report := pg_catalog.jsonb_set(v_report, '{failedChecks}', v_failures, true);
  v_report := pg_catalog.jsonb_set(
    v_report,
    '{verdict}',
    pg_catalog.to_jsonb(case when pg_catalog.jsonb_array_length(v_failures) = 0 and v_p4_locked then 'PASS' else 'HOLD' end),
    true
  );
  v_report := pg_catalog.jsonb_set(v_report, '{verifierRole}', pg_catalog.to_jsonb(v_actor_role), true);
  v_report := pg_catalog.jsonb_set(v_report, '{verifiedAt}', pg_catalog.to_jsonb(pg_catalog.statement_timestamp()), true);

  return v_report;
end;
$function$;

comment on function public.ecoflow_read_commercial_wave2_p3_verification_v2() is
  'P3A-R3 verification-only wrapper: preserves frozen P2B evidence and accepts only healthy incumbent legacy-bearer BACKFILL activity on the legacy Ordermentum origin; current API/shadow, unknown, failed, caller-switch, retirement and cutover evidence remain fail-closed.';

revoke all on function public.ecoflow_read_commercial_wave2_p3_verification_v2()
  from public, anon, service_role;
grant execute on function public.ecoflow_read_commercial_wave2_p3_verification_v2()
  to authenticated;

commit;
