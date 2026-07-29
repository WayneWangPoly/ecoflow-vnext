\set ON_ERROR_STOP on

begin;

do $initial_state$
begin
  if (select status from analytics.refresh_status
      where dataset_key='analytics.return_inspections')<>'NEVER' then
    raise exception 'return inspection refresh status was not seeded as NEVER';
  end if;
  if exists(select 1 from analytics.fact_return_inspection) then
    raise exception 'return inspection facts were populated automatically';
  end if;
  if has_table_privilege('anon','analytics.fact_return_inspection','SELECT')
     or has_table_privilege('authenticated','analytics.fact_return_inspection','SELECT')
     or has_table_privilege('service_role','analytics.fact_return_inspection','INSERT')
     or has_table_privilege('service_role','analytics.fact_return_inspection','UPDATE')
     or has_table_privilege('service_role','analytics.fact_return_inspection','DELETE') then
    raise exception 'return inspection fact ACL is not read-only/service-only';
  end if;
  if has_function_privilege(
       'authenticated','analytics.refresh_return_inspection_facts(timestamptz)','EXECUTE'
     ) or not has_function_privilege(
       'service_role','analytics.refresh_return_inspection_facts(timestamptz)','EXECUTE'
     ) then
    raise exception 'return inspection refresh execute ACL is incorrect';
  end if;
end;
$initial_state$;

insert into analytics.dim_physical_sku(
  source_system,source_physical_sku_key,physical_sku_code,product_name,
  primary_barcode,package_level,units_per_package,active,effective_from,is_current,
  recorded_by
) values(
  'ECOFLOW','SKU:RET-RESTOCK','RET-RESTOCK','Return Restock Product',
  'RET-BARCODE-1','carton',6,true,'2026-07-29 08:00:00+09:30',true,
  'return-inspection-contract'
);

insert into analytics.dim_commercial_sku(
  source_system,source_commercial_sku_key,commercial_sku_code,product_name,
  sales_unit,sales_unit_quantity,active,effective_from,is_current,recorded_by
) values(
  'ORDERMENTUM','SKU:RET-COMMERCIAL','RET-COMMERCIAL','Commercial-only Return',
  'CARTON',1,true,'2026-07-29 08:00:00+09:30',true,
  'return-inspection-contract'
);

insert into public.ecoflow_warehouse_locations(
  id,location_code,rack_id,rack_title,side,display_level,location_category,
  status,sort_order,created_at,updated_at
) values(
  'a1000000-0000-0000-0000-000000000001','RET-A1','RET-RACK','Returns Rack',
  'front','L1','RETURNS','ACTIVE',1,
  '2026-07-29 08:00:00+09:30','2026-07-29 08:00:00+09:30'
)
on conflict(id) do update set location_code=excluded.location_code;

insert into public.ecoflow_delivery_exceptions(
  id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,
  expected_cartons,delivered_cartons,return_cartons,reason,return_code,
  return_status,warehouse_location,recorded_by,recorded_at,driver_returned_at,
  updated_at
) values
(
  'b1000000-0000-0000-0000-000000000001','2026-07-29','return-order-1',
  'RET-ORDER-1',1,'RET-BOX-1','Return Store One','DAMAGED',2,0,2,
  'damaged goods','RET-CONTRACT-001','INSPECTION_HOLD','RETURNS-HOLD',
  'DRIVER:81000000-0000-0000-0000-000000000001',
  '2026-07-29 09:00:00+09:30','2026-07-29 10:00:00+09:30',
  '2026-07-29 10:00:00+09:30'
),
(
  'b1000000-0000-0000-0000-000000000002','2026-07-29','return-order-2',
  'RET-ORDER-2',2,'RET-BOX-2','Return Store Two','REFUSED',1,0,1,
  'customer refused','RET-CONTRACT-002','SUPPLIER_CLAIM','RETURNS-HOLD',
  'DRIVER:81000000-0000-0000-0000-000000000001',
  '2026-07-29 09:05:00+09:30','2026-07-29 10:05:00+09:30',
  '2026-07-29 11:00:00+09:30'
),
(
  'b1000000-0000-0000-0000-000000000003','2026-07-29','return-order-3',
  'RET-ORDER-3',3,'RET-BOX-3','Return Store Three','WRONG_GOODS',1,0,1,
  'wrong goods','RET-CONTRACT-003','DISPOSED','RETURNS-HOLD',
  'DRIVER:81000000-0000-0000-0000-000000000001',
  '2026-07-29 09:10:00+09:30','2026-07-29 10:10:00+09:30',
  '2026-07-29 11:10:00+09:30'
);

