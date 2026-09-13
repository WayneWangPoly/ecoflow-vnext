\set ON_ERROR_STOP on

-- Reuse the complete authenticated P3A post-P2B fixture and its R2 regressions.
\ir commercial-promotion-wave2-p3a-auth-read-db-contract-test.sql

-- Production has these provider-observation fields; the older isolated R2 fixture
-- intentionally modelled only the columns R2 used.
alter table public.ordermentum_sync_runs_v2
  add column if not exists run_type text,
  add column if not exists api_base_url text,
  add column if not exists rate_limited integer not null default 0,
  add column if not exists error_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

update public.ordermentum_sync_runs_v2
set run_type = 'BACKFILL',
    api_base_url = 'https://app.ordermentum.com',
    rate_limited = 0,
    error_count = 0,
    started_at = created_at,
    finished_at = updated_at
where id = '0bc9be6e-bc67-4e20-8e5c-c843451eb326'::uuid;

alter table public.ordermentum_api_sync_state
  add column if not exists enabled boolean not null default true,
  add column if not exists sync_mode text not null default 'LEGACY_INCREMENTAL',
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists last_error text;

update public.ordermentum_api_sync_state
set enabled = true,
    sync_mode = 'LEGACY_INCREMENTAL',
    consecutive_failures = 0,
    last_error = null
where id = 'ORDERMENTUM';

-- Apply twice to prove forward repeat safety.
\ir ../supabase/migrations/20260913222500_commercial_wave2_p3a_r3_provider_sentinel.sql
\ir ../supabase/migrations/20260913222500_commercial_wave2_p3a_r3_provider_sentinel.sql

do $$
begin
  if not has_function_privilege('authenticated', 'public.ecoflow_read_commercial_wave2_p3_verification_v2()', 'execute')
     or has_function_privilege('anon', 'public.ecoflow_read_commercial_wave2_p3_verification_v2()', 'execute')
     or has_function_privilege('service_role', 'public.ecoflow_read_commercial_wave2_p3_verification_v2()', 'execute') then
    raise exception 'P3A-R3 function grant boundary failed';
  end if;

  if not (select p.prosecdef and p.provolatile = 's' and p.pronargs = 0
          from pg_catalog.pg_proc p
          where p.oid = 'public.ecoflow_read_commercial_wave2_p3_verification_v2()'::regprocedure)
     or (select coalesce(pg_catalog.array_length(p.proconfig, 1), 0) <> 1
              or pg_catalog.split_part(p.proconfig[1], '=', 1) <> 'search_path'
              or pg_catalog.split_part(p.proconfig[1], '=', 2) not in ('', '""')
         from pg_catalog.pg_proc p
         where p.oid = 'public.ecoflow_read_commercial_wave2_p3_verification_v2()'::regprocedure) then
    raise exception 'P3A-R3 function execution contract failed';
  end if;
end $$;

-- The incumbent legacy class passes without relying on one dynamic run UUID.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v2();
  if r ->> 'verdict' <> 'PASS'
     or r ->> 'verifierRole' <> 'ADMIN'
     or r -> 'providerSentinel' ->> 'status' <> 'ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY'
     or r -> 'providerSentinel' ->> 'contractVersion' <> 'P3A_R3_INCUMBENT_LEGACY_CLASS'
     or r -> 'providerSentinel' ->> 'allowedClass' <> 'SUCCEEDED_BACKFILL_LEGACY_BEARER'
     or (r -> 'providerSentinel' ->> 'unattributedSyncRuns')::bigint <> 0
     or (r -> 'providerSentinel' ->> 'unattributedRawApiEvents')::bigint <> 0
     or (r -> 'providerSentinel' ->> 'unattributedSyncStateRows')::bigint <> 0
     or (r -> 'providerSentinel' ->> 'currentApiShadowExecuted')::boolean
     or pg_catalog.jsonb_array_length(r -> 'failedChecks') <> 0 then
    raise exception 'P3A-R3 incumbent legacy class failed: %', r;
  end if;
end $$;
reset role;

