-- UNLEASHED-MIGRATION-003: canonical master-data mapping and product assets.
-- This migration is additive. It never creates Physical SKUs, changes an
-- inventory quantity, or calls Unleashed. Runtime planning consumes only the
-- governed snapshots written by UNLEASHED-MIGRATION-002.

begin;

do $deps$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.unleashed_external_identities') is null then
    v_missing := array_append(v_missing,'public.unleashed_external_identities');
  end if;
  if to_regclass('public.unleashed_raw_snapshots') is null then
    v_missing := array_append(v_missing,'public.unleashed_raw_snapshots');
  end if;
  if to_regclass('public.unleashed_sync_runs') is null then
    v_missing := array_append(v_missing,'public.unleashed_sync_runs');
  end if;
  if to_regclass('public.external_product_mappings') is null then
    v_missing := array_append(v_missing,'public.external_product_mappings');
  end if;
  if to_regclass('public.ecoflow_external_object_mappings') is null then
    v_missing := array_append(v_missing,'public.ecoflow_external_object_mappings');
  end if;
  if to_regclass('public.skus') is null then
    v_missing := array_append(v_missing,'public.skus');
  end if;
  if to_regclass('public.warehouses') is null then
    v_missing := array_append(v_missing,'public.warehouses');
  end if;
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;
  if to_regclass('public.app_security_audit_events') is null then
    v_missing := array_append(v_missing,'public.app_security_audit_events');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_active_app_role()');
  end if;
  if to_regnamespace('extensions') is null then
    v_missing := array_append(v_missing,'extensions schema');
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null then
    v_missing := array_append(v_missing,'extensions.gen_random_uuid()');
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    v_missing := array_append(v_missing,'extensions.digest(text,text)');
  end if;
  if array_length(v_missing,1) is not null then
    raise exception 'UNLEASHED_MASTER_DATA_DEPENDENCIES_MISSING:%',array_to_string(v_missing,',');
  end if;
end;
$deps$;

create table if not exists public.ecoflow_unleashed_master_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  identity_id uuid not null unique
    references public.unleashed_external_identities(id) on delete restrict,
  entity_type text not null
    check (entity_type in ('PRODUCT','CUSTOMER','CUSTOMER_DELIVERY_ADDRESS','SUPPLIER','WAREHOUSE')),
  mapping_status text not null
    check (mapping_status in ('MATCHED','AMBIGUOUS','UNMATCHED','RETIRED')),
  source_external_guid text,
  source_external_code text,
  source_external_key text not null,
  source_payload_sha256 text not null,
  source_observed_at timestamptz not null,
  canonical_object_type text,
  canonical_object_id uuid,
  canonical_code text,
  ordermentum_external_id text,
  match_method text,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  source_duplicate_count integer not null default 1 check (source_duplicate_count >= 1),
  candidate_set_sha256 text not null check (candidate_set_sha256 ~ '^[0-9a-f]{64}$'),
  decision_source text not null default 'AUTO'
    check (decision_source in ('AUTO','REVIEW')),
  revision bigint not null default 0 check (revision >= 0),
  last_planned_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  last_planned_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_unleashed_mapping_source_hash
    check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ecoflow_unleashed_mapping_matched_target
    check (
      mapping_status <> 'MATCHED'
      or (
        canonical_object_type is not null
        and canonical_object_id is not null
        and canonical_code is not null
        and match_method is not null
      )
    ),
  constraint ecoflow_unleashed_mapping_nonmatched_target
    check (
      mapping_status = 'MATCHED'
      or (
        canonical_object_type is null
        and canonical_object_id is null
        and canonical_code is null
        and ordermentum_external_id is null
      )
    )
);

create index if not exists ecoflow_unleashed_master_mappings_queue_idx
  on public.ecoflow_unleashed_master_mappings(mapping_status,entity_type,updated_at desc);
create index if not exists ecoflow_unleashed_master_mappings_source_code_idx
  on public.ecoflow_unleashed_master_mappings(entity_type,upper(source_external_code));

create table if not exists public.ecoflow_unleashed_master_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  mapping_id uuid not null
    references public.ecoflow_unleashed_master_mappings(id) on delete cascade,
  candidate_rank integer not null default 1 check (candidate_rank >= 1),
  canonical_object_type text not null,
  canonical_object_id uuid not null,
  canonical_code text not null,
  ordermentum_external_id text,
  match_method text not null,
  is_current boolean not null default true,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mapping_id,canonical_object_type,canonical_object_id,match_method)
);

create index if not exists ecoflow_unleashed_master_candidates_current_idx
  on public.ecoflow_unleashed_master_candidates(mapping_id,candidate_rank)
  where is_current;

create table if not exists public.ecoflow_unleashed_mapping_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  mapping_id uuid not null
    references public.ecoflow_unleashed_master_mappings(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  expected_revision bigint not null check (expected_revision >= 0),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  requested_status text not null
    check (requested_status in ('MATCHED','AMBIGUOUS','UNMATCHED','RETIRED')),
  requested_candidate_id uuid references public.ecoflow_unleashed_master_candidates(id) on delete restrict,
  selected_candidate_snapshot jsonb
    check (selected_candidate_snapshot is null or jsonb_typeof(selected_candidate_snapshot)='object'),
  reason text not null,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.ecoflow_unleashed_asset_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  authorization_status text not null
    check (authorization_status in ('PENDING','APPROVED','REJECTED','REVOKED')),
  is_current boolean not null default true,
  revision bigint not null check (revision >= 1),
  evidence_reference text,
  rights_scope text,
  storage_budget_bytes bigint,
  max_object_bytes bigint,
  authorized_by uuid references auth.users(id) on delete restrict,
  authorized_at timestamptz,
  expires_at timestamptz,
  reason text not null,
  command_id uuid not null unique,
  created_at timestamptz not null default now(),
  constraint ecoflow_unleashed_asset_approval_evidence check (
    authorization_status <> 'APPROVED'
    or (
      authorized_by is not null
      and authorized_at is not null
      and length(btrim(evidence_reference)) > 0
      and length(btrim(rights_scope)) > 0
      and storage_budget_bytes > 0
      and max_object_bytes between 1 and 10485760
    )
  )
);

