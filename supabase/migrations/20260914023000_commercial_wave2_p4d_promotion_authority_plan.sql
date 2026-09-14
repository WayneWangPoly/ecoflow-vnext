-- ECOFLOW-R3-P4D: replace stale service-role promotion authority and expose
-- authenticated SELECT-only promotion readiness. This migration performs no
-- Commercial SKU promotion and leaves the replacement promotion function dormant.

begin;

do $deps$
begin
  if to_regprocedure('public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)') is null
     or to_regprocedure('public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)') is null
     or to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotion_commands') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'COMMERCIAL_WAVE2_P4D_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

-- P4C must already be durably complete before promotion authority is changed.
do $p4c_closed$
begin
  if (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION') <> 163
     or (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled) <> 163
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks
         where promotion_phase='EXPANSION'
           and candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
           and unlocked_candidate_count=163
           and authorization_command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid) <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands
         where promotion_phase='EXPANSION'
           and command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid
           and (result->>'unlockedCandidateCount')::bigint=163
           and not coalesce((result->>'promotionIncluded')::boolean,true)
           and not coalesce((result->>'providerActionIncluded')::boolean,true)) <> 1
     or (select count(*) from public.app_security_audit_events
         where action='COMMERCIAL_WAVE2_EXPANSION_UNLOCKED_V2'
           and target_type='ecoflow_commercial_wave2_phase_unlocks'
           and target_id='EXPANSION') <> 1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010') <> 0
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands where external_product_code<>'140010') <> 0 then
    raise exception 'COMMERCIAL_WAVE2_P4D_P4C_CLOSURE_NOT_PROVEN';
  end if;
end;
$p4c_closed$;

-- Close the completed P4C mutation surface and revoke the incumbent promotion
-- function from every application role. The historical implementation remains
-- available only as an internal delegate for the new caller-authenticated wrapper.
revoke all on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;

comment on function public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text) is
  'REVOKED direct Wave-2 promotion authority. Retained only as the bounded internal delegate for P4D caller-authenticated promotion replacement. Do not re-grant to service_role or browser roles.';

create or replace function public.ecoflow_promote_commercial_wave2_expansion_sku_v2(
  p_command_id uuid,
  p_external_product_code text,
  p_unleashed_mapping_id uuid,
  p_expected_mapping_revision bigint,
  p_expected_source_payload_sha256 text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_code text := upper(btrim(coalesce(p_external_product_code,'')));
  v_candidate public.ecoflow_commercial_wave2_candidates%rowtype;
  v_existing boolean;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4D_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE';

  if v_role is null
     or v_role not in ('OWNER','ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4D_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  if p_command_id is null
     or p_unleashed_mapping_id is null
     or p_expected_mapping_revision is null
     or p_expected_mapping_revision < 0
     or p_expected_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or v_code=''
     or v_code in ('140010','CCSB6-80','CCSKBM16-90')
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'COMMERCIAL_WAVE2_P4D_INVALID';
  end if;

  select * into v_candidate
  from public.ecoflow_commercial_wave2_candidates
  where external_product_code=v_code
  for update;

  if not found
     or v_candidate.promotion_phase <> 'EXPANSION'
     or not v_candidate.enabled
     or v_candidate.candidate_set_sha256 <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or v_candidate.unleashed_mapping_id <> p_unleashed_mapping_id
     or v_candidate.expected_mapping_revision <> p_expected_mapping_revision
     or v_candidate.expected_source_payload_sha256 <> p_expected_source_payload_sha256 then
    raise exception 'COMMERCIAL_WAVE2_P4D_FROZEN_EXPANSION_EVIDENCE_MISMATCH';
  end if;

  if not exists (
    select 1 from public.ecoflow_commercial_wave2_phase_unlocks
    where promotion_phase='EXPANSION'
      and candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
      and unlocked_candidate_count=163
      and authorization_command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid
  ) then
    raise exception 'COMMERCIAL_WAVE2_P4D_EXPANSION_UNLOCK_NOT_PROVEN';
  end if;

  select exists(
    select 1 from public.ecoflow_commercial_wave2_promotion_commands
    where command_id=p_command_id
  ) into v_existing;

  -- Thin delegation preserves the previously verified business mutation surface:
  -- one Commercial SKU + one ORDERMENTUM external mapping + promotion/command/audit
  -- ledgers, with no Physical/package/barcode/inventory/provider authority.
  v_result := public.ecoflow_promote_commercial_wave2_sku(
    p_command_id,
    v_actor,
    v_code,
    p_unleashed_mapping_id,
    p_expected_mapping_revision,
    p_expected_source_payload_sha256,
    btrim(p_reason)
  );

  if v_result->>'externalProductCode' <> v_code
     or v_result->>'promotionPhase' <> 'EXPANSION'
     or v_result->>'candidateSetSha256' <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or coalesce((v_result->>'physicalAuthorityCreated')::boolean,true)
     or coalesce((v_result->>'inventoryAuthorityCreated')::boolean,true) then
    raise exception 'COMMERCIAL_WAVE2_P4D_DELEGATE_POSTCONDITION_MISMATCH';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'authorityVersion','P4D_CALLER_AUTH_PROMOTION_V2',
    'callerAuthenticated',true,
    'providerActionIncluded',false,
    'replayed',v_existing
  );
end;
$function$;

-- Dormant by design. P4E must separately activate authenticated EXECUTE and add
-- a bounded batch execution carrier. service_role must never receive this grant.
revoke all on function public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;

comment on function public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text) is
  'P4D dormant caller-authenticated EXPANSION promotion replacement. Direct legacy service-role authority is revoked. P4E activation required before any non-CANARY promotion.';

