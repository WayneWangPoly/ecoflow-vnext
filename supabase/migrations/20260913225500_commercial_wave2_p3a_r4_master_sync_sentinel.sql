-- ECOFLOW-R3-P3A-R4: attribute healthy incumbent legacy master-sync activity.
--
-- R3 correctly repaired dynamic legacy BACKFILL attribution, but still treated every
-- post-P2B ordermentum_master_sync_runs row as evidence of current-API shadowing.
-- The incumbent Complete Mirror also produces healthy legacy-bearer MASTER_DATA_SYNC
-- rows, so that rule creates a false HOLD. R4 wraps R3, preserves all frozen P2B/P3
-- evidence, and removes only the master-sync/provider failures when every observed
-- master run belongs to the bounded healthy incumbent legacy class.
--
-- R4 is wire-compatible with the reviewed R3 client contract: the real master-run
-- count remains visible under providerSentinel.masterSyncRuns, while the legacy
-- sinceP2B generic mutation bucket is normalized to zero only after the stricter
-- master attribution check succeeds.
--
-- No business DML, provider request, P2B replay, P4 capability, caller switch,
-- legacy retirement, or cutover is introduced.

begin;

do $dependencies$
begin
  if to_regprocedure('public.ecoflow_read_commercial_wave2_p3_verification_v2()') is null
     or to_regclass('public.ordermentum_master_sync_runs') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'COMMERCIAL_WAVE2_P3A_R4_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

create or replace function public.ecoflow_read_commercial_wave2_p3_verification_v3()
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
  v_master_runs bigint;
  v_invalid_master_runs bigint;
  v_base_provider_clean boolean;
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

  -- Consume the already-reviewed R3 report. R4 changes only attribution of
  -- ordermentum_master_sync_runs emitted by the incumbent legacy Complete Mirror.
  v_report := public.ecoflow_read_commercial_wave2_p3_verification_v2();
  v_provider := coalesce(v_report -> 'providerSentinel', '{}'::jsonb);
  v_legacy_retired := coalesce((v_provider ->> 'legacyRetired')::boolean, false);

  select
    count(*),
    count(*) filter (
      where not (
        r.run_type = 'MASTER_DATA_SYNC'
        and r.status = 'SUCCEEDED'
        and r.auth_mode = 'legacy-bearer'
        and coalesce(r.dry_run, false) = false
        and coalesce(pg_catalog.array_length(r.resources_failed, 1), 0) = 0
        and coalesce(r.detail_failed, 0) = 0
        and coalesce(r.detail_succeeded, 0) = coalesce(r.detail_attempted, 0)
        and r.last_error is null
        and r.finished_at is not null
      )
    )
  into v_master_runs, v_invalid_master_runs
  from public.ordermentum_master_sync_runs r
  where r.started_at > '2026-09-13T11:35:14.960842Z'::timestamptz
     or r.finished_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  v_base_provider_clean :=
    coalesce((v_provider ->> 'unattributedSyncRuns')::bigint, 0) = 0
    and coalesce((v_provider ->> 'unattributedRawApiEvents')::bigint, 0) = 0
    and coalesce((v_provider ->> 'unattributedSyncStateRows')::bigint, 0) = 0
    and not v_legacy_retired
    and v_invalid_master_runs = 0;

  select coalesce(pg_catalog.jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
    into v_failures
  from pg_catalog.jsonb_array_elements(coalesce(v_report -> 'failedChecks', '[]'::jsonb))
       with ordinality as e(value, ordinality)
  where not (
    v_base_provider_clean
    and e.value in (
      pg_catalog.to_jsonb('provider.unattributedActivity'::text),
      pg_catalog.to_jsonb('sentinels.sinceP2B.ordermentumMasterSyncRuns'::text)
    )
  );

  if not v_base_provider_clean
     and not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_failures) as e(value)
       where e.value = pg_catalog.to_jsonb('provider.unattributedActivity'::text)
     ) then
    v_failures := v_failures || pg_catalog.jsonb_build_array('provider.unattributedActivity');
  end if;

  v_provider := v_provider
    || pg_catalog.jsonb_build_object(
      'status', case
        when v_base_provider_clean
             and coalesce((v_provider ->> 'syncRuns')::bigint, 0) = 0
             and coalesce((v_provider ->> 'rawApiEvents')::bigint, 0) = 0
             and coalesce((v_provider ->> 'syncStateRows')::bigint, 0) = 0
             and v_master_runs = 0
          then 'NO_PROVIDER_ACTIVITY'
        when v_base_provider_clean
          then 'ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY'
        else 'UNATTRIBUTED_PROVIDER_ACTIVITY'
      end,
      -- Preserve the reviewed R3 wire contract; R4 adds a stricter nested class.
      'contractVersion', 'P3A_R3_INCUMBENT_LEGACY_CLASS',
      'allowedClass', 'SUCCEEDED_BACKFILL_LEGACY_BEARER',
      'masterAllowedClass', 'SUCCEEDED_MASTER_DATA_SYNC_LEGACY_BEARER',
      'masterSyncRuns', v_master_runs,
      'unattributedMasterSyncRuns', v_invalid_master_runs,
      'currentApiShadowExecuted', not v_base_provider_clean and (
        coalesce((v_provider ->> 'unattributedSyncRuns')::bigint, 0) <> 0
        or v_invalid_master_runs <> 0
      )
    );

  -- The client contract historically treats every sinceP2B counter as forbidden.
  -- Once master runs have passed the R4 attribution contract, expose their true
  -- count under providerSentinel and normalize only this generic mutation bucket.
  if v_base_provider_clean then
    v_report := pg_catalog.jsonb_set(
      v_report,
      '{sentinels,sinceP2B,ordermentumMasterSyncRuns}',
      '0'::jsonb,
      false
    );
  end if;

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

comment on function public.ecoflow_read_commercial_wave2_p3_verification_v3() is
  'P3A-R4 verification-only wrapper: preserves R3 evidence while attributing only healthy SUCCEEDED legacy-bearer MASTER_DATA_SYNC rows from the incumbent Complete Mirror; current API, failed/degraded master runs, caller switch, retirement and cutover remain fail-closed.';

revoke all on function public.ecoflow_read_commercial_wave2_p3_verification_v3()
  from public, anon, service_role;
grant execute on function public.ecoflow_read_commercial_wave2_p3_verification_v3()
  to authenticated;

commit;
