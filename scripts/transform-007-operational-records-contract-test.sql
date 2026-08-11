\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

insert into public.app_user_profiles(user_id,app_role) values
  ('11111111-1111-4111-8111-111111111111','OWNER'),
  ('22222222-2222-4222-8222-222222222222','ACCOUNT'),
  ('33333333-3333-4333-8333-333333333333','VIEWER');

insert into public.v_ecoflow_inventory_kpis values(12,1,1,45,clock_timestamp());
insert into public.v_ecoflow_inventory_sku_control(
  sku,product_name,category,reorder_target,units_7d,units_30d,revenue_30d,
  order_count_30d,last_sold_at,inventory_signal,action_hint,inventory_rank,
  primary_barcode,control_status,latest_movement_at,stock_source,effective_on_hand
)
select
  'SKU-'||g,'Product '||g,'Cups',10,g,g*2,g*20,g,
  clock_timestamp()-(g||' hours')::interval,
  case when g=2 then 'BELOW_TARGET' when g=3 then 'NEGATIVE_STOCK' else 'CONTROLLED' end,
  'Review stock',g,'BC-'||g,'ACTIVE',clock_timestamp(),'LIVE_LEDGER',g*3
from generate_series(1,12) g;

insert into public.ecoflow_warehouse_locations values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','A1-01','A1','MAIN','BIN','ACTIVE',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','A1-02','A1','MAIN','BIN','ACTIVE',2);
insert into public.ecoflow_warehouse_location_items values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','SKU-1','Product 1','CARTON',20,'BC-1',clock_timestamp(),'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','SKU-1','Product 1','CARTON',5,'BC-1',clock_timestamp(),'ACTIVE');
insert into public.ecoflow_warehouse_movements values(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1','RECEIVE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'SKU-1','Product 1','BC-1','CARTON',20,'RCV-1','Received','11111111-1111-4111-8111-111111111111',clock_timestamp()
);
insert into public.ecoflow_inventory_movements values(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1','SKU-1','Product 1','RETURN_IN',2,null,'A1-01','DELIVERY_RETURN','RET-CLOSED','Restocked',
  '11111111-1111-4111-8111-111111111111',clock_timestamp()
);
insert into public.ecoflow_stocktake_sessions values(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','CYCLE_COUNT','REVIEW','A1 cycle count','A1',true,3,
  clock_timestamp(),clock_timestamp(),null,clock_timestamp()
);
insert into public.ecoflow_stocktake_location_progress values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','A1-01');
insert into public.ecoflow_stocktake_observations values(
  'ffffffff-ffff-4fff-8fff-fffffffffff1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',array['COUNT_VARIANCE'],'RECOUNT_REQUIRED'
);

insert into public.skus values('10000000-0000-4000-8000-000000000001','SKU-1','Product 1');
insert into public.external_product_mappings values(
  '10000000-0000-4000-8000-000000000002','ORDERMENTUM','SKU-1','10000000-0000-4000-8000-000000000001',true
);
insert into public.ecoflow_sku_families values('10000000-0000-4000-8000-000000000003','FAM-CUP','Cup family','ACTIVE');
insert into public.ecoflow_physical_skus values(
  '10000000-0000-4000-8000-000000000004','PHY-CUP-A','Physical Cup A','Eco','Supplier','MFG-A',
  '10000000-0000-4000-8000-000000000003','ACTIVE',2
);
insert into public.ecoflow_commercial_family_links values(
  '10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','ALLOWED','ACTIVE'
);
insert into public.ecoflow_physical_sku_packages values(
  '10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','CARTON',20,'ACTIVE',1
);
insert into public.ecoflow_physical_barcode_bindings values(
  '10000000-0000-4000-8000-000000000007','BC-1','10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000006','ACTIVE','WAREHOUSE_COMMISSIONING',1,clock_timestamp()
);
insert into public.ecoflow_product_identity_tasks values(
  '10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001',
  'COMMERCIAL_SKU_MAPPING','CONFLICT',true,null,'Identity conflict remains visible',clock_timestamp()
);

insert into public.v_ecoflow_customer_store_directory(
  store_id,purchaser_id,store_name,suburb,state,address,contact_phone,price_group_id,
  verified,store_signal,orders_30d,revenue_30d,units_30d,top_sku_30d,top_product_30d,last_order_at,site_updated_at
)
select
  'STORE-'||g,'PURCH-'||g,'Store '||g,'Adelaide','SA',g||' Test Street','08000000'||g,'TIER-A',
  true,case when g=2 then 'NEEDS_ADDRESS' else 'READY' end,g,g*100,g*3,'SKU-1','Product 1',
  clock_timestamp()-(g||' days')::interval,clock_timestamp()
