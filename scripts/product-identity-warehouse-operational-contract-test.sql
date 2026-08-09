\set ON_ERROR_STOP on

set app.test_role='OWNER';

-- Publish one canonical physical barcode for the existing Commercial SKU.
do $setup$
declare
  v_batch record;
  v_capture record;
  v_revision bigint;
  v_submit record;
  v_publish record;
begin
  select * into v_batch from public.ecoflow_start_product_identity_batch(
    'Operational authority fixture','00000000-0000-4000-8000-000000000101'::uuid
  );
  select * into v_capture from public.ecoflow_capture_product_identity(
    v_batch.batch_id,
    '00000000-0000-4000-8000-000000000102'::uuid,
    'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
    'PHY-CUP-12-GREEN','12oz White Cup GreenPack','GreenPack','Supplier A',
    'FAM-CUP-12','12oz Compatible Cups','CANON-001','CARTON',1000,
    'ALLOWED',true,'operational fixture'
  );
  if v_capture.capture_status<>'DRAFTED' then raise exception 'canonical capture failed: %',v_capture.capture_status; end if;
  select revision into v_revision from public.ecoflow_product_identity_batches where id=v_batch.batch_id;
  select * into v_submit from public.ecoflow_submit_product_identity_batch(
    v_batch.batch_id,v_revision,'00000000-0000-4000-8000-000000000103'::uuid,'submit'
  );
  if v_submit.command_status<>'APPLIED' then raise exception 'canonical submit failed'; end if;
  select revision into v_revision from public.ecoflow_product_identity_batches where id=v_batch.batch_id;
  select * into v_publish from public.ecoflow_publish_product_identity_batch(
    v_batch.batch_id,v_revision,'00000000-0000-4000-8000-000000000104'::uuid,'publish'
  );
  if v_publish.command_status<>'APPLIED' or v_publish.published_barcodes<>1 then raise exception 'canonical publish failed'; end if;
end;
$setup$;

-- Canonical resolver wins over legacy evidence and accepts either internal or
-- active Ordermentum Commercial SKU context.
do $verify$
declare
  v_ok record;
  v_external record;
  v_legacy record;
begin
  select * into v_ok from public.ecoflow_resolve_operational_barcode('CANON-001','COM-CUP-12');
  if v_ok.resolution_status<>'RESOLVED' or v_ok.physical_sku_code<>'PHY-CUP-12-GREEN' then
    raise exception 'internal Commercial SKU context did not resolve';
  end if;
  select * into v_external from public.ecoflow_resolve_operational_barcode('CANON-001','CUP-12W');
  if v_external.resolution_status<>'RESOLVED' then raise exception 'Ordermentum SKU context did not resolve'; end if;
  select * into v_legacy from public.ecoflow_resolve_operational_barcode('LEGACY-FAKE-001','CUP-12W');
  if v_legacy.resolution_status<>'UNKNOWN' then raise exception 'legacy registry became operational authority'; end if;
end;
$verify$;

-- Stocktake-compatible MAP_AND_COUNT is evidence-only. It cannot commission a
-- new barcode, rewrite primary_barcode, or change quantity.
do $verify$
declare
  v_registry_before bigint;
  v_registry_after bigint;
  v_moves_before bigint;
  v_moves_after bigint;
  v_event record;
  v_blocked boolean:=false;
