-- #338 Identity Unlock Batch 1A
-- Bounded Owner/Admin manual warehouse mapping candidate authority.
-- Frozen production scope: Unleashed warehouse ADL1 -> EcoFlow warehouse MAIN only.
-- This migration never creates or mutates Physical SKU, package, barcode,
-- inventory, location, opening-balance, or cutover authority.

begin;

do $deps$
begin
  if to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.ecoflow_unleashed_master_candidates') is null
     or to_regclass('public.warehouses') is null
     or to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null then
    raise exception 'IDENTITY_UNLOCK_MANUAL_WAREHOUSE_DEPENDENCIES_MISSING';
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'IDENTITY_UNLOCK_MANUAL_WAREHOUSE_EXTENSIONS_MISSING';
  end if;
end;
$deps$;

create table if not exists public.ecoflow_unleashed_manual_mapping_candidates (
  mapping_id uuid primary key
    references public.ecoflow_unleashed_master_mappings(id) on delete cascade,
  source_external_code text not null,
  source_payload_sha256 text not null
    check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_warehouse_id uuid not null
    references public.warehouses(id) on delete restrict,
  canonical_code text not null,
  match_method text not null default 'OWNER_ADMIN_MANUAL_WAREHOUSE'
    check (match_method='OWNER_ADMIN_MANUAL_WAREHOUSE'),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  reason text not null,
  authorization_command_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_unlock_manual_source_bound
    check (upper(btrim(source_external_code))='ADL1'),
  constraint identity_unlock_manual_target_bound
    check (upper(btrim(canonical_code))='MAIN'),
  constraint identity_unlock_manual_reason_nonblank
    check (length(btrim(reason)) >= 3)
);

