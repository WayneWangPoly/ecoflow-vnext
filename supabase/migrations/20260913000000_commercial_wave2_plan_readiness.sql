-- ECOFLOW-R3-001: command-bound Commercial Promotion Wave 2 PLAN.
-- This forward migration does not execute PLAN, unlock a phase, or promote a SKU.

begin;

do $deps$
begin
  if to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotion_commands') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null
     or to_regprocedure('public.ecoflow_plan_unleashed_master_mappings(uuid,text)') is null
     or to_regprocedure('public.ecoflow_unleashed_json_boolean(jsonb)') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'COMMERCIAL_WAVE2_PLAN_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

create table if not exists public.ecoflow_commercial_wave2_plan_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  expected_protected_main_sha text not null
    check (expected_protected_main_sha ~ '^[0-9a-f]{40}$'),
  expected_candidate_count bigint not null check (expected_candidate_count=164),
  expected_candidate_set_sha256 text not null
    check (expected_candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'),
  expected_canary_external_product_code text not null
    check (expected_canary_external_product_code='140010'),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.ecoflow_commercial_wave2_plan_commands enable row level security;
revoke all on table public.ecoflow_commercial_wave2_plan_commands
  from public,anon,authenticated,service_role;

create or replace function public.ecoflow_commercial_wave2_plan_evidence()
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_count bigint;
  v_distinct_codes bigint;
  v_normalized_failures bigint;
  v_enabled bigint;
  v_canary_rows bigint;
  v_expansion_rows bigint;
  v_hash text;
  v_code_hash text;
  v_mapping_hash text;
  v_revision_hash text;
  v_source_sha_hash text;
  v_source_key_hash text;
  v_eligible bigint;
  v_hold_rows bigint;
  v_phase_unlocks bigint;
  v_unlock_commands bigint;
  v_promotions bigint;
  v_promotion_commands bigint;
  v_plan_commands bigint;
  v_canary jsonb;
  v_ready boolean;
begin
  select
    count(*),
    count(distinct upper(btrim(a.external_product_code))),
    count(*) filter(where a.external_product_code<>upper(btrim(a.external_product_code))),
    count(*) filter(where a.enabled),
    count(*) filter(where a.promotion_phase='CANARY'),
    count(*) filter(where a.promotion_phase='EXPANSION'),
    encode(extensions.digest(string_agg(concat_ws('|',
      a.external_product_code,a.unleashed_mapping_id::text,a.expected_mapping_revision::text,
      a.expected_source_payload_sha256,a.expected_source_external_key),
      chr(10) order by a.external_product_code collate "C"),'sha256'),'hex')
  into v_count,v_distinct_codes,v_normalized_failures,v_enabled,
       v_canary_rows,v_expansion_rows,v_hash
  from public.ecoflow_commercial_wave2_candidates a;

  select
    encode(extensions.digest(string_agg(a.external_product_code,
      chr(10) order by a.external_product_code collate "C"),'sha256'),'hex'),
    encode(extensions.digest(string_agg(concat_ws('|',a.external_product_code,a.unleashed_mapping_id::text),
      chr(10) order by a.external_product_code collate "C"),'sha256'),'hex'),
    encode(extensions.digest(string_agg(concat_ws('|',a.external_product_code,a.expected_mapping_revision::text),
      chr(10) order by a.external_product_code collate "C"),'sha256'),'hex'),
    encode(extensions.digest(string_agg(concat_ws('|',a.external_product_code,a.expected_source_payload_sha256),
      chr(10) order by a.external_product_code collate "C"),'sha256'),'hex'),
    encode(extensions.digest(string_agg(concat_ws('|',a.external_product_code,a.expected_source_external_key),
      chr(10) order by a.external_product_code collate "C"),'sha256'),'hex')
  into v_code_hash,v_mapping_hash,v_revision_hash,v_source_sha_hash,v_source_key_hash
  from public.ecoflow_commercial_wave2_candidates a;

  select count(*) into v_eligible
  from public.ecoflow_commercial_wave2_candidates a
  join public.ecoflow_unleashed_master_mappings m on m.id=a.unleashed_mapping_id
  join public.unleashed_raw_snapshots rs
    on rs.resource='products'
   and rs.external_key=a.expected_source_external_key
   and rs.payload_sha256=a.expected_source_payload_sha256
  where not a.enabled
    and a.candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
    and m.entity_type='PRODUCT'
    and m.mapping_status='UNMATCHED'
    and m.source_duplicate_count=1
    and upper(btrim(coalesce(m.source_external_code,'')))=a.external_product_code
    and m.source_external_key=a.expected_source_external_key
    and m.revision=a.expected_mapping_revision
    and m.source_payload_sha256=a.expected_source_payload_sha256
    and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=a.external_product_code
    and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
    and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
    and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
         where upper(btrim(coalesce(l.external_sku_code,'')))=a.external_product_code
           and l.is_visible_on_ordermentum)=1
    and not exists(select 1 from public.external_product_mappings e
      where e.provider='ORDERMENTUM'
        and upper(btrim(e.external_product_code))=a.external_product_code)
    and not exists(select 1 from public.skus s
      where upper(btrim(s.sku_code))=a.external_product_code);

  select count(*) into v_hold_rows
  from public.ecoflow_commercial_wave2_candidates
  where external_product_code in ('CCSB6-80','CCSKBM16-90');
  select count(*) into v_phase_unlocks from public.ecoflow_commercial_wave2_phase_unlocks;
  select count(*) into v_unlock_commands from public.ecoflow_commercial_wave2_unlock_commands;
  select count(*) into v_promotions from public.ecoflow_commercial_wave2_promotions;
  select count(*) into v_promotion_commands from public.ecoflow_commercial_wave2_promotion_commands;
  select count(*) into v_plan_commands from public.ecoflow_commercial_wave2_plan_commands;

  select jsonb_build_object(
    'externalProductCode',a.external_product_code,
    'mappingId',a.unleashed_mapping_id,
    'mappingRevision',a.expected_mapping_revision,
    'sourcePayloadSha256',a.expected_source_payload_sha256,
    'sourceExternalKey',a.expected_source_external_key,
    'enabled',a.enabled
  ) into v_canary
  from public.ecoflow_commercial_wave2_candidates a
  where a.promotion_phase='CANARY';

  v_ready := v_count=164
    and v_distinct_codes=164
    and v_normalized_failures=0
    and v_enabled=0
    and v_canary_rows=1
    and v_expansion_rows=163
    and v_hash='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
    and v_code_hash='d57e9fe728b7d2b272a6fd33e89e6f0e5d9dc7a5d32e525c95535912a9fe32ad'
    and v_mapping_hash='3edf75311bbab34995b7beb2fba38b9715aef142f0481fa1dfe4a621b5b510d1'
    and v_revision_hash='b3397bd903a2a9569a90c2e6217af87764641b99e4af6c1a5baf7ef630bc3131'
    and v_source_sha_hash='c852383af29ebd2dfe5713a487963ff1470a18c88646c3f448fbcac97b6aebd5'
    and v_source_key_hash='40410822604cab1b49b8d5597a387c414b974adadc30b21f4b68ac75cbcb81f6'
    and v_eligible=164
    and v_hold_rows=0
    and v_phase_unlocks=0
    and v_unlock_commands=0
    and v_promotions=0
    and v_promotion_commands=0
    and v_plan_commands=0
    and v_canary->>'externalProductCode'='140010'
    and not coalesce((v_canary->>'enabled')::boolean,true);

  return jsonb_build_object(
    'ready',v_ready,
    'candidateCount',v_count,
    'distinctNormalizedCodes',v_distinct_codes,
    'normalizedFailures',v_normalized_failures,
    'eligibleCandidateCount',v_eligible,
    'enabledCandidateCount',v_enabled,
    'canaryCount',v_canary_rows,
    'expansionCount',v_expansion_rows,
    'candidateSetSha256',v_hash,
    'componentHashes',jsonb_build_object(
      'code',v_code_hash,
      'mapping',v_mapping_hash,
      'revision',v_revision_hash,
      'sourceSha',v_source_sha_hash,
      'sourceKey',v_source_key_hash
    ),
    'canary',v_canary,
    'excludedHoldRows',v_hold_rows,
    'phaseUnlockCount',v_phase_unlocks,
    'unlockCommandCount',v_unlock_commands,
    'promotionCount',v_promotions,
    'promotionCommandCount',v_promotion_commands,
    'planCommandCount',v_plan_commands,
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false,
    'imagePlanningIncluded',false
  );
