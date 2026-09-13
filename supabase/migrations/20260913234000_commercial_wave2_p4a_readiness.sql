-- ECOFLOW-R3-P4A: caller-authenticated, read-only Wave-2 expansion readiness.
-- P3 is complete, but the incumbent EXPANSION unlock gate was written against a
-- test-only CANARY source-mapping mutation. Production P2B created the Commercial
-- SKU + active ORDERMENTUM mapping while leaving the frozen Unleashed source
-- mapping UNMATCHED at revision 0. P4A proves readiness only and does not invoke
-- or expose production expansion authority.

begin;

do $dependencies$
begin
  if to_regprocedure('public.ecoflow_read_commercial_wave2_p3_verification_v3()') is null
     or to_regprocedure('public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)') is null
     or to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'COMMERCIAL_WAVE2_P4A_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

create or replace function public.ecoflow_read_commercial_wave2_p4_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_p3 jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_candidate_count bigint;
  v_canary_count bigint;
  v_expansion_count bigint;
  v_enabled_canary bigint;
  v_enabled_expansion bigint;
  v_expansion_unlocks bigint;
  v_non_canary_promotions bigint;
  v_eligible_expansion bigint;
  v_candidate_hash text;
  v_stored_hash_count bigint;
  v_stored_hash text;
  v_canary public.ecoflow_commercial_wave2_candidates%rowtype;
  v_source public.ecoflow_unleashed_master_mappings%rowtype;
  v_promotion public.ecoflow_commercial_wave2_promotions%rowtype;
  v_legacy_compatible boolean := false;
  v_legacy_service_role_execute boolean := false;
  v_ineligible_codes jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P4A_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role into v_actor_role
  from public.app_user_profiles p
  where p.user_id = v_actor and p.is_active and p.team_status = 'ACTIVE';

  if v_actor_role is null
     or v_actor_role not in ('OWNER', 'ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_actor_role then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P4A_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  v_p3 := public.ecoflow_read_commercial_wave2_p3_verification_v3();
  if v_p3 ->> 'verdict' <> 'PASS' then
    v_failures := v_failures || pg_catalog.jsonb_build_array('p3.verdict');
  end if;
  if not coalesce((v_p3 ->> 'p4Locked')::boolean, false) then
    v_failures := v_failures || pg_catalog.jsonb_build_array('p3.p4Locked');
  end if;

  select count(*),
         count(*) filter (where promotion_phase = 'CANARY'),
         count(*) filter (where promotion_phase = 'EXPANSION'),
         count(*) filter (where promotion_phase = 'CANARY' and enabled),
         count(*) filter (where promotion_phase = 'EXPANSION' and enabled),
         count(distinct candidate_set_sha256),
         min(candidate_set_sha256)
    into v_candidate_count, v_canary_count, v_expansion_count,
         v_enabled_canary, v_enabled_expansion, v_stored_hash_count, v_stored_hash
  from public.ecoflow_commercial_wave2_candidates;

  select encode(extensions.digest(pg_catalog.string_agg(pg_catalog.concat_ws('|',
      external_product_code,
      unleashed_mapping_id::text,
      expected_mapping_revision::text,
      expected_source_payload_sha256,
      expected_source_external_key
    ), pg_catalog.chr(10) order by external_product_code collate "C"), 'sha256'), 'hex')
    into v_candidate_hash
  from public.ecoflow_commercial_wave2_candidates;

  select * into v_canary
  from public.ecoflow_commercial_wave2_candidates
  where promotion_phase = 'CANARY';

  if found then
    select * into v_source
    from public.ecoflow_unleashed_master_mappings
    where id = v_canary.unleashed_mapping_id;

    select * into v_promotion
    from public.ecoflow_commercial_wave2_promotions
    where external_product_code = v_canary.external_product_code;
  end if;

  select count(*) into v_expansion_unlocks
  from public.ecoflow_commercial_wave2_phase_unlocks
  where promotion_phase = 'EXPANSION';

  select count(*) into v_non_canary_promotions
  from public.ecoflow_commercial_wave2_promotions
  where external_product_code <> '140010';

  with evaluation as (
    select a.external_product_code,
      (
        not a.enabled
        and m.entity_type = 'PRODUCT'
        and m.mapping_status = 'UNMATCHED'
        and m.source_duplicate_count = 1
        and upper(btrim(coalesce(m.source_external_code, ''))) = a.external_product_code
        and m.source_external_key = a.expected_source_external_key
        and m.revision = a.expected_mapping_revision
        and m.source_payload_sha256 = a.expected_source_payload_sha256
        and upper(btrim(coalesce(rs.payload ->> 'ProductCode', ''))) = a.external_product_code
        and not public.ecoflow_unleashed_json_boolean(rs.payload -> 'Obsolete')
        and lower(coalesce(rs.payload ->> 'Status', '')) not in ('obsolete', 'inactive', 'retired')
        and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
             where upper(btrim(coalesce(l.external_sku_code, ''))) = a.external_product_code
               and l.is_visible_on_ordermentum) = 1
        and not exists (
          select 1 from public.external_product_mappings e
          where e.provider = 'ORDERMENTUM'
            and upper(btrim(e.external_product_code)) = a.external_product_code
        )
        and not exists (
          select 1 from public.skus s
          where upper(btrim(s.sku_code)) = a.external_product_code
        )
      ) as eligible
    from public.ecoflow_commercial_wave2_candidates a
    join public.ecoflow_unleashed_master_mappings m on m.id = a.unleashed_mapping_id
    join public.unleashed_raw_snapshots rs
      on rs.resource = 'products'
     and rs.external_key = a.expected_source_external_key
     and rs.payload_sha256 = a.expected_source_payload_sha256
    where a.promotion_phase = 'EXPANSION'
  )
  select count(*) filter (where eligible),
         coalesce(pg_catalog.jsonb_agg(external_product_code order by external_product_code)
           filter (where not eligible), '[]'::jsonb)
    into v_eligible_expansion, v_ineligible_codes
  from evaluation;

  v_legacy_service_role_execute := pg_catalog.has_function_privilege(
    'service_role',
    'public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)',
    'execute'
  );

  v_legacy_compatible :=
    v_source.id is not null
    and v_promotion.commercial_sku_id is not null
    and v_source.mapping_status = 'MATCHED'
    and v_source.match_method = 'ORDERMENTUM_PRODUCT_CODE_EXACT'
    and v_source.canonical_object_type = 'COMMERCIAL_SKU'
    and v_source.canonical_object_id = v_promotion.commercial_sku_id
    and upper(btrim(coalesce(v_source.canonical_code, ''))) = v_canary.external_product_code
    and v_source.candidate_count = 1;

  if v_candidate_count <> 164 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.candidateCount'); end if;
  if v_canary_count <> 1 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.canaryCount'); end if;
  if v_expansion_count <> 163 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.expansionCount'); end if;
  if v_enabled_canary <> 1 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.enabledCanary'); end if;
  if v_enabled_expansion <> 0 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.enabledExpansion'); end if;
  if v_eligible_expansion <> 163 then v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.eligibleExpansion'); end if;
  if v_stored_hash_count <> 1 or v_stored_hash <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a' then
    v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.storedHash');
  end if;
  if v_candidate_hash <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a' then
    v_failures := v_failures || pg_catalog.jsonb_build_array('cohort.recomputedHash');
  end if;
  if v_expansion_unlocks <> 0 then v_failures := v_failures || pg_catalog.jsonb_build_array('lineage.expansionUnlocks'); end if;
  if v_non_canary_promotions <> 0 then v_failures := v_failures || pg_catalog.jsonb_build_array('lineage.nonCanaryPromotions'); end if;

  if v_canary.external_product_code is null
     or v_canary.external_product_code <> '140010'
     or v_source.id is null
     or v_source.id is distinct from '3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid
     or v_source.mapping_status is distinct from 'UNMATCHED'
     or v_source.revision is distinct from 0
     or v_source.source_payload_sha256 is distinct from '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8'
     or v_promotion.commercial_sku_id is distinct from '4710bb98-2706-42e5-866b-8788e36e1acc'::uuid
     or v_promotion.external_mapping_id is distinct from '1995b15c-7ee7-466b-ba3e-daba596d71a3'::uuid then
    v_failures := v_failures || pg_catalog.jsonb_build_array('canary.postP2BState');
  end if;

  if v_legacy_compatible then
    v_failures := v_failures || pg_catalog.jsonb_build_array('legacyExpansionUnlock.unexpectedlyCompatible');
  end if;

  return pg_catalog.jsonb_build_object(
    'mode', 'P4A_READINESS_ONLY',
    'stage', 'P4A_EXPANSION_READINESS',
    'verdict', case when pg_catalog.jsonb_array_length(v_failures) = 0 then 'PASS' else 'HOLD' end,
    'status', case when pg_catalog.jsonb_array_length(v_failures) = 0 then 'READY_FOR_P4B_ENGINEERING' else 'HOLD' end,
    'verifiedAt', pg_catalog.statement_timestamp(),
    'verifierRole', v_actor_role,
    'p3', pg_catalog.jsonb_build_object(
      'verdict', v_p3 ->> 'verdict',
      'p4Locked', coalesce((v_p3 ->> 'p4Locked')::boolean, false),
      'providerStatus', v_p3 -> 'providerSentinel' ->> 'status',
      'commercialSkuId', v_p3 -> 'identity' ->> 'id',
      'activeOrdermentumMappingId', v_p3 -> 'mapping' ->> 'id'
    ),
    'cohort', pg_catalog.jsonb_build_object(
      'candidateSetSha256', v_stored_hash,
      'recomputedCandidateSetSha256', v_candidate_hash,
      'candidateCount', v_candidate_count,
      'canaryCount', v_canary_count,
      'expansionCandidateCount', v_expansion_count,
      'enabledCanaryCount', v_enabled_canary,
      'enabledExpansionCount', v_enabled_expansion,
      'eligibleExpansionCount', v_eligible_expansion,
      'ineligibleExpansionCount', v_expansion_count - v_eligible_expansion,
      'ineligibleCodes', v_ineligible_codes
    ),
    'canary', pg_catalog.jsonb_build_object(
      'externalProductCode', v_canary.external_product_code,
      'sourceMappingId', v_source.id,
      'sourceMappingStatus', v_source.mapping_status,
      'sourceMappingRevision', v_source.revision,
      'sourcePayloadSha256', v_source.source_payload_sha256,
      'commercialSkuId', v_promotion.commercial_sku_id,
      'activeOrdermentumMappingId', v_promotion.external_mapping_id
    ),
    'lineage', pg_catalog.jsonb_build_object(
      'expansionUnlockCount', v_expansion_unlocks,
      'nonCanaryPromotionCount', v_non_canary_promotions
    ),
    'legacyExpansionUnlock', pg_catalog.jsonb_build_object(
      'functionPresent', true,
      'serviceRoleExecute', v_legacy_service_role_execute,
      'compatibleWithCurrentCanaryState', v_legacy_compatible,
      'blocker', 'CANARY_SOURCE_MAPPING_REMAINS_UNMATCHED_BY_DESIGN',
      'requiredNextGate', 'P4B_REPLACE_OR_REVOKE_LEGACY_UNLOCK'
    ),
    'authority', pg_catalog.jsonb_build_object(
      'p4aMutationCapabilityExposed', false,
      'productionExpansionAuthorized', false,
      'providerActionIncluded', false,
      'inventoryAuthorityIncluded', false,
      'physicalAuthorityIncluded', false,
      'imageActionIncluded', false
    ),
    'failedChecks', v_failures
  );
end;
$function$;

comment on function public.ecoflow_read_commercial_wave2_p4_readiness() is
  'P4A SELECT-only readiness: requires P3 PASS, revalidates the frozen 163-row expansion cohort, and proves the incumbent service-role expansion unlock is stale/incompatible. Adds no P4 execution authority.';

revoke all on function public.ecoflow_read_commercial_wave2_p4_readiness()
  from public, anon, service_role;
grant execute on function public.ecoflow_read_commercial_wave2_p4_readiness()
  to authenticated;

commit;
