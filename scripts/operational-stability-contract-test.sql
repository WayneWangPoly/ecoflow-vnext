\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);

insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.test'),
  ('22222222-2222-4222-8222-222222222222','account@example.test')
on conflict(id) do nothing;
insert into public.app_user_profiles(user_id,app_role,is_active,team_status) values
  ('11111111-1111-4111-8111-111111111111','OWNER',true,'ACTIVE'),
  ('22222222-2222-4222-8222-222222222222','ACCOUNT',true,'ACTIVE')
on conflict(user_id) do update set app_role=excluded.app_role,is_active=true,team_status='ACTIVE';

insert into public.ecoflow_warehouse_locations(
  id,location_code,rack_id,rack_title,side,display_level,status,sort_order
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','A1-01','A1','Rack A1','front','01','ACTIVE',1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','A1-02','A1','Rack A1','front','02','ACTIVE',2)
on conflict(location_code) do nothing;

insert into public.ecoflow_sku_barcode_registry(
  sku,barcode,package_level,units_per_barcode,product_name,verified
) values ('SKU-1','BC-SKU-1','CARTON',10,'Test product',true)
on conflict(barcode) do update set sku=excluded.sku,verified=true;

-- Initial stocktake evidence must not post until supervisor approval.
do $$
declare
  v_session uuid;
  v_revision bigint;
  v_observation uuid;
  v_qty numeric;
  v_approval uuid:='10000000-0000-4000-8000-000000000005';
begin
  select session_id into v_session from public.ecoflow_start_stocktake_session(
    'INITIAL','Opening count','A1',null,false,'Initial physical opening balance',
    '10000000-0000-4000-8000-000000000001'
  );
  select observation_id into v_observation from public.ecoflow_record_stocktake_observation(
    v_session,'A1-01','SKU-1','Test product','BC-SKU-1','carton',10,5,
    'Counted five cartons','10000000-0000-4000-8000-000000000002'
  );
  select quantity into v_qty from public.ecoflow_warehouse_location_items
  where location_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and sku='SKU-1' and unit_level='carton';
  if v_qty is not null then raise exception 'observation posted stock before approval'; end if;

  perform * from public.ecoflow_complete_stocktake_location(
    v_session,'A1-01','Location physically complete','10000000-0000-4000-8000-000000000003'
  );
  perform * from public.ecoflow_submit_stocktake_session(
    v_session,'Submit complete opening count','10000000-0000-4000-8000-000000000004'
  );
  select revision into v_revision from public.ecoflow_stocktake_sessions where id=v_session;
  perform * from public.ecoflow_approve_stocktake_session(
    v_session,v_revision,'Supervisor approved opening count',v_approval
  );

  select quantity into v_qty from public.ecoflow_warehouse_location_items
  where location_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and sku='SKU-1' and unit_level='carton';
  if v_qty<>5 then raise exception 'approved opening balance was not posted: %',v_qty; end if;
  if (select count(*) from public.ecoflow_inventory_movements where reference_type='OPENING_STOCKTAKE')<>1 then
    raise exception 'opening adjustment audit movement missing';
  end if;
  if (select count(*) from public.ecoflow_stocktake_events where session_id=v_session)<5 then
    raise exception 'stocktake event history incomplete';
  end if;

  -- Idempotent approval replay does not add a second adjustment.
  perform * from public.ecoflow_approve_stocktake_session(
    v_session,v_revision,'Supervisor approved opening count',v_approval
  );
  if (select count(*) from public.ecoflow_inventory_movements where reference_type='OPENING_STOCKTAKE')<>1 then
    raise exception 'approval replay duplicated adjustment';
  end if;

  begin
    update public.ecoflow_stocktake_events set reason='tamper' where session_id=v_session;
    raise exception 'immutable event update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Blind cycle count hides current balances before submit/review.
do $$
declare v_session uuid; v_balance_rows integer;
begin
  select session_id into v_session from public.ecoflow_start_stocktake_session(
    'CYCLE_COUNT','Blind cycle count','A1',null,true,'Targeted cycle count',
    '11000000-0000-4000-8000-000000000001'
  );
  select count(*) into v_balance_rows
  from public.ecoflow_read_warehouse_control(v_session,500)
  where record_kind='BALANCE';
  if v_balance_rows<>0 then raise exception 'blind count exposed current balances'; end if;