update public.ecoflow_delivery_exceptions
set inspection_completed_by='WAREHOUSE:82000000-0000-0000-0000-000000000001',
    inspection_completed_at='2026-07-29 11:00:00+09:30'
where id='b1000000-0000-0000-0000-000000000002';
update public.ecoflow_delivery_exceptions
set inspection_completed_by='WAREHOUSE:82000000-0000-0000-0000-000000000001',
    inspection_completed_at='2026-07-29 11:10:00+09:30'
where id='b1000000-0000-0000-0000-000000000003';

insert into public.ecoflow_inventory_movements(
  id,sku,product_name,movement_type,quantity,to_location,reference_type,
  reference_id,action_note,source,moved_by,moved_at
) values(
  'c1000000-0000-0000-0000-000000000001','RET-RESTOCK',
  'Return Restock Product','RETURN_IN',12,'RET-A1','DELIVERY_RETURN',
  'b1000000-0000-0000-0000-000000000001','contract restock',
  'RETURN_INSPECTION','82000000-0000-0000-0000-000000000001',
  '2026-07-29 10:30:00+09:30'
);

insert into public.ecoflow_delivery_return_inspection_lines(
  id,exception_id,resolution,barcode,sku,product_name,package_level,
  qty_packages,units_per_package,units_processed,target_location,movement_id,
  manual_item,inspection_note,inspected_by,inspected_at
) values
(
  'd1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001','RESTOCK','RET-BARCODE-1',
  'RET-RESTOCK','Return Restock Product','carton',2,6,12,'RET-A1',
  'c1000000-0000-0000-0000-000000000001',null,'must not enter analytics',
  'WAREHOUSE:82000000-0000-0000-0000-000000000001',
  '2026-07-29 10:30:00+09:30'
),
(
  'd1000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000002','SUPPLIER_CLAIM',null,
  null,null,null,1,1,1,null,null,'Unmapped returned carton',
  'must not enter analytics','Warehouse','2026-07-29 10:40:00+09:30'
),
(
  'd1000000-0000-0000-0000-000000000003',
  'b1000000-0000-0000-0000-000000000003','DISPOSE',null,
  null,null,null,2,3,5,null,null,'Loose damaged items',
  'must not enter analytics','WAREHOUSE:82000000-0000-0000-0000-000000000001',
  '2026-07-29 10:50:00+09:30'
);

set role service_role;
create temporary table pg_temp.return_fact_first_refresh as
select * from analytics.refresh_return_inspection_facts(
  '2026-07-29 12:00:00+09:30'
);
reset role;

do $first_refresh$
declare
  v_hash text;
