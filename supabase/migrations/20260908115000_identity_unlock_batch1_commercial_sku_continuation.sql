-- #338 Identity Unlock Batch 1B post-canary continuation
--
-- Authority boundary:
--   * unlocks only the 21 rows already frozen as AFTER_CANARY;
--   * requires the CCSA8-90 production-canary state to remain exact MATCHED and queue-ready;
--   * requires every continuation row to remain a single-source UNMATCHED Unleashed product
--     with exact Ordermentum commercial evidence and no pre-existing Commercial identity;
--   * creates Commercial identity only through a separate continuation RPC;
--   * never creates Physical SKU/family/package/barcode, sku_units, inventory/location/SOH,
--     opening-balance, substitution or cutover authority;
--   * CCSB6-80 remains an explicit conflict and is never allowlisted.

begin;

do $deps$
begin
  if to_regclass('public.ecoflow_bounded_commercial_sku_promotion_allowlist') is null
     or to_regclass('public.ecoflow_bounded_commercial_sku_promotions') is null
     or to_regclass('public.ecoflow_bounded_commercial_sku_promotion_commands') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.v_ecoflow_ordermentum_sku_mapping_workbench') is null
     or to_regclass('public.ecoflow_barcode_survey_observations') is null
     or to_regclass('public.ecoflow_barcode_survey_identity_reconciliations') is null
     or to_regclass('public.ecoflow_physical_barcode_bindings') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null then
    raise exception 'IDENTITY_UNLOCK_CONTINUATION_DEPENDENCIES_MISSING';
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('public.ecoflow_promote_bounded_commercial_sku(uuid,uuid,text,uuid,bigint,text,text)') is null then
    raise exception 'IDENTITY_UNLOCK_CONTINUATION_FUNCTION_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

create table if not exists public.ecoflow_bounded_commercial_sku_phase_unlocks (
  promotion_phase text primary key check (promotion_phase='AFTER_CANARY'),
  canary_external_product_code text not null check (canary_external_product_code='CCSA8-90'),
  canary_unleashed_mapping_id uuid not null references public.ecoflow_unleashed_master_mappings(id) on delete restrict,
  canary_mapping_revision bigint not null check (canary_mapping_revision>=0),
  canary_source_payload_sha256 text not null check (canary_source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  canary_commercial_sku_id uuid not null references public.skus(id) on delete restrict,
  canary_queue_observation_id uuid not null references public.ecoflow_barcode_survey_observations(id) on delete restrict,
  canary_carton_barcode text not null,
  canary_queue_status text not null check (canary_queue_status='READY_TO_RECONCILE'),
  canary_commercial_match_count bigint not null check (canary_commercial_match_count=1),
  unlocked_candidate_count bigint not null check (unlocked_candidate_count=21),
  authorization_command_id uuid not null unique,
  unlocked_by uuid not null,
  unlocked_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason))>=3)
);