create unique index if not exists ecoflow_unleashed_asset_authorization_current_uidx
  on public.ecoflow_unleashed_asset_authorizations((true)) where is_current;

create table if not exists public.ecoflow_unleashed_asset_authorization_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  expected_revision bigint not null check (expected_revision >= 0),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.ecoflow_unleashed_asset_copy_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'RUNNING'
    check (status in ('RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  requested_limit integer not null check (requested_limit between 1 and 10),
  authorization_id uuid not null
    references public.ecoflow_unleashed_asset_authorizations(id) on delete restrict,
  assets_planned integer not null default 0,
  assets_copied integer not null default 0,
  assets_reused integer not null default 0,
  assets_failed integer not null default 0,
  bytes_copied bigint not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);

create unique index if not exists ecoflow_unleashed_asset_copy_running_uidx
  on public.ecoflow_unleashed_asset_copy_runs((true)) where status='RUNNING';

create table if not exists public.ecoflow_unleashed_product_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  identity_id uuid not null
    references public.unleashed_external_identities(id) on delete restrict,
  source_snapshot_id uuid not null
    references public.unleashed_raw_snapshots(id) on delete restrict,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_image_url text not null,
  source_locator_sha256 text not null check (source_locator_sha256 ~ '^[0-9a-f]{64}$'),
  source_host text not null,
  asset_status text not null default 'PLANNED'
    check (asset_status in ('PLANNED','COPYING','COPIED','FAILED','BLOCKED','RETIRED')),
  content_type text,
  content_length bigint check (content_length is null or content_length >= 0),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  bucket_id text not null default 'unleashed-product-images',
  object_path text,
  claimed_in_run_id uuid references public.ecoflow_unleashed_asset_copy_runs(id) on delete set null,
  copied_in_run_id uuid references public.ecoflow_unleashed_asset_copy_runs(id) on delete set null,
  copied_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_error_message text,
  source_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(identity_id,source_locator_sha256),
  constraint ecoflow_unleashed_product_asset_copied_fields check (
    asset_status <> 'COPIED'
    or (
      content_type in ('image/jpeg','image/png','image/webp')
      and content_length is not null
      and content_sha256 is not null
      and object_path is not null
      and copied_at is not null
    )
  )
);

create index if not exists ecoflow_unleashed_product_assets_queue_idx
  on public.ecoflow_unleashed_product_assets(asset_status,created_at);
create index if not exists ecoflow_unleashed_product_assets_content_idx
  on public.ecoflow_unleashed_product_assets(content_sha256)
  where content_sha256 is not null;

