-- ECOFLOW-R5-004A — BPB8 INITIAL opening-balance commissioning bridge
-- One bounded migration only. Creates provenance/location-evidence controls and a
-- materialization bridge into the incumbent stocktake engine. It NEVER approves the
-- stocktake and therefore does not create inventory authority by itself.

create table public.ecoflow_unleashed_inventory_commissioning_sets (
  id uuid primary key default gen_random_uuid(),
  reference_batch_id uuid not null references public.ecoflow_unleashed_inventory_reference_batches(id),
  reference_row_id uuid not null references public.ecoflow_unleashed_inventory_reference_rows(id),
  source_run_id uuid not null references public.unleashed_sync_runs(id),
  source_set_sha256 text not null check (source_set_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  source_qty_on_hand numeric not null check (source_qty_on_hand >= 0),
  commercial_sku_id uuid not null references public.skus(id),
  physical_sku_id uuid not null references public.ecoflow_physical_skus(id),
  package_id uuid not null references public.ecoflow_physical_sku_packages(id),
  package_level text not null,
  operational_barcode text not null,
  units_per_package numeric not null check (units_per_package > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT','FINALIZED','MATERIALIZED','SUPERSEDED')),
  revision bigint not null default 0 check (revision >= 0),
  counted_qty_total numeric,
  reference_allocated_qty_total numeric,
  accepted_count_variance boolean,
  variance_reason text,
  stocktake_session_id uuid references public.ecoflow_stocktake_sessions(id),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  finalized_by uuid,
  finalized_at timestamptz,
  materialized_by uuid,
  materialized_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique(reference_row_id)
);

create table public.ecoflow_unleashed_inventory_commissioning_locations (
  id uuid primary key default gen_random_uuid(),
  commissioning_id uuid not null references public.ecoflow_unleashed_inventory_commissioning_sets(id) on delete restrict,
  location_id uuid not null references public.ecoflow_warehouse_locations(id),
  location_code text not null,
  reference_allocated_qty numeric not null check (reference_allocated_qty >= 0 and reference_allocated_qty = trunc(reference_allocated_qty)),
  counted_qty numeric not null check (counted_qty >= 0 and counted_qty = trunc(counted_qty)),
  evidence_note text not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(commissioning_id, location_id)
);

create table public.ecoflow_unleashed_inventory_commissioning_commands (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  commissioning_id uuid references public.ecoflow_unleashed_inventory_commissioning_sets(id),
  command_type text not null check (command_type in ('START','RECORD_LOCATION','FINALIZE','MATERIALIZE')),
  actor_user_id uuid not null,
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.ecoflow_unleashed_inventory_commissioning_sets enable row level security;
alter table public.ecoflow_unleashed_inventory_commissioning_locations enable row level security;
alter table public.ecoflow_unleashed_inventory_commissioning_commands enable row level security;

revoke all on public.ecoflow_unleashed_inventory_commissioning_sets from public, anon, authenticated, service_role;
revoke all on public.ecoflow_unleashed_inventory_commissioning_locations from public, anon, authenticated, service_role;
revoke all on public.ecoflow_unleashed_inventory_commissioning_commands from public, anon, authenticated, service_role;

create or replace function public.ecoflow_r5_004a_payload_sha256(p_payload jsonb)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, public
as $$
  select encode(digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex')
$$;

revoke all on function public.ecoflow_r5_004a_payload_sha256(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.ecoflow_read_bpb8_inventory_commissioning_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(false);
  v_batch public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_result jsonb;
begin
  select * into v_batch
  from public.ecoflow_unleashed_inventory_reference_batches
  where id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9';

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where reference_row_id='7156d372-b12f-419e-b05e-2f12571ca525';

  select jsonb_build_object(
    'actorRole',v_role,
    'referenceBatchId',v_batch.id,
    'referenceBatchStatus',v_batch.batch_status,
    'referenceBatchRevision',v_batch.revision,
    'sourceRunId','5cd0e73b-956d-4c80-9e70-6d841d27b163',
    'sourceProductCode','BPB8',
    'sourceQtyOnHand',3,
    'commercialSkuId','ec67ca0a-67b5-437f-96a8-81e6268faa44',
    'familyId','1ff1f446-6e97-4ce6-bf6c-ef063265783a',
    'physicalSkuId','7dcaa2ed-a7db-4722-b91a-e8f17ffe2281',
    'packageId','521dfafc-fd01-4897-a3ac-4e272d8f6ba5',
    'packageLevel','CARTON',
    'unitsPerPackage',1,
    'barcode','19348045005009',
    'commissioningId',v_set.id,
    'commissioningStatus',v_set.status,
    'commissioningRevision',v_set.revision,
    'stocktakeSessionId',v_set.stocktake_session_id,
    'locations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'locationId',l.location_id,
        'locationCode',l.location_code,
        'referenceAllocatedQty',l.reference_allocated_qty,
        'countedQty',l.counted_qty,
        'evidenceNote',l.evidence_note,
        'recordedAt',l.recorded_at
      ) order by l.recorded_at,l.location_code)
      from public.ecoflow_unleashed_inventory_commissioning_locations l
      where l.commissioning_id=v_set.id
    ),'[]'::jsonb),
    'referenceAllocatedQtyTotal',coalesce(v_set.reference_allocated_qty_total,(
      select coalesce(sum(l.reference_allocated_qty),0)
      from public.ecoflow_unleashed_inventory_commissioning_locations l
      where l.commissioning_id=v_set.id
    )),
    'countedQtyTotal',coalesce(v_set.counted_qty_total,(
      select coalesce(sum(l.counted_qty),0)
      from public.ecoflow_unleashed_inventory_commissioning_locations l
      where l.commissioning_id=v_set.id
    )),
    'acceptedCountVariance',v_set.accepted_count_variance,
    'varianceReason',v_set.variance_reason,
    'inventoryAuthorityCreated',false
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.ecoflow_read_bpb8_inventory_commissioning_gate()
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_read_bpb8_inventory_commissioning_gate()
  to authenticated;

create or replace function public.ecoflow_start_bpb8_inventory_commissioning(p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(true);
  v_existing public.ecoflow_unleashed_inventory_commissioning_commands%rowtype;
  v_batch public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_ref record;
  v_phys public.ecoflow_physical_skus%rowtype;
  v_pkg public.ecoflow_physical_sku_packages%rowtype;
  v_link_count integer;
  v_barcode_count integer;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_command_id is null then raise exception 'R5_004A_COMMAND_ID_REQUIRED'; end if;

  v_payload:=jsonb_build_object(
    'referenceBatchId','4cdb85d3-06d8-44bf-96bb-93660e10c3c9',
    'referenceRowId','7156d372-b12f-419e-b05e-2f12571ca525',
    'sku','BPB8'
  );
  v_payload_hash:=public.ecoflow_r5_004a_payload_sha256(v_payload);

  select * into v_existing
  from public.ecoflow_unleashed_inventory_commissioning_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'START'
       or v_existing.actor_user_id<>auth.uid()
       or v_existing.command_payload_sha256<>v_payload_hash
    then raise exception 'R5_004A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r5-004a-bpb8-start',0));

  select * into v_batch
  from public.ecoflow_unleashed_inventory_reference_batches
  where id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9'
  for update;
  if not found
     or v_batch.batch_status <> 'SEALED'
     or v_batch.revision <> 1
     or v_batch.source_run_id <> '5cd0e73b-956d-4c80-9e70-6d841d27b163'
     or v_batch.source_row_count <> 427
     or v_batch.source_set_sha256 <> '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d'
  then raise exception 'R5_004A_REFERENCE_BATCH_NOT_EXACT_SEALED'; end if;

  select * into v_ref
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where reference_row_id='7156d372-b12f-419e-b05e-2f12571ca525';
  if not found
     or v_ref.batch_id <> v_batch.id
     or v_ref.source_run_id <> v_batch.source_run_id
     or v_ref.source_product_code <> 'BPB8'
     or v_ref.source_warehouse_code <> 'ADL1'
     or v_ref.source_row_sha256 <> '1b87e277073f13572797c4716dc56880b72904287b15c54d582930512928f5e7'
     or v_ref.source_payload_sha256 <> '63cd1d70cf5ad1f74c7a2f75af368cec378ad53fdc722ee73df96d758cae44fd'
     or v_ref.qty_on_hand <> 3
     or v_ref.allocated_qty <> 0
     or v_ref.on_purchase_qty <> 0
     or v_ref.available_qty_source <> 3
     or v_ref.source_available_formula_delta <> 0
     or v_ref.product_mapping_status <> 'MATCHED'
     or v_ref.warehouse_mapping_status <> 'MATCHED'
     or v_ref.commercial_sku_id <> 'ec67ca0a-67b5-437f-96a8-81e6268faa44'
     or v_ref.family_id <> '1ff1f446-6e97-4ce6-bf6c-ef063265783a'
     or v_ref.preferred_physical_sku_context_id <> '7dcaa2ed-a7db-4722-b91a-e8f17ffe2281'
     or v_ref.readiness_status <> 'READY_FOR_LOCATION_EVIDENCE'
  then raise exception 'R5_004A_BPB8_REFERENCE_BINDING_MISMATCH'; end if;

  select * into v_phys
  from public.ecoflow_physical_skus
  where id='7dcaa2ed-a7db-4722-b91a-e8f17ffe2281';
  if not found
     or v_phys.identity_status <> 'ACTIVE'
     or v_phys.family_id <> '1ff1f446-6e97-4ce6-bf6c-ef063265783a'
  then raise exception 'R5_004A_PHYSICAL_IDENTITY_MISMATCH'; end if;

  select count(*)::integer into v_link_count
  from public.ecoflow_commercial_family_links l
  where l.commercial_sku_id='ec67ca0a-67b5-437f-96a8-81e6268faa44'
    and l.family_id='1ff1f446-6e97-4ce6-bf6c-ef063265783a'
    and l.preferred_physical_sku_id=v_phys.id
    and l.identity_status='ACTIVE'
    and l.substitution_policy='PROHIBITED';
  if v_link_count<>1 then raise exception 'R5_004A_COMMERCIAL_FAMILY_LINK_MISMATCH'; end if;

  select * into v_pkg
  from public.ecoflow_physical_sku_packages
  where id='521dfafc-fd01-4897-a3ac-4e272d8f6ba5';
  if not found
     or v_pkg.physical_sku_id<>v_phys.id
     or v_pkg.identity_status<>'ACTIVE'
     or upper(v_pkg.package_level)<>'CARTON'
     or v_pkg.units_in_base_unit<>1
  then raise exception 'R5_004A_PACKAGE_IDENTITY_MISMATCH'; end if;

  select count(*)::integer into v_barcode_count
  from public.ecoflow_physical_barcode_bindings b
  where b.physical_sku_id=v_phys.id
    and b.package_id=v_pkg.id
    and b.barcode='19348045005009'
    and b.identity_status='ACTIVE';
  if v_barcode_count<>1 then raise exception 'R5_004A_OPERATIONAL_BARCODE_MISMATCH'; end if;

  if exists(
    select 1 from public.ecoflow_unleashed_inventory_commissioning_sets
    where reference_row_id='7156d372-b12f-419e-b05e-2f12571ca525'
  ) then raise exception 'R5_004A_COMMISSIONING_ALREADY_EXISTS'; end if;

  insert into public.ecoflow_unleashed_inventory_commissioning_sets(
    reference_batch_id,reference_row_id,source_run_id,source_set_sha256,source_row_sha256,
    source_qty_on_hand,commercial_sku_id,physical_sku_id,package_id,package_level,
    operational_barcode,units_per_package,created_by
  ) values (
    v_batch.id,'7156d372-b12f-419e-b05e-2f12571ca525',v_batch.source_run_id,v_batch.source_set_sha256,
    '1b87e277073f13572797c4716dc56880b72904287b15c54d582930512928f5e7',3,
    'ec67ca0a-67b5-437f-96a8-81e6268faa44','7dcaa2ed-a7db-4722-b91a-e8f17ffe2281',
    '521dfafc-fd01-4897-a3ac-4e272d8f6ba5','CARTON','19348045005009',1,auth.uid()
  ) returning * into v_set;

  v_result:=jsonb_build_object(
    'commissioningId',v_set.id,
    'status',v_set.status,
    'revision',v_set.revision,
    'sourceQtyOnHand',v_set.source_qty_on_hand,
    'inventoryAuthorityCreated',false
  );
  insert into public.ecoflow_unleashed_inventory_commissioning_commands(
    command_id,commissioning_id,command_type,actor_user_id,command_payload_sha256,result
  ) values(
    p_command_id,v_set.id,'START',auth.uid(),v_payload_hash,v_result
  );
  return v_result;
end;
$$;

revoke all on function public.ecoflow_start_bpb8_inventory_commissioning(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_start_bpb8_inventory_commissioning(uuid)
  to authenticated;

create or replace function public.ecoflow_record_bpb8_inventory_commissioning_location(
  p_commissioning_id uuid,
  p_location_code text,
  p_reference_allocated_qty numeric,
  p_counted_qty numeric,
  p_note text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(false);
  v_existing public.ecoflow_unleashed_inventory_commissioning_commands%rowtype;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_command_id is null then raise exception 'R5_004A_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_location_code,'')),'') is null then raise exception 'R5_004A_PHYSICAL_LOCATION_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'R5_004A_LOCATION_EVIDENCE_NOTE_REQUIRED'; end if;
  if p_reference_allocated_qty is null or p_reference_allocated_qty<0 or p_reference_allocated_qty<>trunc(p_reference_allocated_qty)
    then raise exception 'R5_004A_VALID_REFERENCE_ALLOCATION_REQUIRED'; end if;
  if p_counted_qty is null or p_counted_qty<0 or p_counted_qty<>trunc(p_counted_qty)
    then raise exception 'R5_004A_VALID_PHYSICAL_COUNT_REQUIRED'; end if;

  v_payload:=jsonb_build_object(
    'commissioningId',p_commissioning_id,
    'locationCode',upper(btrim(p_location_code)),
    'referenceAllocatedQty',p_reference_allocated_qty,
    'countedQty',p_counted_qty,
    'note',left(btrim(p_note),2000)
  );
  v_payload_hash:=public.ecoflow_r5_004a_payload_sha256(v_payload);

  select * into v_existing
  from public.ecoflow_unleashed_inventory_commissioning_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'RECORD_LOCATION'
       or v_existing.actor_user_id<>auth.uid()
       or v_existing.commissioning_id is distinct from p_commissioning_id
       or v_existing.command_payload_sha256<>v_payload_hash
    then raise exception 'R5_004A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;
  if not found
     or v_set.reference_row_id<>'7156d372-b12f-419e-b05e-2f12571ca525'
     or v_set.status<>'DRAFT'
  then raise exception 'R5_004A_DRAFT_BPB8_COMMISSIONING_REQUIRED'; end if;

  select * into v_location
  from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(btrim(p_location_code))
    and status='ACTIVE'
  limit 1;
  if not found then raise exception 'R5_004A_ACTIVE_PHYSICAL_LOCATION_REQUIRED'; end if;

  if exists(
    select 1 from public.ecoflow_unleashed_inventory_commissioning_locations
    where commissioning_id=v_set.id and location_id=v_location.id
  ) then raise exception 'R5_004A_LOCATION_ALREADY_RECORDED'; end if;

  insert into public.ecoflow_unleashed_inventory_commissioning_locations(
    commissioning_id,location_id,location_code,reference_allocated_qty,counted_qty,evidence_note,recorded_by
  ) values(
    v_set.id,v_location.id,v_location.location_code,p_reference_allocated_qty,p_counted_qty,
    left(btrim(p_note),2000),auth.uid()
  );

  update public.ecoflow_unleashed_inventory_commissioning_sets
  set revision=revision+1,updated_at=clock_timestamp()
  where id=v_set.id
  returning * into v_set;

  v_result:=jsonb_build_object(
    'commissioningId',v_set.id,
    'status',v_set.status,
    'revision',v_set.revision,
    'locationCode',v_location.location_code,
    'referenceAllocatedQty',p_reference_allocated_qty,
    'countedQty',p_counted_qty,
    'inventoryAuthorityCreated',false
  );
  insert into public.ecoflow_unleashed_inventory_commissioning_commands(
    command_id,commissioning_id,command_type,actor_user_id,command_payload_sha256,result
  ) values(
    p_command_id,v_set.id,'RECORD_LOCATION',auth.uid(),v_payload_hash,v_result
  );
  return v_result;
end;
$$;

revoke all on function public.ecoflow_record_bpb8_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_record_bpb8_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid)
  to authenticated;

create or replace function public.ecoflow_finalize_bpb8_inventory_commissioning(
  p_commissioning_id uuid,
  p_accept_count_variance boolean,
  p_variance_reason text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(true);
  v_existing public.ecoflow_unleashed_inventory_commissioning_commands%rowtype;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_alloc numeric;
  v_count numeric;
  v_locations integer;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_command_id is null then raise exception 'R5_004A_COMMAND_ID_REQUIRED'; end if;

  v_payload:=jsonb_build_object(
    'commissioningId',p_commissioning_id,
    'acceptCountVariance',coalesce(p_accept_count_variance,false),
    'varianceReason',coalesce(p_variance_reason,'')
  );
  v_payload_hash:=public.ecoflow_r5_004a_payload_sha256(v_payload);

  select * into v_existing
  from public.ecoflow_unleashed_inventory_commissioning_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'FINALIZE'
       or v_existing.actor_user_id<>auth.uid()
       or v_existing.commissioning_id is distinct from p_commissioning_id
       or v_existing.command_payload_sha256<>v_payload_hash
    then raise exception 'R5_004A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;
  if not found
     or v_set.reference_row_id<>'7156d372-b12f-419e-b05e-2f12571ca525'
     or v_set.status<>'DRAFT'
  then raise exception 'R5_004A_DRAFT_BPB8_COMMISSIONING_REQUIRED'; end if;

  select count(*),coalesce(sum(reference_allocated_qty),0),coalesce(sum(counted_qty),0)
  into v_locations,v_alloc,v_count
  from public.ecoflow_unleashed_inventory_commissioning_locations
  where commissioning_id=v_set.id;

  if v_locations<1 then raise exception 'R5_004A_LOCATION_EVIDENCE_REQUIRED'; end if;
  if v_alloc<>v_set.source_qty_on_hand then raise exception 'R5_004A_REFERENCE_ALLOCATION_MUST_RECONCILE'; end if;
  if v_count<>v_set.source_qty_on_hand and not coalesce(p_accept_count_variance,false)
    then raise exception 'R5_004A_EXPLICIT_COUNT_VARIANCE_ACCEPTANCE_REQUIRED'; end if;
  if v_count<>v_set.source_qty_on_hand and nullif(btrim(coalesce(p_variance_reason,'')),'') is null
    then raise exception 'R5_004A_COUNT_VARIANCE_REASON_REQUIRED'; end if;

  update public.ecoflow_unleashed_inventory_commissioning_sets
  set status='FINALIZED',
      reference_allocated_qty_total=v_alloc,
      counted_qty_total=v_count,
      accepted_count_variance=(v_count<>source_qty_on_hand),
      variance_reason=case when v_count<>source_qty_on_hand then left(btrim(p_variance_reason),2000) else null end,
      finalized_by=auth.uid(),
      finalized_at=clock_timestamp(),
      revision=revision+1,
      updated_at=clock_timestamp()
  where id=v_set.id
  returning * into v_set;

  v_result:=jsonb_build_object(
    'commissioningId',v_set.id,
    'status',v_set.status,
    'revision',v_set.revision,
    'referenceAllocatedQtyTotal',v_alloc,
    'countedQtyTotal',v_count,
    'countVariance',v_count-v_set.source_qty_on_hand,
    'inventoryAuthorityCreated',false
  );
  insert into public.ecoflow_unleashed_inventory_commissioning_commands(
    command_id,commissioning_id,command_type,actor_user_id,command_payload_sha256,result
  ) values(
    p_command_id,v_set.id,'FINALIZE',auth.uid(),v_payload_hash,v_result
  );
  return v_result;
end;
$$;

revoke all on function public.ecoflow_finalize_bpb8_inventory_commissioning(uuid,boolean,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_finalize_bpb8_inventory_commissioning(uuid,boolean,text,uuid)
  to authenticated;

create or replace function public.ecoflow_materialize_bpb8_initial_stocktake(
  p_commissioning_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(true);
  v_existing public.ecoflow_unleashed_inventory_commissioning_commands%rowtype;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_location record;
  v_session_id uuid;
  v_session_status text;
  v_session_revision bigint;
  v_observation_id uuid;
  v_review_status text;
  v_exception_codes text[];
  v_observed_at timestamptz;
  v_internal_command uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_command_id is null then raise exception 'R5_004A_COMMAND_ID_REQUIRED'; end if;

  v_payload:=jsonb_build_object('commissioningId',p_commissioning_id);
  v_payload_hash:=public.ecoflow_r5_004a_payload_sha256(v_payload);

  select * into v_existing
  from public.ecoflow_unleashed_inventory_commissioning_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'MATERIALIZE'
       or v_existing.actor_user_id<>auth.uid()
       or v_existing.commissioning_id is distinct from p_commissioning_id
       or v_existing.command_payload_sha256<>v_payload_hash
    then raise exception 'R5_004A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r5-004a-bpb8-materialize',0));

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;
  if not found
     or v_set.reference_row_id<>'7156d372-b12f-419e-b05e-2f12571ca525'
     or v_set.status<>'FINALIZED'
  then raise exception 'R5_004A_FINALIZED_BPB8_COMMISSIONING_REQUIRED'; end if;
  if v_set.stocktake_session_id is not null then raise exception 'R5_004A_ALREADY_MATERIALIZED'; end if;
  if v_set.counted_qty_total is null then raise exception 'R5_004A_FINAL_COUNT_REQUIRED'; end if;

  v_internal_command:=gen_random_uuid();
  select session_id,session_status,revision
  into v_session_id,v_session_status,v_session_revision
  from public.ecoflow_start_stocktake_session(
    'INITIAL',
    'R5-004 BPB8 opening-balance canary',
    null,
    auth.uid(),
    false,
    'R5-004 BPB8 materialized from immutable ADL1 reference batch '||v_set.reference_batch_id::text,
    v_internal_command
  );

  for v_location in
    select *
    from public.ecoflow_unleashed_inventory_commissioning_locations
    where commissioning_id=v_set.id
    order by recorded_at,location_code
  loop
    v_internal_command:=gen_random_uuid();
    select observation_id,review_status,exception_codes,observed_at
    into v_observation_id,v_review_status,v_exception_codes,v_observed_at
    from public.ecoflow_record_stocktake_observation(
      v_session_id,
      v_location.location_code,
      'BPB8',
      '8oz Kraft Soup Bowl 250ml',
      '19348045005009',
      'carton',
      1,
      v_location.counted_qty,
      'R5-004 BPB8 physical count; immutable reference allocation='||v_location.reference_allocated_qty::text||'; evidence='||v_location.evidence_note,
      v_internal_command
    );
    if coalesce(cardinality(v_exception_codes),0)>0 then
      raise exception 'R5_004A_UNEXPECTED_STOCKTAKE_EXCEPTION:%',array_to_string(v_exception_codes,',');
    end if;

    v_internal_command:=gen_random_uuid();
    perform * from public.ecoflow_complete_stocktake_location(
      v_session_id,
      v_location.location_code,
      'R5-004 BPB8 location evidence complete',
      v_internal_command
    );
  end loop;

  v_internal_command:=gen_random_uuid();
  select session_id,session_status,revision
  into v_session_id,v_session_status,v_session_revision
  from public.ecoflow_submit_stocktake_session(
    v_session_id,
    'R5-004 BPB8 canary ready for separate Owner/Admin approval gate',
    v_internal_command
  );

  if v_session_status<>'REVIEW' then raise exception 'R5_004A_MATERIALIZED_SESSION_NOT_REVIEW'; end if;

  update public.ecoflow_unleashed_inventory_commissioning_sets
  set status='MATERIALIZED',
      stocktake_session_id=v_session_id,
      materialized_by=auth.uid(),
      materialized_at=clock_timestamp(),
      revision=revision+1,
      updated_at=clock_timestamp()
  where id=v_set.id
  returning * into v_set;

  v_result:=jsonb_build_object(
    'commissioningId',v_set.id,
    'status',v_set.status,
    'revision',v_set.revision,
    'stocktakeSessionId',v_session_id,
    'stocktakeSessionStatus',v_session_status,
    'stocktakeSessionRevision',v_session_revision,
    'countedQtyTotal',v_set.counted_qty_total,
    'approvalRequired',true,
    'inventoryAuthorityCreated',false
  );

  insert into public.ecoflow_unleashed_inventory_commissioning_commands(
    command_id,commissioning_id,command_type,actor_user_id,command_payload_sha256,result
  ) values(
    p_command_id,v_set.id,'MATERIALIZE',auth.uid(),v_payload_hash,v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_materialize_bpb8_initial_stocktake(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_materialize_bpb8_initial_stocktake(uuid,uuid)
  to authenticated;

comment on table public.ecoflow_unleashed_inventory_commissioning_sets is
  'R5-004 commissioning provenance bridge. Creates no inventory authority; authority remains in separately approved stocktake sessions.';
comment on function public.ecoflow_start_bpb8_inventory_commissioning(uuid) is
  'R5-004A exact BPB8 commissioning start. Requires exact SEALED R5-003 evidence and canonical Commercial->Family->preferred Physical SKU->package->barcode identity.';
comment on function public.ecoflow_materialize_bpb8_initial_stocktake(uuid,uuid) is
  'Materializes frozen BPB8 location/count evidence into an INITIAL stocktake in REVIEW only. It never calls stocktake approval.';