end $$;

-- Move SKU is a paired, idempotent, non-negative transaction with CAS.
do $$
declare
  v_ref text;
  v_source numeric;
  v_dest numeric;
  v_count integer;
begin
  select transfer_reference,source_quantity,destination_quantity
  into v_ref,v_source,v_dest
  from public.ecoflow_move_warehouse_sku(
    'A1-01','A1-02','SKU-1','carton',2,false,5,
    'Rebalance pick face','12000000-0000-4000-8000-000000000001'
  );
  if v_source<>3 or v_dest<>2 then raise exception 'paired transfer balances incorrect: %, %',v_source,v_dest; end if;
  select count(*) into v_count from public.ecoflow_warehouse_movements where transfer_reference=v_ref;
  if v_count<>2 then raise exception 'paired transfer must produce exactly two warehouse legs'; end if;

  perform * from public.ecoflow_move_warehouse_sku(
    'A1-01','A1-02','SKU-1','carton',2,false,5,
    'Rebalance pick face','12000000-0000-4000-8000-000000000001'
  );
  if (select quantity from public.ecoflow_warehouse_location_items where location_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and sku='SKU-1' and unit_level='carton')<>3 then
    raise exception 'transfer replay changed source balance';
  end if;

  begin
    perform * from public.ecoflow_move_warehouse_sku(
      'A1-01','A1-02','SKU-1','carton',1,false,5,
      'Stale balance attempt','12000000-0000-4000-8000-000000000002'
    );
    raise exception 'stale source balance unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%SOURCE_BALANCE_CONFLICT%' then raise; end if;
  end;

  begin
    perform * from public.ecoflow_move_warehouse_sku(
      'A1-01','A1-02','SKU-1','carton',99,false,3,
      'Negative stock attempt','12000000-0000-4000-8000-000000000003'
    );
    raise exception 'negative stock move unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%VALID_TRANSFER_QUANTITY_REQUIRED%' then raise; end if;
  end;
end $$;

-- Exact server pagination for the five bounded operational resources.
insert into public.fixture_order_inbox(
  raw_order_id,external_order_id,external_order_number,external_invoice_number,
  order_number,invoice_number,order_status,payment_status,order_items_total,order_updated_at
)
select 'raw-'||g,'ext-'||g,'EXT-'||g,'EINV-'||g,'ORD-'||lpad(g::text,3,'0'),
       'INV-'||g,'placed','unpaid',g*10,clock_timestamp()-(g||' minutes')::interval
from generate_series(1,30) g;

insert into public.ecoflow_store_sites(retailer_id,store_name,suburb,state,formatted_address,contact_phone,price_group_id,verified)
values ('store-1','Test Store','Adelaide','SA','1 Test Street Adelaide','0800000000','TIER-A',true)
on conflict(retailer_id) do nothing;

insert into public.fixture_order_exceptions(
  raw_order_id,external_order_id,external_order_number,external_invoice_number,
  order_number,invoice_number,exception_type,message,status,detected_at
) values ('raw-1','ext-1','EXT-1','EINV-1','ORD-001','INV-1','MISSING_BARCODE','Barcode is missing','OPEN',clock_timestamp()-interval '5 hours');

insert into public.fixture_sync_health(last_synced_at) values(clock_timestamp());

-- Assign the deterministic exception so Business Day Close is not blocked.
insert into analytics.actionable_exception_lifecycle(exception_id,lifecycle_status,owner_team)
select 'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
  coalesce(e.raw_order_id::text,''),coalesce(e.external_order_id::text,''),
  coalesce(e.external_order_number::text,''),coalesce(e.external_invoice_number::text,''),
  coalesce(e.order_number::text,''),coalesce(e.invoice_number::text,''),
  coalesce(e.exception_type::text,''),coalesce(e.status::text,''),coalesce(e.detected_at::text,'')
)),'ACKNOWLEDGED','Warehouse'
from public.fixture_order_exceptions e
on conflict(exception_id) do update set owner_team=excluded.owner_team,lifecycle_status=excluded.lifecycle_status;

