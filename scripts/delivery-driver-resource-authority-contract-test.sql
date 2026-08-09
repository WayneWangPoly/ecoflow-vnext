\set ON_ERROR_STOP on

grant usage on schema storage to authenticated;

create or replace function pg_temp.resource_route_snapshot(
  p_run_code text,
  p_order_id text,
  p_store text,
  p_phone text,
  p_cartons integer
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'version',1,
    'businessDay','2026-08-10',
    'runCode',p_run_code,
    'routeId','RUN-20260810-'||p_run_code,
    'routeLabel','Resource Run '||p_run_code,
    'totalCartons',p_cartons,
    'readyStops',1,
    'warehousePoint',jsonb_build_object('x',0.08,'y',0.5),
    'geoProjected',false,
    'stops',jsonb_build_array(
      jsonb_build_object(
        'orderId',p_order_id,
        'stopNumber',1,
        'boxCode',p_run_code,
        'store',p_store,
        'address','20 Grenfell Street, Adelaide SA 5000',
        'suburb','Adelaide',
        'orderNo','ORD-'||p_run_code,
        'invoiceNo','INV-'||p_run_code,
        'cartons',p_cartons,
        'eta','10:30',
        'phone',p_phone,
        'lines',jsonb_build_array(jsonb_build_object('sku','CUP-12W','name','12oz Cup','qty',p_cartons,'unit','carton','location','A1')),
        'warehouseReady',true,
        'orderStatus','STAGED',
        'mapPoint',jsonb_build_object('x',0.45,'y',0.45)
      )
    )
  )
$$;

-- Two independent locked resources for two Drivers.
set app.test_role='ACCOUNT';
set app.test_user_id='33333333-3333-4333-8333-333333333333';

do $setup$
declare
  v_route uuid;
  v_current_revision bigint;
  v_status text;
begin
  select route_snapshot_id into v_route
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','D','11111111-1111-4111-8111-111111111111',
    pg_temp.resource_route_snapshot('D','order-d','Resource Cafe D','0400000001',3)
  );
  if v_route is null then raise exception 'Run D route lock failed'; end if;

  select route_snapshot_id into v_route
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','E','22222222-2222-4222-8222-222222222222',
    pg_temp.resource_route_snapshot('E','order-e','Resource Cafe E','0400000002',2)
  );
  if v_route is null then raise exception 'Run E route lock failed'; end if;

  select coalesce(revision,0) into v_current_revision
  from public.ecoflow_day_state
  where business_day='2026-08-10' and scope='run-control';
  if not found then v_current_revision:=0; end if;

  select command_status into v_status
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    jsonb_build_array(jsonb_build_object(
      'commandId','91000000-0000-4000-8000-000000000001',
      'scope','run-control',
      'expectedRevision',v_current_revision,
      'payload',jsonb_build_object('activeRunCode','D')
    )),
    'Accounts User'
  );
  if v_status not in ('APPLIED','REPLAYED') then raise exception 'Run D control setup failed: %',v_status; end if;
end;
$setup$;

insert into public.ecoflow_delivery_notification_contacts(store_key,store_name,contact_email,enabled) values
  ('RESOURCE-CAFE-D','Resource Cafe D','canonical-d@example.test',true),
  ('RESOURCE-CAFE-E','Resource Cafe E','canonical-e@example.test',true)
on conflict(store_key) do update set contact_email=excluded.contact_email,enabled=true;

-- Seed both run-state and evidence rows as database setup so RLS reads can prove isolation.
delete from public.ecoflow_day_state where business_day='2026-08-10' and scope in ('run:D:stop:order-d','run:E:stop:order-e');
insert into public.ecoflow_day_state(business_day,scope,payload,updated_by,revision)
values
  ('2026-08-10','run:D:stop:order-d','{"status":"ARRIVED"}'::jsonb,'fixture',1),
  ('2026-08-10','run:E:stop:order-e','{"status":"ARRIVED"}'::jsonb,'fixture',1);

