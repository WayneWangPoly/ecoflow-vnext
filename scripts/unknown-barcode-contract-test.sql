\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);

DO $$
declare
  v_batch uuid;
  v_intake uuid;
  v_retry uuid;
  v_line uuid;
  v_blocked boolean := false;
  v_count integer;
begin
  select started.batch_id into v_batch
  from public.ecoflow_start_warehouse_receiving_batch('New supplier','PO-UNKNOWN',null,'unknown code contract') started limit 1;

  select q.intake_id into v_intake
  from public.ecoflow_stage_unknown_barcode_intake(v_batch,'939999999999',2,'unidentified cartons','unknown-request-1',now()) q limit 1;
  select q.intake_id into v_retry
  from public.ecoflow_stage_unknown_barcode_intake(v_batch,'939999999999',2,'retry','unknown-request-1',now()) q limit 1;
  if v_intake is null or v_retry<>v_intake then raise exception 'unknown intake retry was not idempotent'; end if;

  select count(*) into v_count from public.ecoflow_unknown_barcode_intakes i where i.batch_id=v_batch;
  if v_count<>1 then raise exception 'unknown intake duplicated: %',v_count; end if;
  if exists(select 1 from public.ecoflow_inventory_movements m where m.reference_id=v_intake::text) then
    raise exception 'unknown intake changed inventory before mapping';
  end if;

  begin
    perform * from public.ecoflow_complete_warehouse_receiving_batch(v_batch,'must block');
  exception when others then
    if position('UNRESOLVED_UNKNOWN_BARCODES' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'batch posted with unresolved unknown barcode'; end if;

  insert into public.ecoflow_sku_barcode_registry(
    sku,barcode,package_level,units_per_barcode,product_name,fixed_shelf,verified,is_active,valid_from
  ) values ('NEW-CUP','939999999999','CARTON',25,'New cup','TEMP',true,true,now())
  on conflict(barcode) do update set sku=excluded.sku,package_level=excluded.package_level,
    units_per_barcode=excluded.units_per_barcode,verified=true,is_active=true,fixed_shelf='TEMP';

  select c.converted_line_id into v_line from public.ecoflow_convert_unknown_barcode_intake(v_intake) c limit 1;
  if v_line is null then raise exception 'mapped unknown intake did not convert'; end if;
  if not exists(select 1 from public.ecoflow_unknown_barcode_intakes i where i.id=v_intake and i.intake_status='CONVERTED') then
    raise exception 'unknown intake status was not converted';
  end if;
  perform * from public.ecoflow_confirm_warehouse_receiving_line(v_line,true,'verified after mapping');
  perform * from public.ecoflow_complete_warehouse_receiving_batch(v_batch,'converted and posted');
  if not exists(select 1 from public.ecoflow_inventory_movements m where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line::text and m.quantity=50) then
    raise exception 'converted unknown intake did not post exactly 50 units';
  end if;
end $$;

select 'unknown barcode quarantine contract passed' as result;
