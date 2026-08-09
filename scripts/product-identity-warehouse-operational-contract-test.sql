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

-- Unknown inbound goods remain auditable in TEMP without stock side effects.
-- Legacy registry evidence cannot make them mapped; canonical publication is the
-- only transition that permits conversion to a normal receiving line.
do $verify$
declare
  v_batch record;
  v_intake record;
  v_replay record;
  v_moves_before bigint;
  v_moves_after bigint;
  v_convert_blocked boolean:=false;
  v_published_blocked boolean:=false;
begin
  select * into v_batch from public.ecoflow_start_warehouse_receiving_batch('Supplier Unknown','PO-U',null,'unknown fixture');
  select count(*) into v_moves_before from public.ecoflow_inventory_movements;

  select * into v_intake from public.ecoflow_stage_unknown_barcode_intake(
    v_batch.batch_id,'LEGACY-FAKE-001',2,'hold physical goods','unknown:1',now()
  );
  if v_intake.intake_status<>'PENDING_MAPPING' or v_intake.target_location<>'TEMP' then
    raise exception 'canonical UNKNOWN barcode was not quarantined in TEMP';
  end if;

  select * into v_replay from public.ecoflow_stage_unknown_barcode_intake(
    v_batch.batch_id,'LEGACY-FAKE-001',2,'replay','unknown:1',now()
  );
  if v_replay.intake_id<>v_intake.intake_id then raise exception 'unknown quarantine replay duplicated intake'; end if;

  begin
    perform * from public.ecoflow_convert_unknown_barcode_intake(v_intake.intake_id);
  exception when others then
    if position('BARCODE_STILL_UNMAPPED' in sqlerrm)>0 then v_convert_blocked:=true; else raise; end if;
  end;
  if not v_convert_blocked then raise exception 'legacy registry allowed unknown intake conversion before canonical publication'; end if;

  begin
    perform * from public.ecoflow_stage_unknown_barcode_intake(
      v_batch.batch_id,'CANON-001',1,'already published','unknown:published',now()
    );
  exception when others then
    if position('BARCODE_NOW_MAPPED' in sqlerrm)>0 then v_published_blocked:=true; else raise; end if;
  end;
  if not v_published_blocked then raise exception 'published canonical barcode entered unknown quarantine'; end if;

  select count(*) into v_moves_after from public.ecoflow_inventory_movements;
  if v_moves_after<>v_moves_before then raise exception 'unknown quarantine or failed conversion changed inventory quantity'; end if;
  if exists(select 1 from public.ecoflow_warehouse_location_items where source_barcode='LEGACY-FAKE-001') then
    raise exception 'unknown quarantine changed live warehouse quantity';
  end if;
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