insert into public.ecoflow_delivery_pod_proofs(
  business_day,order_id,order_number,stop_number,box_code,store_name,proof_type,photo_path,captured_by
) values
  ('2026-08-10','order-e','ORD-E',1,'E','Resource Cafe E','POD2_GOODS_PLACED','2026-08-10/order-e/existing-e.jpg','fixture')
on conflict(business_day,order_id,proof_type) do nothing;
insert into storage.objects(bucket_id,name) values('pod-photos','2026-08-10/order-e/existing-e.jpg')
on conflict(bucket_id,name) do nothing;

-- Driver A: all own-resource operations work, metadata is server-derived, and
-- Driver B resources are neither readable nor writable.
set role authenticated;
set app.test_role='DRIVER';
set app.test_user_id='11111111-1111-4111-8111-111111111111';

do $driver_a$
declare
  v_route record;
  v_order text;
  v_count integer;
  v_denied boolean;
  v_status text;
begin
  select * into v_route
  from public.ecoflow_authorize_delivery_resource('2026-08-10','RUN-20260810-D','order-d')
  limit 1;
  if v_route.run_code<>'D' or v_route.assigned_driver_user_id::text<>'11111111-1111-4111-8111-111111111111' then
    raise exception 'Driver A own route authorization failed';
  end if;

  v_order:=public.ecoflow_resolve_assigned_delivery_order_by_box('2026-08-10','D');
  if v_order<>'order-d' then raise exception 'Driver A BOX authority returned %',v_order; end if;

  v_denied:=false;
  begin
    perform * from public.ecoflow_authorize_delivery_resource('2026-08-10','RUN-20260810-E','order-e');
  exception when sqlstate '42501' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver A authorized Driver B route'; end if;

  v_denied:=false;
  begin
    perform public.ecoflow_resolve_assigned_delivery_order_by_box('2026-08-10','E');
  exception when sqlstate '42501' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver A resolved Driver B BOX'; end if;

  select count(*) into v_count from public.ecoflow_read_day_state('2026-08-10',0,500) r
  where r.scope='run:E:stop:order-e';
  if v_count<>0 then raise exception 'Driver A read Driver B state through authority RPC'; end if;
  select count(*) into v_count from public.ecoflow_read_day_state('2026-08-10',0,500) r
  where r.scope='run:D:stop:order-d';
  if v_count<>1 then raise exception 'Driver A could not read own state through authority RPC'; end if;

  select count(*) into v_count from public.ecoflow_day_state d
  where d.business_day='2026-08-10' and d.scope='run:E:stop:order-e';
  if v_count<>0 then raise exception 'Driver A read Driver B state through direct table SELECT'; end if;

  insert into storage.objects(bucket_id,name) values('pod-photos','2026-08-10/order-d/driver-a.jpg');
  insert into public.ecoflow_delivery_pod_proofs(
    business_day,order_id,order_number,stop_number,box_code,store_name,proof_type,photo_path,captured_by
  ) values('2026-08-10','order-d','spoof',99,'Z','spoof','POD2_GOODS_PLACED','2026-08-10/order-d/driver-a.jpg','Driver A');

  v_denied:=false;
  begin
    insert into storage.objects(bucket_id,name) values('pod-photos','2026-08-10/order-e/driver-a-cross.jpg');
  exception when sqlstate '42501' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver A wrote Driver B POD storage path'; end if;

  v_denied:=false;
  begin
    insert into public.ecoflow_delivery_pod_proofs(
      business_day,order_id,proof_type,photo_path
    ) values('2026-08-10','order-e','POD1_DROP_POINT','2026-08-10/order-e/driver-a-cross.jpg');
  exception when sqlstate '42501' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver A wrote Driver B POD proof row'; end if;

  select count(*) into v_count from public.ecoflow_delivery_pod_proofs where order_id='order-e';
  if v_count<>0 then raise exception 'Driver A read Driver B POD proof'; end if;
  select count(*) into v_count from storage.objects where bucket_id='pod-photos' and name like '2026-08-10/order-e/%';
  if v_count<>0 then raise exception 'Driver A read Driver B POD storage object'; end if;
