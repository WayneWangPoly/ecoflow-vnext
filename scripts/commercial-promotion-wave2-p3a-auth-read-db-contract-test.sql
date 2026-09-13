\set ON_ERROR_STOP on

-- Build a clean, authentic post-P2B fixture first. This exercises the incumbent
-- P0/P1/P2A/P2B chain before the P3A authority is introduced.
\ir commercial-promotion-wave2-p2b-canary-promotion-db-contract-test.sql

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.app_role
  from public.app_user_profiles p
  where p.user_id = auth.uid()
    and p.is_active
    and p.team_status = 'ACTIVE'
  limit 1
$$;

alter table public.app_security_audit_events
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z';
alter table public.ecoflow_sku_families
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists updated_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists retired_at timestamptz;
alter table public.ecoflow_physical_skus
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists updated_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists retired_at timestamptz;
alter table public.ecoflow_physical_sku_packages
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists retired_at timestamptz;
alter table public.ecoflow_physical_barcode_bindings
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists retired_at timestamptz;
alter table public.ecoflow_commercial_family_links
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists retired_at timestamptz;
alter table public.ecoflow_inventory_movements
  add column if not exists moved_at timestamptz not null default '2026-09-13T00:00:00Z';
alter table public.ecoflow_warehouse_movements
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z';
alter table public.ecoflow_warehouse_location_items
  add column if not exists quantity numeric not null default 0,
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists updated_at timestamptz not null default '2026-09-13T00:00:00Z';
alter table public.stock_movements
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists updated_at timestamptz not null default '2026-09-13T00:00:00Z';
alter table public.inventory_balances
  add column if not exists quantity_on_hand numeric not null default 0,
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists updated_at timestamptz not null default '2026-09-13T00:00:00Z';
alter table public.ecoflow_unleashed_product_assets
  add column if not exists created_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists updated_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists copied_at timestamptz;
alter table public.ecoflow_unleashed_asset_copy_runs
  add column if not exists started_at timestamptz not null default '2026-09-13T00:00:00Z',
  add column if not exists completed_at timestamptz;

