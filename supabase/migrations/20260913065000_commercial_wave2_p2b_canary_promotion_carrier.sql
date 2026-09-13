-- ECOFLOW-R3-P2B-ENG: authenticated Wave 2 canary-promotion carrier.
-- P2A must already be durably complete. This migration adds a SELECT-only
-- P2B preflight and a thin wrapper around the incumbent bounded promotion RPC.
-- It does not execute the frozen P2B command during deployment.

begin;

do $deps$
begin
  if to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotion_commands') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null
     or to_regprocedure('public.ecoflow_commercial_wave2_plan_evidence()') is null
     or to_regprocedure('public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)') is null then
    raise exception 'COMMERCIAL_WAVE2_P2B_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

create or replace function public.ecoflow_commercial_wave2_canary_promotion_evidence()
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_evidence jsonb;
  v_exact_unlock_commands bigint;
  v_unlock_audits bigint;
  v_canary_skus bigint;
  v_canary_external_mappings bigint;
  v_ready boolean;
begin
  v_evidence:=public.ecoflow_commercial_wave2_plan_evidence();

  select count(*) into v_exact_unlock_commands
  from public.ecoflow_commercial_wave2_unlock_commands c
  where c.command_id='61b13a7c-18d1-48f0-b317-96d23607ddfb'
    and c.promotion_phase='CANARY'
    and c.result->>'promotionPhase'='CANARY'
    and c.result->>'candidateSetSha256'='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
    and (c.result->>'unlockedCandidateCount')::bigint=1;

  select count(*) into v_unlock_audits
  from public.app_security_audit_events a
  where a.action='COMMERCIAL_WAVE2_CANARY_UNLOCKED'
    and a.target_type='ecoflow_commercial_wave2_phase_unlocks'
    and a.target_id='CANARY';

  select count(*) into v_canary_skus
  from public.skus s
  where upper(btrim(s.sku_code))='140010';

  select count(*) into v_canary_external_mappings
  from public.external_product_mappings e
  where e.provider='ORDERMENTUM'
    and upper(btrim(e.external_product_code))='140010';

  v_ready := (v_evidence->>'candidateCount')::bigint=164
    and (v_evidence->>'distinctNormalizedCodes')::bigint=164
    and (v_evidence->>'normalizedFailures')::bigint=0
    and (v_evidence->>'eligibleCandidateCount')::bigint=163
    and (v_evidence->>'enabledCandidateCount')::bigint=1
    and (v_evidence->>'canaryCount')::bigint=1
    and (v_evidence->>'expansionCount')::bigint=163
    and v_evidence->>'candidateSetSha256'='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
    and v_evidence->'componentHashes'->>'code'='d57e9fe728b7d2b272a6fd33e89e6f0e5d9dc7a5d32e525c95535912a9fe32ad'
    and v_evidence->'componentHashes'->>'mapping'='3edf75311bbab34995b7beb2fba38b9715aef142f0481fa1dfe4a621b5b510d1'
    and v_evidence->'componentHashes'->>'revision'='b3397bd903a2a9569a90c2e6217af87764641b99e4af6c1a5baf7ef630bc3131'
    and v_evidence->'componentHashes'->>'sourceSha'='c852383af29ebd2dfe5713a487963ff1470a18c88646c3f448fbcac97b6aebd5'
    and v_evidence->'componentHashes'->>'sourceKey'='40410822604cab1b49b8d5597a387c414b974adadc30b21f4b68ac75cbcb81f6'
    and (v_evidence->>'excludedHoldRows')::bigint=0
    and (v_evidence->>'planCommandCount')::bigint=1
    and (v_evidence->>'phaseUnlockCount')::bigint=1
    and (v_evidence->>'unlockCommandCount')::bigint=1
    and v_exact_unlock_commands=1
    and v_unlock_audits=1
    and (v_evidence->>'promotionCount')::bigint=0
    and (v_evidence->>'promotionCommandCount')::bigint=0
    and v_evidence->'canary'->>'externalProductCode'='140010'
    and v_evidence->'canary'->>'mappingId'='3001d0f1-6c1b-4b15-98a0-91443ca6b525'
    and (v_evidence->'canary'->>'mappingRevision')::bigint=0
    and v_evidence->'canary'->>'sourcePayloadSha256'='016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8'
    and v_evidence->'canary'->>'sourceExternalKey'='guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b'
    and coalesce((v_evidence->'canary'->>'enabled')::boolean,false)
    and v_canary_skus=0
    and v_canary_external_mappings=0
    and not coalesce((v_evidence->>'physicalAuthorityCreated')::boolean,false)
    and not coalesce((v_evidence->>'inventoryAuthorityCreated')::boolean,false)
    and not coalesce((v_evidence->>'imagePlanningIncluded')::boolean,false);

  return v_evidence || jsonb_build_object(
    'ready',v_ready,
    'exactUnlockCommandCount',v_exact_unlock_commands,
    'unlockAuditCount',v_unlock_audits,
    'unlockCommandId','61b13a7c-18d1-48f0-b317-96d23607ddfb',
    'promotionCommandId','7900f15b-bdae-444f-b22c-04000730e260',
    'canarySkuCount',v_canary_skus,
    'canaryExternalMappingCount',v_canary_external_mappings
  );
