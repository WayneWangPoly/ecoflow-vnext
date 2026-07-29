\set ON_ERROR_STOP on

begin;

insert into public.ecoflow_delivery_exceptions(
  id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,
  expected_cartons,delivered_cartons,return_cartons,reason,return_code,
  return_status,warehouse_location,recorded_by,recorded_at,
  inspection_completed_by,inspection_completed_at,updated_at
) values(
  'b2000000-0000-0000-0000-000000000001','2026-07-29','',
  'RET-DRIFT-ORDER',4,'RET-DRIFT-BOX','Drift Return Store','REFUSED',
  1,0,1,'legacy blank order key','RET-DRIFT-001','SUPPLIER_CLAIM',
  'RETURNS-HOLD','DRIVER:81000000-0000-0000-0000-000000000001',
  '2026-07-29 09:20:00+09:30',
  'WAREHOUSE:82000000-0000-0000-0000-000000000001',
  '2026-07-29 10:20:00+09:30','2026-07-29 10:20:00+09:30'
);

insert into public.ecoflow_delivery_return_inspection_lines(
  id,exception_id,resolution,barcode,sku,product_name,package_level,
  qty_packages,units_per_package,units_processed,target_location,movement_id,
  manual_item,inspection_note,inspected_by,inspected_at
) values(
  'd2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001','SUPPLIER_CLAIM',null,null,null,null,
  1,1,1,null,null,'Legacy return item','must not enter analytics',
  'WAREHOUSE:82000000-0000-0000-0000-000000000001',
  '2026-07-29 10:10:00+09:30'
);

set role service_role;
create temporary table pg_temp.return_drift_refresh as
select * from analytics.refresh_return_inspection_facts(
  '2026-07-29 12:20:00+09:30'
);
reset role;

do $drift_capture$
begin
  if exists(
    select 1 from pg_temp.return_drift_refresh where refresh_state<>'CURRENT'
  ) then
    raise exception 'blank source order key aborted return refresh: result=% status=%',
      (select jsonb_agg(to_jsonb(r)) from pg_temp.return_drift_refresh r),
      (select to_jsonb(s) from analytics.refresh_status s
       where dataset_key='analytics.return_inspections');
  end if;

  if not exists(
    select 1
    from analytics.fact_return_inspection
    where source_inspection_line_id='d2000000-0000-0000-0000-000000000001'
      and coalesce(source_order_id,'')=''
      and quality_status='INVALID'
      and quality_detail='SOURCE_ORDER_ID_MISSING'
      and history_completeness='IMMUTABLE_LINE_CURRENT_CASE_CONTEXT'
  ) then
    raise exception 'blank source order key was not retained as explicit INVALID quality';
  end if;

  if (select count(*) from analytics.fact_return_inspection)<>1 then
    raise exception 'source drift contract created an unexpected fact count';
  end if;
end;
$drift_capture$;

rollback;

\echo 'Return inspection source-drift contract passed.'
