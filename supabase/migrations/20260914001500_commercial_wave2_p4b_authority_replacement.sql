-- #338 Commercial Promotion Wave 2 P4B authority replacement.
-- Engineering intent: remove the stale service-role P4 expansion authority and
-- install a caller-authenticated replacement in a DORMANT state.
--
-- IMPORTANT: this migration does NOT authorize production expansion. The v2
-- mutation function is explicitly revoked from public, anon, authenticated and
-- service_role. A later, separately authorized activation gate must grant it.

begin;

do $deps$
begin
  if to_regprocedure('public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)') is null
     or to_regprocedure('public.ecoflow_read_commercial_wave2_p4_readiness()') is null
     or to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null then
    raise exception 'COMMERCIAL_WAVE2_P4B_DEPENDENCIES_MISSING';
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'COMMERCIAL_WAVE2_P4B_DIGEST_MISSING';
  end if;
end;
$deps$;

-- Revoke the stale service-role authority first. Keep the historical function
-- definition for auditability, but remove every application-facing execution path.
revoke all on function public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated, service_role;

comment on function public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)
  is 'REVOKED legacy Wave-2 EXPANSION unlock. P4A proved its CANARY MATCHED gate is incompatible with real P2B/P3 production state. Do not re-grant.';

create or replace function public.ecoflow_unlock_commercial_wave2_expansion_v2(
  p_command_id uuid,
  p_expected_candidate_set_sha256 text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_payload_hash text;
  v_existing public.ecoflow_commercial_wave2_unlock_commands%rowtype;
  v_p4a jsonb;
  v_canary public.ecoflow_commercial_wave2_candidates%rowtype;
  v_source public.ecoflow_unleashed_master_mappings%rowtype;
  v_promotion public.ecoflow_commercial_wave2_promotions%rowtype;
  v_eligible bigint;
  v_updated bigint;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P4B_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id = v_actor and p.is_active and p.team_status = 'ACTIVE';

  if v_role is null
     or v_role not in ('OWNER', 'ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P4B_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  if p_command_id is null
     or p_expected_candidate_set_sha256 <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'COMMERCIAL_WAVE2_P4B_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_commercial_wave2_unlock_v2:EXPANSION', 0)
  );

  v_payload_hash := encode(extensions.digest(pg_catalog.jsonb_build_object(
    'authorityVersion', 'P4B_CALLER_AUTH_V2',
    'actorUserId', v_actor,
    'phase', 'EXPANSION',
    'candidateSetSha256', p_expected_candidate_set_sha256,
    'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');

  select * into v_existing
  from public.ecoflow_commercial_wave2_unlock_commands
  where command_id = p_command_id;

  if found then
    if v_existing.promotion_phase <> 'EXPANSION'
       or v_existing.actor_user_id <> v_actor
       or v_existing.command_payload_sha256 <> v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return pg_catalog.jsonb_set(v_existing.result, '{replayed}', 'true'::jsonb, true);
  end if;

  if exists (
    select 1 from public.ecoflow_commercial_wave2_phase_unlocks
    where promotion_phase = 'EXPANSION'
  ) then
    raise exception 'COMMERCIAL_WAVE2_P4B_EXPANSION_ALREADY_UNLOCKED';
  end if;

  -- Reuse the authenticated P4A contract as the first gate. P4A itself verifies
  -- P3 PASS, frozen cohort hash, 163/163 eligibility, zero expansion enablement,
  -- zero expansion unlocks, zero non-CANARY promotions and the real CANARY state.
  v_p4a := public.ecoflow_read_commercial_wave2_p4_readiness();
  if v_p4a ->> 'verdict' <> 'PASS'
     or v_p4a ->> 'status' <> 'READY_FOR_P4B_ENGINEERING'
     or (v_p4a -> 'cohort' ->> 'eligibleExpansionCount')::bigint <> 163
     or (v_p4a -> 'cohort' ->> 'enabledExpansionCount')::bigint <> 0
     or (v_p4a -> 'lineage' ->> 'expansionUnlockCount')::bigint <> 0
     or (v_p4a -> 'lineage' ->> 'nonCanaryPromotionCount')::bigint <> 0
     or v_p4a -> 'cohort' ->> 'recomputedCandidateSetSha256' <> p_expected_candidate_set_sha256
     or (v_p4a -> 'legacyExpansionUnlock' ->> 'compatibleWithCurrentCanaryState')::boolean then
    raise exception 'COMMERCIAL_WAVE2_P4B_READINESS_NOT_PROVEN';
  end if;

  select * into v_canary
  from public.ecoflow_commercial_wave2_candidates
  where promotion_phase = 'CANARY'
  for update;

  if not found
     or v_canary.external_product_code <> '140010'
     or not v_canary.enabled
     or v_canary.unleashed_mapping_id <> '3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid
     or v_canary.expected_mapping_revision <> 0
     or v_canary.expected_source_payload_sha256 <> '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8' then
    raise exception 'COMMERCIAL_WAVE2_P4B_CANARY_FROZEN_STATE_MISMATCH';
  end if;

  select * into v_source
  from public.ecoflow_unleashed_master_mappings
  where id = v_canary.unleashed_mapping_id
  for update;

  select * into v_promotion
  from public.ecoflow_commercial_wave2_promotions
  where external_product_code = v_canary.external_product_code;

  if v_source.id is null
     or v_source.mapping_status <> 'UNMATCHED'
     or v_source.revision <> v_canary.expected_mapping_revision
     or v_source.source_payload_sha256 <> v_canary.expected_source_payload_sha256
     or v_promotion.commercial_sku_id <> '4710bb98-2706-42e5-866b-8788e36e1acc'::uuid
     or v_promotion.external_mapping_id <> '1995b15c-7ee7-466b-ba3e-daba596d71a3'::uuid then
    raise exception 'COMMERCIAL_WAVE2_P4B_CANARY_POST_P2B_STATE_MISMATCH';
  end if;

  -- Lock every expansion candidate and its source mapping before the final
  -- eligibility recomputation so revision drift cannot race the enablement.
  perform 1
  from public.ecoflow_commercial_wave2_candidates a
  where a.promotion_phase = 'EXPANSION'
  order by a.external_product_code
  for update;

  perform 1
  from public.ecoflow_unleashed_master_mappings m
  join public.ecoflow_commercial_wave2_candidates a on a.unleashed_mapping_id = m.id
  where a.promotion_phase = 'EXPANSION'
  order by m.id
  for update of m;

  select count(*) into v_eligible
  from public.ecoflow_commercial_wave2_candidates a
  join public.ecoflow_unleashed_master_mappings m on m.id = a.unleashed_mapping_id
  join public.unleashed_raw_snapshots rs
    on rs.resource = 'products'
   and rs.external_key = a.expected_source_external_key
   and rs.payload_sha256 = a.expected_source_payload_sha256
  where a.promotion_phase = 'EXPANSION'
    and not a.enabled
    and a.candidate_set_sha256 = p_expected_candidate_set_sha256
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
    );

  if v_eligible <> 163 then
    raise exception 'COMMERCIAL_WAVE2_P4B_EXPANSION_SET_DRIFT';
  end if;

  -- Repeat the complete eligibility predicate inside the mutation statement.
  -- READ COMMITTED gives each statement a fresh snapshot; this prevents a row
  -- inserted or changed between the count and UPDATE from being enabled merely
  -- because it carries the frozen cohort hash. Any eligible phantom makes the
  -- affected row count differ from 163 and rolls back the entire transaction.
  update public.ecoflow_commercial_wave2_candidates a
  set enabled = true
  from public.ecoflow_unleashed_master_mappings m,
       public.unleashed_raw_snapshots rs
  where a.promotion_phase = 'EXPANSION'
    and not a.enabled
    and a.candidate_set_sha256 = p_expected_candidate_set_sha256
    and m.id = a.unleashed_mapping_id
    and m.entity_type = 'PRODUCT'
    and m.mapping_status = 'UNMATCHED'
    and m.source_duplicate_count = 1
    and upper(btrim(coalesce(m.source_external_code, ''))) = a.external_product_code
    and m.source_external_key = a.expected_source_external_key
    and m.revision = a.expected_mapping_revision
    and m.source_payload_sha256 = a.expected_source_payload_sha256
    and rs.resource = 'products'
    and rs.external_key = a.expected_source_external_key
    and rs.payload_sha256 = a.expected_source_payload_sha256
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
    );

  get diagnostics v_updated = row_count;
  if v_updated <> 163 then
    raise exception 'COMMERCIAL_WAVE2_P4B_EXPANSION_UNLOCK_COUNT_MISMATCH';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'authorityVersion', 'P4B_CALLER_AUTH_V2',
    'promotionPhase', 'EXPANSION',
    'unlockedCandidateCount', 163,
    'candidateSetSha256', p_expected_candidate_set_sha256,
    'canaryExternalProductCode', v_canary.external_product_code,
    'canaryMappingRevision', v_source.revision,
    'canaryCommercialSkuId', v_promotion.commercial_sku_id,
    'providerActionIncluded', false,
    'promotionIncluded', false,
    'physicalAuthorityCreated', false,
    'inventoryAuthorityCreated', false,
    'replayed', false
  );

  insert into public.ecoflow_commercial_wave2_phase_unlocks(
    promotion_phase,
    candidate_set_sha256,
    unlocked_candidate_count,
    canary_external_product_code,
    canary_mapping_revision,
    canary_source_payload_sha256,
    canary_commercial_sku_id,
    authorization_command_id,
    unlocked_by,
    reason
  ) values (
    'EXPANSION',
    p_expected_candidate_set_sha256,
    163,
    v_canary.external_product_code,
    v_source.revision,
    v_source.source_payload_sha256,
    v_promotion.commercial_sku_id,
    p_command_id,
    v_actor,
    btrim(p_reason)
  );

  insert into public.ecoflow_commercial_wave2_unlock_commands(
    command_id,
    actor_user_id,
    promotion_phase,
    command_payload_sha256,
    result
  ) values (
    p_command_id,
    v_actor,
    'EXPANSION',
    v_payload_hash,
    v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    before_data,
    after_data
  ) values (
    v_actor,
    v_role,
    'COMMERCIAL_WAVE2_EXPANSION_UNLOCKED_V2',
    'ecoflow_commercial_wave2_phase_unlocks',
    'EXPANSION',
    pg_catalog.jsonb_build_object(
      'enabledExpansionCount', 0,
      'legacyServiceRoleAuthorityRevoked', true
    ),
    v_result
  );

  return v_result;
end;
$function$;

-- P4B engineering leaves the replacement function dormant. No browser role and
-- no service role can execute it until a later explicit activation migration.
revoke all on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)
  from public, anon, authenticated, service_role;

comment on function public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)
  is 'P4B dormant caller-authenticated EXPANSION unlock replacement. Not production-authorized and intentionally ungranted. P4C activation required.';

commit;