from generate_series(1,12) g;

insert into public.v_ecoflow_accounts_live_ar_kpis values(500,250,1,1,2,1,1,clock_timestamp());
insert into public.v_ecoflow_accounts_live_statement_customers values(
  'STORE-1','Store 1',2,2,1,500,250,35,'OVERDUE_ATTENTION','URGENT_COLLECTION',
  'billing@example.test','Billing Contact',true
);
insert into public.ecoflow_account_release_holds values(
  'STORE-1',true,'Overdue balance requires review','20000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',clock_timestamp()
);
insert into public.v_ecoflow_accounts_live_statement_lines values(
  'STORE-1','Store 1','INT-1','ORD-1','INV-1',clock_timestamp()-interval '35 days',
  clock_timestamp()-interval '5 days',500,0,500,5,'OVERDUE','placed','CREDIT_HOLD','BLOCKED','OVERDUE'
);
insert into public.ecoflow_accounts_statement_actions values(
  '20000000-0000-4000-8000-000000000001','STORE-1','HOLD_ACCOUNT','Overdue balance requires review',null,'ON_HOLD',
  '11111111-1111-4111-8111-111111111111',clock_timestamp()
);
insert into public.v_ecoflow_statement_document_history values(
  '20000000-0000-4000-8000-000000000002','STM-1','STORE-1','Store 1','GENERATED',500,clock_timestamp(),1
);

insert into public.v_ecoflow_customer_store_order_history(
  store_id,store_name,internal_order_id,external_order_id,order_number,invoice_number,status,order_value,order_at,delivery_date,due_at,last_synced_at
)
select 'STORE-1','Store 1','INT-'||g,'EXT-'||g,'ORD-'||g,'INV-'||g,'placed',g*10,
  clock_timestamp()-(g||' hours')::interval,current_date,clock_timestamp()+interval '7 days',clock_timestamp()
from generate_series(1,110) g;
insert into public.ecoflow_customer_operational_events values(
  '20000000-0000-4000-8000-000000000003','store-1','Store 1','CUSTOMER_CONTACT','Called customer','PHONE',
  clock_timestamp(),'11111111-1111-4111-8111-111111111111','owner@example.test',clock_timestamp()
);

insert into public.ecoflow_delivery_exceptions values
  ('30000000-0000-4000-8000-000000000001','RET-OPEN','2026-08-11','EXT-1','ORD-1',1,'Store 1','DAMAGED',1,
   'Damaged carton','Driver note','WITH_DRIVER',null,clock_timestamp(),null,null,null,clock_timestamp()),
  ('30000000-0000-4000-8000-000000000002','RET-CLOSED','2026-08-10','EXT-2','ORD-2',2,'Store 1','REFUSED',1,
   'Refused','Driver note','RESTOCKED','A1-01',clock_timestamp()-interval '1 day',clock_timestamp()-interval '20 hours',
   clock_timestamp()-interval '20 hours',clock_timestamp()-interval '18 hours',clock_timestamp());
insert into public.ecoflow_delivery_return_inspection_lines values(
  '30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002','RESTOCK','BC-1','SKU-1',
  'Product 1','CARTON',1,20,'A1-01','dddddddd-dddd-4ddd-8ddd-ddddddddddd1',null,'Inspected','Warehouse',clock_timestamp()
);
insert into public.ecoflow_delivery_return_scans values(
  '30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','RET-CLOSED','RESTOCKED',
  'A1-01','Restocked','Warehouse',clock_timestamp()
);

