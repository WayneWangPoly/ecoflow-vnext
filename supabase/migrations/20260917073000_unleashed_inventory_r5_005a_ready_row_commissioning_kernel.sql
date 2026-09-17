-- ECOFLOW-R5-005A — READY-row INITIAL opening-balance commissioning kernel
--
-- Generalises the proven R5-004 BPB8 commissioning bridge without widening
-- inventory authority. The kernel starts only from the latest SEALED ADL1
-- reference row whose Product/Warehouse/Physical identity is READY, records
-- real physical location/count evidence, finalises the evidence, and may
-- materialise it into the incumbent INITIAL stocktake engine in REVIEW.
--
-- This migration deliberately exposes NO stocktake approval action and does
-- not directly insert/update inventory balances or warehouse movements.

create or replace function public.ecoflow_read_ready_inventory_commissioning_gate(
  p_reference_row_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(false);
  v_ref public.v_ecoflow_unleashed_inventory_reference_rows%rowtype;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_pkg public.ecoflow_physical_sku_packages%rowtype;
  v_pkg_count integer := 0;
  v_barcode text;
  v_barcode_count integer := 0;
  v_latest_sealed_batch_id uuid;
  v_session_status text;
  v_start_eligible boolean := false;
  v_result jsonb;
begin
  if p_reference_row_id is null then
    raise exception 'R5_005A_REFERENCE_ROW_ID_REQUIRED';
  end if;

  select * into v_ref
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where reference_row_id=p_reference_row_id;
  if not found then
    raise exception 'R5_005A_REFERENCE_ROW_NOT_FOUND';
  end if;

  select id into v_latest_sealed_batch_id
  from public.ecoflow_unleashed_inventory_reference_batches
  where batch_status='SEALED'
  order by sealed_at desc nulls last, created_at desc, id desc
  limit 1;

  if v_ref.preferred_physical_sku_context_id is not null then
    select count(*)::integer into v_pkg_count
    from public.ecoflow_physical_sku_packages p
    where p.physical_sku_id=v_ref.preferred_physical_sku_context_id
      and p.identity_status='ACTIVE'
      and upper(p.package_level)='CARTON';

    if v_pkg_count=1 then
      select * into v_pkg
      from public.ecoflow_physical_sku_packages p
      where p.physical_sku_id=v_ref.preferred_physical_sku_context_id
        and p.identity_status='ACTIVE'
        and upper(p.package_level)='CARTON'
      limit 1;

      select count(*)::integer into v_barcode_count
      from public.ecoflow_physical_barcode_bindings b
      where b.physical_sku_id=v_ref.preferred_physical_sku_context_id
        and b.package_id=v_pkg.id
        and b.identity_status='ACTIVE';

      if v_barcode_count=1 then
        select b.barcode into v_barcode
        from public.ecoflow_physical_barcode_bindings b
        where b.physical_sku_id=v_ref.preferred_physical_sku_context_id
          and b.package_id=v_pkg.id
          and b.identity_status='ACTIVE'
        limit 1;
      end if;
    end if;
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where reference_row_id=p_reference_row_id;

  if v_set.stocktake_session_id is not null then
    select s.session_status into v_session_status
    from public.ecoflow_stocktake_sessions s
    where s.id=v_set.stocktake_session_id;
  end if;

  v_start_eligible :=
    v_ref.batch_status='SEALED'
    and v_ref.batch_id=v_latest_sealed_batch_id
    and v_ref.source_warehouse_code='ADL1'
    and upper(coalesce(v_ref.warehouse_code,''))='MAIN'
    and v_ref.reference_quantity_scope='UNLEASHED_WAREHOUSE_TOTAL'
    and v_ref.product_mapping_count=1
    and v_ref.product_mapping_status='MATCHED'
    and v_ref.warehouse_mapping_count=1
    and v_ref.warehouse_mapping_status='MATCHED'
    and v_ref.physical_identity_link_count=1
    and v_ref.substitution_policy='PROHIBITED'
    and v_ref.preferred_physical_sku_context_id is not null
    and v_ref.commercial_sku_id is not null
    and v_ref.family_id is not null
    and v_ref.quantity_assigned_physical_sku_id is null
    and v_ref.quantity_assigned_location_id is null
    and v_ref.readiness_status='READY_FOR_LOCATION_EVIDENCE'
    and v_ref.qty_on_hand>=0
    and v_ref.qty_on_hand=trunc(v_ref.qty_on_hand)
    and coalesce(v_ref.source_available_formula_delta,999999) = 0
    and v_pkg_count=1
    and v_barcode_count=1
    and nullif(btrim(coalesce(v_barcode,'')),'') is not null
    and v_set.id is null;

  select jsonb_build_object(
    'actorRole',v_role,
    'referenceRowId',v_ref.reference_row_id,
    'referenceBatchId',v_ref.batch_id,
    'referenceBatchStatus',v_ref.batch_status,
    'referenceBatchRevision',v_ref.batch_revision,
    'isLatestSealedBatch',v_ref.batch_id=v_latest_sealed_batch_id,
    'sourceRunId',v_ref.source_run_id,
    'sourceSetSha256',v_ref.source_set_sha256,
    'sourceRowSha256',v_ref.source_row_sha256,
    'sourceProductCode',v_ref.source_product_code,
    'sourceWarehouseCode',v_ref.source_warehouse_code,
    'sourceQtyOnHand',v_ref.qty_on_hand,
    'referenceQuantityScope',v_ref.reference_quantity_scope,
    'commercialSkuId',v_ref.commercial_sku_id,
    'familyId',v_ref.family_id,
    'physicalSkuId',v_ref.preferred_physical_sku_context_id,
    'activeCartonPackageCount',v_pkg_count,
    'packageId',case when v_pkg_count=1 then v_pkg.id else null end,
    'packageLevel',case when v_pkg_count=1 then v_pkg.package_level else null end,
    'unitsPerPackage',case when v_pkg_count=1 then v_pkg.units_in_base_unit else null end,
    'activePackageBarcodeCount',v_barcode_count,
    'barcode',case when v_barcode_count=1 then v_barcode else null end,
    'startEligible',v_start_eligible,
    'commissioningId',v_set.id,
    'commissioningStatus',v_set.status,
    'commissioningRevision',v_set.revision,
    'stocktakeSessionId',v_set.stocktake_session_id,
    'stocktakeSessionStatus',v_session_status,
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
    'inventoryAuthorityCreated',coalesce(v_session_status='APPROVED',false)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.ecoflow_read_ready_inventory_commissioning_gate(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_read_ready_inventory_commissioning_gate(uuid)
  to authenticated;

create or replace function public.ecoflow_start_ready_inventory_commissioning(
  p_reference_row_id uuid,
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
  v_ref public.v_ecoflow_unleashed_inventory_reference_rows%rowtype;
  v_batch public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_phys public.ecoflow_physical_skus%rowtype;
  v_pkg public.ecoflow_physical_sku_packages%rowtype;
  v_latest_sealed_batch_id uuid;
  v_link_count integer;
  v_pkg_count integer;
  v_barcode_count integer;
  v_barcode text;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_reference_row_id is null then raise exception 'R5_005A_REFERENCE_ROW_ID_REQUIRED'; end if;
  if p_command_id is null then raise exception 'R5_005A_COMMAND_ID_REQUIRED'; end if;

  v_payload:=jsonb_build_object('referenceRowId',p_reference_row_id);
  v_payload_hash:=public.ecoflow_r5_004a_payload_sha256(v_payload);

  select * into v_existing
  from public.ecoflow_unleashed_inventory_commissioning_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'START'
       or v_existing.actor_user_id<>auth.uid()
       or v_existing.command_payload_sha256<>v_payload_hash
    then raise exception 'R5_005A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r5-005a-ready-start:'||p_reference_row_id::text,0));

  select * into v_ref
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where reference_row_id=p_reference_row_id;
  if not found then raise exception 'R5_005A_REFERENCE_ROW_NOT_FOUND'; end if;

  select id into v_latest_sealed_batch_id
  from public.ecoflow_unleashed_inventory_reference_batches
  where batch_status='SEALED'
  order by sealed_at desc nulls last, created_at desc, id desc
  limit 1;

  select * into v_batch
  from public.ecoflow_unleashed_inventory_reference_batches
  where id=v_ref.batch_id
  for update;

  if not found
     or v_batch.batch_status<>'SEALED'
     or v_batch.id is distinct from v_latest_sealed_batch_id
     or v_ref.batch_status<>'SEALED'
     or v_ref.batch_revision<>v_batch.revision
     or v_ref.source_run_id<>v_batch.source_run_id
     or v_ref.source_set_sha256<>v_batch.source_set_sha256
     or v_ref.source_row_count<>v_batch.source_row_count
  then raise exception 'R5_005A_LATEST_SEALED_REFERENCE_BATCH_REQUIRED'; end if;

  if nullif(btrim(coalesce(v_ref.source_product_code,'')),'') is null
     or v_ref.source_warehouse_code<>'ADL1'
     or upper(coalesce(v_ref.warehouse_code,''))<>'MAIN'
     or v_ref.reference_quantity_scope<>'UNLEASHED_WAREHOUSE_TOTAL'
     or v_ref.product_mapping_count<>1
     or v_ref.product_mapping_status<>'MATCHED'
     or v_ref.warehouse_mapping_count<>1
     or v_ref.warehouse_mapping_status<>'MATCHED'
     or v_ref.physical_identity_link_count<>1
     or v_ref.substitution_policy<>'PROHIBITED'
     or v_ref.commercial_sku_id is null
     or v_ref.family_id is null
     or v_ref.preferred_physical_sku_context_id is null
     or v_ref.quantity_assigned_physical_sku_id is not null
     or v_ref.quantity_assigned_location_id is not null
     or v_ref.readiness_status<>'READY_FOR_LOCATION_EVIDENCE'
     or v_ref.qty_on_hand is null
     or v_ref.qty_on_hand<0
     or v_ref.qty_on_hand<>trunc(v_ref.qty_on_hand)
     or coalesce(v_ref.source_available_formula_delta,999999)<>0
     or nullif(btrim(coalesce(v_ref.source_row_sha256,'')),'') is null
  then raise exception 'R5_005A_READY_REFERENCE_BINDING_REQUIRED'; end if;

  select * into v_phys
  from public.ecoflow_physical_skus
  where id=v_ref.preferred_physical_sku_context_id;
  if not found
     or v_phys.identity_status<>'ACTIVE'
     or v_phys.family_id<>v_ref.family_id
     or nullif(btrim(coalesce(v_phys.physical_sku_code,'')),'') is null
  then raise exception 'R5_005A_ACTIVE_PREFERRED_PHYSICAL_SKU_REQUIRED'; end if;

  select count(*)::integer into v_link_count
  from public.ecoflow_commercial_family_links l
  where l.commercial_sku_id=v_ref.commercial_sku_id
    and l.family_id=v_ref.family_id
    and l.preferred_physical_sku_id=v_phys.id
    and l.identity_status='ACTIVE'
    and l.substitution_policy='PROHIBITED';
  if v_link_count<>1 then raise exception 'R5_005A_UNIQUE_COMMERCIAL_FAMILY_LINK_REQUIRED'; end if;

  select count(*)::integer into v_pkg_count
  from public.ecoflow_physical_sku_packages p
  where p.physical_sku_id=v_phys.id
    and p.identity_status='ACTIVE'
    and upper(p.package_level)='CARTON';
  if v_pkg_count<>1 then raise exception 'R5_005A_UNIQUE_ACTIVE_CARTON_PACKAGE_REQUIRED'; end if;

  select * into v_pkg
  from public.ecoflow_physical_sku_packages p
  where p.physical_sku_id=v_phys.id
    and p.identity_status='ACTIVE'
    and upper(p.package_level)='CARTON'
  limit 1;
  if v_pkg.units_in_base_unit is null or v_pkg.units_in_base_unit<=0 then
    raise exception 'R5_005A_VALID_CARTON_UNITS_REQUIRED';
  end if;

  select count(*)::integer into v_barcode_count
  from public.ecoflow_physical_barcode_bindings b
  where b.physical_sku_id=v_phys.id
    and b.package_id=v_pkg.id
    and b.identity_status='ACTIVE';
  if v_barcode_count<>1 then raise exception 'R5_005A_UNIQUE_ACTIVE_PACKAGE_BARCODE_REQUIRED'; end if;

  select b.barcode into v_barcode
  from public.ecoflow_physical_barcode_bindings b
  where b.physical_sku_id=v_phys.id
    and b.package_id=v_pkg.id
    and b.identity_status='ACTIVE'
  limit 1;
  if nullif(btrim(coalesce(v_barcode,'')),'') is null then
    raise exception 'R5_005A_OPERATIONAL_BARCODE_REQUIRED';
  end if;

  if exists(
    select 1 from public.ecoflow_unleashed_inventory_commissioning_sets
    where reference_row_id=p_reference_row_id
  ) then raise exception 'R5_005A_COMMISSIONING_ALREADY_EXISTS'; end if;

  insert into public.ecoflow_unleashed_inventory_commissioning_sets(
    reference_batch_id,reference_row_id,source_run_id,source_set_sha256,source_row_sha256,
    source_qty_on_hand,commercial_sku_id,physical_sku_id,package_id,package_level,
    operational_barcode,units_per_package,created_by
  ) values (
    v_ref.batch_id,v_ref.reference_row_id,v_ref.source_run_id,v_ref.source_set_sha256,v_ref.source_row_sha256,
    v_ref.qty_on_hand,v_ref.commercial_sku_id,v_phys.id,v_pkg.id,upper(v_pkg.package_level),
    v_barcode,v_pkg.units_in_base_unit,auth.uid()
  ) returning * into v_set;

  v_result:=jsonb_build_object(
    'referenceRowId',v_ref.reference_row_id,
    'sourceProductCode',v_ref.source_product_code,
    'physicalSkuId',v_phys.id,
    'physicalSkuCode',v_phys.physical_sku_code,
    'packageId',v_pkg.id,
    'packageLevel',upper(v_pkg.package_level),
    'unitsPerPackage',v_pkg.units_in_base_unit,
    'barcode',v_barcode,
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

revoke all on function public.ecoflow_start_ready_inventory_commissioning(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_start_ready_inventory_commissioning(uuid,uuid)
  to authenticated;

create or replace function public.ecoflow_record_ready_inventory_commissioning_location(
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
  v_location_count integer;
  v_existing_alloc numeric;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_commissioning_id is null then raise exception 'R5_005A_COMMISSIONING_ID_REQUIRED'; end if;
  if p_command_id is null then raise exception 'R5_005A_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_location_code,'')),'') is null then raise exception 'R5_005A_PHYSICAL_LOCATION_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'R5_005A_LOCATION_EVIDENCE_NOTE_REQUIRED'; end if;
  if p_reference_allocated_qty is null or p_reference_allocated_qty<0 or p_reference_allocated_qty<>trunc(p_reference_allocated_qty)
    then raise exception 'R5_005A_VALID_REFERENCE_ALLOCATION_REQUIRED'; end if;
  if p_counted_qty is null or p_counted_qty<0 or p_counted_qty<>trunc(p_counted_qty)
    then raise exception 'R5_005A_VALID_PHYSICAL_COUNT_REQUIRED'; end if;

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
    then raise exception 'R5_005A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;
  if not found or v_set.status<>'DRAFT' then
    raise exception 'R5_005A_DRAFT_COMMISSIONING_REQUIRED';
  end if;

  select count(*)::integer into v_location_count
  from public.ecoflow_warehouse_locations l
  where upper(l.location_code)=upper(btrim(p_location_code))
    and l.status='ACTIVE';
  if v_location_count<>1 then raise exception 'R5_005A_UNIQUE_ACTIVE_PHYSICAL_LOCATION_REQUIRED'; end if;

  select * into v_location
  from public.ecoflow_warehouse_locations l
  where upper(l.location_code)=upper(btrim(p_location_code))
    and l.status='ACTIVE'
  limit 1;

  if exists(
    select 1 from public.ecoflow_unleashed_inventory_commissioning_locations l
    where l.commissioning_id=v_set.id and l.location_id=v_location.id
  ) then raise exception 'R5_005A_LOCATION_ALREADY_RECORDED'; end if;

  select coalesce(sum(l.reference_allocated_qty),0) into v_existing_alloc
  from public.ecoflow_unleashed_inventory_commissioning_locations l
  where l.commissioning_id=v_set.id;
  if v_existing_alloc+p_reference_allocated_qty>v_set.source_qty_on_hand then
    raise exception 'R5_005A_REFERENCE_ALLOCATION_EXCEEDS_SOURCE';
  end if;

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

revoke all on function public.ecoflow_record_ready_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_record_ready_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid)
  to authenticated;

create or replace function public.ecoflow_finalize_ready_inventory_commissioning(
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
  if p_commissioning_id is null then raise exception 'R5_005A_COMMISSIONING_ID_REQUIRED'; end if;
  if p_command_id is null then raise exception 'R5_005A_COMMAND_ID_REQUIRED'; end if;

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
    then raise exception 'R5_005A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;
  if not found or v_set.status<>'DRAFT' then
    raise exception 'R5_005A_DRAFT_COMMISSIONING_REQUIRED';
  end if;

  select count(*)::integer,coalesce(sum(reference_allocated_qty),0),coalesce(sum(counted_qty),0)
  into v_locations,v_alloc,v_count
  from public.ecoflow_unleashed_inventory_commissioning_locations
  where commissioning_id=v_set.id;

  if v_locations<1 then raise exception 'R5_005A_LOCATION_EVIDENCE_REQUIRED'; end if;
  if v_alloc<>v_set.source_qty_on_hand then raise exception 'R5_005A_REFERENCE_ALLOCATION_MUST_RECONCILE'; end if;
  if v_count<>v_set.source_qty_on_hand and not coalesce(p_accept_count_variance,false)
    then raise exception 'R5_005A_EXPLICIT_COUNT_VARIANCE_ACCEPTANCE_REQUIRED'; end if;
  if v_count<>v_set.source_qty_on_hand and nullif(btrim(coalesce(p_variance_reason,'')),'') is null
    then raise exception 'R5_005A_COUNT_VARIANCE_REASON_REQUIRED'; end if;

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

revoke all on function public.ecoflow_finalize_ready_inventory_commissioning(uuid,boolean,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_finalize_ready_inventory_commissioning(uuid,boolean,text,uuid)
  to authenticated;

create or replace function public.ecoflow_materialize_ready_initial_stocktake(
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
  v_ref public.v_ecoflow_unleashed_inventory_reference_rows%rowtype;
  v_phys public.ecoflow_physical_skus%rowtype;
  v_pkg public.ecoflow_physical_sku_packages%rowtype;
  v_location record;
  v_latest_sealed_batch_id uuid;
  v_barcode_count integer;
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
  if p_commissioning_id is null then raise exception 'R5_005A_COMMISSIONING_ID_REQUIRED'; end if;
  if p_command_id is null then raise exception 'R5_005A_COMMAND_ID_REQUIRED'; end if;

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
    then raise exception 'R5_005A_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r5-005a-ready-materialize:'||p_commissioning_id::text,0));

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;
  if not found or v_set.status<>'FINALIZED' then
    raise exception 'R5_005A_FINALIZED_COMMISSIONING_REQUIRED';
  end if;
  if v_set.stocktake_session_id is not null then raise exception 'R5_005A_ALREADY_MATERIALIZED'; end if;
  if v_set.counted_qty_total is null then raise exception 'R5_005A_FINAL_COUNT_REQUIRED'; end if;

  select id into v_latest_sealed_batch_id
  from public.ecoflow_unleashed_inventory_reference_batches
  where batch_status='SEALED'
  order by sealed_at desc nulls last, created_at desc, id desc
  limit 1;
  if v_set.reference_batch_id is distinct from v_latest_sealed_batch_id then
    raise exception 'R5_005A_STALE_REFERENCE_BATCH';
  end if;

  select * into v_ref
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where reference_row_id=v_set.reference_row_id;
  if not found
     or v_ref.batch_id<>v_set.reference_batch_id
     or v_ref.source_run_id<>v_set.source_run_id
     or v_ref.source_set_sha256<>v_set.source_set_sha256
     or v_ref.source_row_sha256<>v_set.source_row_sha256
     or v_ref.commercial_sku_id<>v_set.commercial_sku_id
     or v_ref.preferred_physical_sku_context_id<>v_set.physical_sku_id
     or v_ref.readiness_status<>'READY_FOR_LOCATION_EVIDENCE'
  then raise exception 'R5_005A_FROZEN_REFERENCE_BINDING_MISMATCH'; end if;

  select * into v_phys
  from public.ecoflow_physical_skus
  where id=v_set.physical_sku_id;
  if not found
     or v_phys.identity_status<>'ACTIVE'
     or nullif(btrim(coalesce(v_phys.physical_sku_code,'')),'') is null
     or nullif(btrim(coalesce(v_phys.display_name,'')),'') is null
  then raise exception 'R5_005A_ACTIVE_PHYSICAL_SKU_REQUIRED'; end if;

  select * into v_pkg
  from public.ecoflow_physical_sku_packages
  where id=v_set.package_id;
  if not found
     or v_pkg.physical_sku_id<>v_set.physical_sku_id
     or v_pkg.identity_status<>'ACTIVE'
     or upper(v_pkg.package_level)<>upper(v_set.package_level)
     or v_pkg.units_in_base_unit<>v_set.units_per_package
  then raise exception 'R5_005A_FROZEN_PACKAGE_BINDING_MISMATCH'; end if;

  select count(*)::integer into v_barcode_count
  from public.ecoflow_physical_barcode_bindings b
  where b.physical_sku_id=v_set.physical_sku_id
    and b.package_id=v_set.package_id
    and b.barcode=v_set.operational_barcode
    and b.identity_status='ACTIVE';
  if v_barcode_count<>1 then raise exception 'R5_005A_FROZEN_BARCODE_BINDING_MISMATCH'; end if;

  v_internal_command:=gen_random_uuid();
  select session_id,session_status,revision
  into v_session_id,v_session_status,v_session_revision
  from public.ecoflow_start_stocktake_session(
    'INITIAL',
    left('R5-005 '||v_ref.source_product_code||' opening-balance commissioning',200),
    null,
    auth.uid(),
    false,
    left('R5-005 materialized from immutable ADL1 reference batch '||v_set.reference_batch_id::text||' row '||v_set.reference_row_id::text,2000),
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
      v_phys.physical_sku_code,
      v_phys.display_name,
      v_set.operational_barcode,
      lower(v_set.package_level),
      v_set.units_per_package,
      v_location.counted_qty,
      left('R5-005 physical count; immutable reference allocation='||v_location.reference_allocated_qty::text||'; evidence='||v_location.evidence_note,2000),
      v_internal_command
    );

    if coalesce(cardinality(v_exception_codes),0)>0 then
      raise exception 'R5_005A_UNEXPECTED_STOCKTAKE_EXCEPTION:%',array_to_string(v_exception_codes,',');
    end if;

    v_internal_command:=gen_random_uuid();
    perform * from public.ecoflow_complete_stocktake_location(
      v_session_id,
      v_location.location_code,
      left('R5-005 '||v_ref.source_product_code||' location evidence complete',2000),
      v_internal_command
    );
  end loop;

  v_internal_command:=gen_random_uuid();
  select session_id,session_status,revision
  into v_session_id,v_session_status,v_session_revision
  from public.ecoflow_submit_stocktake_session(
    v_session_id,
    left('R5-005 '||v_ref.source_product_code||' ready for separate Owner/Admin approval gate',2000),
    v_internal_command
  );

  if v_session_status<>'REVIEW' then raise exception 'R5_005A_MATERIALIZED_SESSION_NOT_REVIEW'; end if;

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
    'referenceRowId',v_set.reference_row_id,
    'sourceProductCode',v_ref.source_product_code,
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

revoke all on function public.ecoflow_materialize_ready_initial_stocktake(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_materialize_ready_initial_stocktake(uuid,uuid)
  to authenticated;

comment on function public.ecoflow_read_ready_inventory_commissioning_gate(uuid) is
  'R5-005A read gate for latest-SEALED ADL1 READY reference rows and any existing commissioning state.';
comment on function public.ecoflow_start_ready_inventory_commissioning(uuid,uuid) is
  'R5-005A generic START. Freezes one latest-SEALED ADL1 READY reference row onto one active preferred Physical SKU, one CARTON package and one package barcode.';
comment on function public.ecoflow_record_ready_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid) is
  'R5-005A records real active location evidence and physical carton count only; it creates no inventory authority.';
comment on function public.ecoflow_finalize_ready_inventory_commissioning(uuid,boolean,text,uuid) is
  'R5-005A finalises reconciled reference allocation and explicit physical-count variance evidence only.';
comment on function public.ecoflow_materialize_ready_initial_stocktake(uuid,uuid) is
  'R5-005A materialises frozen evidence into an INITIAL stocktake in REVIEW only. It never calls stocktake approval.';