do $$
declare v_total bigint; v_rows integer; v_payload jsonb;
begin
  select max(total_count),count(*) filter(where row_data is not null)
  into v_total,v_rows
  from public.ecoflow_read_operational_page('orders',2,10,null,null,'latest');
  if v_total<>30 or v_rows<>10 then raise exception 'orders pagination contract failed: total %, rows %',v_total,v_rows; end if;

  if (select max(total_count) from public.ecoflow_read_operational_page('stores',1,10,null,null,'suburb'))<>1 then
    raise exception 'stores pagination total failed';
  end if;
  if (select max(total_count) from public.ecoflow_read_operational_page('inventory',1,10,null,null,'quantity-desc'))<2 then
    raise exception 'inventory pagination total failed';
  end if;
  select row_data into v_payload from public.ecoflow_read_operational_page('exceptions',1,10,null,null,'oldest') where row_data is not null limit 1;
  if v_payload->>'owner_team'<>'Warehouse' or coalesce(v_payload->>'recommended_action','')='' then
    raise exception 'exception policy fields missing: %',v_payload;
  end if;
  if (select max(total_count) from public.ecoflow_read_operational_page('logs',1,10,null,null,'latest'))<2 then
    raise exception 'logs pagination total failed';
  end if;
end $$;

-- Quick Actions are authenticated-user scoped, revisioned and capped at four.
do $$
declare v_source text; v_revision bigint; v_keys text[];
begin
  select source,revision,action_keys into v_source,v_revision,v_keys from public.ecoflow_read_quick_actions();
  if v_source<>'ROLE_DEFAULT' or cardinality(v_keys)<>4 then raise exception 'role Quick Action defaults missing'; end if;

  select revision,action_keys into v_revision,v_keys from public.ecoflow_set_quick_actions(array['ORDERS','INVENTORY'],0);
  if v_revision<>1 or v_keys<>array['ORDERS','INVENTORY'] then raise exception 'user Quick Actions not stored'; end if;

  begin
    perform * from public.ecoflow_set_quick_actions(array['ORDERS','INVENTORY','CUSTOMERS','EXCEPTIONS','LOGS'],1);
    raise exception 'five Quick Actions unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%INVALID_QUICK_ACTION_CONFIGURATION%' then raise; end if;
  end;

  begin
    perform * from public.ecoflow_set_quick_actions(array['ORDERS'],0);
    raise exception 'stale Quick Action revision unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%QUICK_ACTION_REVISION_CONFLICT%' then raise; end if;
  end;
end $$;

-- Business Day Close requires explicit acknowledgement and preserves carry-over history.
insert into public.ecoflow_day_state(business_day,scope,payload,revision)
values
  ('2026-08-01','run:A:stop:1','{"status":"OUT_FOR_DELIVERY"}'::jsonb,1),
  ('2026-08-01','run:A:task:1','{"status":"PENDING"}'::jsonb,1)
on conflict(business_day,scope) do update set payload=excluded.payload,revision=excluded.revision;

do $$
declare v_status text; v_carry integer;
begin
  if exists(select 1 from public.ecoflow_business_day_close_readiness('2026-08-01') where blocking and check_key<>'ACCOUNTS_VARIANCE') then
    raise exception 'assigned exception queue should not block close';
  end if;

  select close_status,carry_over_count into v_status,v_carry
  from public.ecoflow_complete_business_day_close(
    '2026-08-01','2026-08-02',0,'Daily close complete',
    '13000000-0000-4000-8000-000000000001',
    '{"accountsVarianceAcknowledged":true}'::jsonb,
    'Accounts variance reviewed','Owner test'
  );
  if v_status<>'APPLIED' or v_carry<>2 then raise exception 'Business Day Close failed: %, %',v_status,v_carry; end if;
  if (select count(*) from public.ecoflow_business_day_carry_over where source_business_day='2026-08-01')<>2 then
    raise exception 'carry-over history missing';
  end if;
  if not exists(select 1 from public.ecoflow_business_day_close_checklists where business_day='2026-08-01') then
    raise exception 'close checklist missing';
  end if;
end $$;

-- Account can read and act on exception queue but cannot read physical inventory.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$
begin
  if (select max(total_count) from public.ecoflow_read_operational_page('exceptions',1,10,null,null,'oldest'))<>1 then
    raise exception 'Account exception queue access failed';
  end if;
  begin
    perform * from public.ecoflow_read_operational_page('inventory',1,10,null,null,'latest');
    raise exception 'Account physical inventory access unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end $$;

select 'Operational stability PostgreSQL contracts passed.' as result;
