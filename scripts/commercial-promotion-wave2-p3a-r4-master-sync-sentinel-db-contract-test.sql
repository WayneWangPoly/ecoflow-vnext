\set ON_ERROR_STOP on

-- Reuse the complete R3 authenticated P3 fixture and all fail-closed regressions.
\ir commercial-promotion-wave2-p3a-r3-provider-sentinel-db-contract-test.sql

-- The older isolated fixture models only the timestamps used by R2. Add the
-- production master-run evidence fields consumed by R4.
alter table public.ordermentum_master_sync_runs
  add column if not exists run_type text not null default 'MASTER_DATA_SYNC',
  add column if not exists status text not null default 'SUCCEEDED',
  add column if not exists auth_mode text not null default 'legacy-bearer',
  add column if not exists resources_failed text[] not null default '{}'::text[],
  add column if not exists dry_run boolean not null default false,
  add column if not exists detail_attempted integer not null default 0,
  add column if not exists detail_succeeded integer not null default 0,
  add column if not exists detail_failed integer not null default 0,
  add column if not exists last_error text;

-- Model the two incumbent Complete Mirror master runs observed in production.
insert into public.ordermentum_master_sync_runs(
  id, run_type, status, auth_mode, resources_failed, dry_run,
  detail_attempted, detail_succeeded, detail_failed, last_error,
  started_at, finished_at
) values
(
  '40000000-0000-4000-8000-000000000001', 'MASTER_DATA_SYNC', 'SUCCEEDED', 'legacy-bearer', '{}'::text[], false,
  649, 649, 0, null, '2026-09-13T19:38:52Z', '2026-09-13T20:38:29Z'
),
(
  '40000000-0000-4000-8000-000000000002', 'MASTER_DATA_SYNC', 'SUCCEEDED', 'legacy-bearer', '{}'::text[], false,
  102, 102, 0, null, '2026-09-13T20:38:31Z', '2026-09-13T20:41:25Z'
);

-- Apply twice to prove forward repeat safety.
\ir ../supabase/migrations/20260913225500_commercial_wave2_p3a_r4_master_sync_sentinel.sql
\ir ../supabase/migrations/20260913225500_commercial_wave2_p3a_r4_master_sync_sentinel.sql

do $$
begin
  if not has_function_privilege('authenticated', 'public.ecoflow_read_commercial_wave2_p3_verification_v3()', 'execute')
     or has_function_privilege('anon', 'public.ecoflow_read_commercial_wave2_p3_verification_v3()', 'execute')
     or has_function_privilege('service_role', 'public.ecoflow_read_commercial_wave2_p3_verification_v3()', 'execute') then
    raise exception 'P3A-R4 function grant boundary failed';
  end if;

  if not (select p.prosecdef and p.provolatile = 's' and p.pronargs = 0
          from pg_catalog.pg_proc p
          where p.oid = 'public.ecoflow_read_commercial_wave2_p3_verification_v3()'::regprocedure) then
    raise exception 'P3A-R4 function execution contract failed';
  end if;
end $$;

-- Healthy incumbent legacy master runs are attributed and no longer make the
-- generic sinceP2B bucket or provider sentinel fail.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v3();
  if r ->> 'verdict' <> 'PASS'
     or r ->> 'verifierRole' <> 'ADMIN'
     or r -> 'providerSentinel' ->> 'status' <> 'ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY'
     or (r -> 'providerSentinel' ->> 'masterSyncRuns')::bigint <> 2
     or (r -> 'providerSentinel' ->> 'unattributedMasterSyncRuns')::bigint <> 0
     or r -> 'providerSentinel' ->> 'masterAllowedClass' <> 'SUCCEEDED_MASTER_DATA_SYNC_LEGACY_BEARER'
     or (r -> 'providerSentinel' ->> 'currentApiShadowExecuted')::boolean
     or (r -> 'sentinels' -> 'sinceP2B' ->> 'ordermentumMasterSyncRuns')::bigint <> 0
     or pg_catalog.jsonb_array_length(r -> 'failedChecks') <> 0 then
    raise exception 'P3A-R4 incumbent legacy master class failed: %', r;
  end if;
end $$;
reset role;

-- A current-API master run remains fail-closed.
begin;
insert into public.ordermentum_master_sync_runs(
  id, run_type, status, auth_mode, resources_failed, dry_run,
  detail_attempted, detail_succeeded, detail_failed, last_error,
  started_at, finished_at
) values (
  '40000000-0000-4000-8000-000000000003', 'MASTER_DATA_SYNC', 'SUCCEEDED', 'api-key', '{}'::text[], false,
  1, 1, 0, null, '2026-09-13T21:00:00Z', '2026-09-13T21:00:01Z'
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v3();
  if r ->> 'verdict' <> 'HOLD'
     or r -> 'providerSentinel' ->> 'status' <> 'UNATTRIBUTED_PROVIDER_ACTIVITY'
     or (r -> 'providerSentinel' ->> 'unattributedMasterSyncRuns')::bigint = 0
     or not (r -> 'providerSentinel' ->> 'currentApiShadowExecuted')::boolean
     or not (r -> 'failedChecks') ? 'provider.unattributedActivity' then
    raise exception 'current API master run did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

-- A failed legacy master run is also a HOLD.
begin;
insert into public.ordermentum_master_sync_runs(
  id, run_type, status, auth_mode, resources_failed, dry_run,
  detail_attempted, detail_succeeded, detail_failed, last_error,
  started_at, finished_at
) values (
  '40000000-0000-4000-8000-000000000004', 'MASTER_DATA_SYNC', 'FAILED', 'legacy-bearer', ARRAY['products'], false,
  1, 0, 1, 'fixture-error', '2026-09-13T21:05:00Z', '2026-09-13T21:05:01Z'
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v3();
  if r ->> 'verdict' <> 'HOLD'
     or (r -> 'providerSentinel' ->> 'unattributedMasterSyncRuns')::bigint = 0
     or not (r -> 'failedChecks') ? 'provider.unattributedActivity' then
    raise exception 'failed legacy master run did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

select 'COMMERCIAL_PROMOTION_WAVE2_P3A_R4_MASTER_SYNC_SENTINEL_DB_CONTRACT_PASS' as result;
