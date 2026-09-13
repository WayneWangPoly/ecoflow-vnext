\set ON_ERROR_STOP on

-- Reuse the complete post-P2B/P3 authenticated fixture, including the corrected
-- incumbent legacy provider attribution. It leaves production-like state:
-- CANARY promoted once, 163 EXPANSION candidates disabled, source mapping still
-- UNMATCHED, P3 PASS, P4 locked.
\ir commercial-promotion-wave2-p3a-r4-master-sync-sentinel-db-contract-test.sql

-- Apply twice to prove forward repeat safety.
\ir ../supabase/migrations/20260913234000_commercial_wave2_p4a_readiness.sql
\ir ../supabase/migrations/20260913234000_commercial_wave2_p4a_readiness.sql

do $$
begin
  if not has_function_privilege('authenticated', 'public.ecoflow_read_commercial_wave2_p4_readiness()', 'execute')
     or has_function_privilege('anon', 'public.ecoflow_read_commercial_wave2_p4_readiness()', 'execute')
     or has_function_privilege('service_role', 'public.ecoflow_read_commercial_wave2_p4_readiness()', 'execute') then
    raise exception 'P4A function grant boundary failed';
  end if;

  if not (select p.prosecdef and p.provolatile = 's' and p.pronargs = 0
          from pg_catalog.pg_proc p
          where p.oid = 'public.ecoflow_read_commercial_wave2_p4_readiness()'::regprocedure) then
    raise exception 'P4A function execution contract failed';
  end if;

  if has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_candidates', 'select')
     or has_table_privilege('authenticated', 'public.ecoflow_commercial_wave2_promotions', 'select') then
    raise exception 'P4A widened private ledger table authority';
  end if;
end $$;

-- Production-like P4A readiness: all 163 expansion rows remain eligible, none
-- enabled, P3 remains PASS, and the stale legacy unlock is detected as incompatible.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p4_readiness();
  if r ->> 'verdict' <> 'PASS'
     or r ->> 'status' <> 'READY_FOR_P4B_ENGINEERING'
     or r ->> 'verifierRole' <> 'ADMIN'
     or r -> 'p3' ->> 'verdict' <> 'PASS'
     or not (r -> 'p3' ->> 'p4Locked')::boolean
     or (r -> 'cohort' ->> 'candidateCount')::bigint <> 164
     or (r -> 'cohort' ->> 'expansionCandidateCount')::bigint <> 163
     or (r -> 'cohort' ->> 'enabledExpansionCount')::bigint <> 0
     or (r -> 'cohort' ->> 'eligibleExpansionCount')::bigint <> 163
     or (r -> 'cohort' ->> 'ineligibleExpansionCount')::bigint <> 0
     or r -> 'canary' ->> 'sourceMappingStatus' <> 'UNMATCHED'
     or (r -> 'canary' ->> 'sourceMappingRevision')::bigint <> 0
     or (r -> 'lineage' ->> 'expansionUnlockCount')::bigint <> 0
     or (r -> 'lineage' ->> 'nonCanaryPromotionCount')::bigint <> 0
     or not (r -> 'legacyExpansionUnlock' ->> 'serviceRoleExecute')::boolean
     or (r -> 'legacyExpansionUnlock' ->> 'compatibleWithCurrentCanaryState')::boolean
     or (r -> 'authority' ->> 'productionExpansionAuthorized')::boolean
     or pg_catalog.jsonb_array_length(r -> 'failedChecks') <> 0 then
    raise exception 'P4A production-like readiness failed: %', r;
  end if;
end $$;
reset role;

-- One expansion source revision drift must turn readiness into HOLD; no mutation
-- is attempted by P4A itself.
begin;
update public.ecoflow_unleashed_master_mappings
set revision = revision + 1
where id = (
  select unleashed_mapping_id
  from public.ecoflow_commercial_wave2_candidates
  where promotion_phase = 'EXPANSION'
  order by external_product_code
  limit 1
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p4_readiness();
  if r ->> 'verdict' <> 'HOLD'
     or (r -> 'cohort' ->> 'eligibleExpansionCount')::bigint <> 162
     or not (r -> 'failedChecks') ? 'cohort.eligibleExpansion' then
    raise exception 'P4A expansion drift did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

-- If the CANARY source mapping is artificially changed into the legacy test-only
-- MATCHED shape without changing the P3 identity, P4A must HOLD rather than expose
-- or bless the dormant service-role expansion path.
begin;
update public.ecoflow_unleashed_master_mappings m
set mapping_status = 'MATCHED',
    match_method = 'ORDERMENTUM_PRODUCT_CODE_EXACT',
    canonical_object_type = 'COMMERCIAL_SKU',
    canonical_object_id = p.commercial_sku_id,
    canonical_code = c.external_product_code,
    candidate_count = 1
from public.ecoflow_commercial_wave2_candidates c
join public.ecoflow_commercial_wave2_promotions p
  on p.external_product_code = c.external_product_code
where c.promotion_phase = 'CANARY'
  and m.id = c.unleashed_mapping_id;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
declare r jsonb;
begin
  r := public.ecoflow_read_commercial_wave2_p4_readiness();
  if r ->> 'verdict' <> 'HOLD'
     or not (r -> 'legacyExpansionUnlock' ->> 'compatibleWithCurrentCanaryState')::boolean
     or not (r -> 'failedChecks') ? 'legacyExpansionUnlock.unexpectedlyCompatible' then
    raise exception 'P4A legacy authority compatibility did not fail closed: %', r;
  end if;
end $$;
reset role;
rollback;

select 'COMMERCIAL_PROMOTION_WAVE2_P4A_READINESS_DB_CONTRACT_PASS' as result;