create or replace function public.ecoflow_unleashed_json_boolean(p_value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case lower(btrim(coalesce(p_value #>> '{}','')))
    when 'true' then true
    when 'yes' then true
    when '1' then true
    else false
  end
$$;

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
  v_source record;
  v_mapping_id uuid;
  v_candidate_count integer;
  v_duplicate_count integer;
  v_status text;
  v_final_status text;
  v_object_type text;
  v_object_id uuid;
  v_canonical_code text;
  v_ordermentum_id text;
  v_match_method text;
  v_candidate_set jsonb;
  v_candidate_set_sha256 text;
  v_preserve_review boolean;
  v_planned integer := 0;
  v_matched integer := 0;
  v_ambiguous integer := 0;
  v_unmatched integer := 0;
  v_retired integer := 0;
begin
  if p_requested_by is null or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'UNLEASHED_MASTER_PLAN_CONTEXT_REQUIRED';
  end if;
  if not exists (
    select 1 from public.app_user_profiles p
    where p.user_id=p_requested_by
      and p.is_active
      and p.team_status='ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  ) then
    raise exception 'UNLEASHED_MASTER_PLAN_FORBIDDEN';
  end if;

  for v_source in
    select
      i.id as identity_id,
      i.resource,
      i.external_key,
      i.external_guid,
      i.external_code,
      i.last_seen_run_id,
      s.id as snapshot_id,
      s.payload,
      s.payload_sha256,
      s.last_seen_at
    from public.unleashed_external_identities i
    join public.unleashed_raw_snapshots s
      on s.resource=i.resource and s.external_key=i.external_key
    where i.resource in ('products','customers','customer_delivery_addresses','suppliers','warehouses')
    order by i.resource,i.external_key
  loop
    v_candidate_count := 0;
    v_object_type := null;
    v_object_id := null;
    v_canonical_code := null;
    v_ordermentum_id := null;
    v_match_method := null;
    v_candidate_set := '[]'::jsonb;

    select count(*)::integer into v_duplicate_count
    from public.unleashed_external_identities d
    where d.resource=v_source.resource
      and (
        (v_source.external_guid is not null and lower(d.external_guid)=lower(v_source.external_guid))
        or (
          v_source.external_code is not null
          and upper(btrim(d.external_code))=upper(btrim(v_source.external_code))
        )
      );
    v_duplicate_count := greatest(coalesce(v_duplicate_count,0),1);

    if v_source.resource='products' then
      select
        count(distinct s.id)::integer,
        min('COMMERCIAL_SKU'),
        min(s.id::text)::uuid,
        min(s.sku_code),
        min(m.external_product_code),
        min('ORDERMENTUM_PRODUCT_CODE_EXACT')
      into v_candidate_count,v_object_type,v_object_id,v_canonical_code,v_ordermentum_id,v_match_method
      from public.external_product_mappings m
      join public.skus s on s.id=m.internal_sku_id
      where m.provider='ORDERMENTUM'
        and m.is_active
        and v_source.external_code is not null
        and upper(btrim(m.external_product_code))=upper(btrim(v_source.external_code));
    elsif v_source.resource='warehouses' then
      select
        count(distinct w.id)::integer,
        min('WAREHOUSE'),
        min(w.id::text)::uuid,
        min(w.warehouse_code),
        min(null::text),
        min('ECOFLOW_WAREHOUSE_CODE_EXACT')
      into v_candidate_count,v_object_type,v_object_id,v_canonical_code,v_ordermentum_id,v_match_method
      from public.warehouses w
      where v_source.external_code is not null
        and upper(btrim(w.warehouse_code))=upper(btrim(v_source.external_code));
    else
      select
        count(distinct (m.internal_object_type,m.internal_object_id))::integer,
        min(m.internal_object_type),
        min(m.internal_object_id::text)::uuid,
        min(coalesce(m.internal_code,m.internal_object_id::text)),
        min(null::text),
        min('EXPLICIT_EXTERNAL_OBJECT_MAPPING')
      into v_candidate_count,v_object_type,v_object_id,v_canonical_code,v_ordermentum_id,v_match_method
      from public.ecoflow_external_object_mappings m
      where m.external_system='UNLEASHED'
        and m.mapping_status='ACTIVE'
        and m.internal_object_id is not null
        and m.external_resource_type=v_source.resource
        and m.external_id in (
          v_source.external_key,
          coalesce(v_source.external_guid,''),
          coalesce(v_source.external_code,'')
        );
    end if;

    v_status := case
      when public.ecoflow_unleashed_json_boolean(v_source.payload->'Obsolete')
        or lower(coalesce(v_source.payload->>'Status','')) in ('obsolete','inactive','retired')
        then 'RETIRED'
      when v_duplicate_count > 1 then 'AMBIGUOUS'
      when v_candidate_count = 1 then 'MATCHED'
      when v_candidate_count > 1 then 'AMBIGUOUS'
      else 'UNMATCHED'
    end;

    if v_source.resource='products' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'canonicalObjectType','COMMERCIAL_SKU',
        'canonicalObjectId',candidate.id,
        'canonicalCode',candidate.sku_code,
        'ordermentumExternalId',candidate.ordermentum_external_id,
        'matchMethod','ORDERMENTUM_PRODUCT_CODE_EXACT'
      ) order by candidate.id), '[]'::jsonb)
      into v_candidate_set
      from (
        select s.id,s.sku_code,min(m.external_product_code) as ordermentum_external_id
        from public.external_product_mappings m
        join public.skus s on s.id=m.internal_sku_id
        where m.provider='ORDERMENTUM' and m.is_active
          and v_source.external_code is not null
          and upper(btrim(m.external_product_code))=upper(btrim(v_source.external_code))
        group by s.id,s.sku_code
      ) candidate;
    elsif v_source.resource='warehouses' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'canonicalObjectType','WAREHOUSE',
        'canonicalObjectId',candidate.id,
        'canonicalCode',candidate.warehouse_code,
        'matchMethod','ECOFLOW_WAREHOUSE_CODE_EXACT'
      ) order by candidate.id), '[]'::jsonb)
      into v_candidate_set
      from (
        select distinct w.id,w.warehouse_code
        from public.warehouses w
        where v_source.external_code is not null
          and upper(btrim(w.warehouse_code))=upper(btrim(v_source.external_code))
      ) candidate;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'canonicalObjectType',candidate.internal_object_type,
        'canonicalObjectId',candidate.internal_object_id,
        'canonicalCode',candidate.internal_code,
        'matchMethod','EXPLICIT_EXTERNAL_OBJECT_MAPPING'
      ) order by candidate.internal_object_type,candidate.internal_object_id), '[]'::jsonb)
      into v_candidate_set
      from (
        select
          m.internal_object_type,m.internal_object_id,
          min(coalesce(m.internal_code,m.internal_object_id::text)) as internal_code
        from public.ecoflow_external_object_mappings m
        where m.external_system='UNLEASHED'
          and m.mapping_status='ACTIVE'
          and m.internal_object_id is not null
          and m.external_resource_type=v_source.resource
          and m.external_id in (
            v_source.external_key,
            coalesce(v_source.external_guid,''),
            coalesce(v_source.external_code,'')
          )
        group by m.internal_object_type,m.internal_object_id
      ) candidate;
    end if;

    v_candidate_set_sha256 := encode(extensions.digest(jsonb_build_object(
      'autoStatus',v_status,
      'sourceDuplicateCount',v_duplicate_count,
      'candidates',v_candidate_set
    )::text,'sha256'),'hex');

    if v_status <> 'MATCHED' then
      v_object_type := null;
      v_object_id := null;
      v_canonical_code := null;
      v_ordermentum_id := null;
    end if;

    select exists(
      select 1
      from public.ecoflow_unleashed_master_mappings current_mapping
      where current_mapping.identity_id=v_source.identity_id
        and current_mapping.decision_source='REVIEW'
        and current_mapping.source_payload_sha256=v_source.payload_sha256
        and current_mapping.candidate_set_sha256=v_candidate_set_sha256
    ) into v_preserve_review;

    insert into public.ecoflow_unleashed_master_mappings as existing (
      identity_id,entity_type,mapping_status,
      source_external_guid,source_external_code,source_external_key,
      source_payload_sha256,source_observed_at,
      canonical_object_type,canonical_object_id,canonical_code,ordermentum_external_id,
      match_method,candidate_count,source_duplicate_count,candidate_set_sha256,decision_source,
      last_planned_run_id,last_planned_at
    ) values (
      v_source.identity_id,
      case v_source.resource
        when 'products' then 'PRODUCT'
        when 'customers' then 'CUSTOMER'
        when 'customer_delivery_addresses' then 'CUSTOMER_DELIVERY_ADDRESS'
        when 'suppliers' then 'SUPPLIER'
        when 'warehouses' then 'WAREHOUSE'
      end,
      v_status,
      v_source.external_guid,v_source.external_code,v_source.external_key,
      v_source.payload_sha256,v_source.last_seen_at,
      v_object_type,v_object_id,v_canonical_code,v_ordermentum_id,
      v_match_method,coalesce(v_candidate_count,0),v_duplicate_count,v_candidate_set_sha256,'AUTO',
      v_source.last_seen_run_id,now()
    )
    on conflict(identity_id) do update set
      entity_type=excluded.entity_type,
      source_external_guid=excluded.source_external_guid,
      source_external_code=excluded.source_external_code,
      source_external_key=excluded.source_external_key,
      source_payload_sha256=excluded.source_payload_sha256,
      source_observed_at=excluded.source_observed_at,
      mapping_status=case when v_preserve_review then existing.mapping_status else excluded.mapping_status end,
      canonical_object_type=case when v_preserve_review then existing.canonical_object_type else excluded.canonical_object_type end,
      canonical_object_id=case when v_preserve_review then existing.canonical_object_id else excluded.canonical_object_id end,
      canonical_code=case when v_preserve_review then existing.canonical_code else excluded.canonical_code end,
      ordermentum_external_id=case when v_preserve_review then existing.ordermentum_external_id else excluded.ordermentum_external_id end,
      match_method=case when v_preserve_review then existing.match_method else excluded.match_method end,
      candidate_count=excluded.candidate_count,
      source_duplicate_count=excluded.source_duplicate_count,
      candidate_set_sha256=excluded.candidate_set_sha256,
      decision_source=case when v_preserve_review then existing.decision_source else 'AUTO' end,
      reviewed_by=case when v_preserve_review then existing.reviewed_by else null end,
      reviewed_at=case when v_preserve_review then existing.reviewed_at else null end,
      review_reason=case when v_preserve_review then existing.review_reason else null end,
      revision=existing.revision + case
        when existing.source_payload_sha256 is distinct from excluded.source_payload_sha256 then 1
        when existing.candidate_set_sha256 is distinct from excluded.candidate_set_sha256 then 1
        when not v_preserve_review and (
          existing.mapping_status is distinct from excluded.mapping_status
          or existing.canonical_object_id is distinct from excluded.canonical_object_id
          or existing.candidate_count is distinct from excluded.candidate_count
          or existing.source_duplicate_count is distinct from excluded.source_duplicate_count
        ) then 1
        else 0
      end,
      last_planned_run_id=excluded.last_planned_run_id,
      last_planned_at=excluded.last_planned_at,
      updated_at=now()
    returning id,mapping_status into v_mapping_id,v_final_status;

    -- Candidate rows are durable review evidence. Mark the previous plan stale
    -- and reactivate/upsert the current deterministic candidates instead of
    -- deleting rows that may be referenced by an accepted review command.
    update public.ecoflow_unleashed_master_candidates c
    set is_current=false,updated_at=now()
    where c.mapping_id=v_mapping_id and c.is_current;

    if v_source.resource='products' then
      insert into public.ecoflow_unleashed_master_candidates(
        mapping_id,candidate_rank,canonical_object_type,canonical_object_id,
        canonical_code,ordermentum_external_id,match_method,is_current,evidence
      )
      select
        v_mapping_id,1,'COMMERCIAL_SKU',s.id,s.sku_code,min(m.external_product_code),
        'ORDERMENTUM_PRODUCT_CODE_EXACT',true,
        jsonb_build_object('normalisedCode',upper(btrim(v_source.external_code)))
      from public.external_product_mappings m
      join public.skus s on s.id=m.internal_sku_id
      where m.provider='ORDERMENTUM' and m.is_active
        and v_source.external_code is not null
        and upper(btrim(m.external_product_code))=upper(btrim(v_source.external_code))
      group by s.id,s.sku_code
      on conflict(mapping_id,canonical_object_type,canonical_object_id,match_method)
      do update set
        candidate_rank=excluded.candidate_rank,
        canonical_code=excluded.canonical_code,
        ordermentum_external_id=excluded.ordermentum_external_id,
        is_current=true,
        evidence=excluded.evidence,
        updated_at=now();
    elsif v_source.resource='warehouses' then
      insert into public.ecoflow_unleashed_master_candidates(
        mapping_id,candidate_rank,canonical_object_type,canonical_object_id,
        canonical_code,match_method,is_current,evidence
      )
      select distinct
        v_mapping_id,1,'WAREHOUSE',w.id,w.warehouse_code,
        'ECOFLOW_WAREHOUSE_CODE_EXACT',true,
        jsonb_build_object('normalisedCode',upper(btrim(v_source.external_code)))
      from public.warehouses w
      where v_source.external_code is not null
        and upper(btrim(w.warehouse_code))=upper(btrim(v_source.external_code))
      on conflict(mapping_id,canonical_object_type,canonical_object_id,match_method)
      do update set
        candidate_rank=excluded.candidate_rank,
        canonical_code=excluded.canonical_code,
        is_current=true,
        evidence=excluded.evidence,
        updated_at=now();
    else
      insert into public.ecoflow_unleashed_master_candidates(
        mapping_id,candidate_rank,canonical_object_type,canonical_object_id,
        canonical_code,match_method,is_current,evidence
      )
      select
        v_mapping_id,1,m.internal_object_type,m.internal_object_id,
        min(coalesce(m.internal_code,m.internal_object_id::text)),
        'EXPLICIT_EXTERNAL_OBJECT_MAPPING',true,
        jsonb_build_object('externalObjectMappingIds',jsonb_agg(m.id order by m.id))
      from public.ecoflow_external_object_mappings m
      where m.external_system='UNLEASHED'
        and m.mapping_status='ACTIVE'
        and m.internal_object_id is not null
        and m.external_resource_type=v_source.resource
        and m.external_id in (
          v_source.external_key,
          coalesce(v_source.external_guid,''),
          coalesce(v_source.external_code,'')
        )
      group by m.internal_object_type,m.internal_object_id
      on conflict(mapping_id,canonical_object_type,canonical_object_id,match_method)
      do update set
        candidate_rank=excluded.candidate_rank,
        canonical_code=excluded.canonical_code,
        is_current=true,
        evidence=excluded.evidence,
        updated_at=now();
    end if;

    v_planned := v_planned + 1;
    case v_final_status
      when 'MATCHED' then v_matched := v_matched + 1;
      when 'AMBIGUOUS' then v_ambiguous := v_ambiguous + 1;
      when 'UNMATCHED' then v_unmatched := v_unmatched + 1;
      when 'RETIRED' then v_retired := v_retired + 1;
    end case;
  end loop;

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,after_data
  ) values (
    p_requested_by,
    (select p.app_role from public.app_user_profiles p where p.user_id=p_requested_by),
    'UNLEASHED_MASTER_MAPPING_PLANNED','unleashed_master_mapping_plan',p_requested_by::text,
    jsonb_build_object(
      'reason',p_reason,'planned',v_planned,'matched',v_matched,
      'ambiguous',v_ambiguous,'unmatched',v_unmatched,'retired',v_retired
    )
  );

  return jsonb_build_object(
    'planned',v_planned,'matched',v_matched,'ambiguous',v_ambiguous,
    'unmatched',v_unmatched,'retired',v_retired
  );
