-- ECOFLOW-R5-007 — bounded provisional reference planning evidence for #339
--
-- During ADL1 relocation, the Owner accepted frozen Unleashed QtyOnHand as a
-- provisional migration/reference baseline only. It is NOT a physical count
-- and must NOT enter operational warehouse quantity or inventory movements.
--
-- Scope is frozen to the two already-started R5-005B DRAFT commissionings:
--   R-360Y          -> reference 3 cartons -> planned A2-03-02A
--   SB24/32/40LBOX -> reference 5 cartons -> planned A2-03-03A
--
-- The existing R5-005B physical evidence path remains the only way to create
-- INITIAL stocktake evidence and later inventory authority.

create table if not exists public.ecoflow_unleashed_inventory_provisional_reference_evidence (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  commissioning_id uuid not null unique
    references public.ecoflow_unleashed_inventory_commissioning_sets(id),
  reference_batch_id uuid not null
    references public.ecoflow_unleashed_inventory_reference_batches(id),
  reference_row_id uuid not null
    references public.ecoflow_unleashed_inventory_reference_rows(id),
  source_run_id uuid not null references public.unleashed_sync_runs(id),
  source_set_sha256 text not null check (source_set_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  source_product_code text not null,
  physical_sku_id uuid not null references public.ecoflow_physical_skus(id),
  package_id uuid not null references public.ecoflow_physical_sku_packages(id),
  operational_barcode text not null,
  planned_location_id uuid not null references public.ecoflow_warehouse_locations(id),
  planned_location_code text not null,
  source_qty_on_hand numeric not null
    check (source_qty_on_hand > 0 and source_qty_on_hand = trunc(source_qty_on_hand)),
  units_per_package numeric not null check (units_per_package > 0),
  status text not null default 'PROVISIONAL_REFERENCE'
    check (status in ('PROVISIONAL_REFERENCE','RECONCILED')),
  actor_user_id uuid not null references auth.users(id),
  actor_role text not null,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 2000),
  recorded_at timestamptz not null default clock_timestamp(),
  reconciled_stocktake_session_id uuid references public.ecoflow_stocktake_sessions(id),
  reconciled_at timestamptz,
  result jsonb not null default '{}'::jsonb
);

alter table public.ecoflow_unleashed_inventory_provisional_reference_evidence enable row level security;
revoke all on table public.ecoflow_unleashed_inventory_provisional_reference_evidence
  from public, anon, authenticated, service_role;