create table public.ecoflow_unleashed_inventory_reference_commands(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null
);
create table public.ecoflow_unleashed_inventory_reference_batches(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null, updated_at timestamptz not null
);
create table public.ecoflow_unleashed_inventory_reference_rows(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null
);
create table public.ordermentum_api_jobs(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null, updated_at timestamptz not null
);
create table public.ordermentum_master_sync_runs(
  id uuid primary key default extensions.gen_random_uuid(), started_at timestamptz not null, finished_at timestamptz
);
create table public.ordermentum_sync_batches(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null
);
create table public.unleashed_sync_runs(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null, updated_at timestamptz not null
);
create table public.unleashed_sync_batches(
  id uuid primary key default extensions.gen_random_uuid(), created_at timestamptz not null, updated_at timestamptz not null
);
create table public.ordermentum_api_capabilities(
  id uuid primary key default extensions.gen_random_uuid(), last_checked_at timestamptz not null
);
create table public.ordermentum_sync_runs_v2(
  id uuid primary key,
  status text not null,
  auth_mode text,
  orders_seen integer not null default 0,
  orders_upserted integer not null default 0,
  orders_changed integer not null default 0,
  detail_fetch_attempted integer not null default 0,
  detail_fetch_succeeded integer not null default 0,
  detail_fetch_failed integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table public.ordermentum_raw_api_events_v2(
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid,
  created_at timestamptz not null
);
create table public.ordermentum_api_sync_state(
  id text primary key,
  updated_at timestamptz not null
);

insert into public.app_user_profiles(user_id, app_role, is_active, team_status) values
  ('10000000-0000-4000-8000-000000000003', 'ADMIN', false, 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000004', 'ADMIN', true, 'ACTIVE');

-- Replace fixture-generated identifiers with the exact durable production
-- evidence. This is isolated test data, never a production mutation.
do $$
declare
  v_old_sku uuid;
  v_old_mapping uuid;
begin
  select commercial_sku_id, external_mapping_id
  into v_old_sku, v_old_mapping
  from public.ecoflow_commercial_wave2_promotions
  where external_product_code = '140010';

  perform pg_catalog.set_config('session_replication_role', 'replica', true);
  update public.skus
  set id = '4710bb98-2706-42e5-866b-8788e36e1acc'::uuid
  where id = v_old_sku;
  update public.external_product_mappings
  set id = '1995b15c-7ee7-466b-ba3e-daba596d71a3'::uuid,
      internal_sku_id = '4710bb98-2706-42e5-866b-8788e36e1acc'::uuid
  where id = v_old_mapping;
  update public.ecoflow_commercial_wave2_promotions
  set commercial_sku_id = '4710bb98-2706-42e5-866b-8788e36e1acc'::uuid,
      external_mapping_id = '1995b15c-7ee7-466b-ba3e-daba596d71a3'::uuid,
      promoted_at = '2026-09-13T11:35:14.960842Z'::timestamptz
  where external_product_code = '140010';
  update public.ecoflow_commercial_wave2_promotion_commands
  set command_payload_sha256 = '0fca9742c34f623ae6dbf1614d5966513fdfa7d5167c7caf4c2a798e956599ef',
      result = result || pg_catalog.jsonb_build_object(
        'commercialSkuId', '4710bb98-2706-42e5-866b-8788e36e1acc',
        'externalMappingId', '1995b15c-7ee7-466b-ba3e-daba596d71a3',
        'replayed', false
      ),
      created_at = '2026-09-13T11:35:14.960842Z'::timestamptz
  where command_id = '7900f15b-bdae-444f-b22c-04000730e260'::uuid;
  update public.app_security_audit_events
  set id = '03dbe0fc-7188-4e70-a1fd-a33fb5524ba8'::uuid,
      actor_role = 'ADMIN',
      target_id = '1995b15c-7ee7-466b-ba3e-daba596d71a3',
      after_data = after_data || pg_catalog.jsonb_build_object(
        'commercialSkuId', '4710bb98-2706-42e5-866b-8788e36e1acc',
        'externalMappingId', '1995b15c-7ee7-466b-ba3e-daba596d71a3',
        'replayed', false
      ),
      created_at = '2026-09-13T11:35:14.960842Z'::timestamptz
  where action = 'COMMERCIAL_WAVE2_SKU_PROMOTED';
  perform pg_catalog.set_config('session_replication_role', 'origin', true);
end $$;

insert into public.skus(
  sku_code, display_name, category, can_sell_by_carton, can_sell_by_sleeve,
  default_storage_unit, default_pick_unit, can_mix_pack, setup_status
)
select 'FIXTURE-' || n, 'Fixture ' || n, 'fixture', false, false, 'each', 'each', false, 'active'
from generate_series(1, 191) n;
insert into public.ecoflow_sku_families(id) select extensions.gen_random_uuid() from generate_series(1, 4);
insert into public.ecoflow_physical_skus(id) select extensions.gen_random_uuid() from generate_series(1, 4);
insert into public.ecoflow_physical_sku_packages(id) select extensions.gen_random_uuid() from generate_series(1, 4);
insert into public.ecoflow_physical_barcode_bindings(id) select extensions.gen_random_uuid() from generate_series(1, 4);
insert into public.ecoflow_commercial_family_links(id) select extensions.gen_random_uuid() from generate_series(1, 4);
insert into public.inventory_balances(id, quantity_on_hand) values (extensions.gen_random_uuid(), 11);
insert into public.ecoflow_unleashed_product_assets(id) select extensions.gen_random_uuid() from generate_series(1, 467);
insert into public.ecoflow_unleashed_asset_copy_runs(id) select extensions.gen_random_uuid() from generate_series(1, 45);

-- Apply twice to prove forward repeat safety.
\ir ../supabase/migrations/20260913173007_commercial_wave2_p3a_authenticated_evidence_read.sql
\ir ../supabase/migrations/20260913173007_commercial_wave2_p3a_authenticated_evidence_read.sql

do $$
begin
  if not has_function_privilege('authenticated', 'public.ecoflow_read_commercial_wave2_p3_verification()', 'execute')
     or has_function_privilege('anon', 'public.ecoflow_read_commercial_wave2_p3_verification()', 'execute')
     or has_function_privilege('service_role', 'public.ecoflow_read_commercial_wave2_p3_verification()', 'execute') then
    raise exception 'P3A function grant boundary failed';
  end if;

  if has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_candidates', 'select')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotions', 'select')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotion_commands', 'select')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_candidates', 'insert')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_candidates', 'update')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_candidates', 'delete')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotions', 'insert')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotions', 'update')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotions', 'delete')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotion_commands', 'insert')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotion_commands', 'update')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotion_commands', 'delete') then
    raise exception 'P3A private-ledger table authority expanded';
  end if;

  if not (select p.prosecdef and p.provolatile = 's' and p.pronargs = 0
          from pg_catalog.pg_proc p
          where p.oid = 'public.ecoflow_read_commercial_wave2_p3_verification()'::regprocedure)
     or (select coalesce(pg_catalog.array_length(p.proconfig, 1), 0) <> 1
              or pg_catalog.split_part(p.proconfig[1], '=', 1) <> 'search_path'
              or pg_catalog.split_part(p.proconfig[1], '=', 2) not in ('', '""')
         from pg_catalog.pg_proc p
         where p.oid = 'public.ecoflow_read_commercial_wave2_p3_verification()'::regprocedure) then
    raise exception 'P3A function execution contract failed';
  end if;