end;
$$;

create or replace function public.ecoflow_review_unleashed_master_mapping(
  p_mapping_id uuid,
  p_command_id uuid,
  p_expected_revision bigint,
  p_mapping_status text,
  p_candidate_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_candidate public.ecoflow_unleashed_master_candidates%rowtype;
  v_payload_hash text;
  v_existing public.ecoflow_unleashed_mapping_commands%rowtype;
  v_candidate_snapshot jsonb;
  v_result jsonb;
begin
  v_role := public.ecoflow_active_app_role();
  if v_actor is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'UNLEASHED_MAPPING_REVIEW_FORBIDDEN';
  end if;
  if p_mapping_id is null or p_command_id is null or p_expected_revision is null
     or p_mapping_status not in ('MATCHED','AMBIGUOUS','UNMATCHED','RETIRED')
     or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'UNLEASHED_MAPPING_REVIEW_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_mapping_command:'||p_command_id::text,0)
  );

  v_payload_hash := encode(extensions.digest(
    jsonb_build_object(
      'actorUserId',v_actor,'mappingId',p_mapping_id,'expectedRevision',p_expected_revision,
      'mappingStatus',p_mapping_status,'candidateId',p_candidate_id,'reason',btrim(p_reason)
    )::text,'sha256'
  ),'hex');

  select * into v_existing
  from public.ecoflow_unleashed_mapping_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.id=p_mapping_id
  for update;
  if not found then raise exception 'UNLEASHED_MAPPING_NOT_FOUND'; end if;
  if v_mapping.revision<>p_expected_revision then
    raise exception 'MAPPING_REVISION_CONFLICT';
  end if;

  if p_mapping_status='MATCHED' then
    if p_candidate_id is null then raise exception 'MATCHED_REQUIRES_CANONICAL_TARGET'; end if;
    select * into v_candidate
    from public.ecoflow_unleashed_master_candidates c
    where c.id=p_candidate_id and c.mapping_id=p_mapping_id and c.is_current;
    if not found then raise exception 'MATCHED_REQUIRES_CANONICAL_TARGET'; end if;
    v_candidate_snapshot := jsonb_build_object(
      'candidateId',v_candidate.id,
      'canonicalObjectType',v_candidate.canonical_object_type,
      'canonicalObjectId',v_candidate.canonical_object_id,
      'canonicalCode',v_candidate.canonical_code,
      'ordermentumExternalId',v_candidate.ordermentum_external_id,
      'matchMethod',v_candidate.match_method,
      'evidence',v_candidate.evidence
    );
  elsif p_candidate_id is not null then
    raise exception 'NONMATCHED_FORBIDS_CANONICAL_TARGET';
  end if;

  update public.ecoflow_unleashed_master_mappings m set
    mapping_status=p_mapping_status,
    canonical_object_type=case when p_mapping_status='MATCHED' then v_candidate.canonical_object_type else null end,
    canonical_object_id=case when p_mapping_status='MATCHED' then v_candidate.canonical_object_id else null end,
    canonical_code=case when p_mapping_status='MATCHED' then v_candidate.canonical_code else null end,
    ordermentum_external_id=case when p_mapping_status='MATCHED' then v_candidate.ordermentum_external_id else null end,
    match_method=case when p_mapping_status='MATCHED' then v_candidate.match_method else 'OWNER_ADMIN_REVIEW' end,
    decision_source='REVIEW',
    reviewed_by=v_actor,
    reviewed_at=now(),
    review_reason=btrim(p_reason),
    revision=m.revision+1,
    updated_at=now()
  where m.id=p_mapping_id;

  v_result := jsonb_build_object(
    'mappingId',p_mapping_id,'mappingStatus',p_mapping_status,
    'revision',p_expected_revision+1,'replayed',false,
    'selectedCandidate',v_candidate_snapshot
  );
  insert into public.ecoflow_unleashed_mapping_commands(
    command_id,mapping_id,actor_user_id,expected_revision,command_payload_sha256,
    requested_status,requested_candidate_id,selected_candidate_snapshot,reason,result
  ) values (
    p_command_id,p_mapping_id,v_actor,p_expected_revision,v_payload_hash,
    p_mapping_status,p_candidate_id,v_candidate_snapshot,btrim(p_reason),v_result
  );
  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    v_actor,v_role,'UNLEASHED_MASTER_MAPPING_REVIEWED','ecoflow_unleashed_master_mappings',p_mapping_id::text,
    jsonb_build_object(
      'mappingStatus',v_mapping.mapping_status,'revision',v_mapping.revision,
      'canonicalObjectType',v_mapping.canonical_object_type,
      'canonicalObjectId',v_mapping.canonical_object_id,
      'canonicalCode',v_mapping.canonical_code
    ),v_result
  );
  return v_result;