begin
  select count(*) into v_registry_before from public.ecoflow_sku_barcode_registry;
  select count(*) into v_moves_before from public.ecoflow_inventory_movements;

  begin
    perform * from public.ecoflow_record_barcode_scan(
      null,'CUP-12W','LEGACY-FAKE-001','CARTON',999,'fake','A1',2,'MAP_AND_COUNT','must fail'
    );
  exception when others then
    if position('CANONICAL_BARCODE_UNKNOWN' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'legacy-only barcode was accepted by stocktake scan'; end if;

  select * into v_event from public.ecoflow_record_barcode_scan(
    null,'CUP-12W','CANON-001','CARTON',1000,'ignored','A1',3,'MAP_AND_COUNT','count observation'
  );
  if v_event.scan_status<>'CANONICAL_VALIDATED_COUNT_OBSERVED' or v_event.movement_id is not null then
    raise exception 'canonical stocktake scan did not stay evidence-only';
  end if;

  select count(*) into v_registry_after from public.ecoflow_sku_barcode_registry;
  select count(*) into v_moves_after from public.ecoflow_inventory_movements;
  if v_registry_after<>v_registry_before then raise exception 'stocktake scan mutated legacy barcode registry'; end if;
  if v_moves_after<>v_moves_before then raise exception 'stocktake scan mutated inventory quantity ledger'; end if;
  if exists(select 1 from public.ecoflow_inventory_sku_controls where primary_barcode is not null) then
    raise exception 'stocktake scan silently wrote primary_barcode';
  end if;
end;
$verify$;

-- Receiving scan resolves canonical identity, preserves the existing operational
-- Ordermentum SKU namespace, is idempotent, and stages zero quantity side effect.
do $verify$
declare
  v_batch record;
  v_line record;
  v_replay record;
  v_moves_before bigint;
  v_moves_after bigint;
  v_unknown_blocked boolean:=false;
begin
  select * into v_batch from public.ecoflow_start_warehouse_receiving_batch('Supplier A','PO-1',null,'fixture');
  select count(*) into v_moves_before from public.ecoflow_inventory_movements;

  select * into v_line from public.ecoflow_stage_receiving_scan_v2(
    v_batch.batch_id,'CANON-001',2,'A1','canonical receiving','receive:1',now()
  );
  if v_line.sku<>'CUP-12W' then
    raise exception 'receiving changed operational SKU namespace: expected CUP-12W, got %',v_line.sku;
  end if;
  if v_line.package_level<>'CARTON' or v_line.units_received<>2000 then
    raise exception 'receiving did not derive canonical package conversion';
  end if;

  select * into v_replay from public.ecoflow_stage_receiving_scan_v2(
    v_batch.batch_id,'CANON-001',2,'A1','replay','receive:1',now()
  );
  if v_replay.line_id<>v_line.line_id then raise exception 'receiving idempotency replay created a second line'; end if;

  begin
    perform * from public.ecoflow_stage_receiving_scan_v2(
      v_batch.batch_id,'LEGACY-FAKE-001',1,'A1','legacy must fail','receive:legacy',now()
    );
  exception when others then
    if position('CANONICAL_BARCODE_UNKNOWN' in sqlerrm)>0 then v_unknown_blocked:=true; else raise; end if;
  end;
  if not v_unknown_blocked then raise exception 'receiving accepted legacy-only barcode'; end if;

  select count(*) into v_moves_after from public.ecoflow_inventory_movements;
  if v_moves_after<>v_moves_before then raise exception 'receiving scan changed quantity before explicit post'; end if;
end;
$verify$;

-- Pick must validate barcode/family before the pre-existing stock mutation runs.
insert into public.ecoflow_warehouse_location_items(location_id,sku,product_name,source_barcode,unit_level,quantity,status)
select id,'CUP-12W','12oz White Cup','LEGACY-FAKE-001','carton',5,'ACTIVE'
from public.ecoflow_warehouse_locations where location_code='A1';

do $verify$
declare
  v_before numeric;
  v_after numeric;
  v_blocked boolean:=false;
  v_pick record;
begin
  select quantity into v_before from public.ecoflow_warehouse_location_items where sku='CUP-12W' and unit_level='carton';
  begin
    perform * from public.ecoflow_record_pick_movement('CUP-12W',1,'carton','LEGACY-FAKE-001','must fail');
  exception when others then
    if position('CANONICAL_BARCODE_UNKNOWN' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'pick accepted legacy-only barcode'; end if;
  select quantity into v_after from public.ecoflow_warehouse_location_items where sku='CUP-12W' and unit_level='carton';
  if v_after<>v_before then raise exception 'failed pick changed stock'; end if;

  select * into v_pick from public.ecoflow_record_pick_movement('CUP-12W',1,'carton','CANON-001','canonical pick');
  if v_pick.picked_quantity<>1 then raise exception 'canonical pick did not execute quantity mutation'; end if;
  select quantity into v_after from public.ecoflow_warehouse_location_items where sku='CUP-12W' and unit_level='carton';
  if v_after<>v_before-1 then raise exception 'canonical pick quantity delta wrong'; end if;
end;
$verify$;

-- Returns: only explicit RESTOCK changes quantity; canonical conversion controls
-- the units. Legacy-only barcode must fail before movement creation.
insert into public.ecoflow_delivery_exceptions(id,return_code,return_status,store_name,order_number,warehouse_location)
values('bbbbbbbb-0000-4000-8000-000000000001','RET-001','DROPPED_IN_RETURN_ZONE','Fixture Store','ORD-1','RETURNS-HOLD');

do $verify$
declare
  v_before bigint;
  v_after bigint;
  v_line record;
  v_blocked boolean:=false;
begin
  select count(*) into v_before from public.ecoflow_inventory_movements;
  begin
    perform * from public.ecoflow_record_return_inspection_item(
      'bbbbbbbb-0000-4000-8000-000000000001','RESTOCK','LEGACY-FAKE-001',1,'A1',null,'must fail','Warehouse'
    );
  exception when others then
    if position('CANONICAL_BARCODE_UNKNOWN' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'return restock accepted legacy-only barcode'; end if;
  select count(*) into v_after from public.ecoflow_inventory_movements;
  if v_after<>v_before then raise exception 'failed return restock changed quantity'; end if;

  select * into v_line from public.ecoflow_record_return_inspection_item(
    'bbbbbbbb-0000-4000-8000-000000000001','RESTOCK','CANON-001',2,'A1',null,'sellable','Warehouse'
  );
  if v_line.units_processed<>2000 or v_line.movement_id is null then raise exception 'canonical return did not use published package units'; end if;
  if not exists(
    select 1 from public.ecoflow_inventory_movements
    where id=v_line.movement_id and sku='CUP-12W' and movement_type='RETURN_IN' and quantity=2000
  ) then raise exception 'return changed operational SKU namespace or quantity'; end if;
end;
$verify$;

-- Retirement is final: operational loops must all fail closed on the same barcode.
do $verify$
declare
  v_revision bigint;
  v_result record;
  v_scan_blocked boolean:=false;
  v_pick_blocked boolean:=false;
begin
  select revision into v_revision from public.ecoflow_physical_barcode_bindings
  where barcode='CANON-001' and identity_status='ACTIVE';
  perform * from public.ecoflow_retire_product_identity_barcode('CANON-001','fixture retirement',v_revision);
  select * into v_result from public.ecoflow_resolve_operational_barcode('CANON-001','CUP-12W');
  if v_result.resolution_status<>'RETIRED' then raise exception 'retired barcode did not fail closed in operational resolver'; end if;

  begin
    perform * from public.ecoflow_record_barcode_scan(null,'CUP-12W','CANON-001','CARTON',1000,null,'A1',1,'MAP_AND_COUNT',null);
  exception when others then if position('BARCODE_RETIRED' in sqlerrm)>0 then v_scan_blocked:=true; else raise; end if; end;
  begin
    perform * from public.ecoflow_record_pick_movement('CUP-12W',1,'carton','CANON-001','retired must fail');
  exception when others then if position('BARCODE_RETIRED' in sqlerrm)>0 then v_pick_blocked:=true; else raise; end if; end;
  if not v_scan_blocked or not v_pick_blocked then raise exception 'retired barcode remained operational'; end if;
end;
$verify$;

-- Private pre-canonical mutation primitive must not be executable by clients.
do $verify$
declare v_acl text;
begin
  select coalesce(array_to_string(proacl,','),'') into v_acl
  from pg_proc where oid='public.ecoflow_record_pick_movement_precanonical_20260809(text,numeric,text,text,text)'::regprocedure;
  if v_acl like '%authenticated=X%' or v_acl like '%=X%' then
    raise exception 'pre-canonical pick primitive remains client-executable: %',v_acl;
  end if;
end;
$verify$;

reset app.test_role;
