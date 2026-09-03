-- UNLEASHED-MIGRATION-004 / 339A
-- Immutable warehouse-level Unleashed inventory reference evidence.
--
-- This migration is deliberately non-authoritative. It does not create a
-- Physical SKU, assign a warehouse total to a location, create a stocktake,
-- write an inventory movement, or call the Unleashed provider.

begin;

do $deps$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.unleashed_sync_runs') is null then
    v_missing := array_append(v_missing,'public.unleashed_sync_runs');
  end if;
  if to_regclass('public.unleashed_sync_batches') is null then
    v_missing := array_append(v_missing,'public.unleashed_sync_batches');
  end if;
  if to_regclass('public.unleashed_raw_snapshots') is null then
    v_missing := array_append(v_missing,'public.unleashed_raw_snapshots');
  end if;
  if to_regclass('public.ecoflow_unleashed_master_mappings') is null then
    v_missing := array_append(v_missing,'public.ecoflow_unleashed_master_mappings');
  end if;
  if to_regclass('public.ecoflow_commercial_family_links') is null then
    v_missing := array_append(v_missing,'public.ecoflow_commercial_family_links');
  end if;
  if to_regclass('public.ecoflow_sku_families') is null then
    v_missing := array_append(v_missing,'public.ecoflow_sku_families');
  end if;
  if to_regclass('public.ecoflow_physical_skus') is null then
    v_missing := array_append(v_missing,'public.ecoflow_physical_skus');
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
    raise exception 'UNLEASHED_INVENTORY_REFERENCE_DEPENDENCIES_MISSING:%',
      array_to_string(v_missing,',');
  end if;
end;
$deps$;

create table public.ecoflow_unleashed_inventory_reference_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  source_run_id uuid not null
    references public.unleashed_sync_runs(id) on delete restrict,
  as_at timestamptz not null,
  source_set_sha256 text not null unique
    check (source_set_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_count bigint not null check (source_row_count >= 1),
  batch_status text not null default 'STAGED'
    check (batch_status in ('STAGED','SEALED','REJECTED','SUPERSEDED')),
  revision bigint not null default 0 check (revision >= 0),
  stage_command_id uuid not null unique,
  requested_by uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  sealed_by uuid,
  sealed_at timestamptz,
  seal_reason text,
  seal_command_id uuid unique,
  rejected_by uuid,
  rejected_at timestamptz,
  reject_reason text,
  reject_command_id uuid unique,
  superseded_by uuid,
  superseded_at timestamptz,
  supersede_reason text,
  supersede_command_id uuid unique,
  superseded_by_batch_id uuid
    references public.ecoflow_unleashed_inventory_reference_batches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_unleashed_inventory_reference_sealed_evidence check (
    sealed_at is null
    or (sealed_by is not null and seal_command_id is not null and length(btrim(seal_reason)) >= 3)
  ),
  constraint ecoflow_unleashed_inventory_reference_rejected_evidence check (
    rejected_at is null
    or (rejected_by is not null and reject_command_id is not null and length(btrim(reject_reason)) >= 3)
  ),
  constraint ecoflow_unleashed_inventory_reference_superseded_evidence check (
    superseded_at is null
    or (
      superseded_by is not null
      and supersede_command_id is not null
      and superseded_by_batch_id is not null
      and length(btrim(supersede_reason)) >= 3
    )
  )
);

create index ecoflow_unleashed_inventory_reference_batches_status_idx
  on public.ecoflow_unleashed_inventory_reference_batches(batch_status,as_at desc);
create index ecoflow_unleashed_inventory_reference_batches_run_idx
  on public.ecoflow_unleashed_inventory_reference_batches(source_run_id,created_at desc);

create table public.ecoflow_unleashed_inventory_reference_rows (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null
    references public.ecoflow_unleashed_inventory_reference_batches(id) on delete restrict,
  source_snapshot_id uuid not null,
  source_external_key text not null check (length(btrim(source_external_key)) > 0),
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  source_product_guid text not null check (length(btrim(source_product_guid)) > 0),
  source_product_code text not null check (length(btrim(source_product_code)) > 0),
  source_warehouse_id text not null check (length(btrim(source_warehouse_id)) > 0),
  source_warehouse_code text not null check (length(btrim(source_warehouse_code)) > 0),
  qty_on_hand numeric not null,
  allocated_qty numeric not null,
  on_purchase_qty numeric not null,
  available_qty_source numeric not null,
  source_last_modified_at timestamptz,
  source_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(batch_id,source_product_guid,source_warehouse_id)
);

create index ecoflow_unleashed_inventory_reference_rows_batch_idx
  on public.ecoflow_unleashed_inventory_reference_rows(batch_id,source_product_code,source_warehouse_code);
