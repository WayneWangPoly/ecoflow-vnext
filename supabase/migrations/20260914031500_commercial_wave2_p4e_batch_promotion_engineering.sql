-- ECOFLOW-R3-P4E: authenticated, sequential, postflight-gated batch promotion.
-- Engineering carrier. If deployed, only the batch orchestrator and its postflight
-- verifier are exposed to authenticated callers; the single-SKU delegate remains
-- private. service_role and anon receive no business mutation authority.

begin;

do $deps$
begin
  if to_regprocedure('public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)') is null
     or to_regprocedure('public.ecoflow_read_commercial_wave2_p4d_promotion_readiness()') is null
     or to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotion_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.v_ecoflow_ordermentum_listed_skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_uuid()') is null then
    raise exception 'COMMERCIAL_WAVE2_P4E_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

create table if not exists public.ecoflow_commercial_wave2_promotion_batch_commands (
  batch_no integer primary key check (batch_no between 1 and 7),
  command_id uuid not null unique,
  actor_user_id uuid not null,
  promotion_plan_sha256 text not null
    check (promotion_plan_sha256='43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'),
  batch_sha256 text not null check (batch_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_count integer not null check (candidate_count in (13,25)),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (pg_catalog.jsonb_typeof(result)='object'),
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists public.ecoflow_commercial_wave2_promotion_batch_verifications (
  batch_no integer primary key
    references public.ecoflow_commercial_wave2_promotion_batch_commands(batch_no) on delete restrict,
  batch_command_id uuid not null unique
    references public.ecoflow_commercial_wave2_promotion_batch_commands(command_id) on delete restrict,
  verified_by uuid not null,
  promotion_plan_sha256 text not null
    check (promotion_plan_sha256='43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'),
  batch_sha256 text not null check (batch_sha256 ~ '^[0-9a-f]{64}$'),
  verified_candidate_count integer not null check (verified_candidate_count in (13,25)),
  result jsonb not null check (pg_catalog.jsonb_typeof(result)='object'),
  verified_at timestamptz not null default pg_catalog.now()
);

alter table public.ecoflow_commercial_wave2_promotion_batch_commands enable row level security;
alter table public.ecoflow_commercial_wave2_promotion_batch_verifications enable row level security;
revoke all on table public.ecoflow_commercial_wave2_promotion_batch_commands from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_commercial_wave2_promotion_batch_verifications from public,anon,authenticated,service_role;

create or replace function public.ecoflow_commercial_wave2_p4e_expected_batch(p_batch_no integer)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $function$
  select case p_batch_no
    when 1 then pg_catalog.jsonb_build_object(
      'batchNo',1,'commandId','dbd1f89c-720f-4a44-bd31-59787b0d3bd3',
      'candidateCount',25,'firstCode','140280','lastCode','BP-SSD-TT',
      'batchSha256','7dc7e7aacb5891caa2905a241c68a57920c98173991d5d410cf27b6a2ccf55e3')
    when 2 then pg_catalog.jsonb_build_object(
      'batchNo',2,'commandId','5ad4dd0c-0028-4cc2-9eed-1422f0ba2696',
      'candidateCount',25,'firstCode','BPB12','lastCode','CCSA6-80',
      'batchSha256','82d6667c5a077bd7bcfbefd8e27feb37644b80cd0418b050a1f3d83d2ab955c0')
    when 3 then pg_catalog.jsonb_build_object(
      'batchNo',3,'commandId','e04af561-dd00-4a0b-88b7-aa185508130e',
      'candidateCount',25,'firstCode','CCSKBM6-80','lastCode','EF-DWLQ20',
      'batchSha256','59c55ae2e4d40995234f002eabc1f714d3e634babcddc60db5be68cc5cc8584b')
    when 4 then pg_catalog.jsonb_build_object(
      'batchNo',4,'commandId','bdbd7dfb-ef13-442b-84b6-ce3dead08f8b',
      'candidateCount',25,'firstCode','EF-RTUS05','lastCode','KNIFE165BULK',
      'batchSha256','a03043367fb53ccc81b42e0ea74fe5db9fd6b5ff984ae89f8a56b9303aa05457')
    when 5 then pg_catalog.jsonb_build_object(
      'batchNo',5,'commandId','ed79bf21-245f-43bc-9722-a8a79be568bb',
      'candidateCount',25,'firstCode','KOMCOFFEE12-80','lastCode','PCT5',
      'batchSha256','f761569972fc8a23fa26cd0fe78516bcf37e648d5a07ace5ebd2d34207ab66d1')
    when 6 then pg_catalog.jsonb_build_object(
      'batchNo',6,'commandId','d326df14-63ba-4bac-b66e-c5c489a8a039',
      'candidateCount',25,'firstCode','PROLL16W','lastCode','SCCSPW28BAG',
      'batchSha256','ff2e9000c096485ed63b18dbf9adfb545e925a0d1ced8458122f68dd0151a15c')
    when 7 then pg_catalog.jsonb_build_object(
      'batchNo',7,'commandId','c3a0f311-4efb-4325-804b-d8eb39ef9291',
      'candidateCount',13,'firstCode','SK1216','lastCode','WRCL',
      'batchSha256','ca2ebb59ffbd31e5b8c488ea33b4c39d63ab9194025c3c1bd2157fad87b4f890')
    else null
  end;
$function$;

create or replace function public.ecoflow_commercial_wave2_p4e_plan_members()
returns table(
  batch_no integer,
  item_position integer,
  external_product_code text,
  unleashed_mapping_id uuid,
  expected_mapping_revision bigint,
  expected_source_payload_sha256 text,
  expected_source_external_key text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with ranked as (
    select
      pg_catalog.row_number() over(order by c.external_product_code collate "C") as rn,
      c.external_product_code,
      c.unleashed_mapping_id,
      c.expected_mapping_revision,
      c.expected_source_payload_sha256,
      c.expected_source_external_key
    from public.ecoflow_commercial_wave2_candidates c
    where c.promotion_phase='EXPANSION'
      and c.enabled
      and c.candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
  )
  select
    (((rn-1)/25)::integer+1) as batch_no,
    (((rn-1)%25)::integer+1) as item_position,
    external_product_code,
    unleashed_mapping_id,
    expected_mapping_revision,
    expected_source_payload_sha256,
    expected_source_external_key
  from ranked
  order by rn;
$function$;

create or replace function public.ecoflow_commercial_wave2_p4e_plan_evidence()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with batches as (
    select
      m.batch_no,
      count(*)::integer as candidate_count,
      (pg_catalog.array_agg(m.external_product_code order by m.item_position))[1] as first_code,
      (pg_catalog.array_agg(m.external_product_code order by m.item_position))[count(*)] as last_code,
      encode(extensions.digest(pg_catalog.string_agg(
        pg_catalog.concat_ws('|',m.external_product_code,m.unleashed_mapping_id::text,
          m.expected_mapping_revision::text,m.expected_source_payload_sha256),
        pg_catalog.chr(10) order by m.item_position
      ),'sha256'),'hex') as batch_sha256
    from public.ecoflow_commercial_wave2_p4e_plan_members() m
    group by m.batch_no
  ), plan as (
    select
      count(*)::integer as batch_count,
      coalesce(sum(candidate_count),0)::integer as candidate_count,
      encode(extensions.digest(pg_catalog.string_agg(
        pg_catalog.concat_ws('|',batch_no::text,candidate_count::text,batch_sha256),
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
  select pg_catalog.jsonb_build_object(
    'promotionPlanSha256',plan_sha256,
    'batchCount',batch_count,
    'candidateCount',candidate_count,
    'batches',coalesce(batches,'[]'::jsonb)
  ) from plan;
$function$;

revoke all on function public.ecoflow_commercial_wave2_p4e_expected_batch(integer) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_commercial_wave2_p4e_plan_members() from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_commercial_wave2_p4e_plan_evidence() from public,anon,authenticated,service_role;

create or replace function public.ecoflow_read_commercial_wave2_p4e_batch_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_plan jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_verified_count integer;
  v_verified_max integer;
  v_current_batch integer;
  v_expected jsonb;
  v_expected_count integer;
  v_expected_prior integer;
  v_current_command public.ecoflow_commercial_wave2_promotion_batch_commands%rowtype;
  v_current_verified boolean;
  v_current_eligible integer := 0;
  v_prior_promoted integer := 0;
  v_current_promoted integer := 0;
  v_future_promoted integer := 0;
  v_unplanned_promoted integer := 0;
  v_non_canary_promotions integer;
  v_non_canary_commands integer;
  v_action text;
  v_status text;
  v_batch_auth boolean;
  v_batch_service boolean;
  v_batch_anon boolean;
  v_verify_auth boolean;
  v_verify_service boolean;
  v_single_auth boolean;
  v_single_service boolean;
  v_single_anon boolean;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4E_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE';
  if v_role is null
     or v_role not in ('OWNER','ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4E_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  v_plan := public.ecoflow_commercial_wave2_p4e_plan_evidence();
  if v_plan->>'promotionPlanSha256' is distinct from '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'
     or (v_plan->>'batchCount')::integer<>7
     or (v_plan->>'candidateCount')::integer<>163 then
    v_failures:=v_failures||pg_catalog.jsonb_build_array('plan.frozenEvidence');
  end if;

  select count(*)::integer,coalesce(max(batch_no),0)::integer
  into v_verified_count,v_verified_max
  from public.ecoflow_commercial_wave2_promotion_batch_verifications;
  if v_verified_count<>v_verified_max then
    v_failures:=v_failures||pg_catalog.jsonb_build_array('sequence.verificationGap');
  end if;

  v_batch_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)','execute');
  v_batch_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)','execute');
  v_batch_anon := pg_catalog.has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)','execute');
  v_verify_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer)','execute');
  v_verify_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer)','execute');
  v_single_auth := pg_catalog.has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute');
  v_single_service := pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute');
  v_single_anon := pg_catalog.has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute');

  if not v_batch_auth or v_batch_service or v_batch_anon or not v_verify_auth or v_verify_service then
    v_failures:=v_failures||pg_catalog.jsonb_build_array('authority.batchShape');
  end if;
  if v_single_auth or v_single_service or v_single_anon then
    v_failures:=v_failures||pg_catalog.jsonb_build_array('authority.singleSkuDelegateExposed');
  end if;
  if pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute')
     or pg_catalog.has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute')
     or pg_catalog.has_function_privilege('authenticated','public.ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)','execute') then
    v_failures:=v_failures||pg_catalog.jsonb_build_array('authority.stalePath');
  end if;

  select count(*)::integer into v_non_canary_promotions
  from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010';
  select count(*)::integer into v_non_canary_commands
  from public.ecoflow_commercial_wave2_promotion_commands where external_product_code<>'140010';
  if v_non_canary_promotions<>v_non_canary_commands then
    v_failures:=v_failures||pg_catalog.jsonb_build_array('lineage.commandCount');
  end if;

  if v_verified_count=7 then
    v_action:='COMPLETE';
    v_status:='ALL_BATCHES_VERIFIED';
    v_current_batch:=null;
    if v_non_canary_promotions<>163 then
      v_failures:=v_failures||pg_catalog.jsonb_build_array('lineage.finalPromotionCount');
    end if;
  else
    v_current_batch:=v_verified_count+1;
    v_expected:=public.ecoflow_commercial_wave2_p4e_expected_batch(v_current_batch);
    v_expected_count:=(v_expected->>'candidateCount')::integer;
    select coalesce(count(*),0)::integer into v_expected_prior
    from public.ecoflow_commercial_wave2_p4e_plan_members() m
    where m.batch_no<v_current_batch;

    select count(*)::integer into v_prior_promoted
    from public.ecoflow_commercial_wave2_promotions p
    join public.ecoflow_commercial_wave2_p4e_plan_members() m
      on m.external_product_code=p.external_product_code
    where m.batch_no<v_current_batch;
    select count(*)::integer into v_current_promoted
    from public.ecoflow_commercial_wave2_promotions p
    join public.ecoflow_commercial_wave2_p4e_plan_members() m
      on m.external_product_code=p.external_product_code
    where m.batch_no=v_current_batch;
    select count(*)::integer into v_future_promoted
    from public.ecoflow_commercial_wave2_promotions p
    join public.ecoflow_commercial_wave2_p4e_plan_members() m
      on m.external_product_code=p.external_product_code
    where m.batch_no>v_current_batch;
    select count(*)::integer into v_unplanned_promoted
    from public.ecoflow_commercial_wave2_promotions p
    where p.external_product_code<>'140010'
      and not exists (
        select 1 from public.ecoflow_commercial_wave2_p4e_plan_members() m
        where m.external_product_code=p.external_product_code
      );

    if v_prior_promoted<>v_expected_prior
       or v_non_canary_promotions<>v_expected_prior+v_current_promoted
       or v_future_promoted<>0
       or v_unplanned_promoted<>0 then
      v_failures:=v_failures||pg_catalog.jsonb_build_array('lineage.sequence');
    end if;

    select * into v_current_command
    from public.ecoflow_commercial_wave2_promotion_batch_commands
    where batch_no=v_current_batch;
    v_current_verified:=exists(
      select 1 from public.ecoflow_commercial_wave2_promotion_batch_verifications
      where batch_no=v_current_batch
    );

    if found then
      v_action:='POSTFLIGHT';
      v_status:='READY_FOR_POSTFLIGHT';
      if v_current_verified or v_current_promoted<>v_expected_count then
        v_failures:=v_failures||pg_catalog.jsonb_build_array('postflight.batchFootprint');
      end if;
    else
      v_action:='EXECUTE';
      v_status:='READY_FOR_BATCH_EXECUTION';
      if v_current_promoted<>0 then
        v_failures:=v_failures||pg_catalog.jsonb_build_array('execution.currentAlreadyMutated');
      end if;

      select count(*)::integer into v_current_eligible
      from public.ecoflow_commercial_wave2_p4e_plan_members() pm
      join public.ecoflow_commercial_wave2_candidates c
        on c.external_product_code=pm.external_product_code
      join public.ecoflow_unleashed_master_mappings m
        on m.id=pm.unleashed_mapping_id
      where pm.batch_no=v_current_batch
        and c.promotion_phase='EXPANSION' and c.enabled
        and c.candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
        and m.entity_type='PRODUCT' and m.mapping_status='UNMATCHED'
        and m.source_duplicate_count=1
        and upper(btrim(coalesce(m.source_external_code,'')))=pm.external_product_code
        and m.source_external_key=pm.expected_source_external_key
        and m.revision=pm.expected_mapping_revision
        and m.source_payload_sha256=pm.expected_source_payload_sha256
        and exists (
          select 1 from public.unleashed_raw_snapshots rs
          where rs.resource='products'
            and rs.external_key=pm.expected_source_external_key
            and rs.payload_sha256=pm.expected_source_payload_sha256
            and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=pm.external_product_code
            and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
            and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
        )
        and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
          where upper(btrim(coalesce(l.external_sku_code,'')))=pm.external_product_code
            and l.is_visible_on_ordermentum)=1
        and not exists (select 1 from public.ecoflow_commercial_wave2_promotions p where p.external_product_code=pm.external_product_code)
        and not exists (select 1 from public.external_product_mappings e where e.provider='ORDERMENTUM' and upper(btrim(e.external_product_code))=pm.external_product_code)
        and not exists (select 1 from public.skus s where upper(btrim(s.sku_code))=pm.external_product_code);
      if v_current_eligible<>v_expected_count then
        v_failures:=v_failures||pg_catalog.jsonb_build_array('execution.eligibilityDrift');
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'mode','P4E_BATCH_GATE',
    'stage','P4E_BATCH_PROMOTION',
    'verdict',case when pg_catalog.jsonb_array_length(v_failures)=0 then 'PASS' else 'HOLD' end,
    'status',case when pg_catalog.jsonb_array_length(v_failures)=0 then v_status else 'HOLD' end,
    'action',case when pg_catalog.jsonb_array_length(v_failures)=0 then v_action else 'HOLD' end,
    'verifiedAt',pg_catalog.statement_timestamp(),
    'verifierRole',v_role,
    'plan',v_plan,
    'programme',pg_catalog.jsonb_build_object(
      'verifiedBatchCount',v_verified_count,
      'nextBatchNo',v_current_batch,
      'nonCanaryPromotionCount',v_non_canary_promotions,
      'nonCanaryPromotionCommandCount',v_non_canary_commands
    ),
    'batch',case when v_current_batch is null then null else pg_catalog.jsonb_build_object(
      'expected',v_expected,
      'eligibleCount',v_current_eligible,
      'promotedCount',v_current_promoted,
      'commandExists',v_current_command.batch_no is not null,
      'postflightVerified',coalesce(v_current_verified,false)
    ) end,
    'authority',pg_catalog.jsonb_build_object(
      'batchAuthenticatedExecute',v_batch_auth,
      'batchServiceRoleExecute',v_batch_service,
      'batchAnonExecute',v_batch_anon,
      'postflightAuthenticatedExecute',v_verify_auth,
      'postflightServiceRoleExecute',v_verify_service,
      'singleSkuAuthenticatedExecute',v_single_auth,
      'singleSkuServiceRoleExecute',v_single_service,
      'singleSkuAnonExecute',v_single_anon,
      'productionPromotionAuthorized',v_batch_auth and not v_batch_service and not v_batch_anon
    ),
    'failedChecks',v_failures
  );
end;
$function$;

create or replace function public.ecoflow_promote_commercial_wave2_expansion_batch_v1(p_batch_no integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_expected jsonb;
  v_plan jsonb;
  v_command_id uuid;
  v_expected_count integer;
  v_expected_prior integer;
  v_batch_sha text;
  v_reason text;
  v_payload_hash text;
  v_existing public.ecoflow_commercial_wave2_promotion_batch_commands%rowtype;
  v_eligible integer;
  v_prior_promoted integer;
  v_non_canary_promoted integer;
  v_member record;
  v_item_command_id uuid;
  v_item_result jsonb;
  v_items jsonb := '[]'::jsonb;
  v_promoted_count integer;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4E_AUTHENTICATION_REQUIRED';
  end if;
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE';
  if v_role is null
     or v_role not in ('OWNER','ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4E_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  v_expected:=public.ecoflow_commercial_wave2_p4e_expected_batch(p_batch_no);
  if v_expected is null then raise exception 'COMMERCIAL_WAVE2_P4E_INVALID_BATCH'; end if;
  v_command_id:=(v_expected->>'commandId')::uuid;
  v_expected_count:=(v_expected->>'candidateCount')::integer;
  v_batch_sha:=v_expected->>'batchSha256';
  v_reason:=pg_catalog.format('ECOFLOW-R3-P4E batch %s bounded Commercial promotion',p_batch_no);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ecoflow_commercial_wave2_p4e_batch_sequence',0));

  v_plan:=public.ecoflow_commercial_wave2_p4e_plan_evidence();
  if v_plan->>'promotionPlanSha256' is distinct from '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'
     or (v_plan->>'batchCount')::integer<>7
     or (v_plan->>'candidateCount')::integer<>163
     or not exists (
       select 1 from pg_catalog.jsonb_array_elements(v_plan->'batches') b
       where (b->>'batchNo')::integer=p_batch_no
         and (b->>'candidateCount')::integer=v_expected_count
         and b->>'firstCode'=v_expected->>'firstCode'
         and b->>'lastCode'=v_expected->>'lastCode'
         and b->>'batchSha256'=v_batch_sha
     ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_FROZEN_PLAN_MISMATCH';
  end if;

  if not exists (
    select 1 from public.ecoflow_commercial_wave2_phase_unlocks
    where promotion_phase='EXPANSION'
      and candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
      and unlocked_candidate_count=163
      and authorization_command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid
  ) or not exists (
    select 1 from public.ecoflow_commercial_wave2_unlock_commands
    where command_id='430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8'::uuid
      and promotion_phase='EXPANSION'
      and (result->>'unlockedCandidateCount')::integer=163
      and not coalesce((result->>'promotionIncluded')::boolean,true)
      and not coalesce((result->>'providerActionIncluded')::boolean,true)
  ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_P4C_CLOSURE_NOT_PROVEN';
  end if;

  if pg_catalog.has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or pg_catalog.has_function_privilege('anon','public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)','execute')
     or pg_catalog.has_function_privilege('service_role','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute') then
    raise exception 'COMMERCIAL_WAVE2_P4E_AUTHORITY_SHAPE_INVALID';
  end if;

  v_payload_hash:=encode(extensions.digest(pg_catalog.jsonb_build_object(
    'actorUserId',v_actor,
    'batchNo',p_batch_no,
    'commandId',v_command_id,
    'promotionPlanSha256','43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
    'batchSha256',v_batch_sha,
    'candidateCount',v_expected_count,
    'reason',v_reason
  )::text,'sha256'),'hex');

  select * into v_existing
  from public.ecoflow_commercial_wave2_promotion_batch_commands
  where batch_no=p_batch_no;
  if found then
    if v_existing.command_id<>v_command_id
       or v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMERCIAL_WAVE2_P4E_BATCH_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed',true);
  end if;

  if exists(select 1 from public.ecoflow_commercial_wave2_promotion_batch_commands where batch_no>p_batch_no)
     or exists(select 1 from public.ecoflow_commercial_wave2_promotion_batch_verifications where batch_no>=p_batch_no) then
    raise exception 'COMMERCIAL_WAVE2_P4E_SEQUENCE_INVALID';
  end if;
  if (select count(*) from public.ecoflow_commercial_wave2_promotion_batch_verifications where batch_no<p_batch_no)<>p_batch_no-1
     or exists (
       select 1 from pg_catalog.generate_series(1,p_batch_no-1) g(batch_no)
       where not exists (
         select 1 from public.ecoflow_commercial_wave2_promotion_batch_verifications v
         where v.batch_no=g.batch_no
       )
     ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_PREVIOUS_BATCH_NOT_VERIFIED';
  end if;

  select count(*)::integer into v_expected_prior
  from public.ecoflow_commercial_wave2_p4e_plan_members() where batch_no<p_batch_no;
  select count(*)::integer into v_prior_promoted
  from public.ecoflow_commercial_wave2_promotions p
  join public.ecoflow_commercial_wave2_p4e_plan_members() m
    on m.external_product_code=p.external_product_code
  where m.batch_no<p_batch_no;
  select count(*)::integer into v_non_canary_promoted
  from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010';
  if v_prior_promoted<>v_expected_prior or v_non_canary_promoted<>v_expected_prior
     or exists (
       select 1 from public.ecoflow_commercial_wave2_promotions p
       join public.ecoflow_commercial_wave2_p4e_plan_members() m
         on m.external_product_code=p.external_product_code
       where m.batch_no>=p_batch_no
     )
     or exists (
       select 1 from public.ecoflow_commercial_wave2_promotions p
       where p.external_product_code<>'140010'
         and not exists (
           select 1 from public.ecoflow_commercial_wave2_p4e_plan_members() m
           where m.external_product_code=p.external_product_code
         )
     ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_PROMOTION_SEQUENCE_DRIFT';
  end if;

  select count(*)::integer into v_eligible
  from public.ecoflow_commercial_wave2_p4e_plan_members() pm
  join public.ecoflow_commercial_wave2_candidates c
    on c.external_product_code=pm.external_product_code
  join public.ecoflow_unleashed_master_mappings m
    on m.id=pm.unleashed_mapping_id
  where pm.batch_no=p_batch_no
    and c.promotion_phase='EXPANSION' and c.enabled
    and c.candidate_set_sha256='79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
    and m.entity_type='PRODUCT' and m.mapping_status='UNMATCHED'
    and m.source_duplicate_count=1
    and upper(btrim(coalesce(m.source_external_code,'')))=pm.external_product_code
    and m.source_external_key=pm.expected_source_external_key
    and m.revision=pm.expected_mapping_revision
    and m.source_payload_sha256=pm.expected_source_payload_sha256
    and exists (
      select 1 from public.unleashed_raw_snapshots rs
      where rs.resource='products'
        and rs.external_key=pm.expected_source_external_key
        and rs.payload_sha256=pm.expected_source_payload_sha256
        and upper(btrim(coalesce(rs.payload->>'ProductCode','')))=pm.external_product_code
        and not public.ecoflow_unleashed_json_boolean(rs.payload->'Obsolete')
        and lower(coalesce(rs.payload->>'Status','')) not in ('obsolete','inactive','retired')
    )
    and (select count(*) from public.v_ecoflow_ordermentum_listed_skus l
      where upper(btrim(coalesce(l.external_sku_code,'')))=pm.external_product_code
        and l.is_visible_on_ordermentum)=1
    and not exists (select 1 from public.ecoflow_commercial_wave2_promotions p where p.external_product_code=pm.external_product_code)
    and not exists (select 1 from public.external_product_mappings e where e.provider='ORDERMENTUM' and upper(btrim(e.external_product_code))=pm.external_product_code)
    and not exists (select 1 from public.skus s where upper(btrim(s.sku_code))=pm.external_product_code);
  if v_eligible<>v_expected_count then
    raise exception 'COMMERCIAL_WAVE2_P4E_BATCH_ELIGIBILITY_DRIFT';
  end if;

  for v_member in
    select * from public.ecoflow_commercial_wave2_p4e_plan_members()
    where batch_no=p_batch_no
    order by item_position
  loop
    v_item_command_id:=extensions.gen_random_uuid();
    v_item_result:=public.ecoflow_promote_commercial_wave2_expansion_sku_v2(
      v_item_command_id,
      v_member.external_product_code,
      v_member.unleashed_mapping_id,
      v_member.expected_mapping_revision,
      v_member.expected_source_payload_sha256,
      pg_catalog.format('%s / %s',v_reason,v_member.external_product_code)
    );
    if v_item_result->>'externalProductCode'<>v_member.external_product_code
       or v_item_result->>'promotionPhase'<>'EXPANSION'
       or coalesce((v_item_result->>'physicalAuthorityCreated')::boolean,true)
       or coalesce((v_item_result->>'inventoryAuthorityCreated')::boolean,true)
       or coalesce((v_item_result->>'providerActionIncluded')::boolean,true) then
      raise exception 'COMMERCIAL_WAVE2_P4E_ITEM_POSTCONDITION_MISMATCH';
    end if;
    v_items:=v_items||pg_catalog.jsonb_build_array(
      v_item_result||pg_catalog.jsonb_build_object(
        'itemPosition',v_member.item_position,
        'itemCommandId',v_item_command_id,
        'providerActionIncluded',false
      )
    );
  end loop;

  select count(*)::integer into v_promoted_count
  from public.ecoflow_commercial_wave2_promotions p
  join public.ecoflow_commercial_wave2_p4e_plan_members() m
    on m.external_product_code=p.external_product_code
  where m.batch_no=p_batch_no;
  select count(*)::integer into v_non_canary_promoted
  from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010';
  if v_promoted_count<>v_expected_count
     or v_non_canary_promoted<>v_expected_prior+v_expected_count
     or pg_catalog.jsonb_array_length(v_items)<>v_expected_count then
    raise exception 'COMMERCIAL_WAVE2_P4E_BATCH_POSTCONDITION_MISMATCH';
  end if;

  v_result:=pg_catalog.jsonb_build_object(
    'mode','P4E_BATCH_EXECUTION',
    'stage','P4E_BATCH_PROMOTION',
    'batchNo',p_batch_no,
    'batchCommandId',v_command_id,
    'candidateCount',v_expected_count,
    'promotionPlanSha256','43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
    'batchSha256',v_batch_sha,
    'firstCode',v_expected->>'firstCode',
    'lastCode',v_expected->>'lastCode',
    'promotedCount',v_promoted_count,
    'cumulativePromotedCount',v_non_canary_promoted,
    'items',v_items,
    'replayed',false,
    'postflightRequired',true,
    'providerActionIncluded',false,
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false
  );

  insert into public.ecoflow_commercial_wave2_promotion_batch_commands(
    batch_no,command_id,actor_user_id,promotion_plan_sha256,batch_sha256,candidate_count,
    command_payload_sha256,result
  ) values(
    p_batch_no,v_command_id,v_actor,
    '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
    v_batch_sha,v_expected_count,v_payload_hash,v_result
  );
  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values(
    v_actor,v_role,'COMMERCIAL_WAVE2_EXPANSION_BATCH_PROMOTED_P4E',
    'ecoflow_commercial_wave2_promotion_batch_commands',p_batch_no::text,
    pg_catalog.jsonb_build_object('expectedPriorPromotionCount',v_expected_prior),v_result
  );
  return v_result;
end;
$function$;

create or replace function public.ecoflow_verify_commercial_wave2_expansion_batch_v1(p_batch_no integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_expected jsonb;
  v_plan jsonb;
  v_expected_count integer;
  v_expected_cumulative integer;
  v_batch public.ecoflow_commercial_wave2_promotion_batch_commands%rowtype;
  v_existing public.ecoflow_commercial_wave2_promotion_batch_verifications%rowtype;
  v_verified_items integer;
  v_current_promoted integer;
  v_non_canary_promoted integer;
  v_non_canary_commands integer;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4E_AUTHENTICATION_REQUIRED';
  end if;
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE';
  if v_role is null
     or v_role not in ('OWNER','ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_role then
    raise exception using errcode='42501', message='COMMERCIAL_WAVE2_P4E_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  v_expected:=public.ecoflow_commercial_wave2_p4e_expected_batch(p_batch_no);
  if v_expected is null then raise exception 'COMMERCIAL_WAVE2_P4E_INVALID_BATCH'; end if;
  v_expected_count:=(v_expected->>'candidateCount')::integer;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ecoflow_commercial_wave2_p4e_batch_sequence',0));

  v_plan:=public.ecoflow_commercial_wave2_p4e_plan_evidence();
  if v_plan->>'promotionPlanSha256' is distinct from '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'
     or (v_plan->>'candidateCount')::integer<>163 then
    raise exception 'COMMERCIAL_WAVE2_P4E_FROZEN_PLAN_MISMATCH';
  end if;

  select * into v_batch
  from public.ecoflow_commercial_wave2_promotion_batch_commands
  where batch_no=p_batch_no;
  if not found
     or v_batch.command_id<>(v_expected->>'commandId')::uuid
     or v_batch.promotion_plan_sha256<>'43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888'
     or v_batch.batch_sha256<>v_expected->>'batchSha256'
     or v_batch.candidate_count<>v_expected_count then
    raise exception 'COMMERCIAL_WAVE2_P4E_BATCH_COMMAND_NOT_PROVEN';
  end if;

  select * into v_existing
  from public.ecoflow_commercial_wave2_promotion_batch_verifications
  where batch_no=p_batch_no;
  if found then
    if v_existing.batch_command_id<>v_batch.command_id then
      raise exception 'COMMERCIAL_WAVE2_P4E_POSTFLIGHT_REPLAY_MISMATCH';
    end if;
    return v_existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;

  if exists(select 1 from public.ecoflow_commercial_wave2_promotion_batch_commands where batch_no>p_batch_no)
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_batch_verifications where batch_no<p_batch_no)<>p_batch_no-1 then
    raise exception 'COMMERCIAL_WAVE2_P4E_POSTFLIGHT_SEQUENCE_INVALID';
  end if;

  select coalesce(count(*),0)::integer into v_expected_cumulative
  from public.ecoflow_commercial_wave2_p4e_plan_members() where batch_no<=p_batch_no;
  select count(*)::integer into v_current_promoted
  from public.ecoflow_commercial_wave2_promotions p
  join public.ecoflow_commercial_wave2_p4e_plan_members() m
    on m.external_product_code=p.external_product_code
  where m.batch_no=p_batch_no;
  select count(*)::integer into v_non_canary_promoted
  from public.ecoflow_commercial_wave2_promotions where external_product_code<>'140010';
  select count(*)::integer into v_non_canary_commands
  from public.ecoflow_commercial_wave2_promotion_commands where external_product_code<>'140010';

  if v_current_promoted<>v_expected_count
     or v_non_canary_promoted<>v_expected_cumulative
     or v_non_canary_commands<>v_expected_cumulative
     or exists (
       select 1 from public.ecoflow_commercial_wave2_promotions p
       join public.ecoflow_commercial_wave2_p4e_plan_members() m
         on m.external_product_code=p.external_product_code
       where m.batch_no>p_batch_no
     )
     or exists (
       select 1 from public.ecoflow_commercial_wave2_promotions p
       where p.external_product_code<>'140010'
         and not exists (
           select 1 from public.ecoflow_commercial_wave2_p4e_plan_members() m
           where m.external_product_code=p.external_product_code
         )
     ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_POSTFLIGHT_LINEAGE_MISMATCH';
  end if;

  if pg_catalog.jsonb_array_length(coalesce(v_batch.result->'items','[]'::jsonb))<>v_expected_count
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(v_batch.result->'items') item
       where coalesce((item->>'providerActionIncluded')::boolean,true)
          or coalesce((item->>'physicalAuthorityCreated')::boolean,true)
          or coalesce((item->>'inventoryAuthorityCreated')::boolean,true)
     ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_POSTFLIGHT_RESULT_MISMATCH';
  end if;

  with items as (
    select
      item->>'externalProductCode' as external_product_code,
      (item->>'itemCommandId')::uuid as item_command_id,
      item->>'commercialSkuId' as commercial_sku_id,
      item->>'externalMappingId' as external_mapping_id
    from pg_catalog.jsonb_array_elements(v_batch.result->'items') item
  )
  select count(*)::integer into v_verified_items
  from items i
  join public.ecoflow_commercial_wave2_p4e_plan_members() pm
    on pm.batch_no=p_batch_no and pm.external_product_code=i.external_product_code
  join public.ecoflow_commercial_wave2_promotions p
    on p.external_product_code=i.external_product_code
   and p.authorization_command_id=i.item_command_id
   and p.commercial_sku_id::text=i.commercial_sku_id
   and p.external_mapping_id::text=i.external_mapping_id
  join public.ecoflow_commercial_wave2_promotion_commands pc
    on pc.command_id=i.item_command_id
   and pc.external_product_code=i.external_product_code
  join public.skus s
    on s.id=p.commercial_sku_id
   and upper(btrim(s.sku_code))=i.external_product_code
   and s.setup_status='mapping_draft'
  join public.external_product_mappings e
    on e.id=p.external_mapping_id
   and e.provider='ORDERMENTUM'
   and upper(btrim(e.external_product_code))=i.external_product_code
   and e.internal_sku_id=s.id
   and e.is_active
  join public.ecoflow_unleashed_master_mappings m
    on m.id=pm.unleashed_mapping_id
   and m.entity_type='PRODUCT'
   and m.mapping_status='UNMATCHED'
   and m.source_duplicate_count=1
   and m.revision=pm.expected_mapping_revision
   and m.source_payload_sha256=pm.expected_source_payload_sha256
  where exists (
    select 1 from public.app_security_audit_events a
    where a.action='COMMERCIAL_WAVE2_SKU_PROMOTED'
      and a.target_type='external_product_mappings'
      and a.target_id=e.id::text
  );
  if v_verified_items<>v_expected_count
     or (select count(distinct item->>'externalProductCode') from pg_catalog.jsonb_array_elements(v_batch.result->'items') item)<>v_expected_count
     or (select count(distinct item->>'itemCommandId') from pg_catalog.jsonb_array_elements(v_batch.result->'items') item)<>v_expected_count
     or not exists (
       select 1 from public.app_security_audit_events a
       where a.action='COMMERCIAL_WAVE2_EXPANSION_BATCH_PROMOTED_P4E'
         and a.target_type='ecoflow_commercial_wave2_promotion_batch_commands'
         and a.target_id=p_batch_no::text
     ) then
    raise exception 'COMMERCIAL_WAVE2_P4E_POSTFLIGHT_ITEM_PROOF_MISMATCH';
  end if;

  v_result:=pg_catalog.jsonb_build_object(
    'mode','P4E_BATCH_POSTFLIGHT',
    'stage','P4E_BATCH_PROMOTION',
    'verdict','PASS',
    'batchNo',p_batch_no,
    'batchCommandId',v_batch.command_id,
    'promotionPlanSha256','43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
    'batchSha256',v_batch.batch_sha256,
    'verifiedCandidateCount',v_verified_items,
    'cumulativePromotedCount',v_non_canary_promoted,
    'nextBatchNo',case when p_batch_no<7 then p_batch_no+1 else null end,
    'programmeComplete',p_batch_no=7,
    'providerActionIncluded',false,
    'physicalAuthorityCreated',false,
    'inventoryAuthorityCreated',false,
    'replayed',false
  );
  insert into public.ecoflow_commercial_wave2_promotion_batch_verifications(
    batch_no,batch_command_id,verified_by,promotion_plan_sha256,batch_sha256,
    verified_candidate_count,result
  ) values(
    p_batch_no,v_batch.command_id,v_actor,
    '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
    v_batch.batch_sha256,v_verified_items,v_result
  );
  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values(
    v_actor,v_role,'COMMERCIAL_WAVE2_EXPANSION_BATCH_VERIFIED_P4E',
    'ecoflow_commercial_wave2_promotion_batch_verifications',p_batch_no::text,
    pg_catalog.jsonb_build_object('batchCommandId',v_batch.command_id),v_result
  );
  return v_result;
end;
$function$;

-- The single-SKU delegate remains internal. Browser callers can only use the
-- sequence-gated batch orchestrator and postflight verifier. service_role never
-- receives production business mutation authority.
revoke all on function public.ecoflow_promote_commercial_wave2_expansion_sku_v2(uuid,text,uuid,bigint,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_read_commercial_wave2_p4e_batch_gate()
  from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer) to authenticated;
grant execute on function public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer) to authenticated;
grant execute on function public.ecoflow_read_commercial_wave2_p4e_batch_gate() to authenticated;

comment on function public.ecoflow_promote_commercial_wave2_expansion_batch_v1(integer) is
  'P4E caller-authenticated sequential batch promotion. Frozen 7-batch plan, exactly-once batch command, prior-postflight gate, no provider/Physical/inventory authority.';
comment on function public.ecoflow_verify_commercial_wave2_expansion_batch_v1(integer) is
  'P4E caller-authenticated independent postflight checkpoint. Next batch remains locked until this proof commits.';
comment on function public.ecoflow_read_commercial_wave2_p4e_batch_gate() is
  'P4E caller-authenticated read-only batch gate. Reports EXECUTE, POSTFLIGHT, COMPLETE or HOLD.';

commit;
