\set ON_ERROR_STOP on

-- Start from the exact P4D engineering fixture: P4C is closed, all 163 EXPANSION
-- candidates are enabled, no non-CANARY promotion exists, and the single-SKU v2
-- replacement is dormant.
\ir commercial-promotion-wave2-p4d-promotion-readiness-db-contract-test.sql

\ir ../supabase/migrations/20260914031500_commercial_wave2_p4e_batch_promotion_engineering.sql
\ir ../supabase/migrations/20260914031500_commercial_wave2_p4e_batch_promotion_engineering.sql

create temporary table p4e_baseline as
select
  (select count(*) from public.skus) as sku_count,
  (select count(*) from public.external_product_mappings) as external_mapping_count,
  (select count(*) from public.ecoflow_commercial_wave2_promotions) as promotion_count,
  (select count(*) from public.ecoflow_commercial_wave2_promotion_commands) as promotion_command_count,
  (select count(*) from public.app_security_audit_events) as audit_count;

create temporary table p4e_source_baseline as
select m.id,m.revision,m.mapping_status,m.source_payload_sha256
from public.ecoflow_unleashed_master_mappings m
join public.ecoflow_commercial_wave2_candidates c on c.unleashed_mapping_id=m.id
where c.promotion_phase='EXPANSION';

do $$
begin
  if not has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)','execute')
     or has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)','execute')
     or has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)','execute')
     or not has_function_privilege('authenticated','public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer)','execute')
     or has_function_privilege('service_role','public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer)','execute')
     or not has_function_privilege('authenticated','public.ecoflow_read_commercial_wave2_p4e_batch_gate()','execute')
     or has_function_privilege('service_role','public.ecoflow_read_commercial_wave2_p4e_batch_gate()','execute') then
    raise exception 'P4E batch authority shape mismatch';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute') then
    raise exception 'P4E exposed a forbidden single-SKU or legacy authority';
  end if;
  if (select count(*) from public.ecoflow_commercial_wave2_promotion_batch_commands)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_batch_verifications)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010')<>0 then
    raise exception 'P4E migration itself performed business promotion';
  end if;
end $$;

-- The plan helper must preserve the exact seven frozen windows.
do $$
declare p jsonb;
begin
  p:=public.ecoflow_commercial_wave2_p4e_plan_evidence();
  if p->>'promotionPlanSha256'<>'43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'
     or (p->>'batchCount')::int<>7
     or (p->>'candidateCount')::int<>163
     or pg_catalog.jsonb_array_length(p->'batches')<>7 then
    raise exception 'P4E frozen plan mismatch: %',p;
  end if;
end $$;