create index ecoflow_unleashed_inventory_reference_rows_product_idx
  on public.ecoflow_unleashed_inventory_reference_rows(source_product_guid,batch_id);
create index ecoflow_unleashed_inventory_reference_rows_warehouse_idx
  on public.ecoflow_unleashed_inventory_reference_rows(source_warehouse_id,batch_id);

create table public.ecoflow_unleashed_inventory_reference_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  command_type text not null check (command_type in ('STAGE','SEAL','REJECT','SUPERSEDE')),
  batch_id uuid not null
    references public.ecoflow_unleashed_inventory_reference_batches(id) on delete restrict,
  actor_user_id uuid not null,
  expected_revision bigint check (expected_revision is null or expected_revision >= 0),
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create index ecoflow_unleashed_inventory_reference_commands_batch_idx
  on public.ecoflow_unleashed_inventory_reference_commands(batch_id,created_at);

create or replace function public.ecoflow_guard_unleashed_inventory_reference_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_INVENTORY_REFERENCE_ROW';
end;
$$;

create trigger ecoflow_unleashed_inventory_reference_row_immutable
before update or delete on public.ecoflow_unleashed_inventory_reference_rows
for each row execute function public.ecoflow_guard_unleashed_inventory_reference_row();

create or replace function public.ecoflow_guard_unleashed_inventory_reference_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_INVENTORY_REFERENCE_COMMAND';
end;
$$;

create trigger ecoflow_unleashed_inventory_reference_command_immutable
before update or delete on public.ecoflow_unleashed_inventory_reference_commands
for each row execute function public.ecoflow_guard_unleashed_inventory_reference_command();

create or replace function public.ecoflow_guard_unleashed_inventory_reference_batch_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_run_id is distinct from old.source_run_id
    or new.as_at is distinct from old.as_at
    or new.source_set_sha256 is distinct from old.source_set_sha256
    or new.source_row_count is distinct from old.source_row_count
    or new.stage_command_id is distinct from old.stage_command_id
    or new.requested_by is distinct from old.requested_by
    or new.reason is distinct from old.reason
    or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_INVENTORY_REFERENCE_BATCH_SOURCE';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger ecoflow_unleashed_inventory_reference_batch_source_immutable
before update on public.ecoflow_unleashed_inventory_reference_batches
for each row execute function public.ecoflow_guard_unleashed_inventory_reference_batch_source();

create or replace function public.ecoflow_compute_unleashed_inventory_reference_set(
  p_batch_id uuid
)
returns table (source_row_count bigint,source_set_sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(r.id)::bigint,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.jsonb_build_object(
          'sourceRunId',b.source_run_id,
          'asAt',pg_catalog.to_char(
            b.as_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'rows',coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'sourceSnapshotId',r.source_snapshot_id,
                'sourceExternalKey',r.source_external_key,
                'sourcePayloadSha256',r.source_payload_sha256,
                'productGuid',r.source_product_guid,
                'productCode',r.source_product_code,
                'warehouseId',r.source_warehouse_id,
                'warehouseCode',r.source_warehouse_code,
                'qtyOnHand',r.qty_on_hand,
                'allocatedQty',r.allocated_qty,
                'onPurchase',r.on_purchase_qty,
                'availableQty',r.available_qty_source,
                'sourceLastModifiedAt',case when r.source_last_modified_at is null then null else
                  pg_catalog.to_char(r.source_last_modified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
                'sourceObservedAt',pg_catalog.to_char(
                  r.source_observed_at at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                )
              ) order by r.source_external_key,r.source_product_guid,r.source_warehouse_id,r.source_snapshot_id
            ) filter (where r.id is not null),
            '[]'::jsonb
          )
        )::text,
        'sha256'
      ),
      'hex'
    )
  from public.ecoflow_unleashed_inventory_reference_batches b
  left join public.ecoflow_unleashed_inventory_reference_rows r on r.batch_id=b.id
  where b.id=p_batch_id
  group by b.id,b.source_run_id,b.as_at;
$$;