end;
$$;

create or replace function public.ecoflow_set_unleashed_asset_authorization(
  p_command_id uuid,
  p_requested_by uuid,
  p_expected_revision bigint,
  p_authorization_status text,
  p_evidence_reference text,
  p_rights_scope text,
  p_storage_budget_bytes bigint,
  p_max_object_bytes bigint,
  p_expires_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_current public.ecoflow_unleashed_asset_authorizations%rowtype;
  v_existing public.ecoflow_unleashed_asset_authorization_commands%rowtype;
  v_hash text;
  v_revision bigint;
  v_authorization_id uuid;
  v_result jsonb;
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE';
  if v_role not in ('OWNER','ADMIN') then raise exception 'ASSET_AUTHORIZATION_FORBIDDEN'; end if;
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0
     or p_authorization_status not in ('APPROVED','REJECTED','REVOKED')
     or length(btrim(coalesce(p_reason,'')))<3 then
    raise exception 'ASSET_AUTHORIZATION_INVALID';
  end if;
  if p_authorization_status='APPROVED' and (
    length(btrim(coalesce(p_evidence_reference,'')))=0
    or length(btrim(coalesce(p_rights_scope,'')))=0
    or coalesce(p_storage_budget_bytes,0)<=0
    or coalesce(p_max_object_bytes,0) not between 1 and 10485760
    or (p_expires_at is not null and p_expires_at<=now())
  ) then raise exception 'ASSET_AUTHORIZATION_APPROVAL_EVIDENCE_REQUIRED'; end if;

  -- Asset rights are one global aggregate. Serialize revision and idempotency
  -- checks so two Owner/Admin requests cannot both replace the current grant.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_asset_authorization',0)
  );

  v_hash := encode(extensions.digest(jsonb_build_object(
    'requestedBy',p_requested_by,'expectedRevision',p_expected_revision,
    'status',p_authorization_status,
    'evidenceReference',p_evidence_reference,'rightsScope',p_rights_scope,
    'storageBudgetBytes',p_storage_budget_bytes,'maxObjectBytes',p_max_object_bytes,
    'expiresAt',p_expires_at,'reason',btrim(p_reason)
  )::text,'sha256'),'hex');

  select * into v_existing
  from public.ecoflow_unleashed_asset_authorization_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing.command_payload_sha256<>v_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  select * into v_current
  from public.ecoflow_unleashed_asset_authorizations a
  where a.is_current
  for update;
  v_revision := case when found then v_current.revision else 0 end;
  if v_revision<>p_expected_revision then raise exception 'ASSET_AUTHORIZATION_REVISION_CONFLICT'; end if;

  update public.ecoflow_unleashed_asset_authorizations set is_current=false where is_current;
  insert into public.ecoflow_unleashed_asset_authorizations(
    authorization_status,is_current,revision,evidence_reference,rights_scope,
    storage_budget_bytes,max_object_bytes,authorized_by,authorized_at,expires_at,
    reason,command_id
  ) values (
    p_authorization_status,true,v_revision+1,nullif(btrim(p_evidence_reference),''),
    nullif(btrim(p_rights_scope),''),p_storage_budget_bytes,p_max_object_bytes,
    p_requested_by,case when p_authorization_status='APPROVED' then now() else null end,
    p_expires_at,btrim(p_reason),p_command_id
  ) returning id into v_authorization_id;

  v_result := jsonb_build_object(
    'authorizationId',v_authorization_id,'authorizationStatus',p_authorization_status,
    'revision',v_revision+1,'replayed',false
  );
  insert into public.ecoflow_unleashed_asset_authorization_commands(
    command_id,actor_user_id,expected_revision,command_payload_sha256,result
  ) values (p_command_id,p_requested_by,p_expected_revision,v_hash,v_result);
  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    p_requested_by,v_role,'UNLEASHED_ASSET_AUTHORIZATION_CHANGED',
    'ecoflow_unleashed_asset_authorizations',v_authorization_id::text,
    case when v_revision=0 then null else jsonb_build_object(
      'authorizationStatus',v_current.authorization_status,'revision',v_current.revision
    ) end,
    jsonb_build_object(
      'authorizationStatus',p_authorization_status,'revision',v_revision+1,
      'storageBudgetBytes',p_storage_budget_bytes,'maxObjectBytes',p_max_object_bytes,
      'expiresAt',p_expires_at
    )
  );
  return v_result;