end;
$driver_a$;

-- Queue own notification using deliberately spoofed caller metadata. The legacy
-- primitive must receive canonical stop/contact facts from the authority wrapper.
select * from public.ecoflow_queue_delivery_notifications(
  'resource-d-delivered','2026-08-10','order-d','SPOOF-ORDER',99,'Z','Spoof Store','DELIVERED',
  'attacker@example.test','0499999999','2026-08-10/order-d/drop.jpg','2026-08-10/order-d/goods.jpg','done','Spoof Actor'
);

do $notification$
declare v_call public.ecoflow_test_notification_calls%rowtype; v_denied boolean:=false;
begin
  select * into v_call from public.ecoflow_test_notification_calls where order_id='order-d' order by id desc limit 1;
  if v_call.order_number<>'ORD-D' or v_call.stop_number<>1 or v_call.box_code<>'D'
     or v_call.store_name<>'Resource Cafe D' or v_call.store_email<>'canonical-d@example.test'
     or v_call.store_phone<>'0400000001' then
    raise exception 'notification authority did not canonicalize route facts: %',row_to_json(v_call);
  end if;

  begin
    perform * from public.ecoflow_queue_delivery_notifications(
      'cross-e','2026-08-10','order-e',null,null,null,null,'DELIVERED',null,null,null,null,null,'Driver A'
    );
  exception when sqlstate '42501' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver A queued notification for Driver B order'; end if;
end;
$notification$;

-- Exception total is route-authoritative (3 cartons) and cross-order calls fail.
select * from public.ecoflow_record_delivery_exception(
  '2026-08-10','order-d','SPOOF',77,'Z','Spoof Store','PARTIAL',999,2,1,
  'one carton returning','note',null,'attacker@example.test','0499999999','Spoof Actor'
);

do $exception$
declare v_call public.ecoflow_test_exception_calls%rowtype; v_denied boolean:=false; v_balance_denied boolean:=false;
begin
  select * into v_call from public.ecoflow_test_exception_calls where order_id='order-d' order by id desc limit 1;
  if v_call.order_number<>'ORD-D' or v_call.stop_number<>1 or v_call.box_code<>'D'
     or v_call.store_name<>'Resource Cafe D' or v_call.expected_cartons<>3
     or v_call.store_email is not null or v_call.store_phone<>'0400000001' then
    raise exception 'exception authority did not canonicalize route facts: %',row_to_json(v_call);
  end if;

  begin
    perform * from public.ecoflow_record_delivery_exception(
      '2026-08-10','order-d',null,null,null,null,'PARTIAL',3,3,1,'bad balance',null,null,null,null,'Driver A'
    );
  exception when others then
    if position('DELIVERY_CARTON_BALANCE_EXCEEDED' in sqlerrm)>0 then v_balance_denied:=true; else raise; end if;
  end;
  if not v_balance_denied then raise exception 'server accepted impossible exception carton balance'; end if;

  begin
    perform * from public.ecoflow_record_delivery_exception(
      '2026-08-10','order-e',null,null,null,null,'PARTIAL',2,1,0,'cross',null,null,null,null,'Driver A'
    );
  exception when sqlstate '42501' then v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver A recorded exception for Driver B order'; end if;
end;
$exception$;

-- Location and departure both canonicalize legacy route ids and reject cross-run resources.
select * from public.ecoflow_record_driver_location_sample(
  '2026-08-10','RUN-20260810-D',-34.92,138.60,10,null,null,'order-d','STOP_ARRIVAL',
  '92000000-0000-4000-8000-000000000001',now(),'Spoof Driver','Australia/Adelaide','{}'::jsonb
);
select * from public.ecoflow_record_driver_departure_acknowledgement(
  '2026-08-10','D','2026-07-11-v1','Driver A','{}'::jsonb,true,'declaration','Spoof Driver',null,'{}'::jsonb
);