create or replace function public.ecoflow_read_commercial_wave2_p4d_promotion_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_failures jsonb := '[]'::jsonb;
  v_expansion_count bigint;
  v_enabled_count bigint;
  v_eligible_count bigint;
  v_non_canary_promotions bigint;
  v_non_canary_commands bigint;
  v_unlocks bigint;
  v_unlock_commands bigint;
  v_p4c_audits bigint;
  v_legacy_service boolean;
  v_legacy_auth boolean;
  v_p4c_auth boolean;
  v_v2_service boolean;
  v_v2_auth boolean;
  v_v2_anon boolean;
  v_plan_sha text;
  v_batches jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4D_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE';

  if v_role is null
     or v_role not in ('OWNER','ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4D_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  select count(*) into v_expansion_count
  from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION';
  select count(*) into v_enabled_count
  from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled;
  select count(*) into v_non_canary_promotions
  from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010';
  select count(*) into v_non_canary_commands
  from public.ecoflow_commercial_wave2_promotion_commands where external_product_code<>'140010';
  select count(*) into v_unlocks
  from public.ecoflow_commercial_wave2_phase_unlocks
  where promotion_phase='EXPANSION'
    and candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
    and unlocked_candidate_count=163
    and authorization_command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid;
  select count(*) into v_unlock_commands
  from public.ecoflow_commercial_wave2_unlock_commands
  where promotion_phase='EXPANSION'
    and command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid
    and (result->>'unlockedCandidateCount')::bigint=163
    and not coalesce((result->>'promotionIncluded')::boolean,true)
    and not coalesce((result->>'providerActionIncluded')::boolean,true);
  select count(*) into v_p4c_audits
  from public.app_security_audit_events
  where action='COMMERCIAL_WAVE2_EXPANSION_UNLOCKED_V2'
    and target_type='ecoflow_commercial_wave2_phase_unlocks'
    and target_id='EXPANSION';

  v_legacy_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute');
  v_legacy_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute');
  v_p4c_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute');
  v_v2_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute');
  v_v2_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute');
  v_v2_anon := pg_catalog.has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute');

  with eligible as (
    select a.external_product_code,a.unleashed_mapping_id,a.expected_mapping_revision,a.expected_source_payload_sha256
    from public.ecoflow_commercial_wave2_candidates a
    join public.ecoflow_unleashed_master_mappings m on m.id=a.unleashed_mapping_id
    where a.promotion_phase='EXPANSION'
      and a.enabled
      and a.candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
      and m.entity_type='PRODUCT'
      and m.mapping_status='UNMATCHED'
      and m.source_duplicate_count=1
      and upper(btrim(coalesce(m.source_external_code,'')))=a.external_product_code
      and m.source_external_key=a.expected_source_external_key
      and m.revision=a.expected_mapping_revision
      and m.source_payload_sha256=a.expected_source_payload_sha256
      and exists (
        select 1 from public.unleashed_raw_snapshots rs
        where rs.resource='products'
          and rs.external_key=a.expected_source_external_key
          and rs.payload_sha256=a.expected_source_payload_sha256
          and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=a.external_product_code
          and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
          and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
      )
      and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
        where upper(btrim(coalesce(l.external_sku_code,'')))=a.external_product_code
          and l.is_visible_on_ordermentum)=1
      and not exists (
        select 1 from public.external_product_mappings e
        where e.provider='ORDERMENTUM'
          and upper(btrim(e.external_product_code))=a.external_product_code
      )
      and not exists (
        select 1 from public.skus s
        where upper(btrim(s.sku_code))=a.external_product_code
      )
      and not exists (
        select 1 from public.ecoflow_commercial_wave2_promotions p
        where p.external_product_code=a.external_product_code
      )
  ), ranked as (
    select e.*,row_number() over(order by e.external_product_code collate "C") as rn
    from eligible e
  ), batches as (
    select ((rn-1)/25)::int+1 as batch_no,
           count(*)::int as candidate_count,
           (array_agg(external_product_code order by external_product_code collate "C"))[1] as first_code,
           (array_agg(external_product_code order by external_product_code collate "C"))[count(*)] as last_code,
           encode(extensions.digest(string_agg(
             concat_ws('|',external_product_code,unleashed_mapping_id::text,expected_mapping_revision::text,expected_source_payload_sha256),
             pg_catalog.chr(10) order by external_product_code collate "C"
           ),'sha256'),'hex') as batch_sha256
    from ranked
    group by ((rn-1)/25)::int+1
  ), plan as (
    select encode(extensions.digest(string_agg(
             concat_ws('|',batch_no::text,candidate_count::text,batch_sha256),
             pg_catalog.chr(10) order by batch_no
           ),'sha256'),'hex') as plan_sha256,
           pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'batchNo',batch_no,
             'candidateCount',candidate_count,
             'firstCode',first_code,
             'lastCode',last_code,
             'batchSha256',batch_sha256
           ) order by batch_no) as batches
    from batches
  )
  select (select count(*) from eligible),plan_sha256,batches
  into v_eligible_count,v_plan_sha,v_batches
  from plan;

  if v_expansion_count<>163 then v_failures:=v_failures||pg_catalog.jsonb_build_array('cohort.count'); end if;
  if v_enabled_count<>163 then v_failures:=v_failures||pg_catalog.jsonb_build_array('cohort.enabled'); end if;
  if v_eligible_count<>163 then v_failures:=v_failures||pg_catalog.jsonb_build_array('cohort.eligible'); end if;
  if v_non_canary_promotions<>0 or v_non_canary_commands<>0 then v_failures:=v_failures||pg_catalog.jsonb_build_array('promotion.lineage'); end if;
  if v_unlocks<>1 or v_unlock_commands<>1 or v_p4c_audits<>1 then v_failures:=v_failures||pg_catalog.jsonb_build_array('p4c.closure'); end if;
  if v_legacy_service or v_legacy_auth then v_failures:=v_failures||pg_catalog.jsonb_build_array('legacy.promotionAuthority'); end if;
  if v_p4c_auth then v_failures:=v_failures||pg_catalog.jsonb_build_array('p4c.mutationAuthorityStillOpen'); end if;
  if v_v2_service or v_v2_auth or v_v2_anon then v_failures:=v_failures||pg_catalog.jsonb_build_array('v2.notDormant'); end if;
  if v_plan_sha is distinct from '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888' then v_failures:=v_failures||pg_catalog.jsonb_build_array('batchPlan.hash'); end if;
  if pg_catalog.jsonb_array_length(coalesce(v_batches,'[]'::jsonb))<>7 then v_failures:=v_failures||pg_catalog.jsonb_build_array('batchPlan.count'); end if;

  return pg_catalog.jsonb_build_object(
    'mode','P4D_PROMOTION_READINESS_ONLY',
    'stage','P4D_PROMOTION_AUTHORITY_PLAN',
    'verdict',case when pg_catalog.jsonb_array_length(v_failures)=0 then 'PASS' else 'HOLD' end,
    'status',case when pg_catalog.jsonb_array_length(v_failures)=0 then 'READY_FOR_P4E_ENGINEERING' else 'HOLD' end,
    'verifiedAt',pg_catalog.statement_timestamp(),
    'verifierRole',v_role,
    'cohort',pg_catalog.jsonb_build_object(
      'candidateSetSha256','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'expansionCandidateCount',v_expansion_count,
      'enabledExpansionCount',v_enabled_count,
      'eligibleForPromotionCount',v_eligible_count,
      'nonCanaryPromotionCount',v_non_canary_promotions,
      'nonCanaryPromotionCommandCount',v_non_canary_commands
    ),
    'p4c',pg_catalog.jsonb_build_object(
      'unlockCount',v_unlocks,
      'unlockCommandCount',v_unlock_commands,
      'auditCount',v_p4c_audits,
      'frozenCommandId','430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'
    ),
    'authority',pg_catalog.jsonb_build_object(
      'legacyServiceRoleExecute',v_legacy_service,
      'legacyAuthenticatedExecute',v_legacy_auth,
      'p4cAuthenticatedExecute',v_p4c_auth,
      'v2AuthenticatedExecute',v_v2_auth,
      'v2ServiceRoleExecute',v_v2_service,
      'v2AnonExecute',v_v2_anon,
      'productionPromotionAuthorized',false,
      'providerActionIncluded',false,
      'physicalAuthorityIncluded',false,
      'inventoryAuthorityIncluded',false
    ),
    'batchPlan',pg_catalog.jsonb_build_object(
      'batchSize',25,
      'batchCount',7,
      'promotionPlanSha256',v_plan_sha,
      'expectedPromotionPlanSha256','43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
      'batches',coalesce(v_batches,'[]'::jsonb)
    ),
    'failedChecks',v_failures
  );
end;
$function$;

revoke all on function public.ecoflow_read_commercial_wave2_p4d_promotion_readiness()
  from public, anon, service_role;
grant execute on function public.ecoflow_read_commercial_wave2_p4d_promotion_readiness()
  to authenticated;

commit;
