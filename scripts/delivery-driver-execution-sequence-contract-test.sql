\set ON_ERROR_STOP on

create or replace function pg_temp.execution_route_snapshot(p_run_code text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'version',1,
    'businessDay','2026-08-11',
    'runCode',p_run_code,
    'routeId','run-'||lower(p_run_code),
    'routeLabel','Run '||p_run_code,
    'totalCartons',6,
    'readyStops',3,
    'warehousePoint',jsonb_build_object('x',0.08,'y',0.5),
    'geoProjected',false,
    'stops',jsonb_build_array(
      jsonb_build_object(
        'orderId','seq-order-1','stopNumber',1,'boxCode','A','store','Sequence Cafe One',
        'address','1 North Terrace, Adelaide SA 5000','suburb','Adelaide','orderNo','SEQ-1','invoiceNo','SEQ-INV-1',
        'cartons',1,'eta','09:00','lines','[]'::jsonb,'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.3,'y',0.4)
      ),
      jsonb_build_object(
        'orderId','seq-order-2','stopNumber',2,'boxCode','B','store','Sequence Cafe Two',
        'address','2 Hutt Street, Adelaide SA 5000','suburb','Adelaide','orderNo','SEQ-2','invoiceNo','SEQ-INV-2',
        'cartons',2,'eta','09:30','lines','[]'::jsonb,'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.5,'y',0.5)
      ),
      jsonb_build_object(
        'orderId','seq-order-3','stopNumber',3,'boxCode','C','store','Sequence Cafe Three',
        'address','3 King William Street, Adelaide SA 5000','suburb','Adelaide','orderNo','SEQ-3','invoiceNo','SEQ-INV-3',
        'cartons',3,'eta','10:00','lines','[]'::jsonb,'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.7,'y',0.6)
      )
    )
  )
$$;

-- Office creates immutable dispatch authority. Sequence authority begins at
-- revision zero and reflects the approved stop order until a Driver changes it.
set app.test_role='ACCOUNT';
set app.test_user_id='33333333-3333-4333-8333-333333333333';

do $setup$
declare
  v_route uuid;
  v_sequence bigint;
  v_order text[];
begin
  select route_snapshot_id into v_route
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-11','E','11111111-1111-4111-8111-111111111111',pg_temp.execution_route_snapshot('E')
  );
  if v_route is null then raise exception 'execution sequence fixture route was not locked'; end if;

  select sequence_revision,stop_order into v_sequence,v_order
  from public.ecoflow_get_delivery_route_execution_sequence('2026-08-11','E');
  if v_sequence<>0 then raise exception 'initial execution sequence must start at revision zero'; end if;
  if v_order<>array['seq-order-1','seq-order-2','seq-order-3']::text[] then
    raise exception 'initial execution order drifted from office snapshot: %',v_order;
  end if;
end;
$setup$;

-- Assigned Driver may reorder only the sequence. ETA slots follow route position;
-- box/address/carton/order facts remain attached to their original order.
set app.test_role='DRIVER';
set app.test_user_id='11111111-1111-4111-8111-111111111111';

do $driver_valid$
declare
  v_sequence bigint;
  v_order text[];
  v_snapshot jsonb;
  v_status text;
  v_first jsonb;
  v_second jsonb;
  v_read_snapshot jsonb;
begin
  select sequence_revision,stop_order,snapshot,command_status
    into v_sequence,v_order,v_snapshot,v_status
  from public.ecoflow_reorder_delivery_route_execution(
    '2026-08-11','E',0,'10000000-0000-4000-8000-000000000001',
    array['seq-order-2','seq-order-1','seq-order-3']::text[]
  );
  if v_status<>'APPLIED' or v_sequence<>1 then raise exception 'valid Driver reorder did not append revision 1'; end if;
  if v_order<>array['seq-order-2','seq-order-1','seq-order-3']::text[] then raise exception 'valid Driver reorder returned wrong order'; end if;

  v_first:=v_snapshot->'stops'->0;
  v_second:=v_snapshot->'stops'->1;
  if v_first->>'orderId'<>'seq-order-2' or (v_first->>'stopNumber')::int<>1 then raise exception 'effective sequence did not move order 2 to stop 1'; end if;
  if v_first->>'eta'<>'09:00' then raise exception 'ETA did not follow route position after reorder'; end if;
  if v_first->>'boxCode'<>'B' or v_first->>'address'<>'2 Hutt Street, Adelaide SA 5000' or (v_first->>'cartons')::int<>2 then
    raise exception 'reorder mutated immutable dispatch facts for order 2';
  end if;
  if v_second->>'orderId'<>'seq-order-1' or v_second->>'eta'<>'09:30' or v_second->>'boxCode'<>'A' then
    raise exception 'second route position did not preserve order facts + ETA slot coupling';
  end if;

  -- Existing assigned-route read API is the downstream office/Driver source and
  -- must now return the same effective sequence, never the stale office order.
  select snapshot into v_read_snapshot
  from public.ecoflow_get_assigned_delivery_route_snapshot('2026-08-11','E');
  if v_read_snapshot->'stops'->0->>'orderId'<>'seq-order-2' or v_read_snapshot->'stops'->0->>'eta'<>'09:00' then
    raise exception 'assigned route read remained tied to stale office sequence/ETA';
  end if;

  -- Same key + same intent is a replay, not a second revision.
  select sequence_revision,command_status into v_sequence,v_status
  from public.ecoflow_reorder_delivery_route_execution(
    '2026-08-11','E',0,'10000000-0000-4000-8000-000000000001',
    array['seq-order-2','seq-order-1','seq-order-3']::text[]
  );
  if v_sequence<>1 or v_status<>'REPLAYED' then raise exception 'idempotent reorder replay was not stable'; end if;