end $$;

create function public.test_p3a_call_error()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.ecoflow_read_commercial_wave2_p3_verification();
  return 'NO_ERROR';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;
grant execute on function public.test_p3a_call_error() to authenticated;

create function public.test_p3a_direct_ledger_select()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.ecoflow_commercial_wave2_candidates limit 1;
  perform 1 from public.ecoflow_commercial_wave2_promotions limit 1;
  perform 1 from public.ecoflow_commercial_wave2_promotion_commands limit 1;
  return 'DIRECT_SELECT_ALLOWED';
exception when insufficient_privilege then
  return 'DIRECT_SELECT_DENIED';
end;
$$;
grant execute on function public.test_p3a_direct_ledger_select() to authenticated;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if public.test_p3a_call_error() not like '42501:COMMERCIAL_WAVE2_P3_AUTHENTICATION_REQUIRED%' then
    raise exception 'anonymous/missing JWT identity was not rejected';
  end if;
end $$;

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$ begin
  if public.test_p3a_call_error() not like '42501:COMMERCIAL_WAVE2_P3_ACTIVE_OWNER_ADMIN_REQUIRED%' then
    raise exception 'inactive ADMIN was not rejected';
  end if;
end $$;

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
do $$ begin
  if public.test_p3a_call_error() not like '42501:COMMERCIAL_WAVE2_P3_ACTIVE_OWNER_ADMIN_REQUIRED%' then
    raise exception 'active non-OWNER/ADMIN was not rejected';
  end if;
  if public.test_p3a_direct_ledger_select() <> 'DIRECT_SELECT_DENIED' then
    raise exception 'authenticated direct private-ledger SELECT was not denied';
  end if;