begin
  if exists(
    select 1 from pg_temp.return_fact_first_refresh where refresh_state<>'CURRENT'
  ) then
    raise exception 'return inspection refresh failed: result=% status=%',
      (select jsonb_agg(to_jsonb(r)) from pg_temp.return_fact_first_refresh r),
      (select to_jsonb(s) from analytics.refresh_status s
       where dataset_key='analytics.return_inspections');
  end if;

  if (select count(*) from analytics.fact_return_inspection)<>3 then
    raise exception 'unexpected return inspection fact count';
  end if;

  if not exists(
    select 1 from analytics.fact_return_inspection
    where source_inspection_line_id='d1000000-0000-0000-0000-000000000001'
      and quality_status='TRUSTED'
      and sku_identity_status='PHYSICAL_RESOLVED'
      and restock_movement_status='LINKED_RETURN_IN'
      and location_resolution_status='RESOLVED'
      and quantity_basis_status='MAPPED_PACKAGE_TO_BASE'
      and base_units_processed=12
      and inspected_actor_role='WAREHOUSE'
      and inspected_actor_user_id='82000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'valid restock inspection was not projected as trusted';
  end if;

  if not exists(
    select 1 from analytics.fact_return_inspection
    where source_inspection_line_id='d1000000-0000-0000-0000-000000000002'
      and quality_status='DEGRADED'
      and sku_identity_status='UNRESOLVED_MANUAL_ITEM'
      and manual_item_present
      and base_units_processed is null
      and quantity_basis_status='MANUAL_NATIVE_QUANTITY'
      and restock_movement_status='NOT_APPLICABLE'
      and case_context_status='COMPLETED_CURRENT_CONTEXT'
  ) then
    raise exception 'manual supplier-claim line lost its explicit degraded state';
  end if;

  if not exists(
    select 1 from analytics.fact_return_inspection
    where source_inspection_line_id='d1000000-0000-0000-0000-000000000003'
      and quality_status='INVALID'
      and quality_detail='QUANTITY_ARITHMETIC_MISMATCH'
      and quantity_basis_status='INCONSISTENT_SOURCE'
  ) then
    raise exception 'invalid return quantity arithmetic was not quarantined';
  end if;

  if not exists(
    select 1 from analytics.dim_warehouse_location
    where source_system='ECOFLOW' and location_code='RET-A1' and is_current
  ) then
    raise exception 'first return refresh did not resolve location dimension';
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='analytics' and table_name='fact_return_inspection'
      and column_name in(
        'manual_item','inspection_note','reason','driver_note','store_email',
        'store_phone','pod2_path','latitude','longitude'
      )
  ) then
    raise exception 'free-text, contact, POD or coordinate field leaked into facts';
  end if;

  select source_row_hash into v_hash
  from analytics.fact_return_inspection
  where source_inspection_line_id='d1000000-0000-0000-0000-000000000001';
  create temporary table pg_temp.return_fact_hash(hash text);
  insert into pg_temp.return_fact_hash values(v_hash);
end;
$first_refresh$;

-- A transport-only source updated_at change is not a semantic fact change.
update public.ecoflow_delivery_exceptions
set updated_at='2026-07-29 12:05:00+09:30'
where id='b1000000-0000-0000-0000-000000000001';

set role service_role;
select * from analytics.refresh_return_inspection_facts(
  '2026-07-29 12:06:00+09:30'
);
reset role;

do $transport_only$
begin
  if (select source_row_hash from analytics.fact_return_inspection
      where source_inspection_line_id='d1000000-0000-0000-0000-000000000001')
     <>(select hash from pg_temp.return_fact_hash) then
    raise exception 'transport-only updated_at change altered business hash';
  end if;
  if (select count(*) from analytics.fact_return_inspection)<>3 then
    raise exception 'transport-only refresh duplicated facts';
  end if;
end;
$transport_only$;

-- Completion enriches current case context on the same immutable line.
update public.ecoflow_delivery_exceptions
set return_status='RESTOCKED',
    inspection_completed_by='WAREHOUSE:82000000-0000-0000-0000-000000000001',
    inspection_completed_at='2026-07-29 12:10:00+09:30'
where id='b1000000-0000-0000-0000-000000000001';

set role service_role;
select * from analytics.refresh_return_inspection_facts(
  '2026-07-29 12:11:00+09:30'
);
reset role;

do $completion_context$
begin
  if (select count(*) from analytics.fact_return_inspection)<>3 then
    raise exception 'case completion duplicated inspection facts';
  end if;
  if not exists(
    select 1 from analytics.fact_return_inspection
    where source_inspection_line_id='d1000000-0000-0000-0000-000000000001'
      and return_case_status_observed='RESTOCKED'
      and case_context_status='COMPLETED_CURRENT_CONTEXT'
      and inspection_completed_at_observed='2026-07-29 12:10:00+09:30'
      and first_observed_at='2026-07-29 12:00:00+09:30'
      and last_observed_at='2026-07-29 12:11:00+09:30'
  ) then
    raise exception 'case completion context was not enriched in place';
  end if;
  if (select status from analytics.refresh_status
      where dataset_key='analytics.return_inspections')<>'CURRENT' then
    raise exception 'return inspection refresh status is not CURRENT';
  end if;
end;
$completion_context$;

rollback;

\echo 'Return inspection fact contract passed.'