end;
$driver_valid$;

-- Malformed/tampered permutations and stale writers fail closed.
do $driver_rejections$
declare
  v_denied boolean;
begin
  v_denied:=false;
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',1,'10000000-0000-4000-8000-000000000002',
      array['seq-order-2','seq-order-2','seq-order-3']::text[]
    );
  exception when others then
    if position('STOP_ORDER_DUPLICATE_STOP' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'duplicate stop reorder was accepted'; end if;

  v_denied:=false;
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',1,'10000000-0000-4000-8000-000000000003',
      array['seq-order-2','seq-order-1']::text[]
    );
  exception when others then
    if position('STOP_ORDER_ROUTE_MEMBERSHIP_MISMATCH' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'missing stop reorder was accepted'; end if;

  v_denied:=false;
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',1,'10000000-0000-4000-8000-000000000004',
      array['seq-order-2','seq-order-1','foreign-order']::text[]
    );
  exception when others then
    if position('STOP_ORDER_ROUTE_MEMBERSHIP_MISMATCH' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'foreign stop reorder was accepted'; end if;

  v_denied:=false;
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',0,'10000000-0000-4000-8000-000000000005',
      array['seq-order-1','seq-order-2','seq-order-3']::text[]
    );
  exception when sqlstate '40001' then
    if position('ROUTE_SEQUENCE_REVISION_CONFLICT' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'stale sequence revision was accepted'; end if;

  v_denied:=false;
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',1,'10000000-0000-4000-8000-000000000001',
      array['seq-order-2','seq-order-3','seq-order-1']::text[]
    );
  exception when others then
    if position('ROUTE_SEQUENCE_COMMAND_ID_REUSE_MISMATCH' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'command id reuse with different intent was accepted'; end if;
end;
$driver_rejections$;

-- Different Driver cannot read or mutate this route.
set app.test_user_id='22222222-2222-4222-8222-222222222222';
do $cross_driver$
declare
  v_read_denied boolean:=false;
  v_write_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_get_delivery_route_execution_sequence('2026-08-11','E');
  exception when sqlstate '42501' then v_read_denied:=true;
  end;
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',1,'10000000-0000-4000-8000-000000000006',
      array['seq-order-2','seq-order-3','seq-order-1']::text[]
    );
  exception when sqlstate '42501' then v_write_denied:=true;
  end;
  if not v_read_denied then raise exception 'different Driver read assigned execution sequence'; end if;
  if not v_write_denied then raise exception 'different Driver mutated assigned execution sequence'; end if;
end;
$cross_driver$;

-- Once the authoritative day-state says a stop has begun execution, that stop
-- position freezes. ARRIVED covers current/in-progress; closed states use the
-- same invariant and cannot re-enter at a different position later.
set app.test_user_id='11111111-1111-4111-8111-111111111111';
insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
values('2026-08-11','run:E:stop:seq-order-2','{"status":"ARRIVED","arrivedAt":"2026-08-11T09:01:00Z"}'::jsonb,'Driver A');

do $executed_position$
declare
  v_denied boolean:=false;
  v_count integer;
begin
  begin
    perform * from public.ecoflow_reorder_delivery_route_execution(
      '2026-08-11','E',1,'10000000-0000-4000-8000-000000000007',
      array['seq-order-1','seq-order-2','seq-order-3']::text[]
    );
  exception when others then
    if position('EXECUTED_STOP_POSITION_IMMUTABLE' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'ARRIVED/current stop was moved behind another stop'; end if;

  select count(*) into v_count
  from public.ecoflow_delivery_route_sequence_revisions s
  join public.ecoflow_delivery_route_snapshots r on r.id=s.route_snapshot_id
  where r.business_day='2026-08-11' and r.run_code='E';
  if v_count<>1 then raise exception 'rejected reorders created append-only sequence rows'; end if;
end;
$executed_position$;

-- Direct browser mutation of history is never granted.
set app.test_role='OWNER';
set app.test_user_id='33333333-3333-4333-8333-333333333333';
do $acl$
begin
  if has_table_privilege('authenticated','public.ecoflow_delivery_route_sequence_revisions','INSERT')
     or has_table_privilege('authenticated','public.ecoflow_delivery_route_sequence_revisions','UPDATE')
     or has_table_privilege('authenticated','public.ecoflow_delivery_route_sequence_revisions','DELETE') then
    raise exception 'authenticated gained direct execution-sequence history mutation privilege';
  end if;
end;
$acl$;

reset app.test_role;
reset app.test_user_id;