end;
$$;

alter table public.ecoflow_unleashed_master_mappings enable row level security;
alter table public.ecoflow_unleashed_master_candidates enable row level security;
alter table public.ecoflow_unleashed_mapping_commands enable row level security;
alter table public.ecoflow_unleashed_asset_authorizations enable row level security;
alter table public.ecoflow_unleashed_asset_authorization_commands enable row level security;
alter table public.ecoflow_unleashed_asset_copy_runs enable row level security;
alter table public.ecoflow_unleashed_product_assets enable row level security;

revoke all on table public.ecoflow_unleashed_master_mappings from public, anon, authenticated;
revoke all on table public.ecoflow_unleashed_master_candidates from public, anon, authenticated;
revoke all on table public.ecoflow_unleashed_mapping_commands from public, anon, authenticated;
revoke all on table public.ecoflow_unleashed_asset_authorizations from public, anon, authenticated;
revoke all on table public.ecoflow_unleashed_asset_authorization_commands from public, anon, authenticated;
revoke all on table public.ecoflow_unleashed_asset_copy_runs from public, anon, authenticated;
revoke all on table public.ecoflow_unleashed_product_assets from public, anon, authenticated;

grant select on table public.ecoflow_unleashed_master_mappings to authenticated;
grant select on table public.ecoflow_unleashed_master_candidates to authenticated;
grant select on table public.ecoflow_unleashed_mapping_commands to authenticated;
grant select on table public.ecoflow_unleashed_asset_authorizations to authenticated;
grant select on table public.ecoflow_unleashed_asset_copy_runs to authenticated;
grant select on table public.ecoflow_unleashed_product_assets to authenticated;

grant select, insert, update, delete on table public.ecoflow_unleashed_master_mappings to service_role;
grant select, insert, update, delete on table public.ecoflow_unleashed_master_candidates to service_role;
grant select, insert, update, delete on table public.ecoflow_unleashed_mapping_commands to service_role;
grant select, insert, update, delete on table public.ecoflow_unleashed_asset_authorizations to service_role;
grant select, insert, update, delete on table public.ecoflow_unleashed_asset_authorization_commands to service_role;
grant select, insert, update, delete on table public.ecoflow_unleashed_asset_copy_runs to service_role;
grant select, insert, update, delete on table public.ecoflow_unleashed_product_assets to service_role;

