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

do $verify$
declare
  v_first uuid;
  v_second uuid;
  v_revision integer;
  v_conflict_denied boolean:=false;
  v_duplicate_denied boolean:=false;
  v_gap_denied boolean:=false;
begin
  select route_snapshot_id,revision into v_first,v_revision
  from public.ecoflow_lock_delivery_route_snapshot('2026-08-10','A',pg_temp.route_snapshot('A'));
  if v_first is null or v_revision<>1 then raise exception 'first lock did not create revision 1'; end if;

  select route_snapshot_id into v_second
  from public.ecoflow_lock_delivery_route_snapshot('2026-08-10','A',pg_temp.route_snapshot('A'));
  if v_second is distinct from v_first then raise exception 'identical route lock was not idempotent'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot('2026-08-10','A',pg_temp.route_snapshot('A',' changed'));
  exception when others then
    if position('ROUTE_ALREADY_LOCKED_DIFFERENT_SNAPSHOT' in sqlerrm)>0 then v_conflict_denied:=true; else raise; end if;
  end;
  if not v_conflict_denied then raise exception 'changed route replaced an already locked route'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot(
      '2026-08-10','C',
      jsonb_set(pg_temp.route_snapshot('C'),'{stops,1,orderId}','"order-1"'::jsonb)
    );
  exception when others then
    if position('ROUTE_SNAPSHOT_DUPLICATE_ORDER' in sqlerrm)>0 then v_duplicate_denied:=true; else raise; end if;
  end;
  if not v_duplicate_denied then raise exception 'duplicate order IDs were accepted'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot(
      '2026-08-10','D',
      jsonb_set(pg_temp.route_snapshot('D'),'{stops,1,stopNumber}','3'::jsonb)
    );
  exception when others then
    if position('ROUTE_SNAPSHOT_STOP_SEQUENCE_GAP' in sqlerrm)>0 then v_gap_denied:=true; else raise; end if;
  end;
  if not v_gap_denied then raise exception 'route sequence gap was accepted'; end if;
end;
$verify$;

-- Run B is a separate authority namespace for the same business day.
do $verify$
declare
  v_a uuid;
  v_b uuid;
begin
  select route_snapshot_id into v_a from public.ecoflow_get_locked_delivery_route_snapshot('2026-08-10','A');
  select route_snapshot_id into v_b from public.ecoflow_lock_delivery_route_snapshot('2026-08-10','B',pg_temp.route_snapshot('B'));
  if v_a is null or v_b is null or v_a=v_b then raise exception 'Run A/B route authority was not isolated'; end if;
end;
$verify$;

-- Driver can read the exact locked object but cannot mutate route authority.
set app.test_role='DRIVER';
do $verify$
declare
  v_seen jsonb;
  v_lock_denied boolean:=false;
  v_unlock_denied boolean:=false;
begin
  select snapshot into v_seen from public.ecoflow_get_locked_delivery_route_snapshot('2026-08-10','A');
  if v_seen is distinct from pg_temp.route_snapshot('A') then raise exception 'Driver did not read the exact office-approved snapshot'; end if;

  begin
    perform * from public.ecoflow_lock_delivery_route_snapshot('2026-08-10','C',pg_temp.route_snapshot('C'));
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

-- Direct browser-table mutation remains unavailable; all writes cross the RPC boundary.
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
end;
$verify$;

-- Office may explicitly unlock only before the UI permits execution, then lock a new append-only revision.
set app.test_role='ACCOUNT';
do $verify$
declare
  v_status text;
  v_revision integer;
  v_snapshot jsonb;
begin
  select route_status into v_status
  from public.ecoflow_unlock_delivery_route_snapshot('2026-08-10','A','route revised before picking');
  if v_status<>'SUPERSEDED' then raise exception 'office unlock did not supersede the active revision'; end if;

  select revision,snapshot into v_revision,v_snapshot
  from public.ecoflow_lock_delivery_route_snapshot('2026-08-10','A',pg_temp.route_snapshot('A',' revised'));
  if v_revision<>2 then raise exception 're-lock did not append revision 2'; end if;
  if v_snapshot is distinct from pg_temp.route_snapshot('A',' revised') then raise exception 'revision 2 snapshot drifted from office approval'; end if;
end;
$verify$;

reset app.test_role;
