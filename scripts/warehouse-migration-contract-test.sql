\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);

insert into auth.users(id,email)
values ('11111111-1111-1111-1111-111111111111','owner@example.test')
on conflict (id) do nothing;
insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values ('11111111-1111-1111-1111-111111111111','OWNER',true,'ACTIVE')
on conflict (user_id) do update set app_role='OWNER',is_active=true,team_status='ACTIVE';

insert into public.fixture_sku_velocity(sku,product_name,units_30d)
values ('CUP-12W','12 oz white cup',100)
on conflict (sku) do update set product_name=excluded.product_name,units_30d=excluded.units_30d;

insert into public.ecoflow_warehouse_locations(location_code,rack_id,rack_title,side,display_level,sort_order)
values
  ('TEMP','TEMP','Temporary holding area','front','Temporary holding area',900),
  ('A1-L-01-01A','A1','A1','left','Bottom',10)
on conflict (location_code) do nothing;

insert into public.ecoflow_sku_package_policies(sku,package_mode,default_shelf,policy_note,updated_by)
values ('CUP-12W','CARTON_AND_SLEEVE','A1-L-01-01A','CI contract','11111111-1111-1111-1111-111111111111')
on conflict (sku) do update set package_mode=excluded.package_mode,default_shelf=excluded.default_shelf;

select * from public.ecoflow_record_barcode_scan(
  null,'CUP-12W','930000000001','CARTON',20,'12 oz white cup','A1-L-01-01A',1,'MAP_ONLY','initial carton code'
);

DO $$
declare
  v_batch uuid;
  v_line uuid;
  v_retry_line uuid;
  v_second_batch uuid;
  v_count integer;
  v_quantity numeric;
  v_version integer;
  v_blocked boolean;
begin
  select started.batch_id into v_batch
  from public.ecoflow_start_warehouse_receiving_batch('Supplier','PO-1','INV-1','CI receiving') started
  limit 1;

  select scanned.line_id into v_line
  from public.ecoflow_stage_receiving_scan_v2(
    v_batch,'930000000001',2,null,'two cartons','scan-request-001',now()
  ) scanned
  limit 1;

  select scanned.line_id into v_retry_line
  from public.ecoflow_stage_receiving_scan_v2(
    v_batch,'930000000001',2,null,'two cartons','scan-request-001',now()
  ) scanned
  limit 1;

  if v_line is null or v_retry_line <> v_line then
    raise exception 'idempotent retry did not return the original receiving line';
  end if;
  select count(*) into v_count
  from public.ecoflow_warehouse_receiving_lines l
  where l.batch_id=v_batch and l.idempotency_key='scan-request-001';
  if v_count <> 1 then raise exception 'duplicate receiving line created: %',v_count; end if;

  perform * from public.ecoflow_confirm_warehouse_receiving_line(v_line,true,'verified carton count');
  perform * from public.ecoflow_complete_warehouse_receiving_batch(v_batch,'post once');

  select count(*) into v_count
  from public.ecoflow_inventory_movements m
  where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line::text;
  if v_count <> 1 then raise exception 'inventory ledger movement count %, expected 1',v_count; end if;

  select m.quantity into v_quantity
  from public.ecoflow_inventory_movements m
  where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line::text;
  if v_quantity <> 40 then raise exception 'base-unit inventory ledger %, expected 40',v_quantity; end if;

  select li.quantity into v_quantity
  from public.ecoflow_warehouse_location_items li
  join public.ecoflow_warehouse_locations wl on wl.id=li.location_id
  where wl.location_code='A1-L-01-01A' and li.sku='CUP-12W' and li.unit_level='carton';
  if v_quantity <> 2 then raise exception 'carton location balance %, expected 2',v_quantity; end if;

  select wm.quantity into v_quantity
  from public.ecoflow_warehouse_movements wm
  where wm.reference_type='WAREHOUSE_RECEIVING_LINE' and wm.reference_id=v_line::text;
  if v_quantity <> 2 then raise exception 'carton warehouse movement %, expected 2',v_quantity; end if;

  if not exists(
    select 1 from public.v_ecoflow_stocktake_uom_integrity i
    where i.receiving_line_id=v_line and i.integrity_status='MATCHED'
  ) then raise exception 'receiving UOM integrity did not report MATCHED'; end if;

  perform * from public.ecoflow_complete_warehouse_receiving_batch(v_batch,'safe retry');
  select count(*) into v_count
  from public.ecoflow_inventory_movements m
  where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line::text;
  if v_count <> 1 then raise exception 'completion retry duplicated inventory movement'; end if;

  v_blocked := false;
  begin
    perform * from public.ecoflow_receive_by_barcode('930000000001',1,'A1-L-01-01A','forbidden');
  exception when others then
    if position('DIRECT_RECEIVE_DISABLED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'legacy receive_by_barcode was not blocked'; end if;

  v_blocked := false;
  begin
    insert into public.ecoflow_inventory_movements(
      sku,product_name,movement_type,quantity,to_location,source,moved_by
    ) values ('CUP-12W','12 oz white cup','RECEIVE',1,'TEMP','INVENTORY_CONTROL',auth.uid());
  exception when others then
    if position('DIRECT_RECEIVE_DISABLED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'uncontrolled RECEIVE ledger insert was not blocked'; end if;

  select saved.layout_version into v_version
  from public.ecoflow_save_warehouse_layout(
    'SITE-01','{"rack:a1":{"left":"10%","top":"8%","width":"12%","height":"50%"}}'::jsonb,null
  ) saved;
  if v_version <> 1 then raise exception 'first layout version %, expected 1',v_version; end if;

  select saved.layout_version into v_version
  from public.ecoflow_save_warehouse_layout(
    'SITE-01','{"rack:a1":{"left":"11%","top":"8%","width":"12%","height":"50%"}}'::jsonb,1
  ) saved;
  if v_version <> 2 then raise exception 'second layout version %, expected 2',v_version; end if;

  v_blocked := false;
  begin
    perform * from public.ecoflow_save_warehouse_layout('SITE-01','{}'::jsonb,1);
  exception when others then
    if position('LAYOUT_VERSION_CONFLICT' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'stale warehouse layout save was not rejected'; end if;

  perform * from public.ecoflow_retire_barcode_mapping('930000000001','supplier changed packaging',null);
  if exists(select 1 from public.ecoflow_sku_barcode_registry r where r.barcode='930000000001' and r.is_active) then
    raise exception 'retired barcode remained active';
  end if;

  select started.batch_id into v_second_batch
  from public.ecoflow_start_warehouse_receiving_batch('Supplier','PO-2','INV-2','cancel test') started
  limit 1;

  v_blocked := false;
  begin
    perform * from public.ecoflow_stage_receiving_scan_v2(
      v_second_batch,'930000000001',1,null,'retired code','scan-request-retired',now()
    );
  exception when others then
    if position('BARCODE_RETIRED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'retired barcode was accepted by receiving'; end if;

  perform * from public.ecoflow_cancel_warehouse_receiving_batch(v_second_batch,'delivery cancelled before unloading');
  if not exists(
    select 1 from public.ecoflow_warehouse_receiving_audit a
    where a.batch_id=v_second_batch and a.action='BATCH_CANCELLED'
  ) then raise exception 'batch cancellation audit was not written'; end if;
end;
$$;

select 'warehouse migration contract passed' as result;