end;
$$;

create or replace function public.ecoflow_read_commercial_wave2_plan_preflight(
  p_requested_by uuid,
  p_expected_protected_main_sha text,
  p_expected_candidate_count bigint,
  p_expected_candidate_set_sha256 text,
  p_expected_canary_external_product_code text
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
    raise exception 'COMMERCIAL_WAVE2_PLAN_FORBIDDEN';
  end if;
  if p_requested_by is null
     or p_expected_protected_main_sha<>'101617435b787d4ac5f4b636e0dc8f9284ff473c'
     or p_expected_candidate_count<>164
     or p_expected_candidate_set_sha256<>'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or upper(btrim(coalesce(p_expected_canary_external_product_code,'')))<>'140010' then
    raise exception 'COMMERCIAL_WAVE2_PLAN_INVALID';
  end if;
  v_evidence:=public.ecoflow_commercial_wave2_plan_evidence();
  return v_evidence || jsonb_build_object(
    'stage','P0_SELECT_ONLY',
    'expectedProtectedMainSha',p_expected_protected_main_sha,
    'status',case when (v_evidence->>'ready')::boolean then 'READY' else 'HOLD' end
  );
end;
$$;

create or replace function public.ecoflow_plan_commercial_wave2(
  p_command_id uuid,
  p_requested_by uuid,
  p_expected_protected_main_sha text,
  p_expected_candidate_count bigint,
  p_expected_candidate_set_sha256 text,
  p_expected_canary_external_product_code text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_role text;
  v_payload_hash text;
  v_existing public.ecoflow_commercial_wave2_plan_commands%rowtype;
  v_preflight jsonb;
  v_postflight jsonb;
  v_planner_result jsonb;
  v_result jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'COMMERCIAL_WAVE2_PLAN_FORBIDDEN';
  end if;
  if p_command_id is null or p_requested_by is null
     or p_expected_protected_main_sha<>'101617435b787d4ac5f4b636e0dc8f9284ff473c'
     or p_expected_candidate_count<>164
     or p_expected_candidate_set_sha256<>'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or upper(btrim(coalesce(p_expected_canary_external_product_code,'')))<>'140010'
     or length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'COMMERCIAL_WAVE2_PLAN_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_commercial_wave2_plan',0));
  v_payload_hash:=encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,
    'expectedProtectedMainSha',p_expected_protected_main_sha,
    'expectedCandidateCount',p_expected_candidate_count,
    'expectedCandidateSetSha256',p_expected_candidate_set_sha256,
    'expectedCanaryExternalProductCode',upper(btrim(p_expected_canary_external_product_code)),
    'reason',btrim(p_reason)
  )::text,'sha256'),'hex');

  select * into v_existing
  from public.ecoflow_commercial_wave2_plan_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  v_preflight:=public.ecoflow_commercial_wave2_plan_evidence();
  if not coalesce((v_preflight->>'ready')::boolean,false) then
    raise exception 'COMMERCIAL_WAVE2_PLAN_GATE_DRIFT';
  end if;

  v_planner_result:=public.ecoflow_plan_unleashed_master_mappings(
    p_requested_by,btrim(p_reason));

  v_postflight:=public.ecoflow_commercial_wave2_plan_evidence();
  if not coalesce((v_postflight->>'ready')::boolean,false) then
    raise exception 'COMMERCIAL_WAVE2_PLAN_POSTCONDITION_DRIFT';
  end if;

  v_result:=jsonb_build_object(
    'stage','P1_PLAN',
    'status','PLANNED',
    'commandId',p_command_id,
    'protectedMainSha',p_expected_protected_main_sha,
    'candidateCount',164,
    'candidateSetSha256',p_expected_candidate_set_sha256,
    'canaryExternalProductCode','140010',
    'enabledCandidateCount',0,
    'promotionCount',0,
    'phaseUnlockCount',0,
    'plannerResult',v_planner_result,
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false,
    'imagePlanningIncluded',false,
    'replayed',false
  );

  insert into public.ecoflow_commercial_wave2_plan_commands(
    command_id,actor_user_id,expected_protected_main_sha,
    expected_candidate_count,expected_candidate_set_sha256,
    expected_canary_external_product_code,command_payload_sha256,result
  ) values(
    p_command_id,p_requested_by,p_expected_protected_main_sha,
    p_expected_candidate_count,p_expected_candidate_set_sha256,
    '140010',v_payload_hash,v_result
  );
  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values(
    p_requested_by,v_role,'COMMERCIAL_WAVE2_PLAN_COMPLETED',
    'ecoflow_commercial_wave2_plan_commands',p_command_id::text,
    v_preflight,v_result
  );
  return v_result;
end;
$$;

revoke all on function public.ecoflow_commercial_wave2_plan_evidence()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_read_commercial_wave2_plan_preflight(uuid,text,bigint,text,text)
  from public,anon,authenticated;
revoke all on function public.ecoflow_plan_commercial_wave2(uuid,uuid,text,bigint,text,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_read_commercial_wave2_plan_preflight(uuid,text,bigint,text,text)
  to service_role;
grant execute on function public.ecoflow_plan_commercial_wave2(uuid,uuid,text,bigint,text,text,text)
  to service_role;

commit;