end;
$$;

create or replace function public.ecoflow_read_commercial_wave2_canary_promotion_preflight(
  p_requested_by uuid,
  p_expected_unlock_command_id uuid,
  p_expected_promotion_command_id uuid,
  p_expected_candidate_set_sha256 text,
  p_expected_canary_external_product_code text,
  p_expected_canary_mapping_id uuid,
  p_expected_canary_mapping_revision bigint,
  p_expected_canary_source_payload_sha256 text,
  p_expected_canary_source_external_key text
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_role text;
  v_evidence jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'COMMERCIAL_WAVE2_P2B_FORBIDDEN';
  end if;

  if p_requested_by is null
     or p_expected_unlock_command_id is distinct from '61b13a7c-18d1-48f0-b317-96d23607ddfb'::uuid
     or p_expected_promotion_command_id is distinct from '7900f15b-bdae-444f-b22c-04000730e260'::uuid
     or p_expected_candidate_set_sha256 is distinct from '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or upper(btrim(coalesce(p_expected_canary_external_product_code,'')))<>'140010'
     or p_expected_canary_mapping_id is distinct from '3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid
     or p_expected_canary_mapping_revision is distinct from 0::bigint
     or p_expected_canary_source_payload_sha256 is distinct from '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8'
     or p_expected_canary_source_external_key is distinct from 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b' then
    raise exception 'COMMERCIAL_WAVE2_P2B_INVALID';
  end if;

  v_evidence:=public.ecoflow_commercial_wave2_canary_promotion_evidence();
  return v_evidence || jsonb_build_object(
    'stage','P2B_SELECT_ONLY',
    'status',case when (v_evidence->>'ready')::boolean then 'READY' else 'HOLD' end
  );
end;
$$;

create or replace function public.ecoflow_execute_commercial_wave2_canary_promotion(
  p_command_id uuid,
  p_requested_by uuid,
  p_external_product_code text,
  p_unleashed_mapping_id uuid,
  p_expected_mapping_revision bigint,
  p_expected_source_payload_sha256 text,
  p_expected_candidate_set_sha256 text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_existing boolean;
  v_preflight jsonb;
  v_incumbent_result jsonb;
  v_postflight jsonb;
  v_exact_promotion bigint;
  v_exact_command bigint;
begin
  if p_command_id is distinct from '7900f15b-bdae-444f-b22c-04000730e260'::uuid
     or upper(btrim(coalesce(p_external_product_code,'')))<>'140010'
     or p_unleashed_mapping_id is distinct from '3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid
     or p_expected_mapping_revision is distinct from 0::bigint
     or p_expected_source_payload_sha256 is distinct from '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8'
     or p_expected_candidate_set_sha256 is distinct from '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'COMMERCIAL_WAVE2_P2B_INVALID';
  end if;

  select exists(
    select 1 from public.ecoflow_commercial_wave2_promotion_commands
    where command_id=p_command_id
  ) into v_existing;

  if not v_existing then
    v_preflight:=public.ecoflow_read_commercial_wave2_canary_promotion_preflight(
      p_requested_by,
      '61b13a7c-18d1-48f0-b317-96d23607ddfb',
      '7900f15b-bdae-444f-b22c-04000730e260',
      p_expected_candidate_set_sha256,
      '140010',
      '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
      0,
      '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b'
    );
    if not coalesce((v_preflight->>'ready')::boolean,false) then
      raise exception 'COMMERCIAL_WAVE2_P2B_GATE_DRIFT';
    end if;
  end if;

  v_incumbent_result:=public.ecoflow_promote_commercial_wave2_sku(
    p_command_id,
    p_requested_by,
    '140010',
    p_unleashed_mapping_id,
    p_expected_mapping_revision,
    p_expected_source_payload_sha256,
    btrim(p_reason)
  );

  v_postflight:=public.ecoflow_commercial_wave2_plan_evidence();

  select count(*) into v_exact_promotion
  from public.ecoflow_commercial_wave2_promotions p
  where p.external_product_code='140010'
    and p.unleashed_mapping_id='3001d0f1-6c1b-4b15-98a0-91443ca6b525'
    and p.source_payload_sha256='016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8'
    and p.authorization_command_id='7900f15b-bdae-444f-b22c-04000730e260';

  select count(*) into v_exact_command
  from public.ecoflow_commercial_wave2_promotion_commands c
  where c.command_id='7900f15b-bdae-444f-b22c-04000730e260'
    and c.external_product_code='140010'
    and c.unleashed_mapping_id='3001d0f1-6c1b-4b15-98a0-91443ca6b525'
    and c.expected_mapping_revision=0
    and c.expected_source_payload_sha256='016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8';

  if (v_postflight->>'candidateCount')::bigint<>164
     or (v_postflight->>'distinctNormalizedCodes')::bigint<>164
     or (v_postflight->>'enabledCandidateCount')::bigint<>1
     or not coalesce((v_postflight->'canary'->>'enabled')::boolean,false)
     or (v_postflight->>'phaseUnlockCount')::bigint<>1
     or (v_postflight->>'unlockCommandCount')::bigint<>1
     or (v_postflight->>'promotionCount')::bigint<>1
     or (v_postflight->>'promotionCommandCount')::bigint<>1
     or (v_postflight->>'planCommandCount')::bigint<>1
     or v_postflight->>'candidateSetSha256'<>p_expected_candidate_set_sha256
     or v_exact_promotion<>1
     or v_exact_command<>1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010')<>0
     or (select count(*) from public.skus where upper(btrim(sku_code))='140010')<>1
     or (select count(*) from public.external_product_mappings where provider='ORDERMENTUM' and upper(btrim(external_product_code))='140010')<>1 then
    raise exception 'COMMERCIAL_WAVE2_P2B_POSTCONDITION_DRIFT';
  end if;

  return v_incumbent_result || jsonb_build_object(
    'stage','P2B_CANARY_PROMOTION',
    'status','CANARY_PROMOTED',
    'commandId',p_command_id,
    'canaryExternalProductCode','140010',
    'enabledCandidateCount',1,
    'phaseUnlockCount',1,
    'unlockCommandCount',1,
    'promotionCount',1,
    'promotionCommandCount',1,
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false,
    'imageActionIncluded',false,
    'replayed',v_existing
  );
end;
$$;

revoke all on function public.ecoflow_commercial_wave2_canary_promotion_evidence()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_read_commercial_wave2_canary_promotion_preflight(uuid,uuid,uuid,text,text,uuid,bigint,text,text)
  from public,anon,authenticated;
revoke all on function public.ecoflow_execute_commercial_wave2_canary_promotion(uuid,uuid,text,uuid,bigint,text,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_read_commercial_wave2_canary_promotion_preflight(uuid,uuid,uuid,text,text,uuid,bigint,text,text)
  to service_role;
grant execute on function public.ecoflow_execute_commercial_wave2_canary_promotion(uuid,uuid,text,uuid,bigint,text,text,text)
  to service_role;

commit;