drop policy if exists ecoflow_unleashed_master_mappings_owner_admin_read on public.ecoflow_unleashed_master_mappings;
create policy ecoflow_unleashed_master_mappings_owner_admin_read
  on public.ecoflow_unleashed_master_mappings for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));
drop policy if exists ecoflow_unleashed_master_candidates_owner_admin_read on public.ecoflow_unleashed_master_candidates;
create policy ecoflow_unleashed_master_candidates_owner_admin_read
  on public.ecoflow_unleashed_master_candidates for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));
drop policy if exists ecoflow_unleashed_mapping_commands_owner_admin_read on public.ecoflow_unleashed_mapping_commands;
create policy ecoflow_unleashed_mapping_commands_owner_admin_read
  on public.ecoflow_unleashed_mapping_commands for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));
drop policy if exists ecoflow_unleashed_asset_authorizations_owner_admin_read on public.ecoflow_unleashed_asset_authorizations;
create policy ecoflow_unleashed_asset_authorizations_owner_admin_read
  on public.ecoflow_unleashed_asset_authorizations for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));
drop policy if exists ecoflow_unleashed_asset_copy_runs_owner_admin_read on public.ecoflow_unleashed_asset_copy_runs;
create policy ecoflow_unleashed_asset_copy_runs_owner_admin_read
  on public.ecoflow_unleashed_asset_copy_runs for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));
drop policy if exists ecoflow_unleashed_product_assets_active_read on public.ecoflow_unleashed_product_assets;
create policy ecoflow_unleashed_product_assets_active_read
  on public.ecoflow_unleashed_product_assets for select to authenticated
  using (public.ecoflow_active_app_role() is not null);

create or replace view public.v_ecoflow_unleashed_master_review_queue
with (security_invoker=on)
as
select
  m.id as mapping_id,m.identity_id,m.entity_type,m.mapping_status,
  m.source_external_guid,m.source_external_code,m.source_external_key,
  m.source_payload_sha256,m.source_observed_at,
  m.canonical_object_type,m.canonical_object_id,m.canonical_code,
  m.ordermentum_external_id,m.match_method,m.candidate_count,
  m.source_duplicate_count,m.candidate_set_sha256,m.decision_source,m.revision,
  m.last_planned_run_id,m.last_planned_at,m.reviewed_by,m.reviewed_at,
  m.review_reason,m.updated_at
from public.ecoflow_unleashed_master_mappings m
where m.mapping_status in ('AMBIGUOUS','UNMATCHED')
   or m.decision_source='REVIEW';

create or replace view public.v_ecoflow_unleashed_asset_readiness
with (security_invoker=on)
as
select
  a.id as authorization_id,a.authorization_status,a.revision,
  a.evidence_reference,a.rights_scope,a.storage_budget_bytes,a.max_object_bytes,
  a.authorized_by,a.authorized_at,a.expires_at,a.reason,
  (a.authorization_status='APPROVED' and (a.expires_at is null or a.expires_at>now())) as copy_allowed,
  (select count(*) from public.ecoflow_unleashed_product_assets p where p.asset_status='PLANNED')::bigint as planned_assets,
  (select count(*) from public.ecoflow_unleashed_product_assets p where p.asset_status='COPIED')::bigint as copied_assets,
  (select coalesce(sum(p.content_length),0) from public.ecoflow_unleashed_product_assets p where p.asset_status='COPIED')::bigint as copied_bytes
from public.ecoflow_unleashed_asset_authorizations a
where a.is_current;

grant select on table public.v_ecoflow_unleashed_master_review_queue to authenticated;
grant select on table public.v_ecoflow_unleashed_asset_readiness to authenticated;
revoke all on table public.v_ecoflow_unleashed_master_review_queue from anon;
revoke all on table public.v_ecoflow_unleashed_asset_readiness from anon;