-- Inactive ADMIN cannot execute a production batch.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$
begin
  begin
    perform public.ecoflow_promote_commercial_wave2_expansion_batch_v1(1);
    raise exception 'inactive ADMIN unexpectedly promoted batch 1';
  exception when sqlstate '42501' then
    if position('COMMERCIAL_WAVE2_P4E_ACTIVE_OWNER_ADMIN_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

-- Fresh active ADMIN gate is exactly batch 1 EXECUTE.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare r jsonb;
begin
  r:=public.ecoflow_read_commercial_wave2_p4e_batch_gate();
  if r->>'verdict'<>'PASS'
     or r->>'status'<>'READY_FOR_BATCH_EXECUTION'
     or r->>'action'<>'EXECUTE'
     or (r->'programme'->>'nextBatchNo')::int<>1
     or (r->'batch'->'expected'->>'candidateCount')::int<>25
     or (r->'batch'->>'eligibleCount')::int<>25
     or not (r->'authority'->>'productionPromotionAuthorized')::boolean then
    raise exception 'P4E initial gate mismatch: %',r;
  end if;
end $$;

-- Batch 2 cannot be called ahead of batch 1 postflight.
do $$
begin
  begin
    perform public.ecoflow_promote_commercial_wave2_expansion_batch_v1(2);
    raise exception 'batch 2 unexpectedly bypassed sequence gate';
  exception when others then
    if position('COMMERCIAL_WAVE2_P4E_PREVIOUS_BATCH_NOT_VERIFIED' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

-- Any source revision drift in the current window must fail the whole batch before
-- one Commercial SKU is created.
begin;
update public.ecoflow_unleashed_master_mappings
set revision=revision+1
where id=(
  select unleashed_mapping_id
  from public.ecoflow_commercial_wave2_p4e_plan_members()
  where batch_no=1 order by item_position limit 1
);
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
begin
  begin
    perform public.ecoflow_promote_commercial_wave2_expansion_batch_v1(1);
    raise exception 'drifted batch 1 unexpectedly promoted';
  exception when others then
    if position('COMMERCIAL_WAVE2_P4E_BATCH_ELIGIBILITY_DRIFT' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;
rollback;

-- Execute batch 1 exactly once.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$
declare r jsonb; replay jsonb;
begin
  r:=public.ecoflow_promote_commercial_wave2_expansion_batch_v1(1);
  if r->>'mode'<>'P4E_BATCH_EXECUTION'
     or (r->>'batchNo')::int<>1
     or (r->>'candidateCount')::int<>25
     or (r->>'promotedCount')::int<>25
     or (r->>'cumulativePromotedCount')::int<>25
     or (r->>'replayed')::boolean
     or not (r->>'postflightRequired')::boolean
     or (r->>'providerActionIncluded')::boolean
     or (r->>'physicalAuthorityCreated')::boolean
     or (r->>'inventoryAuthorityCreated')::boolean
     or pg_catalog.jsonb_array_length(r->'items')<>25 then
    raise exception 'P4E batch 1 result mismatch: %',r;
  end if;
  replay:=public.ecoflow_promote_commercial_wave2_expansion_batch_v1(1);
  if not (replay->>'replayed')::boolean
     or (replay->>'promotedCount')::int<>25 then
    raise exception 'P4E batch replay mismatch: %',replay;
  end if;
end $$;

-- Gate must force independent postflight before batch 2 can become executable.
do $$
declare r jsonb;
begin
  r:=public.ecoflow_read_commercial_wave2_p4e_batch_gate();
  if r->>'verdict'<>'PASS'
     or r->>'status'<>'READY_FOR_POSTFLIGHT'
     or r->>'action'<>'POSTFLIGHT'
     or (r->'programme'->>'nextBatchNo')::int<>1
     or (r->'batch'->>'promotedCount')::int<>25 then
    raise exception 'P4E post-batch-1 gate mismatch: %',r;
  end if;
  begin
    perform public.ecoflow_promote_commercial_wave2_expansion_batch_v1(2);
    raise exception 'batch 2 unexpectedly executed without batch 1 postflight';
  exception when others then
    if position('COMMERCIAL_WAVE2_P4E_PREVIOUS_BATCH_NOT_VERIFIED' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- Verify and close batch 1; verification replay is idempotent.
do $$
declare r jsonb; replay jsonb;
begin
  r:=public.ecoflow_verify_commercial_wave2_expansion_batch_v1(1);
  if r->>'verdict'<>'PASS'
     or (r->>'batchNo')::int<>1
     or (r->>'verifiedCandidateCount')::int<>25
     or (r->>'cumulativePromotedCount')::int<>25
     or (r->>'nextBatchNo')::int<>2
     or (r->>'programmeComplete')::boolean
     or (r->>'replayed')::boolean then
    raise exception 'P4E batch 1 postflight mismatch: %',r;
  end if;
  replay:=public.ecoflow_verify_commercial_wave2_expansion_batch_v1(1);
  if not (replay->>'replayed')::boolean then
    raise exception 'P4E postflight replay mismatch: %',replay;
  end if;
end $$;

-- Now and only now batch 2 is executable.
do $$
declare r jsonb;
begin
  r:=public.ecoflow_read_commercial_wave2_p4e_batch_gate();
  if r->>'status'<>'READY_FOR_BATCH_EXECUTION'
     or r->>'action'<>'EXECUTE'
     or (r->'programme'->>'nextBatchNo')::int<>2
     or (r->'batch'->>'eligibleCount')::int<>25 then
    raise exception 'P4E batch 2 gate mismatch: %',r;
  end if;
end $$;

-- Exercise the remaining six windows through the exact production carrier.
do $$
declare
  b integer;
  exec_result jsonb;
  verify_result jsonb;
begin
  for b in 2..7 loop
    exec_result:=public.ecoflow_promote_commercial_wave2_expansion_batch_v1(b);
    if (exec_result->>'batchNo')::int<>b
       or (exec_result->>'promotedCount')::int<>(case when b=7 then 13 else 25 end)
       or (exec_result->>'providerActionIncluded')::boolean
       or (exec_result->>'physicalAuthorityCreated')::boolean
       or (exec_result->>'inventoryAuthorityCreated')::boolean then
      raise exception 'P4E batch % execution mismatch: %',b,exec_result;
    end if;
    verify_result:=public.ecoflow_verify_commercial_wave2_expansion_batch_v1(b);
    if verify_result->>'verdict'<>'PASS'
       or (verify_result->>'batchNo')::int<>b
       or (verify_result->>'verifiedCandidateCount')::int<>(case when b=7 then 13 else 25 end) then
      raise exception 'P4E batch % postflight mismatch: %',b,verify_result;
    end if;
  end loop;
end $$;

-- Final programme gate is COMPLETE and all business footprints are exact.
do $$
declare r jsonb; b record;
begin
  r:=public.ecoflow_read_commercial_wave2_p4e_batch_gate();
  if r->>'verdict'<>'PASS'
     or r->>'status'<>'ALL_BATCHES_VERIFIED'
     or r->>'action'<>'COMPLETE'
     or (r->'programme'->>'verifiedBatchCount')::int<>7
     or (r->'programme'->>'nonCanaryPromotionCount')::int<>163
     or (r->'programme'->>'nonCanaryPromotionCommandCount')::int<>163 then
    raise exception 'P4E final gate mismatch: %',r;
  end if;
  select * into b from p4e_baseline;
  if (select count(*) from public.skus)<>b.sku_count+163
     or (select count(*) from public.external_product_mappings)<>b.external_mapping_count+163
     or (select count(*) from public.ecoflow_commercial_wave2_promotions)<>b.promotion_count+163
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands)<>b.promotion_command_count+163
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_batch_commands)<>7
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_batch_verifications)<>7
     or (select count(*) from public.app_security_audit_events)<>b.audit_count+177 then
    raise exception 'P4E final bounded footprint mismatch';
  end if;
  if exists (
    (select m.id,m.revision,m.mapping_status,m.source_payload_sha256
     from public.ecoflow_unleashed_master_mappings m
     join public.ecoflow_commercial_wave2_candidates c on c.unleashed_mapping_id=m.id
     where c.promotion_phase='EXPANSION')
    except
    (select id,revision,mapping_status,source_payload_sha256 from p4e_source_baseline)
  ) or exists (
    (select id,revision,mapping_status,source_payload_sha256 from p4e_source_baseline)
    except
    (select m.id,m.revision,m.mapping_status,m.source_payload_sha256
     from public.ecoflow_unleashed_master_mappings m
     join public.ecoflow_commercial_wave2_candidates c on c.unleashed_mapping_id=m.id
     where c.promotion_phase='EXPANSION')
  ) then
    raise exception 'P4E mutated Unleashed source mapping authority';
  end if;
end $$;
reset role;

select 'COMMERCIAL_PROMOTION_WAVE2_P4E_BATCH_PROMOTION_DB_CONTRACT_PASS' as result;