-- A later normal scheduled legacy reconciliation must not invalidate P3 merely
-- because its operational UUID is new.
insert into public.ordermentum_sync_runs_v2(
  id, run_type, status, auth_mode, api_base_url,
  orders_seen, orders_upserted, orders_changed,
  detail_fetch_attempted, detail_fetch_succeeded, detail_fetch_failed,
  rate_limited, error_count, started_at, finished_at, created_at, updated_at
) values (
  '30000000-0000-4000-8000-000000000001', 'BACKFILL', 'SUCCEEDED', 'legacy-bearer', 'https://app.ordermentum.com',
  81, 81, 73, 81, 81, 0, 0, 0,
  '2026-09-13T19:35:34Z', '2026-09-13T19:38:51Z',
  '2026-09-13T19:35:34Z', '2026-09-13T19:38:51Z'
);
insert into public.ordermentum_raw_api_events_v2(run_id, created_at)
select '30000000-0000-4000-8000-000000000001', '2026-09-13T19:37:54Z'::timestamptz + (n || ' seconds')::interval
from generate_series(1, 25) n;
update public.ordermentum_api_sync_state
set updated_at = '2026-09-13T19:38:51Z',
    enabled = true,
    sync_mode = 'LEGACY_INCREMENTAL',
    consecutive_failures = 0,
    last_error = null
where id = 'ORDERMENTUM';

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v2();
  if r ->> 'verdict' <> 'PASS'
     or r -> 'providerSentinel' ->> 'status' <> 'ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY'
     or (r -> 'providerSentinel' ->> 'syncRuns')::bigint <> 2
     or (r -> 'providerSentinel' ->> 'rawApiEvents')::bigint <> 33
     or (r -> 'providerSentinel' ->> 'unattributedSyncRuns')::bigint <> 0
     or (r -> 'providerSentinel' ->> 'unattributedRawApiEvents')::bigint <> 0 then
    raise exception 'dynamic incumbent legacy run was rejected: %', r;
  end if;
end $$;
reset role;

-- Current-API/#359-style activity remains fail-closed.
begin;
insert into public.ordermentum_sync_runs_v2(
  id, run_type, status, auth_mode, api_base_url,
  detail_fetch_attempted, detail_fetch_succeeded, detail_fetch_failed,
  rate_limited, error_count, started_at, finished_at, created_at, updated_at
) values (
  '30000000-0000-4000-8000-000000000002', 'BACKFILL', 'SUCCEEDED', 'api-key', 'https://api.ordermentum.com',
  1, 1, 0, 0, 0,
  '2026-09-13T20:00:00Z', '2026-09-13T20:00:01Z',
  '2026-09-13T20:00:00Z', '2026-09-13T20:00:01Z'
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v2();
  if r ->> 'verdict' <> 'HOLD'
     or r -> 'providerSentinel' ->> 'status' <> 'UNATTRIBUTED_PROVIDER_ACTIVITY'
     or not (r -> 'providerSentinel' ->> 'currentApiShadowExecuted')::boolean
     or not (r -> 'failedChecks') ? 'provider.unattributedActivity' then
    raise exception 'current API activity did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

-- A failed/errored legacy run is not accepted merely because it used legacy auth.
begin;
insert into public.ordermentum_sync_runs_v2(
  id, run_type, status, auth_mode, api_base_url,
  detail_fetch_attempted, detail_fetch_succeeded, detail_fetch_failed,
  rate_limited, error_count, started_at, finished_at, created_at, updated_at
) values (
  '30000000-0000-4000-8000-000000000003', 'BACKFILL', 'FAILED', 'legacy-bearer', 'https://app.ordermentum.com',
  1, 0, 1, 0, 1,
  '2026-09-13T20:05:00Z', '2026-09-13T20:05:01Z',
  '2026-09-13T20:05:00Z', '2026-09-13T20:05:01Z'
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v2();
  if r ->> 'verdict' <> 'HOLD'
     or r -> 'providerSentinel' ->> 'status' <> 'UNATTRIBUTED_PROVIDER_ACTIVITY'
     or (r -> 'providerSentinel' ->> 'unattributedSyncRuns')::bigint = 0
     or not (r -> 'failedChecks') ? 'provider.unattributedActivity' then
    raise exception 'failed legacy run did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

-- A degraded sync-state row is also a HOLD.
begin;
update public.ordermentum_api_sync_state
set consecutive_failures = 1,
    last_error = 'fixture-error',
    updated_at = '2026-09-13T20:10:00Z'
where id = 'ORDERMENTUM';
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification_v2();
  if r ->> 'verdict' <> 'HOLD'
     or (r -> 'providerSentinel' ->> 'unattributedSyncStateRows')::bigint = 0
     or not (r -> 'failedChecks') ? 'provider.unattributedActivity' then
    raise exception 'degraded sync state did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

select 'COMMERCIAL_PROMOTION_WAVE2_P3A_R3_PROVIDER_SENTINEL_DB_CONTRACT_PASS' as result;