do $$
declare v_total bigint; v_rows integer; v_payload jsonb;
begin
  select max(total_count),count(*) filter(where row_data is not null)
    into v_total,v_rows
  from public.ecoflow_read_operational_records_v1('inventory','sku',2,10,null,null,'sku');
  if v_total<>12 or v_rows<>2 then raise exception 'Inventory exact paging failed: %, %',v_total,v_rows; end if;

  select row_data into v_payload
  from public.ecoflow_read_operational_records_v1('inventory','sku',1,10,'SKU-1',null,null)
  where row_data is not null limit 1;
  if v_payload->>'stock_authority'<>'WAREHOUSE_LOCATION_LEDGER'
     or (v_payload->>'authoritative_on_hand')::numeric<>25 then
    raise exception 'Live location authority was not preferred: %',v_payload;
  end if;

  if (select count(*) from public.ecoflow_read_operational_record_detail_v1('inventory','SKU-1',50)
      where record_kind in ('SUMMARY','LOCATION','PHYSICAL_SKU','PACKAGE','BARCODE','IDENTITY_EXCEPTION'))<6 then
    raise exception 'Inventory identity/location detail is incomplete';
  end if;

  if (select max(total_count) from public.ecoflow_read_operational_records_v1('customers','overview',1,10,null,null,null))<>12 then
    raise exception 'Customer exact paging failed';
  end if;
  if (select count(*) from public.ecoflow_read_operational_record_detail_v1('customers','STORE-1',999)
      where record_kind='ORDER')<>100 then
    raise exception 'Customer detail limit was not clamped to 100';
  end if;

  select row_data into v_payload
  from public.ecoflow_read_operational_records_v1('accounts','held',1,10,null,null,null)
  where row_data is not null limit 1;
  if v_payload->>'hold_reason'<>'Overdue balance requires review'
     or v_payload->>'release_authority'<>'OWNER_ADMIN_ACCOUNT' then
    raise exception 'Accounts hold explanation is incomplete: %',v_payload;
  end if;
  if not exists(select 1 from public.ecoflow_read_operational_record_detail_v1('accounts','STORE-1',50) where record_kind='AFFECTED_ORDER') then
    raise exception 'Accounts affected Orders are missing';
  end if;

  select row_data into v_payload
  from public.ecoflow_read_operational_records_v1('returns','reported',1,10,null,null,null)
  where row_data is not null limit 1;
  if v_payload->>'inventory_consequence_status'<>'MISSING' then
    raise exception 'Open return missing consequence was hidden: %',v_payload;
  end if;
  select record_data into v_payload
  from public.ecoflow_read_operational_record_detail_v1('returns','RET-CLOSED',50)
  where record_kind='INVENTORY_CONSEQUENCE' limit 1;
  if v_payload->>'consequence_status'<>'EXPLICIT' or coalesce(v_payload->>'movement_id','')='' then
    raise exception 'Closed return inventory consequence is not explicit: %',v_payload;
  end if;

  begin
    perform * from public.ecoflow_read_operational_records_v1('returns','invented',1,10,null,null,null);
    raise exception 'Unknown Returns view unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%UNKNOWN_RETURNS_VIEW%' then raise; end if;
  end;
  begin
    perform * from public.ecoflow_read_operational_records_v1('customers','overview',1,500,null,null,null);
    raise exception 'Unbounded page size unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%INVALID_OPERATIONAL_RECORDS_PAGE%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$ begin
  perform * from public.ecoflow_read_operational_records_v1('customers','overview',1,10,null,null,null);
  perform * from public.ecoflow_read_operational_records_v1('accounts','overview',1,10,null,null,null);
  begin
    perform * from public.ecoflow_read_operational_records_v1('inventory','overview',1,10,null,null,null);
    raise exception 'Account Inventory access unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
  begin
    perform * from public.ecoflow_read_operational_records_v1('returns','overview',1,10,null,null,null);
    raise exception 'Account Returns access unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$ begin
  perform * from public.ecoflow_read_operational_records_v1('inventory','overview',1,10,null,null,null);
  perform * from public.ecoflow_read_operational_records_v1('customers','overview',1,10,null,null,null);
  begin
    perform * from public.ecoflow_read_operational_records_v1('accounts','overview',1,10,null,null,null);
    raise exception 'Viewer Accounts access unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
  begin
    perform * from public.ecoflow_read_operational_records_v1('returns','overview',1,10,null,null,null);
    raise exception 'Viewer Returns access unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
do $$ begin
  begin
    perform * from public.ecoflow_read_operational_records_v1('customers','overview',1,10,null,null,null);
    raise exception 'Authenticated user without an active app profile unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
end $$;

do $$ begin
  if has_function_privilege('anon','public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)','EXECUTE') then
    raise exception 'anon can execute operational records page RPC';
  end if;
  if has_function_privilege('anon','public.ecoflow_read_operational_record_detail_v1(text,text,integer)','EXECUTE') then
    raise exception 'anon can execute operational record detail RPC';
  end if;
end $$;

select 'TRANSFORM-007 operational-records PostgreSQL contracts passed.' as result;
