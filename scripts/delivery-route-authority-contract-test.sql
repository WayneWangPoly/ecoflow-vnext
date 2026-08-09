\set ON_ERROR_STOP on

create or replace function pg_temp.route_snapshot(p_run_code text,p_store_suffix text default '')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'version',1,
    'businessDay','2026-08-10',
    'runCode',p_run_code,
    'routeId','run-'||lower(p_run_code),
    'routeLabel','Run '||p_run_code,
    'totalCartons',3,
    'readyStops',2,
    'warehousePoint',jsonb_build_object('x',0.08,'y',0.5),
    'geoProjected',false,
    'stops',jsonb_build_array(
      jsonb_build_object(
        'orderId','order-1','stopNumber',1,'boxCode','A','store','Cafe One'||p_store_suffix,
        'address','1 North Terrace, Adelaide SA 5000','suburb','Adelaide','orderNo','ORD-1','invoiceNo','INV-1',
        'cartons',1,'eta','09:00','lines',jsonb_build_array(jsonb_build_object('sku','CUP-12W','name','12oz Cup','qty',1,'unit','carton','location','A1')),
        'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.3,'y',0.4)
      ),
      jsonb_build_object(
        'orderId','order-2','stopNumber',2,'boxCode','B','store','Cafe Two'||p_store_suffix,
        'address','2 Hutt Street, Adelaide SA 5000','suburb','Adelaide','orderNo','ORD-2','invoiceNo','INV-2',
        'cartons',2,'eta','09:30','lines',jsonb_build_array(jsonb_build_object('sku','BOWL-16','name','16oz Bowl','qty',2,'unit','carton','location','A2')),
        'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.6,'y',0.5)
      )
    )
  )
$$;

set app.test_role='OWNER';
set app.test_user_id='33333333-3333-4333-8333-333333333333';

do $verify$
declare
  v_first uuid;
  v_second uuid;
  v_revision integer;
  v_driver_label text;
  v_conflict_denied boolean:=false;
  v_driver_change_denied boolean:=false;
  v_invalid_driver_denied boolean:=false;
  v_non_driver_denied boolean:=false;
  v_duplicate_denied boolean:=false;
  v_gap_denied boolean:=false;
  v_driver_count integer;
begin
  select count(*) into v_driver_count from public.ecoflow_list_active_dispatch_drivers();
  if v_driver_count<>2 then raise exception 'dispatch Driver directory did not expose exactly the two active Drivers'; end if;

  select route_snapshot_id,revision,assigned_driver_label into v_first,v_revision,v_driver_label
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','A','11111111-1111-4111-8111-111111111111',pg_temp.route_snapshot('A')
  );
  if v_first is null or v_revision<>1 then raise exception 'first lock did not create revision 1'; end if;
  if v_driver_label<>'Driver A' then raise exception 'Driver label was not server-derived from the active team directory'; end if;

  select route_snapshot_id into v_second
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','A','11111111-1111-4111-8111-111111111111',pg_temp.route_snapshot('A')
  );
  if v_second is distinct from v_first then raise exception 'identical route + Driver lock was not idempotent'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','A','22222222-2222-4222-8222-222222222222',pg_temp.route_snapshot('A')
    );
  exception when others then
    if position('ROUTE_ALREADY_LOCKED_DIFFERENT_DRIVER' in sqlerrm)>0 then v_driver_change_denied:=true; else raise; end if;
  end;
  if not v_driver_change_denied then raise exception 'locked route silently changed Driver assignment'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','A','11111111-1111-4111-8111-111111111111',pg_temp.route_snapshot('A',' changed')
    );
  exception when others then
    if position('ROUTE_ALREADY_LOCKED_DIFFERENT_SNAPSHOT' in sqlerrm)>0 then v_conflict_denied:=true; else raise; end if;
  end;
  if not v_conflict_denied then raise exception 'changed route replaced an already locked route'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','C','44444444-4444-4444-8444-444444444444',pg_temp.route_snapshot('C')
    );
  exception when others then
    if position('ACTIVE_DRIVER_REQUIRED' in sqlerrm)>0 then v_invalid_driver_denied:=true; else raise; end if;
  end;
  if not v_invalid_driver_denied then raise exception 'suspended Driver was accepted for dispatch'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','C','33333333-3333-4333-8333-333333333333',pg_temp.route_snapshot('C')
    );
  exception when others then
    if position('ACTIVE_DRIVER_REQUIRED' in sqlerrm)>0 then v_non_driver_denied:=true; else raise; end if;
  end;
  if not v_non_driver_denied then raise exception 'non-Driver account was accepted for dispatch'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','C','11111111-1111-4111-8111-111111111111',
      jsonb_set(pg_temp.route_snapshot('C'),'{stops,1,orderId}','"order-1"'::jsonb)
    );
  exception when others then
    if position('ROUTE_SNAPSHOT_DUPLICATE_ORDER' in sqlerrm)>0 then v_duplicate_denied:=true; else raise; end if;
  end;
  if not v_duplicate_denied then raise exception 'duplicate order IDs were accepted'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','D','11111111-1111-4111-8111-111111111111',
      jsonb_set(pg_temp.route_snapshot('D'),'{stops,1,stopNumber}','3'::jsonb)
    );
  exception when others then
    if position('ROUTE_SNAPSHOT_STOP_SEQUENCE_GAP' in sqlerrm)>0 then v_gap_denied:=true; else raise; end if;
  end;
  if not v_gap_denied then raise exception 'route sequence gap was accepted'; end if;