do $route_bound_writes$
declare
  v_location public.ecoflow_test_location_calls%rowtype;
  v_departure public.ecoflow_test_departure_calls%rowtype;
  v_location_denied boolean:=false;
  v_departure_denied boolean:=false;
begin
  select * into v_location from public.ecoflow_test_location_calls order by captured_at desc limit 1;
  if v_location.route_id<>'RUN-20260810-D' or v_location.current_order_id<>'order-d'
     or v_location.driver_label<>'Driver A' then
    raise exception 'location resource was not canonicalized: %',row_to_json(v_location);
  end if;
  select * into v_departure from public.ecoflow_test_departure_calls order by accepted_at desc limit 1;
  if v_departure.route_id<>'RUN-20260810-D' or v_departure.driver_label<>'Driver A' then
    raise exception 'departure resource was not canonicalized: %',row_to_json(v_departure);
  end if;

  begin
    perform * from public.ecoflow_record_driver_location_sample(
      '2026-08-10','RUN-20260810-E',-34.92,138.60,null,null,null,'order-e','STOP_ARRIVAL',
      '92000000-0000-4000-8000-000000000002',now(),'Driver A',null,'{}'::jsonb
    );
  exception when sqlstate '42501' then v_location_denied:=true;
  end;
  if not v_location_denied then raise exception 'Driver A wrote location against Driver B route'; end if;

  begin
    perform * from public.ecoflow_record_driver_departure_acknowledgement(
      '2026-08-10','RUN-20260810-E','2026-07-11-v1','Driver A','{}'::jsonb,true,'declaration','Driver A',null,'{}'::jsonb
    );
  exception when sqlstate '42501' then v_departure_denied:=true;
  end;
  if not v_departure_denied then raise exception 'Driver A acknowledged Driver B route'; end if;
end;
$route_bound_writes$;

reset role;

-- Old primitives and anon entry points are not browser-callable.
do $acl$
begin
  if has_function_privilege('authenticated','public.ecoflow_queue_delivery_notifications_pre_resource_authority_20260809(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)','EXECUTE') then
    raise exception 'authenticated can execute private notification primitive';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_record_delivery_exception_pre_resource_authority_20260809(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)','EXECUTE') then
    raise exception 'authenticated can execute private exception primitive';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_record_driver_location_sample_pre_resource_authority_20260809(date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb)','EXECUTE') then
    raise exception 'authenticated can execute private location primitive';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_record_driver_departure_acknowledgement_pre_resource_authority_20260809(date,text,text,text,jsonb,boolean,text,text,text,jsonb)','EXECUTE') then
    raise exception 'authenticated can execute private departure primitive';
  end if;
  if has_function_privilege('anon','public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)','EXECUTE') then
    raise exception 'anon can queue delivery notifications';
  end if;
  if has_function_privilege('anon','public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)','EXECUTE') then
    raise exception 'anon can record delivery exceptions';
  end if;
end;
$acl$;

-- Owner/Admin retain deliberate operational access to a locked resource without
-- impersonating the assigned Driver; WAREHOUSE/ACCOUNT do not gain mutation APIs.
set role authenticated;
set app.test_role='OWNER';
set app.test_user_id='33333333-3333-4333-8333-333333333333';
select * from public.ecoflow_authorize_delivery_resource('2026-08-10','E','order-e');
select * from public.ecoflow_queue_delivery_notifications(
  'owner-e','2026-08-10','order-e',null,null,null,null,'DELIVERED',null,null,null,null,'owner retry','Owner'
);
reset role;

reset app.test_role;
reset app.test_user_id;
