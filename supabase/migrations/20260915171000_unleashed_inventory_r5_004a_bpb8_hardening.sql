-- ECOFLOW-R5-004A hardening — align BPB8 commissioning to the deployed canonical
-- Product Identity graph and close SECURITY DEFINER PUBLIC execution.
-- This migration is authority-neutral: it does not start, finalize, materialize,
-- submit, approve, or mutate any production stocktake/inventory quantity.

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
  v_result jsonb;
begin
  if p_command_id is null then raise exception 'R5_004A_COMMAND_ID_REQUIRED'; end if;

  select * into v_existing
  from public.ecoflow_unleashed_inventory_commissioning_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type <> 'START' or v_existing.actor_user_id <> auth.uid() then
      raise exception 'R5_004A_COMMAND_REPLAY_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('r5-004a-bpb8-start',0));

  select * into v_batch
  from public.ecoflow_unleashed_inventory_reference_batches
  where id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9'
  for update;
  if not found
     or v_batch.batch_status <> 'SEALED'
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
  if v_link_count <> 1 then raise exception 'R5_004A_COMMERCIAL_FAMILY_LINK_MISMATCH'; end if;

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
  if v_barcode_count <> 1 then raise exception 'R5_004A_OPERATIONAL_BARCODE_MISMATCH'; end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where reference_row_id='7156d372-b12f-419e-b05e-2f12571ca525';
  if found then raise exception 'R5_004A_COMMISSIONING_ALREADY_EXISTS'; end if;

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

  v_payload:=jsonb_build_object(
    'referenceBatchId',v_batch.id,
    'referenceRowId',v_set.reference_row_id,
    'sku','BPB8',
    'familyId','1ff1f446-6e97-4ce6-bf6c-ef063265783a',
    'physicalSkuId',v_phys.id,
    'packageId',v_pkg.id,
    'barcode','19348045005009'
  );
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
    p_command_id,v_set.id,'START',auth.uid(),public.ecoflow_r5_004a_payload_sha256(v_payload),v_result
  );
  return v_result;
end;
$$;

-- SECURITY DEFINER functions in public must not inherit default PUBLIC execute.
revoke all on function public.ecoflow_r5_004a_payload_sha256(jsonb)
  from public,anon,authenticated,service_role;

revoke all on function public.ecoflow_read_bpb8_inventory_commissioning_gate()
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_read_bpb8_inventory_commissioning_gate()
  to authenticated;

revoke all on function public.ecoflow_start_bpb8_inventory_commissioning(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_start_bpb8_inventory_commissioning(uuid)
  to authenticated;

revoke all on function public.ecoflow_record_bpb8_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_record_bpb8_inventory_commissioning_location(uuid,text,numeric,numeric,text,uuid)
  to authenticated;

revoke all on function public.ecoflow_finalize_bpb8_inventory_commissioning(uuid,boolean,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_finalize_bpb8_inventory_commissioning(uuid,boolean,text,uuid)
  to authenticated;

revoke all on function public.ecoflow_materialize_bpb8_initial_stocktake(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_materialize_bpb8_initial_stocktake(uuid,uuid)
  to authenticated;

comment on function public.ecoflow_start_bpb8_inventory_commissioning(uuid) is
  'R5-004A exact BPB8 commissioning start. Revalidates SEALED R5-003 evidence plus canonical Commercial->Family->preferred Physical SKU->package->barcode identity. Creates no inventory authority.';