-- Receiving resolves canonical identity but remains a staged transaction: scan
-- and line confirmation are quantity-neutral; only explicit batch post creates
-- the RECEIVE ledger entry and warehouse-location quantity. Replay stays idempotent.
do $verify$
declare
  v_batch record;
  v_line record;
  v_replay record;
  v_confirm record;
  v_post record;
  v_replay_post record;
  v_moves_before bigint;
  v_moves_after_scan bigint;
  v_moves_after_confirm bigint;
  v_moves_after_post bigint;
  v_unknown_blocked boolean:=false;
  v_unconfirmed_blocked boolean:=false;
  v_stock numeric;
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

  select count(*) into v_moves_after_scan from public.ecoflow_inventory_movements;
  if v_moves_after_scan<>v_moves_before then raise exception 'receiving scan changed quantity before explicit post'; end if;
  if exists(select 1 from public.ecoflow_warehouse_location_items where sku='CUP-12W') then
    raise exception 'receiving scan changed warehouse-location quantity before explicit post';
  end if;

  begin
    perform * from public.ecoflow_complete_warehouse_receiving_batch(v_batch.batch_id,'must require confirmation');
  exception when others then
    if position('all scanned receiving lines must be confirmed before completion' in sqlerrm)>0 then
      v_unconfirmed_blocked:=true;
    else raise;
    end if;
  end;
  if not v_unconfirmed_blocked then raise exception 'receiving posted an unconfirmed line'; end if;

  select * into v_confirm from public.ecoflow_confirm_warehouse_receiving_line(v_line.line_id,true,'count verified');
  if not v_confirm.confirmation_checked or v_confirm.line_status<>'CONFIRMED' then
    raise exception 'receiving confirmation did not reach CONFIRMED';
  end if;
  select count(*) into v_moves_after_confirm from public.ecoflow_inventory_movements;
  if v_moves_after_confirm<>v_moves_before then raise exception 'line confirmation changed quantity before explicit batch post'; end if;

  select * into v_post from public.ecoflow_complete_warehouse_receiving_batch(v_batch.batch_id,'explicit post');
  if v_post.batch_status<>'POSTED' or v_post.posted_lines<>1 or v_post.posted_units<>2000 then
    raise exception 'explicit receiving post returned wrong result';
  end if;
  select count(*) into v_moves_after_post from public.ecoflow_inventory_movements;
  if v_moves_after_post<>v_moves_before+1 then raise exception 'explicit receiving post did not create exactly one quantity movement'; end if;
  if not exists(
    select 1 from public.ecoflow_inventory_movements
    where reference_type='WAREHOUSE_RECEIVING_LINE' and reference_id=v_line.line_id::text
      and sku='CUP-12W' and movement_type='RECEIVE' and quantity=2000
      and source='WAREHOUSE_RECEIVING_BATCH'
  ) then raise exception 'receiving post movement lost canonical operational SKU/quantity/source'; end if;
  select quantity into v_stock from public.ecoflow_warehouse_location_items i
  join public.ecoflow_warehouse_locations l on l.id=i.location_id
  where i.sku='CUP-12W' and i.unit_level='carton' and l.location_code='A1';
  if v_stock<>2000 then raise exception 'receiving post warehouse quantity expected 2000, got %',v_stock; end if;

  select * into v_replay_post from public.ecoflow_complete_warehouse_receiving_batch(v_batch.batch_id,'post replay');
  if v_replay_post.batch_status<>'POSTED' or v_replay_post.posted_lines<>1 or v_replay_post.posted_units<>2000 then
    raise exception 'receiving post replay changed posted result';
  end if;
  if (select count(*) from public.ecoflow_inventory_movements where reference_type='WAREHOUSE_RECEIVING_LINE' and reference_id=v_line.line_id::text)<>1 then
    raise exception 'receiving post replay duplicated quantity movement';
  end if;
end;
$verify$;

-- Pick must validate barcode/family before the pre-existing stock mutation runs.
insert into public.ecoflow_warehouse_location_items(location_id,sku,product_name,source_barcode,unit_level,quantity,status)
select id,'CUP-12W','12oz White Cup','LEGACY-FAKE-001','carton',5,'ACTIVE'
from public.ecoflow_warehouse_locations where location_code='A1'
on conflict(location_id,sku,unit_level) do update set
  quantity=excluded.quantity,source_barcode=excluded.source_barcode,status='ACTIVE',updated_at=now();

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

-- Retirement is final: operational loops and quarantine must all fail closed on
-- the same barcode.
do $verify$
declare
  v_revision bigint;
  v_result record;
  v_scan_blocked boolean:=false;
  v_pick_blocked boolean:=false;
  v_quarantine_blocked boolean:=false;
  v_batch record;
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

  select * into v_batch from public.ecoflow_start_warehouse_receiving_batch('Supplier retired','PO-R',null,'retired fixture');
  begin
    perform * from public.ecoflow_stage_unknown_barcode_intake(v_batch.batch_id,'CANON-001',1,'retired','retired:1',now());
  exception when others then if position('BARCODE_RETIRED' in sqlerrm)>0 then v_quarantine_blocked:=true; else raise; end if; end;

  if not v_scan_blocked or not v_pick_blocked or not v_quarantine_blocked then
    raise exception 'retired barcode remained operational';
  end if;
end;
$verify$;

-- Private pre-canonical mutation primitive must not be executable by API client
-- roles. Function owners retain EXECUTE by design; effective privilege is what
-- matters for authenticated/anon callers.
do $verify$
declare
  v_proc regprocedure:='public.ecoflow_record_pick_movement_precanonical_20260809(text,numeric,text,text,text)'::regprocedure;
begin
  if has_function_privilege('authenticated',v_proc,'EXECUTE') then
    raise exception 'pre-canonical pick primitive is executable by authenticated';
  end if;
  if has_function_privilege('anon',v_proc,'EXECUTE') then
    raise exception 'pre-canonical pick primitive is executable by anon';
  end if;
end;
$verify$;

reset app.test_role;