end;
$verify$;

-- Run B is a separate authority namespace and may be handed to Driver B.
do $verify$
declare
  v_a uuid;
  v_b uuid;
begin
  select route_snapshot_id into v_a from public.ecoflow_get_assigned_delivery_route_snapshot('2026-08-10','A');
  select route_snapshot_id into v_b
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','B','22222222-2222-4222-8222-222222222222',pg_temp.route_snapshot('B')
  );
  if v_a is null or v_b is null or v_a=v_b then raise exception 'Run A/B route authority was not isolated'; end if;
end;
$verify$;

-- DRIVER A can read only Run A, never Run B or route mutation APIs.
set app.test_role='DRIVER';
set app.test_user_id='11111111-1111-4111-8111-111111111111';
do $verify$
declare
  v_seen jsonb;
  v_other_denied boolean:=false;
  v_lock_denied boolean:=false;
  v_unlock_denied boolean:=false;
begin
  select snapshot into v_seen from public.ecoflow_get_assigned_delivery_route_snapshot('2026-08-10','A');
  if v_seen is distinct from pg_temp.route_snapshot('A') then raise exception 'Driver A did not read the exact assigned office snapshot'; end if;

  begin
    perform * from public.ecoflow_get_assigned_delivery_route_snapshot('2026-08-10','B');
  exception when sqlstate '42501' then v_other_denied:=true;
  end;
  if not v_other_denied then raise exception 'Driver A gained access to Driver B route'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot_v2(
      '2026-08-10','C','11111111-1111-4111-8111-111111111111',pg_temp.route_snapshot('C')
    );
  exception when sqlstate '42501' then v_lock_denied:=true;
  end;
  begin
    perform * from public.ecoflow_unlock_delivery_route_snapshot('2026-08-10','A','driver attempted unlock');
  exception when sqlstate '42501' then v_unlock_denied:=true;
  end;
  if not v_lock_denied then raise exception 'Driver gained route lock authority'; end if;
  if not v_unlock_denied then raise exception 'Driver gained route unlock authority'; end if;
end;
$verify$;

-- DRIVER B has the inverse visibility contract.
set app.test_user_id='22222222-2222-4222-8222-222222222222';
do $verify$
declare
  v_seen jsonb;
  v_other_denied boolean:=false;
begin
  select snapshot into v_seen from public.ecoflow_get_assigned_delivery_route_snapshot('2026-08-10','B');
  if v_seen is distinct from pg_temp.route_snapshot('B') then raise exception 'Driver B did not read the exact assigned office snapshot'; end if;
  begin
    perform * from public.ecoflow_get_assigned_delivery_route_snapshot('2026-08-10','A');
  exception when sqlstate '42501' then v_other_denied:=true;
  end;
  if not v_other_denied then raise exception 'Driver B gained access to Driver A route'; end if;
end;
$verify$;

-- Direct browser-table mutation and unassigned v1 client APIs remain unavailable.
set app.test_role='OWNER';
set app.test_user_id='33333333-3333-4333-8333-333333333333';
do $verify$
begin
  if has_table_privilege('authenticated','public.ecoflow_delivery_route_snapshots','INSERT') then
    raise exception 'authenticated gained direct route snapshot INSERT privilege';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_delivery_route_snapshots','UPDATE') then
    raise exception 'authenticated gained direct route snapshot UPDATE privilege';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_delivery_route_snapshots','DELETE') then
    raise exception 'authenticated gained direct route snapshot DELETE privilege';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_lock_delivery_route_snapshot(date,text,jsonb)','EXECUTE') then
    raise exception 'authenticated retained the unassigned v1 route-lock bypass';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_get_locked_delivery_route_snapshot(date,text)','EXECUTE') then
    raise exception 'authenticated retained the unassigned v1 route-read bypass';
  end if;
end;
$verify$;

-- Office may explicitly unlock before execution, then append a new revision and reassign it.
set app.test_role='ACCOUNT';
do $verify$
declare
  v_status text;
  v_revision integer;
  v_snapshot jsonb;
  v_driver uuid;
begin
  select route_status into v_status
  from public.ecoflow_unlock_delivery_route_snapshot('2026-08-10','A','route revised before picking');
  if v_status<>'SUPERSEDED' then raise exception 'office unlock did not supersede the active revision'; end if;

  select revision,snapshot,assigned_driver_user_id into v_revision,v_snapshot,v_driver
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','A','22222222-2222-4222-8222-222222222222',pg_temp.route_snapshot('A',' revised')
  );
  if v_revision<>2 then raise exception 're-lock did not append revision 2'; end if;
  if v_snapshot is distinct from pg_temp.route_snapshot('A',' revised') then raise exception 'revision 2 snapshot drifted from office approval'; end if;
  if v_driver<>'22222222-2222-4222-8222-222222222222'::uuid then raise exception 'explicit re-lock did not apply the new Driver assignment'; end if;
end;
$verify$;

reset app.test_role;
reset app.test_user_id;