create or replace function public.ecoflow_read_provisional_inventory_reference_gate(
  p_commissioning_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(false);
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_ref public.v_ecoflow_unleashed_inventory_reference_rows%rowtype;
  v_phys public.ecoflow_physical_skus%rowtype;
  v_pkg public.ecoflow_physical_sku_packages%rowtype;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_evidence public.ecoflow_unleashed_inventory_provisional_reference_evidence%rowtype;
  v_expected_code text;
  v_expected_location text;
  v_expected_qty numeric;
  v_expected_reference_row uuid;
  v_expected_physical uuid;
  v_expected_package uuid;
  v_expected_barcode text;
  v_expected_source_row_sha text;
  v_latest_sealed_batch_id uuid;
  v_existing_location_count integer := 0;
  v_existing_movement_count integer := 0;
  v_eligible boolean := false;
begin
  if p_commissioning_id is null then
    raise exception 'R5_007_COMMISSIONING_ID_REQUIRED';
  end if;

  if p_commissioning_id='44f09191-85f6-4682-8934-98c459cc4d88'::uuid then
    v_expected_code:='R-360Y';
    v_expected_location:='A2-03-02A';
    v_expected_qty:=3;
    v_expected_reference_row:='2a710fa3-0467-4c05-9317-033fb863815e'::uuid;
    v_expected_physical:='8905b519-6418-4bb1-a2a4-bdd8d48157f7'::uuid;
    v_expected_package:='ff12d5f1-ba94-4960-bee6-c3c12aaf53ba'::uuid;
    v_expected_barcode:='19344062000652';
    v_expected_source_row_sha:='bf95d275d9419dae66a29e10a2a1e4e4f4b57d83a1ae872f4626260cb1592e0d';
  elsif p_commissioning_id='2124ea46-765f-488a-8442-baf9dbd268d0'::uuid then
    v_expected_code:='SB24/32/40LBOX';
    v_expected_location:='A2-03-03A';
    v_expected_qty:=5;
    v_expected_reference_row:='44aca94f-bb82-457d-9998-c397b687140a'::uuid;
    v_expected_physical:='d8d9a558-37e6-4a22-99a2-7f0caf7492ac'::uuid;
    v_expected_package:='203dedb0-3ab7-425d-85e2-ac646b1fa601'::uuid;
    v_expected_barcode:='19348045022914';
    v_expected_source_row_sha:='afbf51ee85d8785036a4532f9ab5ba4f9334ceee6c87998ba09762ed82e9afb6';
  else
    raise exception 'R5_007_COMMISSIONING_OUTSIDE_FROZEN_SCOPE';
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id;
  if not found then raise exception 'R5_007_COMMISSIONING_NOT_FOUND'; end if;

  select * into v_ref
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where reference_row_id=v_set.reference_row_id;
  if not found then raise exception 'R5_007_REFERENCE_ROW_NOT_FOUND'; end if;

  select id into v_latest_sealed_batch_id
  from public.ecoflow_unleashed_inventory_reference_batches
  where batch_status='SEALED'
  order by sealed_at desc nulls last, created_at desc, id desc
  limit 1;

  select * into v_phys
  from public.ecoflow_physical_skus
  where id=v_set.physical_sku_id;

  select * into v_pkg
  from public.ecoflow_physical_sku_packages
  where id=v_set.package_id;

  select * into v_location
  from public.ecoflow_warehouse_locations
  where upper(location_code)=v_expected_location
    and status='ACTIVE';

  select * into v_evidence
  from public.ecoflow_unleashed_inventory_provisional_reference_evidence
  where commissioning_id=p_commissioning_id;

  select count(*)::integer into v_existing_location_count
  from public.ecoflow_warehouse_location_items
  where upper(sku)=v_expected_code
    and quantity<>0;

  select count(*)::integer into v_existing_movement_count
  from public.ecoflow_inventory_movements
  where upper(sku)=v_expected_code;

  v_eligible :=
    v_evidence.id is null
    and v_set.status='DRAFT'
    and v_set.revision=0
    and v_set.stocktake_session_id is null
    and v_set.reference_row_id=v_expected_reference_row
    and v_set.reference_batch_id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9'::uuid
    and v_set.source_run_id='5cd0e73b-956d-4c80-9e70-6d841d27b163'::uuid
    and v_set.source_set_sha256='215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d'
    and v_set.source_row_sha256=v_expected_source_row_sha
    and v_set.source_qty_on_hand=v_expected_qty
    and v_set.physical_sku_id=v_expected_physical
    and v_set.package_id=v_expected_package
    and v_set.operational_barcode=v_expected_barcode
    and upper(v_set.package_level)='CARTON'
    and v_set.units_per_package=1
    and v_ref.batch_id=v_latest_sealed_batch_id
    and v_ref.batch_status='SEALED'
    and v_ref.source_row_sha256=v_expected_source_row_sha
    and v_ref.source_product_code=v_expected_code
    and v_ref.source_warehouse_code='ADL1'
    and upper(coalesce(v_ref.warehouse_code,''))='MAIN'
    and v_ref.reference_quantity_scope='UNLEASHED_WAREHOUSE_TOTAL'
    and v_ref.readiness_status='READY_FOR_LOCATION_EVIDENCE'
    and v_ref.quantity_assigned_physical_sku_id is null
    and v_ref.quantity_assigned_location_id is null
    and v_phys.identity_status='ACTIVE'
    and v_phys.physical_sku_code=v_expected_code
    and v_pkg.identity_status='ACTIVE'
    and upper(v_pkg.package_level)='CARTON'
    and v_pkg.units_in_base_unit=1
    and v_location.id is not null
    and not exists (
      select 1
      from public.ecoflow_unleashed_inventory_commissioning_locations l
      where l.commissioning_id=v_set.id
    )
    and v_existing_location_count=0
    and v_existing_movement_count=0;

  return jsonb_build_object(
    'actorRole',v_role,
    'commissioningId',v_set.id,
    'commissioningStatus',v_set.status,
    'commissioningRevision',v_set.revision,
    'referenceBatchId',v_set.reference_batch_id,
    'referenceRowId',v_set.reference_row_id,
    'sourceRunId',v_set.source_run_id,
    'sourceSetSha256',v_set.source_set_sha256,
    'sourceRowSha256',v_expected_source_row_sha,
    'sourceProductCode',v_expected_code,
    'sourceQtyOnHand',v_expected_qty,
    'physicalSkuId',v_expected_physical,
    'physicalSkuCode',v_phys.physical_sku_code,
    'physicalSkuName',v_phys.display_name,
    'packageId',v_expected_package,
    'packageLevel','CARTON',
    'unitsPerPackage',1,
    'barcode',v_expected_barcode,
    'plannedLocationCode',v_expected_location,
    'plannedLocationId',v_location.id,
    'provisionalEligible',v_eligible,
    'provisionalEvidenceId',v_evidence.id,
    'provisionalStatus',v_evidence.status,
    'provisionalRecordedAt',v_evidence.recorded_at,
    'provisionalQuantity',v_evidence.source_qty_on_hand,
    'inventoryMutationCreated',false,
    'operationalInventoryAuthorityCreated',false,
    'physicalCountClaimed',false,
    'requiresLaterPhysicalStocktake',true,
    'existingNonZeroLocationRows',v_existing_location_count,
    'existingInventoryMovements',v_existing_movement_count
  );
end;
$$;

revoke all on function public.ecoflow_read_provisional_inventory_reference_gate(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_read_provisional_inventory_reference_gate(uuid)
  to authenticated;

create or replace function public.ecoflow_record_provisional_inventory_reference(
  p_commissioning_id uuid,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_require_warehouse_control_role(true);
  v_gate jsonb;
  v_existing public.ecoflow_unleashed_inventory_provisional_reference_evidence%rowtype;
  v_set public.ecoflow_unleashed_inventory_commissioning_sets%rowtype;
  v_phys public.ecoflow_physical_skus%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_commissioning_id is null then raise exception 'R5_007_COMMISSIONING_ID_REQUIRED'; end if;
  if p_command_id is null then raise exception 'R5_007_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'R5_007_REASON_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('r5-007-provisional-opening:'||p_commissioning_id::text,0));

  v_gate:=public.ecoflow_read_provisional_inventory_reference_gate(p_commissioning_id);

  v_payload:=jsonb_build_object(
    'commissioningId',p_commissioning_id,
    'plannedLocationCode',v_gate->>'plannedLocationCode',
    'sourceQtyOnHand',(v_gate->>'sourceQtyOnHand')::numeric,
    'sourceRowSha256',v_gate->>'sourceRowSha256',
    'reason',left(btrim(p_reason),2000)
  );
  v_payload_hash:=public.ecoflow_r5_004a_payload_sha256(v_payload);

  select * into v_existing
  from public.ecoflow_unleashed_inventory_provisional_reference_evidence
  where command_id=p_command_id;
  if found then
    if v_existing.actor_user_id<>auth.uid()
       or v_existing.commissioning_id<>p_commissioning_id
       or v_existing.command_payload_sha256<>v_payload_hash
    then raise exception 'R5_007_COMMAND_REPLAY_MISMATCH'; end if;
    return v_existing.result;
  end if;

  if coalesce((v_gate->>'provisionalEligible')::boolean,false) is not true then
    raise exception 'R5_007_PROVISIONAL_OPENING_NOT_ELIGIBLE';
  end if;

  select * into v_set
  from public.ecoflow_unleashed_inventory_commissioning_sets
  where id=p_commissioning_id
  for update;

  select * into v_phys
  from public.ecoflow_physical_skus
  where id=v_set.physical_sku_id;

  if exists (
    select 1 from public.ecoflow_unleashed_inventory_provisional_reference_evidence
    where commissioning_id=p_commissioning_id
  ) then raise exception 'R5_007_PROVISIONAL_OPENING_ALREADY_EXISTS'; end if;

  if exists (
    select 1 from public.ecoflow_warehouse_location_items
    where upper(sku)=upper(v_phys.physical_sku_code)
      and quantity<>0
  ) then raise exception 'R5_007_EXISTING_WAREHOUSE_QUANTITY_BLOCKS_REFERENCE'; end if;

  if exists (
    select 1 from public.ecoflow_inventory_movements
    where upper(sku)=upper(v_phys.physical_sku_code)
  ) then raise exception 'R5_007_EXISTING_INVENTORY_MOVEMENT_BLOCKS_REFERENCE'; end if;

  v_result:=jsonb_build_object(
    'commissioningId',v_set.id,
    'sourceProductCode',v_phys.physical_sku_code,
    'sourceQtyOnHand',v_set.source_qty_on_hand,
    'plannedLocationCode',v_gate->>'plannedLocationCode',
    'provisionalReferenceRecorded',true,
    'inventoryMutationCreated',false,
    'operationalInventoryAuthorityCreated',false,
    'physicalCountClaimed',false,
    'requiresLaterPhysicalStocktake',true
  );

  insert into public.ecoflow_unleashed_inventory_provisional_reference_evidence(
    command_id,command_payload_sha256,commissioning_id,reference_batch_id,reference_row_id,
    source_run_id,source_set_sha256,source_row_sha256,source_product_code,physical_sku_id,
    package_id,operational_barcode,planned_location_id,planned_location_code,source_qty_on_hand,
    units_per_package,status,actor_user_id,actor_role,reason,result
  ) values (
    p_command_id,v_payload_hash,v_set.id,v_set.reference_batch_id,v_set.reference_row_id,
    v_set.source_run_id,v_set.source_set_sha256,v_set.source_row_sha256,v_phys.physical_sku_code,
    v_set.physical_sku_id,v_set.package_id,v_set.operational_barcode,
    (v_gate->>'plannedLocationId')::uuid,v_gate->>'plannedLocationCode',v_set.source_qty_on_hand,
    v_set.units_per_package,'PROVISIONAL_REFERENCE',auth.uid(),v_role,left(btrim(p_reason),2000),v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_record_provisional_inventory_reference(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_record_provisional_inventory_reference(uuid,uuid,text)
  to authenticated;

create or replace function public.ecoflow_mark_provisional_opening_reconciled()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.session_status is distinct from 'APPROVED' and new.session_status='APPROVED' then
    update public.ecoflow_unleashed_inventory_provisional_reference_evidence p
    set status='RECONCILED',
        reconciled_stocktake_session_id=new.id,
        reconciled_at=clock_timestamp()
    from public.ecoflow_unleashed_inventory_commissioning_sets c
    where c.stocktake_session_id=new.id
      and p.commissioning_id=c.id
      and p.status='PROVISIONAL_REFERENCE';
  end if;
  return new;
end;
$$;

revoke all on function public.ecoflow_mark_provisional_opening_reconciled()
  from public, anon, authenticated, service_role;

drop trigger if exists ecoflow_mark_provisional_opening_reconciled
  on public.ecoflow_stocktake_sessions;
create trigger ecoflow_mark_provisional_opening_reconciled
after update on public.ecoflow_stocktake_sessions
for each row execute function public.ecoflow_mark_provisional_opening_reconciled();

comment on table public.ecoflow_unleashed_inventory_provisional_reference_evidence is
  'R5-007 immutable planning/reference evidence only. It records frozen Unleashed QtyOnHand plus planned placement during relocation and creates no warehouse/inventory quantity.';
comment on function public.ecoflow_read_provisional_inventory_reference_gate(uuid) is
  'R5-007 read-only exact-scope gate for provisional reference planning evidence.';
comment on function public.ecoflow_record_provisional_inventory_reference(uuid,uuid,text) is
  'R5-007 bounded Owner/Admin recording of frozen Unleashed reference quantity plus planned location. No warehouse item, inventory movement, physical-count claim, stocktake approval or operational inventory authority is created.';
