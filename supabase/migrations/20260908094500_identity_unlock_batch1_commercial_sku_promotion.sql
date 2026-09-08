-- #338 Identity Unlock Batch 1B
-- Bounded Commercial SKU Promotion for the frozen reviewed safe set.
--
-- Authority boundary:
--   * creates Commercial identity only: public.skus + ORDERMENTUM external mapping;
--   * never creates sku_units, Physical SKU/family/package/barcode authority;
--   * never creates inventory/location/SOH/opening-balance/cutover authority;
--   * CCSA8-90 is the only enabled production canary in this migration;
--   * the remaining 21 reviewed safe codes are recorded but phase-locked;
--   * CCSB6-80 is an explicit conflict and is never allowlisted.

begin;

do $deps$
begin
  if to_regclass('public.skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null
     or to_regclass('public.v_ecoflow_ordermentum_sku_mapping_workbench') is null then
    raise exception 'IDENTITY_UNLOCK_COMMERCIAL_PROMOTION_DEPENDENCIES_MISSING';
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'IDENTITY_UNLOCK_COMMERCIAL_PROMOTION_EXTENSIONS_MISSING';
  end if;
end;
$deps$;

create table if not exists public.ecoflow_bounded_commercial_sku_promotion_allowlist (
  external_product_code text primary key,
  promotion_phase text not null check (promotion_phase in ('CANARY','AFTER_CANARY')),
  enabled boolean not null default false,
  review_basis text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_bounded_commercial_code_normalized
    check (external_product_code=upper(btrim(external_product_code)))
);

insert into public.ecoflow_bounded_commercial_sku_promotion_allowlist(
  external_product_code,promotion_phase,enabled,review_basis
) values
  ('CCSA8-90','CANARY',true,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('BPB8','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCEA16-90','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCLGPLA-90','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCLWPLA-62','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCSA8-80','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCSB12-80','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCSB8-80','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCSKBM12-80','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCSKBM12-90','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('CCSKBM8-90','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('FL115PLABOX','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('KRC500','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('KRC650','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('KRCL','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('KSB16','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('Q404S0001','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('Q514S0001','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('SB24/32/40LBOX','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('SB24/32/40SLBOX','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('SB32BOX','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET'),
  ('WRC750','AFTER_CANARY',false,'FROZEN_IDENTITY_UNLOCK_BATCH1_REVIEWED_SAFE_SET')
on conflict(external_product_code) do update set
  promotion_phase=excluded.promotion_phase,
  enabled=excluded.enabled,
  review_basis=excluded.review_basis,
  updated_at=now();

create table if not exists public.ecoflow_bounded_commercial_sku_promotions (
  external_product_code text primary key
    references public.ecoflow_bounded_commercial_sku_promotion_allowlist(external_product_code) on delete restrict,
  unleashed_mapping_id uuid not null
    references public.ecoflow_unleashed_master_mappings(id) on delete restrict,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  commercial_sku_id uuid not null unique references public.skus(id) on delete restrict,
  external_mapping_id uuid not null unique references public.external_product_mappings(id) on delete restrict,
  authorization_command_id uuid not null unique,
  promoted_by uuid not null,
  promoted_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) >= 3)
);

create table if not exists public.ecoflow_bounded_commercial_sku_promotion_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  actor_user_id uuid not null,
  external_product_code text not null,
  unleashed_mapping_id uuid not null references public.ecoflow_unleashed_master_mappings(id) on delete restrict,
  expected_revision bigint not null check (expected_revision >= 0),
  expected_source_payload_sha256 text not null check (expected_source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.ecoflow_bounded_commercial_sku_promotion_allowlist enable row level security;
alter table public.ecoflow_bounded_commercial_sku_promotions enable row level security;
alter table public.ecoflow_bounded_commercial_sku_promotion_commands enable row level security;

revoke all on table public.ecoflow_bounded_commercial_sku_promotion_allowlist
  from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_bounded_commercial_sku_promotions
  from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_bounded_commercial_sku_promotion_commands
  from public,anon,authenticated,service_role;

create or replace function public.ecoflow_promote_bounded_commercial_sku(
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
set search_path = ''
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
  v_ordermentum_rows bigint;
  v_ordermentum_name text;
  v_display_name text;
  v_sku_id uuid;
  v_external_mapping_id uuid;
  v_result jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by
    and p.is_active
    and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'COMMERCIAL_PROMOTION_FORBIDDEN';
  end if;

  if v_code='CCSB6-80' then
    raise exception 'COMMERCIAL_PROMOTION_CONFLICT_BLOCKED';
  end if;
  if p_command_id is null or p_requested_by is null or p_unleashed_mapping_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_expected_source_payload_sha256 is null
     or p_expected_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or v_code='' or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'COMMERCIAL_PROMOTION_INVALID';
  end if;

  select * into v_allow
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist a
  where a.external_product_code=v_code;
  if not found then raise exception 'COMMERCIAL_PROMOTION_NOT_ALLOWLISTED'; end if;
  if not v_allow.enabled then raise exception 'COMMERCIAL_PROMOTION_PHASE_LOCKED'; end if;
  if v_allow.promotion_phase<>'CANARY' or v_code<>'CCSA8-90' then
    raise exception 'COMMERCIAL_PROMOTION_CANARY_ONLY';
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
    'reason',btrim(p_reason)
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
  if v_mapping.revision<>p_expected_revision then
    raise exception 'MAPPING_REVISION_CONFLICT';
  end if;
  if v_mapping.source_payload_sha256<>p_expected_source_payload_sha256 then
    raise exception 'SOURCE_SNAPSHOT_CHANGED';
  end if;

  select * into v_snapshot
  from public.unleashed_raw_snapshots s
  where s.resource='products'
    and s.external_key=v_mapping.source_external_key;
  if not found or v_snapshot.payload_sha256<>p_expected_source_payload_sha256 then
    raise exception 'SOURCE_SNAPSHOT_CHANGED';
  end if;
  if upper(btrim(coalesce(v_snapshot.payload->>'ProductCode','')))<>v_code
     or public.ecoflow_unleashed_json_boolean(v_snapshot.payload->'Obsolete')
     or lower(coalesce(v_snapshot.payload->>'Status','')) in ('obsolete','inactive','retired') then
    raise exception 'COMMERCIAL_PROMOTION_SOURCE_NOT_ELIGIBLE';
  end if;

  select
    count(*)::bigint,
    (array_agg(w.external_product_name order by w.order_count desc nulls last,w.line_count desc nulls last,w.external_product_name))[1]
  into v_ordermentum_rows,v_ordermentum_name
  from public.v_ecoflow_ordermentum_sku_mapping_workbench w
  where upper(btrim(coalesce(w.external_sku_code,'')))=v_code;
  if coalesce(v_ordermentum_rows,0)=0 then
    raise exception 'ORDERMENTUM_COMMERCIAL_EVIDENCE_MISSING';
  end if;

  if exists (
    select 1 from public.external_product_mappings m
    where m.provider='ORDERMENTUM'
      and upper(btrim(m.external_product_code))=v_code
  ) then
    raise exception 'COMMERCIAL_PROMOTION_ALREADY_MAPPED';
  end if;
  if exists (
    select 1 from public.skus s where upper(btrim(s.sku_code))=v_code
  ) then
    raise exception 'COMMERCIAL_PROMOTION_SKU_CODE_EXISTS';
  end if;

  -- Name is display-only Commercial metadata. It is not package/physical authority.
  v_display_name := coalesce(
    nullif(btrim(v_ordermentum_name),''),
    nullif(btrim(regexp_replace(coalesce(v_snapshot.payload->>'ProductDescription',''),'[[:space:]]+',' ','g')),''),
    v_code
  );

  -- Deliberately non-operational Commercial row. The required legacy storage/pick
  -- columns are set to an explicit UNCONFIGURED sentinel and no sku_units row is
  -- created. Canonical package/barcode authority remains Product Identity only.
  insert into public.skus(
    sku_code,display_name,category,
    can_sell_by_carton,can_sell_by_sleeve,
    default_storage_unit,default_pick_unit,can_mix_pack,setup_status
  ) values (
    v_code,v_display_name,'Ordermentum commercial identity',
    false,false,'unconfigured','unconfigured',false,'mapping_draft'
  ) returning id into v_sku_id;

  insert into public.external_product_mappings(
    provider,external_product_code,internal_sku_id,
    default_unit_level,confidence,is_active
  ) values (
    'ORDERMENTUM',v_code,v_sku_id,
    'unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true
  ) returning id into v_external_mapping_id;

  insert into public.ecoflow_bounded_commercial_sku_promotions(
    external_product_code,unleashed_mapping_id,source_payload_sha256,
    commercial_sku_id,external_mapping_id,authorization_command_id,
    promoted_by,reason
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
    'promotionPhase',v_allow.promotion_phase,
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
    p_requested_by,v_role,
    'BOUNDED_COMMERCIAL_SKU_PROMOTED',
    'external_product_mappings',v_external_mapping_id::text,
    jsonb_build_object(
      'unleashedMappingStatus',v_mapping.mapping_status,
      'unleashedMappingRevision',v_mapping.revision,
      'sourceExternalCode',v_mapping.source_external_code,
      'sourcePayloadSha256',v_mapping.source_payload_sha256
    ),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_promote_bounded_commercial_sku(uuid,uuid,text,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_promote_bounded_commercial_sku(uuid,uuid,text,uuid,bigint,text,text)
  to service_role;

commit;