create or replace function public.ecoflow_stage_unleashed_inventory_reference(
  p_command_id uuid,
  p_requested_by uuid,
  p_source_run_id uuid,
  p_as_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb;
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role',true),''),
    v_claims->>'role'
  );
  v_payload_hash text;
  v_existing public.ecoflow_unleashed_inventory_reference_commands%rowtype;
  v_rows jsonb;
  v_row_count bigint;
  v_source_set_hash text;
  v_batch_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if session_user <> 'postgres' and v_request_role is distinct from 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_command_id is null or p_requested_by is null or p_source_run_id is null or p_as_at is null
    or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'INVENTORY_REFERENCE_STAGE_CONTEXT_REQUIRED';
  end if;
  if not exists (
    select 1 from public.app_user_profiles p
    where p.user_id=p_requested_by and p.is_active and p.team_status='ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  ) then
    raise exception 'INVENTORY_REFERENCE_REQUESTER_FORBIDDEN';
  end if;

  v_payload_hash := pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'command','STAGE','requestedBy',p_requested_by,'sourceRunId',p_source_run_id,
    'asAt',pg_catalog.to_char(p_as_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'reason',btrim(p_reason)
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_inventory_reference_command:'||p_command_id::text,0)
  );
  select * into v_existing
  from public.ecoflow_unleashed_inventory_reference_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing.command_type<>'STAGE' or v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ecoflow_unleashed_inventory_reference_source:'||p_source_run_id::text||':'||
      pg_catalog.to_char(p_as_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),0
    )
  );

  if not exists (
    select 1 from public.unleashed_sync_runs r
    where r.id=p_source_run_id and r.status='SUCCEEDED'
      and 'stock_on_hand'=any(r.resource_set)
  ) then
    raise exception 'INVENTORY_REFERENCE_SOURCE_RUN_NOT_SUCCESSFUL';
  end if;
  if not exists (
    select 1 from public.unleashed_sync_batches b
    where b.run_id=p_source_run_id and b.resource='stock_on_hand' and b.status='SUCCEEDED'
  ) then
    raise exception 'INVENTORY_REFERENCE_STOCK_SCOPE_NOT_SUCCESSFUL';
  end if;
  if not exists (
    select 1 from public.unleashed_raw_snapshots s
    where s.resource='stock_on_hand' and s.last_seen_run_id=p_source_run_id
  ) then
    raise exception 'INVENTORY_REFERENCE_SOURCE_SET_EMPTY';
  end if;
  if exists (
    select 1 from public.unleashed_raw_snapshots s
    where s.resource='stock_on_hand' and s.last_seen_run_id=p_source_run_id
      and (
        length(btrim(coalesce(s.external_key,'')))=0
        or s.payload_sha256 !~ '^[0-9a-f]{64}$'
        or length(btrim(coalesce(s.payload->>'ProductGuid','')))=0
        or length(btrim(coalesce(s.payload->>'ProductCode','')))=0
        or length(btrim(coalesce(s.payload->>'WarehouseId','')))=0
        or length(btrim(coalesce(s.payload->>'WarehouseCode','')))=0
        or pg_catalog.jsonb_typeof(s.payload->'QtyOnHand') is distinct from 'number'
        or pg_catalog.jsonb_typeof(s.payload->'AllocatedQty') is distinct from 'number'
        or pg_catalog.jsonb_typeof(s.payload->'OnPurchase') is distinct from 'number'
        or pg_catalog.jsonb_typeof(s.payload->'AvailableQty') is distinct from 'number'
      )
  ) then
    raise exception 'INVENTORY_REFERENCE_SOURCE_ROW_INVALID';
  end if;
  if exists (
    select 1 from public.unleashed_raw_snapshots s
    where s.resource='stock_on_hand' and s.last_seen_run_id=p_source_run_id
      and s.last_seen_at>p_as_at
  ) then
    raise exception 'INVENTORY_REFERENCE_OBSERVED_AFTER_BOUNDARY';
  end if;
  if exists (
    select 1
    from public.unleashed_raw_snapshots s
    where s.resource='stock_on_hand' and s.last_seen_run_id=p_source_run_id
    group by lower(btrim(s.payload->>'ProductGuid')),lower(btrim(s.payload->>'WarehouseId'))
    having count(*)>1
  ) then
    raise exception 'INVENTORY_REFERENCE_DUPLICATE_PRODUCT_WAREHOUSE';
  end if;

  select
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'sourceSnapshotId',s.id,
        'sourceExternalKey',s.external_key,
        'sourcePayloadSha256',s.payload_sha256,
        'productGuid',btrim(s.payload->>'ProductGuid'),
        'productCode',btrim(s.payload->>'ProductCode'),
        'warehouseId',btrim(s.payload->>'WarehouseId'),
        'warehouseCode',btrim(s.payload->>'WarehouseCode'),
        'qtyOnHand',(s.payload->>'QtyOnHand')::numeric,
        'allocatedQty',(s.payload->>'AllocatedQty')::numeric,
        'onPurchase',(s.payload->>'OnPurchase')::numeric,
        'availableQty',(s.payload->>'AvailableQty')::numeric,
        'sourceLastModifiedAt',case when s.source_last_modified_at is null then null else
          pg_catalog.to_char(s.source_last_modified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'sourceObservedAt',pg_catalog.to_char(
          s.last_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      ) order by s.external_key,btrim(s.payload->>'ProductGuid'),btrim(s.payload->>'WarehouseId'),s.id
    ),
    count(*)::bigint
  into v_rows,v_row_count
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand' and s.last_seen_run_id=p_source_run_id;

  v_source_set_hash := pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'sourceRunId',p_source_run_id,
    'asAt',pg_catalog.to_char(p_as_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'rows',v_rows
  )::text,'sha256'),'hex');

  if exists (
    select 1 from public.ecoflow_unleashed_inventory_reference_batches b
    where b.source_set_sha256=v_source_set_hash
  ) then
    raise exception 'INVENTORY_REFERENCE_SOURCE_SET_ALREADY_STAGED';
  end if;

  insert into public.ecoflow_unleashed_inventory_reference_batches(
    id,source_run_id,as_at,source_set_sha256,source_row_count,batch_status,
    revision,stage_command_id,requested_by,reason
  ) values (
    v_batch_id,p_source_run_id,p_as_at,v_source_set_hash,v_row_count,'STAGED',
    0,p_command_id,p_requested_by,btrim(p_reason)
  );

  insert into public.ecoflow_unleashed_inventory_reference_rows(
    batch_id,source_snapshot_id,source_external_key,source_payload_sha256,source_row_sha256,
    source_product_guid,source_product_code,source_warehouse_id,source_warehouse_code,
    qty_on_hand,allocated_qty,on_purchase_qty,available_qty_source,
    source_last_modified_at,source_observed_at
  )
  select
    v_batch_id,
    (j.row->>'sourceSnapshotId')::uuid,
    j.row->>'sourceExternalKey',
    j.row->>'sourcePayloadSha256',
    pg_catalog.encode(extensions.digest(j.row::text,'sha256'),'hex'),
    j.row->>'productGuid',j.row->>'productCode',j.row->>'warehouseId',j.row->>'warehouseCode',
    (j.row->>'qtyOnHand')::numeric,(j.row->>'allocatedQty')::numeric,
    (j.row->>'onPurchase')::numeric,(j.row->>'availableQty')::numeric,
    nullif(j.row->>'sourceLastModifiedAt','')::timestamptz,
    (j.row->>'sourceObservedAt')::timestamptz
  from pg_catalog.jsonb_array_elements(v_rows) as j(row);

  v_result := pg_catalog.jsonb_build_object(
    'batchId',v_batch_id,'batchStatus','STAGED','revision',0,
    'sourceRunId',p_source_run_id,'asAt',p_as_at,
    'sourceSetSha256',v_source_set_hash,'sourceRowCount',v_row_count,
    'authorityEffect','NONE'
  );

  insert into public.ecoflow_unleashed_inventory_reference_commands(
    command_id,command_type,batch_id,actor_user_id,expected_revision,
    command_payload_sha256,result
  ) values (p_command_id,'STAGE',v_batch_id,p_requested_by,null,v_payload_hash,v_result);

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,after_data
  ) values (
    p_requested_by,
    (select p.app_role from public.app_user_profiles p where p.user_id=p_requested_by),
    'UNLEASHED_INVENTORY_REFERENCE_STAGED','ecoflow_unleashed_inventory_reference_batches',
    v_batch_id::text,v_result
  );

  return v_result;