end $$;

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification();
  if r ->> 'verdict' <> 'PASS'
     or r ->> 'verifierRole' <> 'OWNER'
     or r -> 'identity' ->> 'id' <> '4710bb98-2706-42e5-866b-8788e36e1acc'
     or r -> 'mapping' ->> 'id' <> '1995b15c-7ee7-466b-ba3e-daba596d71a3'
     or r -> 'lineage' ->> 'commandId' <> '7900f15b-bdae-444f-b22c-04000730e260'
     or (r -> 'lineage' ->> 'initialReplayed')::boolean
     or (r -> 'negativeSpace' ->> 'expansionCandidateCount')::bigint <> 163
     or (r -> 'negativeSpace' ->> 'p4EnabledCandidates')::bigint <> 0
     or (r -> 'negativeSpace' ->> 'nonCanaryPromotions')::bigint <> 0
     or r -> 'providerSentinel' ->> 'status' <> 'NO_PROVIDER_ACTIVITY'
     or (r -> 'providerSentinel' ->> 'p3aEmittedProviderTraffic')::bigint <> 0
     or pg_catalog.jsonb_array_length(r -> 'failedChecks') <> 0 then
    raise exception 'OWNER P3A evidence read failed: %', r;
  end if;
end $$;

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification();
  if r ->> 'verdict' <> 'PASS' or r ->> 'verifierRole' <> 'ADMIN' then
    raise exception 'ADMIN P3A evidence read failed: %', r;
  end if;
end $$;
reset role;

-- Evidence mismatches fail closed and do not create a repair path.
begin;
update public.ecoflow_unleashed_master_mappings
set source_payload_sha256 = repeat('0', 64)
where id = '3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification();
  if r ->> 'verdict' <> 'HOLD'
     or not (r -> 'failedChecks') ? 'provenance.sourcePayloadSha256' then
    raise exception 'frozen evidence mismatch did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

-- The only accepted non-zero provider observation is the already-attributed
-- incumbent legacy run. Any other run is a conservative HOLD.
insert into public.ordermentum_sync_runs_v2(
  id, status, auth_mode, orders_seen, orders_upserted, orders_changed,
  detail_fetch_attempted, detail_fetch_succeeded, detail_fetch_failed, created_at, updated_at
) values (
  '0bc9be6e-bc67-4e20-8e5c-c843451eb326', 'SUCCEEDED', 'legacy-bearer', 8, 8, 8,
  8, 8, 0, '2026-09-13T16:09:00Z', '2026-09-13T16:09:11.195Z'
);
insert into public.ordermentum_raw_api_events_v2(run_id, created_at)
select '0bc9be6e-bc67-4e20-8e5c-c843451eb326', '2026-09-13T16:09:05Z'
from generate_series(1, 8);
insert into public.ordermentum_api_sync_state(id, updated_at)
values ('ORDERMENTUM', '2026-09-13T16:09:11.195Z');

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification();
  if r ->> 'verdict' <> 'PASS'
     or r -> 'providerSentinel' ->> 'status' <> 'ATTRIBUTED_INCUMBENT_LEGACY_SYNC'
     or r -> 'providerSentinel' ->> 'allowedWorkflowRunId' <> '34767646363'
     or (r -> 'providerSentinel' ->> 'unattributedSyncRuns')::bigint <> 0
     or (r -> 'providerSentinel' ->> 'unattributedRawApiEvents')::bigint <> 0 then
    raise exception 'attributed incumbent provider run was rejected: %', r;
  end if;
end $$;
reset role;

begin;
insert into public.ordermentum_sync_runs_v2(
  id, status, auth_mode, created_at, updated_at
) values (
  '20000000-0000-4000-8000-000000000001', 'SUCCEEDED', 'current-api',
  '2026-09-13T17:00:00Z', '2026-09-13T17:00:00Z'
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p3_verification();
  if r ->> 'verdict' <> 'HOLD'
     or r -> 'providerSentinel' ->> 'status' <> 'UNATTRIBUTED_PROVIDER_ACTIVITY'
     or not (r -> 'failedChecks') ? 'provider.unattributedActivity' then
    raise exception 'unattributed provider activity did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

select 'COMMERCIAL_PROMOTION_WAVE2_P3A_AUTH_READ_DB_CONTRACT_PASS' as result;