create table if not exists public.ecoflow_bounded_commercial_sku_phase_unlock_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  actor_user_id uuid not null,
  expected_canary_mapping_revision bigint not null check (expected_canary_mapping_revision>=0),
  expected_canary_source_payload_sha256 text not null check (expected_canary_source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.ecoflow_bounded_commercial_sku_phase_unlocks enable row level security;
alter table public.ecoflow_bounded_commercial_sku_phase_unlock_commands enable row level security;

revoke all on table public.ecoflow_bounded_commercial_sku_phase_unlocks
  from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_bounded_commercial_sku_phase_unlock_commands
  from public,anon,authenticated,service_role;

create or replace function public.ecoflow_unlock_bounded_commercial_sku_after_canary(
  p_command_id uuid,
  p_requested_by uuid,
  p_expected_canary_mapping_revision bigint,
  p_expected_canary_source_payload_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_canary_promotion public.ecoflow_bounded_commercial_sku_promotions%rowtype;
  v_existing_command public.ecoflow_bounded_commercial_sku_phase_unlock_commands%rowtype;
  v_payload_hash text;
  v_after_total bigint;
  v_after_enabled bigint;
  v_eligible bigint;
  v_unlocked bigint;
  v_queue_observation_id uuid;
  v_queue_carton_barcode text;
  v_result jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'COMMERCIAL_CONTINUATION_UNLOCK_FORBIDDEN';
  end if;

  if p_command_id is null or p_requested_by is null
     or p_expected_canary_mapping_revision is null or p_expected_canary_mapping_revision<0
     or p_expected_canary_source_payload_sha256 is null
     or p_expected_canary_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'COMMERCIAL_CONTINUATION_UNLOCK_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_commercial_continuation_unlock_command:'||p_command_id::text,0)
  );

  v_payload_hash := encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,
    'expectedCanaryMappingRevision',p_expected_canary_mapping_revision,
    'expectedCanarySourcePayloadSha256',p_expected_canary_source_payload_sha256,
    'reason',btrim(p_reason),
    'promotionPhase','AFTER_CANARY'
  )::text,'sha256'),'hex');

  select * into v_existing_command
  from public.ecoflow_bounded_commercial_sku_phase_unlock_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing_command.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing_command.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_commercial_continuation_phase:AFTER_CANARY',0)
  );

  if exists(select 1 from public.ecoflow_bounded_commercial_sku_phase_unlocks where promotion_phase='AFTER_CANARY') then
    raise exception 'COMMERCIAL_CONTINUATION_ALREADY_UNLOCKED';
  end if;

  select count(*),count(*) filter(where enabled)
  into v_after_total,v_after_enabled
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist
  where promotion_phase='AFTER_CANARY';

  if v_after_total<>21 or v_after_enabled<>0
     or not exists(
       select 1 from public.ecoflow_bounded_commercial_sku_promotion_allowlist
       where external_product_code='CCSA8-90' and promotion_phase='CANARY' and enabled
     )
     or exists(
       select 1 from public.ecoflow_bounded_commercial_sku_promotion_allowlist
       where external_product_code='CCSB6-80'
     ) then
    raise exception 'COMMERCIAL_CONTINUATION_ALLOWLIST_DRIFT';
  end if;

  select * into v_canary
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='PRODUCT'
    and upper(btrim(coalesce(m.source_external_code,'')))='CCSA8-90'
  for update;
  if not found
     or v_canary.mapping_status<>'MATCHED'
     or v_canary.revision<>p_expected_canary_mapping_revision
     or v_canary.source_payload_sha256<>p_expected_canary_source_payload_sha256
     or v_canary.source_duplicate_count<>1
     or v_canary.match_method<>'ORDERMENTUM_PRODUCT_CODE_EXACT'
     or v_canary.canonical_object_type<>'COMMERCIAL_SKU'
     or v_canary.canonical_code<>'CCSA8-90'
     or v_canary.candidate_count<>1 then
    raise exception 'COMMERCIAL_CONTINUATION_CANARY_EXACT_MATCH_NOT_PROVEN';
  end if;

  select * into v_canary_promotion
  from public.ecoflow_bounded_commercial_sku_promotions p
  where p.external_product_code='CCSA8-90';
  if not found
     or v_canary_promotion.commercial_sku_id<>v_canary.canonical_object_id
     or v_canary_promotion.unleashed_mapping_id<>v_canary.id
     or v_canary_promotion.source_payload_sha256<>v_canary.source_payload_sha256
     or not exists(
       select 1 from public.skus s
       where s.id=v_canary_promotion.commercial_sku_id
         and upper(btrim(s.sku_code))='CCSA8-90'
     )
     or not exists(
       select 1 from public.external_product_mappings e
       where e.id=v_canary_promotion.external_mapping_id
         and e.provider='ORDERMENTUM'
         and upper(btrim(e.external_product_code))='CCSA8-90'
         and e.internal_sku_id=v_canary_promotion.commercial_sku_id
         and e.is_active
     ) then
    raise exception 'COMMERCIAL_CONTINUATION_CANARY_PROMOTION_NOT_PROVEN';
  end if;

  -- Reproduce the existing governed Product Identity queue READY predicate for
  -- the canary, bounded to the same most-recent 500 survey rows. This is read-only
  -- physical evidence: it does not create or modify Product Identity authority.
  with source_rows as (
    select o.*
    from public.ecoflow_barcode_survey_observations o
    order by o.occurred_at desc,o.id desc
    limit 500
  )
  select o.id,o.carton_barcode
  into v_queue_observation_id,v_queue_carton_barcode
  from source_rows o
  where upper(btrim(coalesce(o.sku_context,'')))='CCSA8-90'
    and o.evidence_source='OBSERVED_NOW'
    and o.sleeve_status in ('SCANNED','NO_SEPARATE_BARCODE')
    and not exists(
      select 1 from public.ecoflow_barcode_survey_identity_reconciliations r
      where r.survey_observation_id=o.id
    )
    and not exists(
      select 1 from public.ecoflow_physical_barcode_bindings b
      where b.barcode=o.carton_barcode and b.identity_status='ACTIVE'
    )
    and (
      select count(distinct case
        when d.evidence_source='OBSERVED_NOW' and d.sleeve_status='SCANNED'
          then 'SCANNED:'||d.sleeve_barcode
        when d.evidence_source='OBSERVED_NOW' and d.sleeve_status='NO_SEPARATE_BARCODE'
          then 'NO_SEPARATE_BARCODE'
        else null end)
      from public.ecoflow_barcode_survey_observations d
      where d.sku_context is not distinct from o.sku_context
        and d.carton_barcode=o.carton_barcode
    )=1
    and (
      select count(distinct s.id)
      from public.skus s
      where lower(btrim(s.sku_code))=lower(btrim(o.sku_context))
         or exists(
           select 1 from public.external_product_mappings e
           where e.internal_sku_id=s.id
             and e.provider='ORDERMENTUM'
             and e.is_active
             and lower(btrim(e.external_product_code))=lower(btrim(o.sku_context))
         )
    )=1
  order by o.occurred_at desc,o.id desc
  limit 1;

  if v_queue_observation_id is null then
    raise exception 'COMMERCIAL_CONTINUATION_CANARY_QUEUE_NOT_READY';
  end if;

  -- Revalidate all 21 frozen continuation codes atomically. Exact Ordermentum
  -- commercial evidence is either one listed-SKU row that is currently visible,
  -- or the same exact code in real order history. Unit/UOM/barcode fields from
  -- the listed view are intentionally not read and cannot become package authority.
  select count(*) into v_eligible
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist a
  where a.promotion_phase='AFTER_CANARY'
    and not a.enabled
    and (
      select count(*)
      from public.ecoflow_unleashed_master_mappings m
      where m.entity_type='PRODUCT'
        and upper(btrim(coalesce(m.source_external_code,'')))=a.external_product_code
        and m.mapping_status='UNMATCHED'
        and m.source_duplicate_count=1
        and m.source_payload_sha256 ~ '^[0-9a-f]{64}$'
        and exists(
          select 1 from public.unleashed_raw_snapshots rs
          where rs.resource='products'
            and rs.external_key=m.source_external_key
            and rs.payload_sha256=m.source_payload_sha256
            and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=a.external_product_code
            and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
            and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
        )
    )=1
    and (
      select count(*) from public.v_ecoflow_ordermentum_listed_skus ls
      where upper(btrim(coalesce(ls.external_sku_code,'')))=a.external_product_code
    )=1
    and (
      exists(
        select 1 from public.v_ecoflow_ordermentum_listed_skus ls
        where upper(btrim(coalesce(ls.external_sku_code,'')))=a.external_product_code
          and ls.is_visible_on_ordermentum
      )
      or exists(
        select 1 from public.v_ecoflow_ordermentum_sku_mapping_workbench w
        where upper(btrim(coalesce(w.external_sku_code,'')))=a.external_product_code
      )
    )
    and not exists(
      select 1 from public.skus s
      where upper(btrim(s.sku_code))=a.external_product_code
    )
    and not exists(
      select 1 from public.external_product_mappings e
      where e.provider='ORDERMENTUM'
        and upper(btrim(e.external_product_code))=a.external_product_code
    )
    and not exists(
      select 1 from public.ecoflow_bounded_commercial_sku_promotions p
      where p.external_product_code=a.external_product_code
    );

  if v_eligible<>21 then
    raise exception 'COMMERCIAL_CONTINUATION_CANDIDATE_SET_DRIFT:%',v_eligible;
  end if;

  update public.ecoflow_bounded_commercial_sku_promotion_allowlist
  set enabled=true,updated_at=now()
  where promotion_phase='AFTER_CANARY' and not enabled;
  get diagnostics v_unlocked=row_count;
  if v_unlocked<>21 then
    raise exception 'COMMERCIAL_CONTINUATION_UNLOCK_COUNT_MISMATCH:%',v_unlocked;
  end if;

  v_result := jsonb_build_object(
    'promotionPhase','AFTER_CANARY',
    'canaryExternalProductCode','CCSA8-90',
    'canaryMatchMethod','ORDERMENTUM_PRODUCT_CODE_EXACT',
    'canaryQueueStatus','READY_TO_RECONCILE',
    'canaryCommercialMatchCount',1,
    'unlockedCandidateCount',v_unlocked,
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false,
    'replayed',false
  );

  insert into public.ecoflow_bounded_commercial_sku_phase_unlocks(
    promotion_phase,canary_external_product_code,canary_unleashed_mapping_id,
    canary_mapping_revision,canary_source_payload_sha256,canary_commercial_sku_id,
    canary_queue_observation_id,canary_carton_barcode,canary_queue_status,
    canary_commercial_match_count,unlocked_candidate_count,authorization_command_id,
    unlocked_by,reason
  ) values (
    'AFTER_CANARY','CCSA8-90',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,
    v_canary_promotion.commercial_sku_id,v_queue_observation_id,v_queue_carton_barcode,
    'READY_TO_RECONCILE',1,v_unlocked,p_command_id,p_requested_by,btrim(p_reason)
  );

  insert into public.ecoflow_bounded_commercial_sku_phase_unlock_commands(
    command_id,actor_user_id,expected_canary_mapping_revision,
    expected_canary_source_payload_sha256,command_payload_sha256,result
  ) values (
    p_command_id,p_requested_by,p_expected_canary_mapping_revision,
    p_expected_canary_source_payload_sha256,v_payload_hash,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    p_requested_by,v_role,'BOUNDED_COMMERCIAL_SKU_AFTER_CANARY_UNLOCKED',
    'ecoflow_bounded_commercial_sku_promotion_allowlist','AFTER_CANARY',
    jsonb_build_object('enabledContinuationCandidates',0,'canaryMappingRevision',v_canary.revision),
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.ecoflow_promote_bounded_commercial_sku_after_canary(
  p_command_id uuid,
  p_requested_by uuid,
  p_external_product_code text,
  p_unleashed_mapping_id uuid,
  p_expected_revision bigint,
  p_expected_source_payload_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_code text := upper(btrim(coalesce(p_external_product_code,'')));
  v_allow public.ecoflow_bounded_commercial_sku_promotion_allowlist%rowtype;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_snapshot public.unleashed_raw_snapshots%rowtype;
  v_existing_command public.ecoflow_bounded_commercial_sku_promotion_commands%rowtype;
  v_existing_promotion public.ecoflow_bounded_commercial_sku_promotions%rowtype;
  v_payload_hash text;
  v_listed_rows bigint;
  v_visible_listed_rows bigint;
  v_order_rows bigint;
  v_listed_name text;
  v_order_name text;
  v_display_name text;
  v_source_evidence text;
  v_sku_id uuid;
  v_external_mapping_id uuid;
  v_result jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'COMMERCIAL_PROMOTION_FORBIDDEN';
  end if;

  if v_code='CCSB6-80' then
    raise exception 'COMMERCIAL_PROMOTION_CONFLICT_BLOCKED';
  end if;
  if p_command_id is null or p_requested_by is null or p_unleashed_mapping_id is null
     or p_expected_revision is null or p_expected_revision<0
     or p_expected_source_payload_sha256 is null
     or p_expected_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or v_code='' or length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'COMMERCIAL_PROMOTION_INVALID';
  end if;

  select * into v_allow
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist a
  where a.external_product_code=v_code;
  if not found then raise exception 'COMMERCIAL_PROMOTION_NOT_ALLOWLISTED'; end if;
  if v_allow.promotion_phase<>'AFTER_CANARY' then
    raise exception 'COMMERCIAL_PROMOTION_CONTINUATION_ONLY';
  end if;
  if not v_allow.enabled then raise exception 'COMMERCIAL_PROMOTION_PHASE_LOCKED'; end if;
  if not exists(
    select 1 from public.ecoflow_bounded_commercial_sku_phase_unlocks
    where promotion_phase='AFTER_CANARY' and unlocked_candidate_count=21
  ) then
    raise exception 'COMMERCIAL_PROMOTION_AFTER_CANARY_NOT_UNLOCKED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_commercial_promotion_command:'||p_command_id::text,0)
  );

  v_payload_hash := encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,
    'externalProductCode',v_code,
    'unleashedMappingId',p_unleashed_mapping_id,
    'expectedRevision',p_expected_revision,
    'expectedSourcePayloadSha256',p_expected_source_payload_sha256,
    'reason',btrim(p_reason),
    'authorityPath','AFTER_CANARY'
  )::text,'sha256'),'hex');

  select * into v_existing_command
  from public.ecoflow_bounded_commercial_sku_promotion_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing_command.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing_command.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_commercial_promotion_code:'||v_code,0)
  );

  select * into v_existing_promotion
  from public.ecoflow_bounded_commercial_sku_promotions p
  where p.external_product_code=v_code;
  if found then raise exception 'COMMERCIAL_PROMOTION_ALREADY_COMPLETED'; end if;

  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.id=p_unleashed_mapping_id
  for update;
  if not found then raise exception 'COMMERCIAL_PROMOTION_UNLEASHED_MAPPING_NOT_FOUND'; end if;
  if v_mapping.entity_type<>'PRODUCT'
     or upper(btrim(coalesce(v_mapping.source_external_code,'')))<>v_code
     or v_mapping.mapping_status<>'UNMATCHED'
     or v_mapping.source_duplicate_count<>1 then
    raise exception 'COMMERCIAL_PROMOTION_SOURCE_NOT_ELIGIBLE';
  end if;
  if v_mapping.revision<>p_expected_revision then raise exception 'MAPPING_REVISION_CONFLICT'; end if;
  if v_mapping.source_payload_sha256<>p_expected_source_payload_sha256 then raise exception 'SOURCE_SNAPSHOT_CHANGED'; end if;

  select * into v_snapshot
  from public.unleashed_raw_snapshots s
  where s.resource='products' and s.external_key=v_mapping.source_external_key;
  if not found or v_snapshot.payload_sha256<>p_expected_source_payload_sha256 then
    raise exception 'SOURCE_SNAPSHOT_CHANGED';
  end if;
  if upper(btrim(coalesce(v_snapshot.payload->>'ProductCode','')))<>v_code
     or public.ecoflow_unleashed_json_boolean(v_snapshot.payload->'Obsolete')
     or lower(coalesce(v_snapshot.payload->>'Status','')) in ('obsolete','inactive','retired') then
    raise exception 'COMMERCIAL_PROMOTION_SOURCE_NOT_ELIGIBLE';
  end if;

  select count(*),count(*) filter(where ls.is_visible_on_ordermentum),
         (array_agg(ls.listed_product_name order by ls.listed_updated_at desc nulls last,ls.listed_product_name))[1]
  into v_listed_rows,v_visible_listed_rows,v_listed_name
  from public.v_ecoflow_ordermentum_listed_skus ls
  where upper(btrim(coalesce(ls.external_sku_code,'')))=v_code;

  select count(*)::bigint,
         (array_agg(w.external_product_name order by w.order_count desc nulls last,w.line_count desc nulls last,w.external_product_name))[1]
  into v_order_rows,v_order_name
  from public.v_ecoflow_ordermentum_sku_mapping_workbench w
  where upper(btrim(coalesce(w.external_sku_code,'')))=v_code;

  if coalesce(v_listed_rows,0)<>1 then
    raise exception 'ORDERMENTUM_COMMERCIAL_LISTING_AMBIGUOUS_OR_MISSING';
  end if;
  if coalesce(v_visible_listed_rows,0)=0 and coalesce(v_order_rows,0)=0 then
    raise exception 'ORDERMENTUM_COMMERCIAL_EVIDENCE_MISSING';
  end if;
  v_source_evidence := case
    when coalesce(v_visible_listed_rows,0)=1 then 'ORDERMENTUM_LISTED_SKU_EXACT'
    else 'ORDERMENTUM_ORDER_HISTORY_EXACT'
  end;

  if exists(
    select 1 from public.external_product_mappings e
    where e.provider='ORDERMENTUM' and upper(btrim(e.external_product_code))=v_code
  ) then raise exception 'COMMERCIAL_PROMOTION_ALREADY_MAPPED'; end if;
  if exists(select 1 from public.skus s where upper(btrim(s.sku_code))=v_code) then
    raise exception 'COMMERCIAL_PROMOTION_SKU_CODE_EXISTS';
  end if;

  -- Display-only Commercial metadata. listed_unit/listed_uom/barcode candidates
  -- are intentionally not read; package/barcode authority remains Product Identity.
  v_display_name := coalesce(
    nullif(btrim(v_listed_name),''),
    nullif(btrim(v_order_name),''),
    nullif(btrim(regexp_replace(coalesce(v_snapshot.payload->>'ProductDescription',''),'[[:space:]]+',' ','g')),''),
    v_code
  );

  insert into public.skus(
    sku_code,display_name,category,can_sell_by_carton,can_sell_by_sleeve,
    default_storage_unit,default_pick_unit,can_mix_pack,setup_status
  ) values (
    v_code,v_display_name,'Ordermentum commercial identity',false,false,
    'unconfigured','unconfigured',false,'mapping_draft'
  ) returning id into v_sku_id;

  insert into public.external_product_mappings(
    provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active
  ) values (
    'ORDERMENTUM',v_code,v_sku_id,'unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true
  ) returning id into v_external_mapping_id;

  insert into public.ecoflow_bounded_commercial_sku_promotions(
    external_product_code,unleashed_mapping_id,source_payload_sha256,
    commercial_sku_id,external_mapping_id,authorization_command_id,promoted_by,reason
  ) values (
    v_code,p_unleashed_mapping_id,p_expected_source_payload_sha256,
    v_sku_id,v_external_mapping_id,p_command_id,p_requested_by,btrim(p_reason)
  );

  v_result := jsonb_build_object(
    'externalProductCode',v_code,
    'commercialSkuId',v_sku_id,
    'externalMappingId',v_external_mapping_id,
    'unleashedMappingId',p_unleashed_mapping_id,
    'sourcePayloadSha256',p_expected_source_payload_sha256,
    'promotionPhase','AFTER_CANARY',
    'ordermentumCommercialEvidence',v_source_evidence,
    'setupStatus','mapping_draft',
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false,
    'replayed',false
  );

  insert into public.ecoflow_bounded_commercial_sku_promotion_commands(
    command_id,actor_user_id,external_product_code,unleashed_mapping_id,
    expected_revision,expected_source_payload_sha256,command_payload_sha256,result
  ) values (
    p_command_id,p_requested_by,v_code,p_unleashed_mapping_id,
    p_expected_revision,p_expected_source_payload_sha256,v_payload_hash,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    p_requested_by,v_role,'BOUNDED_COMMERCIAL_SKU_CONTINUATION_PROMOTED',
    'external_product_mappings',v_external_mapping_id::text,
    jsonb_build_object(
      'unleashedMappingStatus',v_mapping.mapping_status,
      'unleashedMappingRevision',v_mapping.revision,
      'sourceExternalCode',v_mapping.source_external_code,
      'sourcePayloadSha256',v_mapping.source_payload_sha256,
      'ordermentumCommercialEvidence',v_source_evidence
    ),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_unlock_bounded_commercial_sku_after_canary(uuid,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_unlock_bounded_commercial_sku_after_canary(uuid,uuid,bigint,text,text)
  to service_role;

revoke all on function public.ecoflow_promote_bounded_commercial_sku_after_canary(uuid,uuid,text,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_promote_bounded_commercial_sku_after_canary(uuid,uuid,text,uuid,bigint,text,text)
  to service_role;

commit;