revoke all on function public.ecoflow_plan_unleashed_master_mappings(uuid,text) from public,anon,authenticated;
grant execute on function public.ecoflow_plan_unleashed_master_mappings(uuid,text) to service_role;
revoke all on function public.ecoflow_set_unleashed_asset_authorization(uuid,uuid,bigint,text,text,text,bigint,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ecoflow_set_unleashed_asset_authorization(uuid,uuid,bigint,text,text,text,bigint,bigint,timestamptz,text) to service_role;
revoke all on function public.ecoflow_review_unleashed_master_mapping(uuid,uuid,bigint,text,uuid,text) from public,anon;
grant execute on function public.ecoflow_review_unleashed_master_mapping(uuid,uuid,bigint,text,uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'unleashed-product-images','unleashed-product-images',false,10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists unleashed_product_images_read on storage.objects;
create policy unleashed_product_images_read
on storage.objects for select to authenticated
using (
  bucket_id='unleashed-product-images'
  and public.ecoflow_active_app_role() is not null
);

-- Independent-review hardening is intentionally integrated into this original
-- undeployed #338 migration. The trusted shadow gate requires one changed
-- migration while the durable retention, review and copy guards remain part of
-- the schema that is verified before first deployment.

-- Raw Unleashed JSON is governed by the already-accepted 14-day retention
-- contract. Durable asset provenance must therefore survive deletion of the
-- staging row instead of retaining raw JSON indefinitely.
alter table public.ecoflow_unleashed_product_assets
  alter column source_snapshot_id drop not null;

alter table public.ecoflow_unleashed_product_assets
  drop constraint if exists ecoflow_unleashed_product_assets_source_snapshot_id_fkey;
alter table public.ecoflow_unleashed_product_assets
  drop constraint if exists ecoflow_unleashed_product_assets_source_snapshot_retention_fkey;
alter table public.ecoflow_unleashed_product_assets
  add constraint ecoflow_unleashed_product_assets_source_snapshot_retention_fkey
  foreign key (source_snapshot_id)
  references public.unleashed_raw_snapshots(id)
  on delete set null;

-- Explicit external identifiers are authority-bearing inputs. Empty text must
-- never be able to match a missing GUID/code through SQL coalesce semantics.
alter table public.ecoflow_external_object_mappings
  drop constraint if exists ecoflow_external_object_mappings_external_id_nonblank;
alter table public.ecoflow_external_object_mappings
  add constraint ecoflow_external_object_mappings_external_id_nonblank
  check (length(btrim(external_id)) > 0) not valid;
alter table public.ecoflow_external_object_mappings
  validate constraint ecoflow_external_object_mappings_external_id_nonblank;

-- A PLAN replay may compute preservation from a pre-lock snapshot while an
-- Owner/Admin review is committing. This trigger is the final authority guard:
-- if source and candidate hashes are unchanged, an already-reviewed decision
-- cannot be demoted back to AUTO by a stale planner update.
create or replace function public.ecoflow_guard_unleashed_review_preservation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.decision_source = 'REVIEW'
     and new.decision_source = 'AUTO'
     and old.source_payload_sha256 = new.source_payload_sha256
     and old.candidate_set_sha256 = new.candidate_set_sha256 then
    new.mapping_status := old.mapping_status;
    new.canonical_object_type := old.canonical_object_type;
    new.canonical_object_id := old.canonical_object_id;
    new.canonical_code := old.canonical_code;
    new.ordermentum_external_id := old.ordermentum_external_id;
    new.match_method := old.match_method;
    new.decision_source := old.decision_source;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_reason := old.review_reason;
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

drop trigger if exists ecoflow_unleashed_review_preservation_guard
  on public.ecoflow_unleashed_master_mappings;
create trigger ecoflow_unleashed_review_preservation_guard
before update on public.ecoflow_unleashed_master_mappings
for each row execute function public.ecoflow_guard_unleashed_review_preservation();

-- A source that is currently obsolete/inactive/retired cannot be promoted to
-- MATCHED by a manual review merely because an old/current candidate row exists.
-- A reviewed MATCHED decision also requires current raw source evidence; if the
-- staging row has already aged out, a fresh bounded source observation is
-- required before authority can be granted.
create or replace function public.ecoflow_guard_unleashed_retired_review_match()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_resource text;
  v_external_key text;
begin
  if new.decision_source <> 'REVIEW' or new.mapping_status <> 'MATCHED' then
    return new;
  end if;

  select i.resource, i.external_key, s.payload
    into v_resource, v_external_key, v_payload
  from public.unleashed_external_identities i
  left join public.unleashed_raw_snapshots s
    on s.resource = i.resource
   and s.external_key = i.external_key
  where i.id = new.identity_id;

  if v_resource is null then
    raise exception 'UNLEASHED_MAPPING_SOURCE_IDENTITY_NOT_FOUND';
  end if;
  if v_payload is null then
    raise exception 'UNLEASHED_MAPPING_SOURCE_SNAPSHOT_REQUIRED';
  end if;
  if public.ecoflow_unleashed_json_boolean(v_payload->'Obsolete')
     or lower(coalesce(v_payload->>'Status','')) in ('obsolete','inactive','retired') then
    raise exception 'RETIRED_SOURCE_CANNOT_BE_MATCHED';
  end if;

  return new;
end;
$$;

drop trigger if exists ecoflow_unleashed_retired_review_match_guard
  on public.ecoflow_unleashed_master_mappings;
create trigger ecoflow_unleashed_retired_review_match_guard
before update on public.ecoflow_unleashed_master_mappings
for each row execute function public.ecoflow_guard_unleashed_retired_review_match();

-- Serialize raw-snapshot deletion against image-copy claims by locking every
-- referencing asset row. If a copy has already reached COPYING, keep the raw
-- source for that bounded lease. If purge wins first, ON DELETE SET NULL makes
-- the later Edge claim fail its source_snapshot_id equality check.
create or replace function public.ecoflow_guard_unleashed_raw_snapshot_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_asset record;
begin
  for v_asset in
    select p.id, p.asset_status
    from public.ecoflow_unleashed_product_assets p
    where p.source_snapshot_id = old.id
    order by p.id
    for update
  loop
    if v_asset.asset_status = 'COPYING' then
      return null;
    end if;
  end loop;
  return old;
end;
$$;

drop trigger if exists ecoflow_unleashed_raw_snapshot_copy_guard
  on public.unleashed_raw_snapshots;
create trigger ecoflow_unleashed_raw_snapshot_copy_guard
before delete on public.unleashed_raw_snapshots
for each row execute function public.ecoflow_guard_unleashed_raw_snapshot_delete();

-- Recheck source provenance at the authoritative COPIED transition. This
-- catches a source payload update during an in-flight network fetch; an orphan
-- physical object may be reconciled later, but no canonical COPIED provenance
-- can be committed from missing/stale raw evidence.
create or replace function public.ecoflow_guard_unleashed_asset_copied_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_status = 'COPIED' and old.asset_status is distinct from 'COPIED' then
    if new.source_snapshot_id is null then
      raise exception 'UNLEASHED_ASSET_SOURCE_SNAPSHOT_REQUIRED';
    end if;
    if not exists (
      select 1
      from public.unleashed_raw_snapshots s
      where s.id = new.source_snapshot_id
        and s.payload_sha256 = new.source_payload_sha256
    ) then
      raise exception 'UNLEASHED_ASSET_SOURCE_SNAPSHOT_CHANGED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ecoflow_unleashed_asset_copied_provenance_guard
  on public.ecoflow_unleashed_product_assets;
create trigger ecoflow_unleashed_asset_copied_provenance_guard
before update on public.ecoflow_unleashed_product_assets
for each row execute function public.ecoflow_guard_unleashed_asset_copied_provenance();

comment on constraint ecoflow_unleashed_product_assets_source_snapshot_retention_fkey
  on public.ecoflow_unleashed_product_assets is
  'Durable asset provenance retains source hashes/identity after governed raw JSON purge; active copy is separately serialized by the raw-snapshot copy guard.';

comment on constraint ecoflow_external_object_mappings_external_id_nonblank
  on public.ecoflow_external_object_mappings is
  'Authority-bearing explicit external IDs must be nonblank so a missing provider GUID/code can never become an empty-string match.';

commit;