create table if not exists public.ecoflow_unleashed_manual_mapping_candidate_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  mapping_id uuid not null
    references public.ecoflow_unleashed_master_mappings(id) on delete restrict,
  actor_user_id uuid not null,
  expected_revision bigint not null check (expected_revision >= 0),
  expected_source_payload_sha256 text not null
    check (expected_source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  command_payload_sha256 text not null
    check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_id uuid
    references public.ecoflow_unleashed_master_candidates(id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.ecoflow_unleashed_manual_mapping_candidates enable row level security;
alter table public.ecoflow_unleashed_manual_mapping_candidate_commands enable row level security;

revoke all on table public.ecoflow_unleashed_manual_mapping_candidates
  from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_unleashed_manual_mapping_candidate_commands
  from public,anon,authenticated,service_role;

-- Materialise only the explicitly authorised, still-current ADL1 -> MAIN pair.
-- A changed source payload automatically invalidates the candidate until a new
-- Owner/Admin command explicitly re-authorises that new source snapshot.
create or replace function public.ecoflow_refresh_unleashed_manual_mapping_candidates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refreshed integer := 0;
begin
  update public.ecoflow_unleashed_master_candidates c
  set is_current=false,updated_at=now()
  where c.match_method='OWNER_ADMIN_MANUAL_WAREHOUSE'
    and not exists (
      select 1
      from public.ecoflow_unleashed_manual_mapping_candidates a
      join public.ecoflow_unleashed_master_mappings m on m.id=a.mapping_id
      join public.warehouses w on w.id=a.canonical_warehouse_id
      where a.mapping_id=c.mapping_id
        and m.entity_type='WAREHOUSE'
        and m.mapping_status <> 'RETIRED'
        and upper(btrim(coalesce(m.source_external_code,'')))='ADL1'
        and m.source_payload_sha256=a.source_payload_sha256
        and upper(btrim(a.source_external_code))='ADL1'
        and upper(btrim(a.canonical_code))='MAIN'
        and upper(btrim(w.warehouse_code))='MAIN'
    );

  insert into public.ecoflow_unleashed_master_candidates(
    mapping_id,candidate_rank,canonical_object_type,canonical_object_id,
    canonical_code,ordermentum_external_id,match_method,is_current,evidence
  )
  select
    a.mapping_id,1,'WAREHOUSE',a.canonical_warehouse_id,
    'MAIN',null,'OWNER_ADMIN_MANUAL_WAREHOUSE',true,
    jsonb_build_object(
      'authority','OWNER_ADMIN_MANUAL_WAREHOUSE_CANDIDATE',
      'sourceExternalCode','ADL1',
      'sourcePayloadSha256',a.source_payload_sha256,
      'targetWarehouseCode','MAIN',
      'authorizationCommandId',a.authorization_command_id,
      'approvedBy',a.approved_by,
      'approvedAt',a.approved_at,
      'reason',a.reason
    )
  from public.ecoflow_unleashed_manual_mapping_candidates a
  join public.ecoflow_unleashed_master_mappings m on m.id=a.mapping_id
  join public.warehouses w on w.id=a.canonical_warehouse_id
  where m.entity_type='WAREHOUSE'
    and m.mapping_status <> 'RETIRED'
    and upper(btrim(coalesce(m.source_external_code,'')))='ADL1'
    and m.source_payload_sha256=a.source_payload_sha256
    and upper(btrim(a.source_external_code))='ADL1'
    and upper(btrim(a.canonical_code))='MAIN'
    and upper(btrim(w.warehouse_code))='MAIN'
  on conflict(mapping_id,canonical_object_type,canonical_object_id,match_method)
  do update set
    candidate_rank=excluded.candidate_rank,
    canonical_code=excluded.canonical_code,
    ordermentum_external_id=null,
    is_current=true,
    evidence=excluded.evidence,
    updated_at=now();

  get diagnostics v_refreshed = row_count;
  return v_refreshed;
end;
$$;

-- The existing PLAN implementation is retained as a private core. The public
-- service-role PLAN entry point is wrapped so every PLAN re-materialises valid
-- manual candidates after the deterministic core has refreshed/staled its own
-- candidate set. This prevents a later PLAN from silently erasing ADL1->MAIN.
do $rename$
begin
  if to_regprocedure('public.ecoflow_plan_unleashed_master_mappings_core(uuid,text)') is null then
    if to_regprocedure('public.ecoflow_plan_unleashed_master_mappings(uuid,text)') is null then
      raise exception 'IDENTITY_UNLOCK_PLAN_ENTRYPOINT_MISSING';
    end if;
    execute 'alter function public.ecoflow_plan_unleashed_master_mappings(uuid,text) rename to ecoflow_plan_unleashed_master_mappings_core';
  end if;
end;
$rename$;

create or replace function public.ecoflow_plan_unleashed_master_mappings(
  p_requested_by uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_manual_refreshed integer;
begin
  v_result := public.ecoflow_plan_unleashed_master_mappings_core(p_requested_by,p_reason);
  v_manual_refreshed := public.ecoflow_refresh_unleashed_manual_mapping_candidates();
  return coalesce(v_result,'{}'::jsonb)
    || jsonb_build_object('manualWarehouseCandidatesRefreshed',v_manual_refreshed);
end;
$$;

create or replace function public.ecoflow_add_unleashed_manual_warehouse_candidate(
  p_command_id uuid,
  p_requested_by uuid,
  p_mapping_id uuid,
  p_expected_revision bigint,
  p_expected_source_payload_sha256 text,
  p_source_external_code text,
  p_target_warehouse_code text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_existing public.ecoflow_unleashed_manual_mapping_candidate_commands%rowtype;
  v_existing_authorization public.ecoflow_unleashed_manual_mapping_candidates%rowtype;
  v_payload_hash text;
  v_candidate_id uuid;
  v_revision bigint;
  v_changed boolean := false;
  v_result jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by
    and p.is_active
    and p.team_status='ACTIVE';
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'MANUAL_WAREHOUSE_CANDIDATE_FORBIDDEN';
  end if;

  if p_command_id is null or p_requested_by is null or p_mapping_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_expected_source_payload_sha256 is null
     or p_expected_source_payload_sha256 !~ '^[0-9a-f]{64}$'
     or upper(btrim(coalesce(p_source_external_code,''))) <> 'ADL1'
     or upper(btrim(coalesce(p_target_warehouse_code,''))) <> 'MAIN'
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'MANUAL_WAREHOUSE_CANDIDATE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_manual_warehouse_candidate:'||p_command_id::text,0)
  );

  v_payload_hash := encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,
    'mappingId',p_mapping_id,
    'expectedRevision',p_expected_revision,
    'expectedSourcePayloadSha256',p_expected_source_payload_sha256,
    'sourceExternalCode','ADL1',
    'targetWarehouseCode','MAIN',
    'reason',btrim(p_reason)
  )::text,'sha256'),'hex');

  select * into v_existing
  from public.ecoflow_unleashed_manual_mapping_candidate_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256 <> v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.id=p_mapping_id
  for update;
  if not found then raise exception 'MANUAL_WAREHOUSE_MAPPING_NOT_FOUND'; end if;
  if v_mapping.revision <> p_expected_revision then
    raise exception 'MAPPING_REVISION_CONFLICT';
  end if;
  if v_mapping.entity_type <> 'WAREHOUSE'
     or v_mapping.mapping_status <> 'UNMATCHED'
     or v_mapping.source_duplicate_count <> 1
     or upper(btrim(coalesce(v_mapping.source_external_code,''))) <> 'ADL1' then
    raise exception 'MANUAL_WAREHOUSE_SOURCE_NOT_ELIGIBLE';
  end if;
  if v_mapping.source_payload_sha256 <> p_expected_source_payload_sha256 then
    raise exception 'SOURCE_SNAPSHOT_CHANGED';
  end if;

  select * into v_warehouse
  from public.warehouses w
  where upper(btrim(w.warehouse_code))='MAIN';
  if not found then raise exception 'MANUAL_WAREHOUSE_TARGET_NOT_FOUND'; end if;

  select * into v_existing_authorization
  from public.ecoflow_unleashed_manual_mapping_candidates a
  where a.mapping_id=p_mapping_id
  for update;

  if not found then
    insert into public.ecoflow_unleashed_manual_mapping_candidates(
      mapping_id,source_external_code,source_payload_sha256,
      canonical_warehouse_id,canonical_code,match_method,
      approved_by,approved_at,reason,authorization_command_id
    ) values (
      p_mapping_id,'ADL1',p_expected_source_payload_sha256,
      v_warehouse.id,'MAIN','OWNER_ADMIN_MANUAL_WAREHOUSE',
      p_requested_by,now(),btrim(p_reason),p_command_id
    );
    v_changed := true;
  elsif v_existing_authorization.source_payload_sha256 <> p_expected_source_payload_sha256
     or v_existing_authorization.canonical_warehouse_id <> v_warehouse.id then
    update public.ecoflow_unleashed_manual_mapping_candidates a set
      source_external_code='ADL1',
      source_payload_sha256=p_expected_source_payload_sha256,
      canonical_warehouse_id=v_warehouse.id,
      canonical_code='MAIN',
      match_method='OWNER_ADMIN_MANUAL_WAREHOUSE',
      approved_by=p_requested_by,
      approved_at=now(),
      reason=btrim(p_reason),
      authorization_command_id=p_command_id,
      updated_at=now()
    where a.mapping_id=p_mapping_id;
    v_changed := true;
  end if;

  if v_changed then
    update public.ecoflow_unleashed_master_mappings m
    set revision=m.revision+1,updated_at=now()
    where m.id=p_mapping_id
    returning revision into v_revision;
  else
    v_revision := v_mapping.revision;
  end if;

  perform public.ecoflow_refresh_unleashed_manual_mapping_candidates();

  select c.id into v_candidate_id
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=p_mapping_id
    and c.canonical_object_type='WAREHOUSE'
    and c.canonical_object_id=v_warehouse.id
    and c.match_method='OWNER_ADMIN_MANUAL_WAREHOUSE'
    and c.is_current;
  if v_candidate_id is null then
    raise exception 'MANUAL_WAREHOUSE_CANDIDATE_MATERIALIZATION_FAILED';
  end if;

  v_result := jsonb_build_object(
    'mappingId',p_mapping_id,
    'candidateId',v_candidate_id,
    'sourceExternalCode','ADL1',
    'targetWarehouseCode','MAIN',
    'matchMethod','OWNER_ADMIN_MANUAL_WAREHOUSE',
    'revision',v_revision,
    'changed',v_changed,
    'replayed',false
  );

  insert into public.ecoflow_unleashed_manual_mapping_candidate_commands(
    command_id,mapping_id,actor_user_id,expected_revision,
    expected_source_payload_sha256,command_payload_sha256,candidate_id,result
  ) values (
    p_command_id,p_mapping_id,p_requested_by,p_expected_revision,
    p_expected_source_payload_sha256,v_payload_hash,v_candidate_id,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    p_requested_by,v_role,
    'UNLEASHED_MANUAL_WAREHOUSE_CANDIDATE_AUTHORIZED',
    'ecoflow_unleashed_master_mappings',p_mapping_id::text,
    jsonb_build_object(
      'mappingStatus',v_mapping.mapping_status,
      'revision',v_mapping.revision,
      'sourceExternalCode',v_mapping.source_external_code,
      'sourcePayloadSha256',v_mapping.source_payload_sha256
    ),
    v_result
  );

  return v_result;
end;
$$;

-- The core and refresh helper are implementation details. Only the server-side
-- PLAN wrapper and the bounded candidate command are exposed to service_role.
revoke all on function public.ecoflow_plan_unleashed_master_mappings_core(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_refresh_unleashed_manual_mapping_candidates()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_plan_unleashed_master_mappings(uuid,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_plan_unleashed_master_mappings(uuid,text)
  to service_role;
revoke all on function public.ecoflow_add_unleashed_manual_warehouse_candidate(uuid,uuid,uuid,bigint,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_add_unleashed_manual_warehouse_candidate(uuid,uuid,uuid,bigint,text,text,text,text)
  to service_role;

commit;