end;
$$;

create or replace function public.ecoflow_transition_unleashed_inventory_reference_batch(
  p_command_type text,
  p_batch_id uuid,
  p_expected_revision bigint,
  p_command_id uuid,
  p_reason text,
  p_superseding_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.ecoflow_active_app_role();
  v_type text := upper(btrim(coalesce(p_command_type,'')));
  v_payload_hash text;
  v_existing public.ecoflow_unleashed_inventory_reference_commands%rowtype;
  v_batch public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_superseding public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_recomputed record;
  v_result jsonb;
  v_next_status text;
  v_before_status text;
begin
  if v_actor is null then
    raise exception 'INVENTORY_REFERENCE_AUTH_REQUIRED';
  end if;
  if v_role is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if v_type not in ('SEAL','REJECT','SUPERSEDE') or p_batch_id is null
    or p_expected_revision is null or p_expected_revision<0 or p_command_id is null
    or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'INVENTORY_REFERENCE_TRANSITION_CONTEXT_REQUIRED';
  end if;
  if v_type='SUPERSEDE' and p_superseding_batch_id is null then
    raise exception 'SUPERSEDING_REFERENCE_BATCH_REQUIRED';
  end if;
  if v_type<>'SUPERSEDE' and p_superseding_batch_id is not null then
    raise exception 'SUPERSEDING_REFERENCE_BATCH_FORBIDDEN';
  end if;

  v_payload_hash := pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'command',v_type,'actorUserId',v_actor,'batchId',p_batch_id,
    'expectedRevision',p_expected_revision,'reason',btrim(p_reason),
    'supersedingBatchId',p_superseding_batch_id
  )::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_inventory_reference_command:'||p_command_id::text,0)
  );
  select * into v_existing
  from public.ecoflow_unleashed_inventory_reference_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing.command_type<>v_type or v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_inventory_reference_batch:'||p_batch_id::text,0)
  );
  select * into v_batch
  from public.ecoflow_unleashed_inventory_reference_batches b
  where b.id=p_batch_id
  for update;
  if not found then
    raise exception 'INVENTORY_REFERENCE_BATCH_NOT_FOUND';
  end if;
  if v_batch.revision<>p_expected_revision then
    raise exception 'INVENTORY_REFERENCE_REVISION_CONFLICT';
  end if;
  v_before_status := v_batch.batch_status;

  if v_type='SEAL' then
    if v_batch.batch_status<>'STAGED' then
      raise exception 'INVENTORY_REFERENCE_INVALID_SEAL_TRANSITION';
    end if;
    select * into v_recomputed
    from public.ecoflow_compute_unleashed_inventory_reference_set(p_batch_id);
    if v_recomputed.source_row_count is distinct from v_batch.source_row_count
      or v_recomputed.source_set_sha256 is distinct from v_batch.source_set_sha256 then
      raise exception 'INVENTORY_REFERENCE_PROVENANCE_MISMATCH';
    end if;
    v_next_status := 'SEALED';
  elsif v_type='REJECT' then
    if v_batch.batch_status not in ('STAGED','SEALED') then
      raise exception 'INVENTORY_REFERENCE_INVALID_REJECT_TRANSITION';
    end if;
    v_next_status := 'REJECTED';
  else
    if v_batch.batch_status<>'SEALED' or p_superseding_batch_id=p_batch_id then
      raise exception 'INVENTORY_REFERENCE_INVALID_SUPERSEDE_TRANSITION';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'ecoflow_unleashed_inventory_reference_batch:'||p_superseding_batch_id::text,0
      )
    );
    select * into v_superseding
    from public.ecoflow_unleashed_inventory_reference_batches b
    where b.id=p_superseding_batch_id
    for share;
    if not found or v_superseding.batch_status<>'SEALED'
      or v_superseding.as_at<v_batch.as_at then
      raise exception 'SUPERSEDING_REFERENCE_BATCH_NOT_ACCEPTED';
    end if;
    v_next_status := 'SUPERSEDED';
  end if;

  update public.ecoflow_unleashed_inventory_reference_batches b set
    batch_status=v_next_status,
    revision=b.revision+1,
    sealed_by=case when v_type='SEAL' then v_actor else b.sealed_by end,
    sealed_at=case when v_type='SEAL' then now() else b.sealed_at end,
    seal_reason=case when v_type='SEAL' then btrim(p_reason) else b.seal_reason end,
    seal_command_id=case when v_type='SEAL' then p_command_id else b.seal_command_id end,
    rejected_by=case when v_type='REJECT' then v_actor else b.rejected_by end,
    rejected_at=case when v_type='REJECT' then now() else b.rejected_at end,
    reject_reason=case when v_type='REJECT' then btrim(p_reason) else b.reject_reason end,
    reject_command_id=case when v_type='REJECT' then p_command_id else b.reject_command_id end,
    superseded_by=case when v_type='SUPERSEDE' then v_actor else b.superseded_by end,
    superseded_at=case when v_type='SUPERSEDE' then now() else b.superseded_at end,
    supersede_reason=case when v_type='SUPERSEDE' then btrim(p_reason) else b.supersede_reason end,
    supersede_command_id=case when v_type='SUPERSEDE' then p_command_id else b.supersede_command_id end,
    superseded_by_batch_id=case when v_type='SUPERSEDE' then p_superseding_batch_id else b.superseded_by_batch_id end
  where b.id=p_batch_id
  returning * into v_batch;

  v_result := pg_catalog.jsonb_build_object(
    'batchId',v_batch.id,'batchStatus',v_batch.batch_status,'revision',v_batch.revision,
    'sourceSetSha256',v_batch.source_set_sha256,'sourceRowCount',v_batch.source_row_count,
    'supersedingBatchId',v_batch.superseded_by_batch_id,'authorityEffect','NONE'
  );

  insert into public.ecoflow_unleashed_inventory_reference_commands(
    command_id,command_type,batch_id,actor_user_id,expected_revision,
    command_payload_sha256,result
  ) values (
    p_command_id,v_type,p_batch_id,v_actor,p_expected_revision,v_payload_hash,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    v_actor,v_role,'UNLEASHED_INVENTORY_REFERENCE_'||v_type,
    'ecoflow_unleashed_inventory_reference_batches',p_batch_id::text,
    pg_catalog.jsonb_build_object(
      'batchStatus',v_before_status,
      'revision',p_expected_revision
    ),
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.ecoflow_seal_unleashed_inventory_reference_batch(
  p_batch_id uuid,p_expected_revision bigint,p_command_id uuid,p_reason text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.ecoflow_transition_unleashed_inventory_reference_batch(
    'SEAL',p_batch_id,p_expected_revision,p_command_id,p_reason,null
  );
$$;

create or replace function public.ecoflow_reject_unleashed_inventory_reference_batch(
  p_batch_id uuid,p_expected_revision bigint,p_command_id uuid,p_reason text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.ecoflow_transition_unleashed_inventory_reference_batch(
    'REJECT',p_batch_id,p_expected_revision,p_command_id,p_reason,null
  );
$$;

create or replace function public.ecoflow_supersede_unleashed_inventory_reference_batch(
  p_batch_id uuid,p_superseding_batch_id uuid,p_expected_revision bigint,
  p_command_id uuid,p_reason text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.ecoflow_transition_unleashed_inventory_reference_batch(
    'SUPERSEDE',p_batch_id,p_expected_revision,p_command_id,p_reason,p_superseding_batch_id
  );
$$;

alter table public.ecoflow_unleashed_inventory_reference_batches enable row level security;
alter table public.ecoflow_unleashed_inventory_reference_rows enable row level security;
alter table public.ecoflow_unleashed_inventory_reference_commands enable row level security;

revoke all on table public.ecoflow_unleashed_inventory_reference_batches from public,anon,authenticated;
revoke all on table public.ecoflow_unleashed_inventory_reference_rows from public,anon,authenticated;
revoke all on table public.ecoflow_unleashed_inventory_reference_commands from public,anon,authenticated;
grant select on table public.ecoflow_unleashed_inventory_reference_batches to authenticated,service_role;
grant select on table public.ecoflow_unleashed_inventory_reference_rows to authenticated,service_role;
grant select on table public.ecoflow_unleashed_inventory_reference_commands to authenticated,service_role;

create policy ecoflow_unleashed_inventory_reference_batches_read
  on public.ecoflow_unleashed_inventory_reference_batches for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN','WAREHOUSE'));
create policy ecoflow_unleashed_inventory_reference_rows_read
  on public.ecoflow_unleashed_inventory_reference_rows for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN','WAREHOUSE'));
create policy ecoflow_unleashed_inventory_reference_commands_read
  on public.ecoflow_unleashed_inventory_reference_commands for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN','WAREHOUSE'));

create or replace view public.v_ecoflow_unleashed_inventory_reference_rows
with (security_invoker=on)
as
select
  r.id as reference_row_id,
  r.batch_id,
  b.batch_status,
  b.revision as batch_revision,
  b.source_run_id,
  b.as_at,
  b.source_set_sha256,
  b.source_row_count,
  r.source_snapshot_id,
  r.source_external_key,
  r.source_payload_sha256,
  r.source_row_sha256,
  r.source_product_guid,
  r.source_product_code,
  r.source_warehouse_id,
  r.source_warehouse_code,
  r.qty_on_hand,
  r.allocated_qty,
  r.on_purchase_qty,
  r.available_qty_source,
  r.available_qty_source-(r.qty_on_hand-r.allocated_qty) as source_available_formula_delta,
  r.source_last_modified_at,
  r.source_observed_at,
  product_map.mapping_record_count as product_mapping_count,
  case
    when product_map.mapping_record_count=0 then 'UNMAPPED'
    when product_map.ambiguous or product_map.matched_target_count>1 then 'AMBIGUOUS'
    when product_map.matched_target_count=1 then 'MATCHED'
    else 'UNMATCHED'
  end as product_mapping_status,
  case when product_map.matched_target_count=1 and not product_map.ambiguous
    then product_map.canonical_object_id else null end as commercial_sku_id,
  case when product_map.matched_target_count=1 and not product_map.ambiguous
    then product_map.canonical_code else null end as commercial_sku_code,
  warehouse_map.mapping_record_count as warehouse_mapping_count,
  case
    when warehouse_map.mapping_record_count=0 then 'UNMAPPED'
    when warehouse_map.ambiguous or warehouse_map.matched_target_count>1 then 'AMBIGUOUS'
    when warehouse_map.matched_target_count=1 then 'MATCHED'
    else 'UNMATCHED'
  end as warehouse_mapping_status,
  case when warehouse_map.matched_target_count=1 and not warehouse_map.ambiguous
    then warehouse_map.canonical_object_id else null end as warehouse_id,
  case when warehouse_map.matched_target_count=1 and not warehouse_map.ambiguous
    then warehouse_map.canonical_code else null end as warehouse_code,
  identity_context.active_link_count as physical_identity_link_count,
  case when identity_context.active_link_count=1 then identity_context.family_id else null end as family_id,
  case when identity_context.active_link_count=1 then identity_context.family_code else null end as family_code,
  case when identity_context.active_link_count=1 then identity_context.family_name else null end as family_name,
  case when identity_context.active_link_count=1 then identity_context.substitution_policy else null end as substitution_policy,
  case when identity_context.active_link_count=1 then identity_context.preferred_physical_sku_id else null end
    as preferred_physical_sku_context_id,
  'UNLEASHED_WAREHOUSE_TOTAL'::text as reference_quantity_scope,
  null::uuid as quantity_assigned_physical_sku_id,
  null::uuid as quantity_assigned_location_id,
  case
    when product_map.ambiguous or product_map.matched_target_count>1
      then 'AMBIGUOUS_PRODUCT_MAPPING'
    when product_map.mapping_record_count=0 or product_map.matched_target_count=0
      then 'PENDING_PRODUCT_MAPPING'
    when warehouse_map.ambiguous or warehouse_map.matched_target_count>1
      then 'AMBIGUOUS_WAREHOUSE_MAPPING'
    when warehouse_map.mapping_record_count=0 or warehouse_map.matched_target_count=0
      then 'PENDING_WAREHOUSE_MAPPING'
    when identity_context.active_link_count<>1
      then 'PENDING_PHYSICAL_IDENTITY'
    else 'READY_FOR_LOCATION_EVIDENCE'
  end::text as readiness_status
from public.ecoflow_unleashed_inventory_reference_rows r
join public.ecoflow_unleashed_inventory_reference_batches b on b.id=r.batch_id
left join lateral (
  select
    count(*)::bigint as mapping_record_count,
    count(*) filter (
      where m.mapping_status='MATCHED' and m.canonical_object_type='COMMERCIAL_SKU'
        and m.canonical_object_id is not null
    )::bigint as matched_target_count,
    coalesce(bool_or(m.mapping_status='AMBIGUOUS' or m.source_duplicate_count>1 or m.candidate_count>1),false)
      as ambiguous,
    (array_agg(m.canonical_object_id order by m.id) filter (
      where m.mapping_status='MATCHED' and m.canonical_object_type='COMMERCIAL_SKU'
        and m.canonical_object_id is not null
    ))[1] as canonical_object_id,
    (array_agg(m.canonical_code order by m.id) filter (
      where m.mapping_status='MATCHED' and m.canonical_object_type='COMMERCIAL_SKU'
        and m.canonical_object_id is not null
    ))[1] as canonical_code
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='PRODUCT'
    and lower(btrim(m.source_external_guid))=lower(btrim(r.source_product_guid))
) product_map on true
left join lateral (
  select
    count(*)::bigint as mapping_record_count,
    count(*) filter (
      where m.mapping_status='MATCHED' and m.canonical_object_type='WAREHOUSE'
        and m.canonical_object_id is not null
    )::bigint as matched_target_count,
    coalesce(bool_or(m.mapping_status='AMBIGUOUS' or m.source_duplicate_count>1 or m.candidate_count>1),false)
      as ambiguous,
    (array_agg(m.canonical_object_id order by m.id) filter (
      where m.mapping_status='MATCHED' and m.canonical_object_type='WAREHOUSE'
        and m.canonical_object_id is not null
    ))[1] as canonical_object_id,
    (array_agg(m.canonical_code order by m.id) filter (
      where m.mapping_status='MATCHED' and m.canonical_object_type='WAREHOUSE'
        and m.canonical_object_id is not null
    ))[1] as canonical_code
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE'
    and lower(btrim(m.source_external_guid))=lower(btrim(r.source_warehouse_id))
) warehouse_map on true
left join lateral (
  select
    count(*)::bigint as active_link_count,
    (array_agg(l.family_id order by l.id))[1] as family_id,
    (array_agg(f.family_code order by l.id))[1] as family_code,
    (array_agg(f.family_name order by l.id))[1] as family_name,
    (array_agg(l.substitution_policy order by l.id))[1] as substitution_policy,
    (array_agg(l.preferred_physical_sku_id order by l.id))[1] as preferred_physical_sku_id
  from public.ecoflow_commercial_family_links l
  join public.ecoflow_sku_families f on f.id=l.family_id and f.identity_status='ACTIVE'
  join public.ecoflow_physical_skus p
    on p.id=l.preferred_physical_sku_id and p.family_id=l.family_id and p.identity_status='ACTIVE'
  where l.identity_status='ACTIVE'
    and l.commercial_sku_id=case when product_map.matched_target_count=1 and not product_map.ambiguous
      then product_map.canonical_object_id else null end
) identity_context on true;

create or replace view public.v_ecoflow_unleashed_inventory_reference_batch_summary
with (security_invoker=on)
as
select
  b.id as batch_id,
  b.batch_status,
  b.revision,
  b.source_run_id,
  b.as_at,
  b.source_set_sha256,
  b.source_row_count as declared_source_row_count,
  count(v.reference_row_id)::bigint as durable_reference_row_count,
  coalesce(sum(v.qty_on_hand),0) as qty_on_hand_total,
  coalesce(sum(v.allocated_qty),0) as allocated_qty_total,
  coalesce(sum(v.on_purchase_qty),0) as on_purchase_qty_total,
  coalesce(sum(v.available_qty_source),0) as available_qty_source_total,
  count(*) filter (where v.readiness_status='PENDING_PRODUCT_MAPPING')::bigint
    as pending_product_mapping_count,
  count(*) filter (where v.readiness_status='AMBIGUOUS_PRODUCT_MAPPING')::bigint
    as ambiguous_product_mapping_count,
  count(*) filter (where v.readiness_status='PENDING_WAREHOUSE_MAPPING')::bigint
    as pending_warehouse_mapping_count,
  count(*) filter (where v.readiness_status='AMBIGUOUS_WAREHOUSE_MAPPING')::bigint
    as ambiguous_warehouse_mapping_count,
  count(*) filter (where v.readiness_status='PENDING_PHYSICAL_IDENTITY')::bigint
    as pending_physical_identity_count,
  count(*) filter (where v.readiness_status='READY_FOR_LOCATION_EVIDENCE')::bigint
    as ready_for_location_evidence_count,
  count(*) filter (where v.source_available_formula_delta<>0)::bigint
    as semantic_formula_mismatch_count,
  min(v.source_observed_at) as earliest_source_observed_at,
  max(v.source_observed_at) as latest_source_observed_at,
  b.requested_by,b.reason,b.created_at,b.updated_at
from public.ecoflow_unleashed_inventory_reference_batches b
left join public.v_ecoflow_unleashed_inventory_reference_rows v on v.batch_id=b.id
group by b.id;

revoke all on table public.v_ecoflow_unleashed_inventory_reference_rows from public,anon;
revoke all on table public.v_ecoflow_unleashed_inventory_reference_batch_summary from public,anon;
grant select on table public.v_ecoflow_unleashed_inventory_reference_rows to authenticated,service_role;
grant select on table public.v_ecoflow_unleashed_inventory_reference_batch_summary to authenticated,service_role;

revoke all on function public.ecoflow_guard_unleashed_inventory_reference_row()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_guard_unleashed_inventory_reference_command()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_guard_unleashed_inventory_reference_batch_source()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_compute_unleashed_inventory_reference_set(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_transition_unleashed_inventory_reference_batch(text,uuid,bigint,uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_stage_unleashed_inventory_reference(uuid,uuid,uuid,timestamptz,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_seal_unleashed_inventory_reference_batch(uuid,bigint,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_reject_unleashed_inventory_reference_batch(uuid,bigint,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_supersede_unleashed_inventory_reference_batch(uuid,uuid,bigint,uuid,text)
  from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_stage_unleashed_inventory_reference(uuid,uuid,uuid,timestamptz,text)
  to service_role;
grant execute on function public.ecoflow_seal_unleashed_inventory_reference_batch(uuid,bigint,uuid,text)
  to authenticated;
grant execute on function public.ecoflow_reject_unleashed_inventory_reference_batch(uuid,bigint,uuid,text)
  to authenticated;
grant execute on function public.ecoflow_supersede_unleashed_inventory_reference_batch(uuid,uuid,bigint,uuid,text)
  to authenticated;

comment on table public.ecoflow_unleashed_inventory_reference_batches is
  'Immutable 339A Unleashed stock boundary evidence. STAGED/SEALED remain non-authoritative and create no inventory effect.';
comment on table public.ecoflow_unleashed_inventory_reference_rows is
  'Append-only warehouse-level source quantity evidence. source_snapshot_id is a durable provenance value, deliberately not an FK to purgeable raw snapshots.';
comment on table public.ecoflow_unleashed_inventory_reference_commands is
  'Append-only payload-bound command evidence for inventory reference staging and lifecycle transitions.';
comment on view public.v_ecoflow_unleashed_inventory_reference_rows is
  'Non-authoritative source quantities plus governed Commercial/Warehouse mapping and Product Identity readiness. Warehouse totals are never assigned to a Physical SKU or location.';
comment on view public.v_ecoflow_unleashed_inventory_reference_batch_summary is
  'Non-authoritative batch totals, mapping readiness and source AvailableQty formula comparison evidence.';
comment on function public.ecoflow_stage_unleashed_inventory_reference(uuid,uuid,uuid,timestamptz,text) is
  'Service-role-only atomic copy from one successful bounded stock_on_hand run into immutable 339A evidence. Never writes inventory authority.';
comment on function public.ecoflow_seal_unleashed_inventory_reference_batch(uuid,bigint,uuid,text) is
  'Owner/Admin acceptance of immutable reference evidence only. SEALED is not opening inventory authority.';

notify pgrst,'reload schema';
commit;
