\set ON_ERROR_STOP on

-- P4C fixture leaves exactly 163 EXPANSION candidates enabled and zero
-- non-CANARY promotions after a real caller-authenticated unlock simulation.
\ir commercial-promotion-wave2-p4c-activation-db-contract-test.sql

\ir ../supabase/migrations/20260914023000_commercial_wave2_p4d_promotion_authority_plan.sql
\ir ../supabase/migrations/20260914023000_commercial_wave2_p4d_promotion_authority_plan.sql

do $$
begin
  if has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute') then
    raise exception 'P4D stale mutation authority remains open';
  end if;

  if has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute') then
    raise exception 'P4D replacement unexpectedly active';
  end if;

  if not has_function_privilege('authenticated','public.ecoflow_read_commercial_wave2_p4d_promotion_readiness()','execute')
     or has_function_privilege('service_role','public.ecoflow_read_commercial_wave2_p4d_promotion_readiness()','execute') then
    raise exception 'P4D readiness authority shape mismatch';
  end if;

  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled)<>163
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010')<>0
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands where external_product_code<>'140010')<>0 then
    raise exception 'P4D migration performed business promotion';
  end if;
end $$;

set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare r jsonb;
begin
  r:=public.ecoflow_read_commercial_wave2_p4d_promotion_readiness();
  if r->>'verdict'<>'PASS'
     or r->>'status'<>'READY_FOR_P4E_ENGINEERING'
     or (r->'cohort'->>'eligibleForPromotionCount')::bigint<>163
     or (r->'cohort'->>'enabledExpansionCount')::bigint<>163
     or (r->'cohort'->>'nonCanaryPromotionCount')::bigint<>0
     or (r->'cohort'->>'nonCanaryPromotionCommandCount')::bigint<>0
     or (r->'authority'->>'productionPromotionAuthorized')::boolean
     or (r->'authority'->>'legacyServiceRoleExecute')::boolean
     or (r->'authority'->>'v2AuthenticatedExecute')::boolean
     or r->'batchPlan'->>'promotionPlanSha256'<>'43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'
     or (r->'batchPlan'->>'batchCount')::int<>7
     or pg_catalog.jsonb_array_length(r->'batchPlan'->'batches')<>7 then
    raise exception 'P4D readiness mismatch: %',r;
  end if;
end $$;
reset role;

-- Inactive ADMIN cannot use the dormant replacement even when a test-only grant
-- is temporarily introduced inside a rollback transaction.
begin;
grant execute on function public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text) to authenticated;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$
begin
  begin
    perform public.ecoflow_promote_commercial_wave2_expansion_sku_v2(
      '44000000-0000-4000-8000-000000000099'::uuid,
      '140280',
      '901c8d51-047c-4716-a4f4-a3e724891cfa'::uuid,
      0,
      'c3c4a95e6381fdd4f0efa18f404ccb7f15dae98ff879f4d10ac99a3acf1c350f',
      'P4D test-only denied inactive admin'
    );
    raise exception 'inactive ADMIN unexpectedly promoted';
  exception when sqlstate '42501' then
    if position('COMMERCIAL_WAVE2_P4D_ACTIVE_OWNER_ADMIN_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;
rollback;

-- Test the exact business footprint through the caller-authenticated wrapper,
-- then roll it back so the P4D engineering fixture remains promotion-free.
begin;
create temporary table p4d_baseline as
select
  (select count(*) from public.skus) as sku_count,
  (select count(*) from public.external_product_mappings) as external_mapping_count,
  (select count(*) from public.ecoflow_commercial_wave2_promotions) as promotion_count,
  (select count(*) from public.ecoflow_commercial_wave2_promotion_commands) as command_count,
  (select count(*) from public.app_security_audit_events) as audit_count;

grant execute on function public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text) to authenticated;
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare r jsonb; replay jsonb;
begin
  r:=public.ecoflow_promote_commercial_wave2_expansion_sku_v2(
    '44000000-0000-4000-8000-000000000001'::uuid,
    '140280',
    '901c8d51-047c-4716-a4f4-a3e724891cfa'::uuid,
    0,
    'c3c4a95e6381fdd4f0efa18f404ccb7f15dae98ff879f4d10ac99a3acf1c350f',
    'P4D isolated expansion promotion simulation'
  );
  if r->>'externalProductCode'<>'140280'
     or r->>'promotionPhase'<>'EXPANSION'
     or r->>'authorityVersion'<>'P4D_CALLER_AUTH_PROMOTION_V2'
     or (r->>'replayed')::boolean
     or (r->>'physicalAuthorityCreated')::boolean
     or (r->>'inventoryAuthorityCreated')::boolean
     or (r->>'providerActionIncluded')::boolean then
    raise exception 'P4D promotion result mismatch: %',r;
  end if;

  replay:=public.ecoflow_promote_commercial_wave2_expansion_sku_v2(
    '44000000-0000-4000-8000-000000000001'::uuid,
    '140280',
    '901c8d51-047c-4716-a4f4-a3e724891cfa'::uuid,
    0,
    'c3c4a95e6381fdd4f0efa18f404ccb7f15dae98ff879f4d10ac99a3acf1c350f',
    'P4D isolated expansion promotion simulation'
  );
  if not (replay->>'replayed')::boolean then raise exception 'P4D replay was not idempotent'; end if;
end $$;
reset role;

do $$
declare b record;
begin
  select * into b from p4d_baseline;
  if (select count(*) from public.skus)<>b.sku_count+1
     or (select count(*) from public.external_product_mappings)<>b.external_mapping_count+1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions)<>b.promotion_count+1
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands)<>b.command_count+1
     or (select count(*) from public.app_security_audit_events)<>b.audit_count+1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code='140280')<>1
     or (select count(*) from public.skus where upper(btrim(sku_code))='140280')<>1
     or (select count(*) from public.external_product_mappings where provider='ORDERMENTUM' and upper(btrim(external_product_code))='140280')<>1 then
    raise exception 'P4D bounded promotion footprint mismatch';
  end if;
end $$;
rollback;

select 'COMMERCIAL_PROMOTION_WAVE2_P4D_PROMOTION_READINESS_DB_CONTRACT_PASS' as result;
